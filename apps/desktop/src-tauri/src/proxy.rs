// The polling proxy: once a second, GETs the sidecar's `/frame` with the
// bearer token and forwards it to the subscribed Channel whenever it differs
// from the last frame forwarded (any field: tick, events, status, reason,
// summary). Also relays pause, resume,
// and presentation-receipt requests, all authenticated the same way.
//
// The webview never holds the token: only this module ever sends it, in
// an `Authorization` header, over plain HTTP to 127.0.0.1.

use std::time::Duration;

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::state::{should_forward, FrameKey, Lifecycle, SidecarState};

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .expect("reqwest client failed to build")
}

fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

pub(crate) fn extract_frame_key(frame: &Value) -> Option<FrameKey> {
    Some(FrameKey {
        sequence: frame.get("sequence")?.as_u64()?,
        status: frame.get("status")?.as_str()?.to_string(),
        session_id: frame.get("sessionId")?.as_str()?.to_string(),
        frame: frame.clone(),
    })
}

/// Given the cached last-polled frame body (if any), what a newly (or
/// re-)subscribing Channel should be sent immediately, and the key to
/// mark as last-forwarded once that send succeeds -- so the webview
/// never waits up to a second for the next poll to see the world's
/// current state, and a reload replays it again rather than waiting for
/// the next change.
pub(crate) fn replay_target(cached: Option<&Value>) -> Option<(Value, FrameKey)> {
    let body = cached?;
    let key = extract_frame_key(body)?;
    Some((body.clone(), key))
}

/// What handling a polled frame should do, or `None` to drop it
/// entirely (untouched state, no cache, no forward, no tray refresh).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FrameDecision {
    pub(crate) forward: bool,
    pub(crate) refresh_tray: bool,
}

/// Decides how to handle one polled frame.
///
/// A frame whose `frame_launch_id` no longer matches the launch
/// currently tracked (`current_launch_id`) is dropped entirely: a
/// restart or a termination ends the launch, and a frame still in
/// flight from the previous launch's poll loop (a task-cancellation
/// race) must never reach the webview or change any state.
///
/// For a current-launch frame: `forward` is true when the frame differs
/// from the last one forwarded (`should_forward`); `refresh_tray` fires on
/// either a status change or a degraded-reason change, so a reason
/// changing while the status stays `"degraded"` still updates the label.
pub(crate) fn decide_frame_handling(
    current_launch_id: u64,
    frame_launch_id: u64,
    last_frame: Option<&FrameKey>,
    current_key: &FrameKey,
    previous_status: Option<&str>,
    previous_degraded_reason: Option<&str>,
    new_degraded_reason: Option<&str>,
) -> Option<FrameDecision> {
    if current_launch_id != frame_launch_id {
        return None;
    }
    let forward = should_forward(last_frame, current_key);
    let status_changed = previous_status != Some(current_key.status.as_str());
    let reason_changed = previous_degraded_reason != new_degraded_reason;
    Some(FrameDecision {
        forward,
        refresh_tray: status_changed || reason_changed,
    })
}

/// The exact value forwarded to the webview's Channel: the sidecar's own
/// frame body, verbatim. This is the one seam where a future change
/// could accidentally attach anything (a token, a header) to the
/// outgoing payload, and is unit-tested to prove it never does.
fn forwarded_payload(frame: Value) -> Value {
    frame
}

/// GETs `/frame` with the bearer token and parses its JSON body. The one
/// place this shell ever sends the token, and the one place a polled
/// frame's shape is decoded.
pub async fn fetch_frame(port: u16, token: &str) -> Result<Value, String> {
    let response = client()
        .get(format!("{}/frame", base_url(port)))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("unexpected status {}", response.status()));
    }
    response.json().await.map_err(|error| error.to_string())
}

/// Spawns the poll task for one sidecar launch, tagged with
/// `launch_id` (the id the launch was minted with) so every frame it
/// hands to `handle_frame` can be checked against whatever launch is
/// current by the time it arrives. Runs until aborted (on restart,
/// termination, or explicit stop) -- an HTTP failure or non-success
/// status logs and waits for the next tick rather than stopping the loop.
pub fn start_polling(
    app: AppHandle,
    port: u16,
    token: String,
    launch_id: u64,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;

            match fetch_frame(port, &token).await {
                Ok(frame) => handle_frame(&app, frame, launch_id),
                Err(error) => {
                    eprintln!("panthea-desktop: /frame poll failed: {error}");
                }
            }
        }
    })
}

/// Applies one polled frame to `lifecycle`: the launch-id check, the
/// forward/refresh decision, the world-status and cached-body update,
/// the channel send, and the last-forwarded mark, all under the
/// caller's single lock on `lifecycle` -- so nothing else can observe
/// or land a change in the middle of handling one frame. Returns
/// whether the tray should be refreshed; the caller does that after
/// releasing the lock, since `tray::refresh` takes its own locks.
///
/// A stale-launch frame (`frame_launch_id` no longer matches
/// `lifecycle.launch_id`) leaves every field of `lifecycle` untouched
/// and returns `false`.
pub(crate) fn apply_frame(lifecycle: &mut Lifecycle, frame_launch_id: u64, frame: Value) -> bool {
    let Some(key) = extract_frame_key(&frame) else {
        eprintln!("panthea-desktop: /frame response missing sequence/status/sessionId");
        return false;
    };
    let new_degraded_reason = frame
        .get("degradedReason")
        .and_then(Value::as_str)
        .map(str::to_string);

    let decision = decide_frame_handling(
        lifecycle.launch_id,
        frame_launch_id,
        lifecycle.last_frame.as_ref(),
        &key,
        lifecycle.world.status.as_deref(),
        lifecycle.world.degraded_reason.as_deref(),
        new_degraded_reason.as_deref(),
    );
    let Some(decision) = decision else {
        return false;
    };

    lifecycle.world.status = Some(key.status.clone());
    lifecycle.world.degraded_reason = new_degraded_reason;
    lifecycle.last_frame_body = Some(frame.clone());

    if decision.forward {
        if let Some(channel) = lifecycle.channel.as_ref() {
            match channel.send(forwarded_payload(frame)) {
                Ok(()) => {
                    lifecycle.last_frame = Some(key);
                }
                Err(error) => {
                    eprintln!("panthea-desktop: failed to forward frame to the webview: {error}");
                }
            }
        }
    }

    decision.refresh_tray
}

/// Installs `frames` as the subscribed channel and, if a frame has ever
/// been cached, replays it immediately -- all under the caller's single
/// lock on `lifecycle`, so a poll landing between the replay and the
/// channel install can never be missed or delivered twice.
pub(crate) fn apply_subscribe(lifecycle: &mut Lifecycle, frames: Channel<Value>) {
    if let Some((body, key)) = replay_target(lifecycle.last_frame_body.as_ref()) {
        match frames.send(body) {
            Ok(()) => {
                lifecycle.last_frame = Some(key);
            }
            Err(error) => {
                eprintln!(
                    "panthea-desktop: failed to replay the cached frame to a new subscriber: {error}"
                );
            }
        }
    }
    lifecycle.channel = Some(frames);
}

fn handle_frame(app: &AppHandle, frame: Value, frame_launch_id: u64) {
    let state = app.state::<SidecarState>();
    let refresh_tray = {
        let mut lifecycle = state
            .lifecycle
            .lock()
            .expect("sidecar state mutex poisoned");
        apply_frame(&mut lifecycle, frame_launch_id, frame)
    };

    if refresh_tray {
        crate::tray::refresh(app);
    }
}

async fn post_empty(port: u16, token: &str, path: &str) -> Result<(), String> {
    client()
        .post(format!("{}{}", base_url(port), path))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| error.to_string())
        .and_then(|response| {
            if response.status().is_success() {
                Ok(())
            } else {
                Err(format!("unexpected status {}", response.status()))
            }
        })
}

pub async fn pause(port: u16, token: &str) -> Result<(), String> {
    post_empty(port, token, "/pause").await
}

pub async fn resume(port: u16, token: &str) -> Result<(), String> {
    post_empty(port, token, "/resume").await
}

/// What a receipt is refused with when the session it was drawn under is not
/// the sidecar's current one. The webview matches this exact string.
pub const STALE_SESSION: &str = "stale-session";

/// Relays a presentation receipt for `event_id`, attributed to the session the
/// webview drew it under (`presented_session`), only while that is the
/// sidecar's current session (`current_session`, the last frame's). A receipt
/// held across a sidecar restart is refused, never relayed: stamping it with
/// the new session would record a presentation under a session that never
/// drew the event. With no frame yet there is no session to check against.
pub(crate) async fn relay_receipt(
    port: u16,
    token: &str,
    current_session: Option<&str>,
    presented_session: &str,
    event_id: &str,
) -> Result<(), String> {
    match current_session {
        None => Err("no frame received yet".to_string()),
        Some(current) if current != presented_session => Err(STALE_SESSION.to_string()),
        Some(_) => present_event(port, token, presented_session, event_id).await,
    }
}

/// Relays a presentation receipt: the event the operator has just seen
/// rendered, attributed to `session_id`.
pub async fn present_event(
    port: u16,
    token: &str,
    session_id: &str,
    event_id: &str,
) -> Result<(), String> {
    let body = serde_json::json!({ "eventId": event_id, "sessionId": session_id });
    let response = client()
        .post(format!("{}/receipts", base_url(port)))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("unexpected status {}", response.status()))
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::state::begin_spawn;

    /// A loopback HTTP server that answers every request 200 and records each
    /// request body, so a test can tell whether a receipt was relayed at all.
    fn receipt_server() -> (u16, Arc<Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
        let port = listener.local_addr().expect("local addr").port();
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&bodies);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                let body = loop {
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    if read == 0 {
                        break String::new();
                    }
                    request.extend_from_slice(&buffer[..read]);
                    let text = String::from_utf8_lossy(&request).to_string();
                    if let Some((head, body)) = text.split_once("\r\n\r\n") {
                        let length = head
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|value| value.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if body.len() >= length {
                            break body.to_string();
                        }
                    }
                };
                recorded.lock().expect("bodies mutex").push(body);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-length: 11\r\nconnection: close\r\n\r\n{\"ok\":true}",
                );
            }
        });
        (port, bodies)
    }

    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime")
            .block_on(future)
    }

    #[test]
    fn a_receipt_for_an_old_session_is_refused_as_stale_and_never_relayed() {
        let (port, bodies) = receipt_server();

        let result = block_on(relay_receipt(
            port,
            "a-token",
            Some("session-2"),
            "session-1",
            "evt-1-1",
        ));

        assert_eq!(result, Err(STALE_SESSION.to_string()));
        assert!(
            bodies.lock().expect("bodies mutex").is_empty(),
            "a stale receipt must not reach the service"
        );
    }

    #[test]
    fn a_receipt_for_the_current_session_is_relayed_with_that_session() {
        let (port, bodies) = receipt_server();

        let result = block_on(relay_receipt(
            port,
            "a-token",
            Some("session-2"),
            "session-2",
            "evt-2-1",
        ));

        assert_eq!(result, Ok(()));
        let bodies = bodies.lock().expect("bodies mutex");
        assert_eq!(bodies.len(), 1);
        let sent: Value = serde_json::from_str(&bodies[0]).expect("a JSON body");
        assert_eq!(
            sent,
            serde_json::json!({ "eventId": "evt-2-1", "sessionId": "session-2" })
        );
    }

    #[test]
    fn a_receipt_before_any_frame_is_refused_without_a_relay() {
        let (port, bodies) = receipt_server();

        let result = block_on(relay_receipt(port, "a-token", None, "session-1", "evt-1-1"));

        assert_eq!(result, Err("no frame received yet".to_string()));
        assert!(bodies.lock().expect("bodies mutex").is_empty());
    }

    fn sample_frame() -> Value {
        serde_json::json!({
            "schemaVersion": 1,
            "sequence": 5,
            "worldId": "world-1",
            "sessionId": "session-1",
            "status": "running",
            "state": { "tick": 5 }
        })
    }

    fn key(sequence: u64, status: &str, session_id: &str) -> FrameKey {
        FrameKey {
            sequence,
            status: status.to_string(),
            session_id: session_id.to_string(),
            frame: serde_json::json!({
                "sequence": sequence, "status": status, "sessionId": session_id
            }),
        }
    }

    #[test]
    fn nothing_cached_has_nothing_to_replay() {
        assert!(replay_target(None).is_none());
    }

    #[test]
    fn a_cached_frame_replays_its_body_and_extracted_key() {
        let frame = sample_frame();
        let (body, replayed_key) = replay_target(Some(&frame)).expect("replay target");
        assert_eq!(body, frame);
        assert_eq!(replayed_key.sequence, 5);
        assert_eq!(replayed_key.session_id, "session-1");
    }

    #[test]
    fn a_malformed_cached_frame_has_nothing_to_replay() {
        let malformed = serde_json::json!({ "not": "a real frame" });
        assert!(replay_target(Some(&malformed)).is_none());
    }

    #[test]
    fn a_stale_launch_id_drops_the_frame_entirely() {
        let previous = key(1, "running", "s1");
        let current = key(2, "running", "s1");
        let decision =
            decide_frame_handling(2, 1, Some(&previous), &current, Some("running"), None, None);
        assert!(decision.is_none());
    }

    #[test]
    fn a_current_launch_id_with_no_status_or_reason_change_forwards_without_refreshing_the_tray() {
        let previous = key(3, "running", "s1");
        let current = key(4, "running", "s1");
        let decision =
            decide_frame_handling(1, 1, Some(&previous), &current, Some("running"), None, None)
                .expect("decision");
        assert!(decision.forward);
        assert!(!decision.refresh_tray);
    }

    #[test]
    fn a_status_change_refreshes_the_tray() {
        let previous = key(1, "running", "s1");
        let current = key(2, "paused", "s1");
        let decision =
            decide_frame_handling(1, 1, Some(&previous), &current, Some("running"), None, None)
                .expect("decision");
        assert!(decision.refresh_tray);
    }

    #[test]
    fn a_degraded_reason_change_with_an_unchanged_status_still_refreshes_the_tray() {
        let previous = key(3, "degraded", "s1");
        let current = key(4, "degraded", "s1");
        let decision = decide_frame_handling(
            1,
            1,
            Some(&previous),
            &current,
            Some("degraded"),
            Some("disk-full"),
            Some("store-error"),
        )
        .expect("decision");
        assert!(decision.refresh_tray);
    }

    #[test]
    fn an_identical_frame_does_not_forward_or_refresh_the_tray() {
        let frame = key(5, "running", "s1");
        let decision =
            decide_frame_handling(1, 1, Some(&frame), &frame, Some("running"), None, None)
                .expect("decision");
        assert!(!decision.forward);
        assert!(!decision.refresh_tray);
    }

    #[test]
    fn a_request_to_a_server_that_never_responds_times_out_well_under_five_seconds() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a loopback port");
        let port = listener.local_addr().expect("local addr").port();
        std::thread::spawn(move || {
            // Accept and hold the connection open without ever writing a
            // response, so the client's own timeout is what ends the call.
            if let Ok((stream, _)) = listener.accept() {
                std::thread::sleep(Duration::from_secs(30));
                drop(stream);
            }
        });

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        let started = std::time::Instant::now();
        let result = runtime.block_on(fetch_frame(port, "a-token"));
        let elapsed = started.elapsed();

        assert!(result.is_err());
        assert!(
            elapsed < Duration::from_secs(5),
            "fetch_frame took {elapsed:?}, expected it to time out well under 5s"
        );
    }

    #[test]
    fn extracts_the_key_fields_from_a_well_formed_frame() {
        let key = extract_frame_key(&sample_frame()).expect("frame key");
        assert_eq!(key.sequence, 5);
        assert_eq!(key.status, "running");
        assert_eq!(key.session_id, "session-1");
    }

    #[test]
    fn a_frame_missing_a_key_field_extracts_nothing() {
        let mut frame = sample_frame();
        frame.as_object_mut().unwrap().remove("sessionId");
        assert!(extract_frame_key(&frame).is_none());
    }

    #[test]
    fn the_forwarded_payload_never_contains_the_token() {
        let token = "a-super-secret-launch-token-value";
        let forwarded = forwarded_payload(sample_frame());
        let serialized = serde_json::to_string(&forwarded).expect("serialize");
        assert!(!serialized.contains(token));
    }

    #[test]
    fn the_forwarded_payload_is_the_frame_verbatim() {
        let frame = sample_frame();
        assert_eq!(forwarded_payload(frame.clone()), frame);
    }

    #[test]
    fn a_stale_launch_id_leaves_lifecycle_untouched_and_a_subscribe_then_handle_sequence_delivers_in_order_with_no_stale_replay(
    ) {
        let mut lifecycle = Lifecycle {
            launch_id: 2,
            ..Default::default()
        };

        // A frame tagged with a superseded launch id is dropped
        // entirely -- every field of Lifecycle stays exactly as it was.
        let stale = serde_json::json!({ "sequence": 99, "status": "running", "sessionId": "old" });
        let refreshed = apply_frame(&mut lifecycle, 1, stale);
        assert!(!refreshed);
        assert_eq!(lifecycle.launch_id, 2);
        assert_eq!(lifecycle.last_frame, None);
        assert_eq!(lifecycle.last_frame_body, None);
        assert_eq!(lifecycle.world, Default::default());

        // A frame for the current launch lands before any subscriber
        // exists: cached, but nothing to deliver yet.
        let frame1 = serde_json::json!({ "sequence": 1, "status": "running", "sessionId": "s2" });
        apply_frame(&mut lifecycle, 2, frame1.clone());
        assert_eq!(lifecycle.last_frame_body, Some(frame1.clone()));

        // A subscriber now arrives: it receives exactly that cached
        // frame immediately, not anything from before the launch bump.
        let delivered = Arc::new(Mutex::new(Vec::<Value>::new()));
        let sink = delivered.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                if let Ok(value) = serde_json::from_str::<Value>(&json) {
                    sink.lock().expect("delivered mutex poisoned").push(value);
                }
            }
            Ok(())
        });
        apply_subscribe(&mut lifecycle, channel);

        // The next two polled frames are forwarded in sequence order.
        let frame2 = serde_json::json!({ "sequence": 2, "status": "running", "sessionId": "s2" });
        let frame3 = serde_json::json!({ "sequence": 3, "status": "paused", "sessionId": "s2" });
        apply_frame(&mut lifecycle, 2, frame2.clone());
        apply_frame(&mut lifecycle, 2, frame3.clone());

        let received = delivered.lock().expect("delivered mutex poisoned");
        assert_eq!(*received, vec![frame1, frame2, frame3]);
    }

    /// A channel that records every body sent to it, and the sink to read them from.
    fn recording_channel() -> (Channel<Value>, Arc<Mutex<Vec<Value>>>) {
        let delivered = Arc::new(Mutex::new(Vec::<Value>::new()));
        let sink = delivered.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                if let Ok(value) = serde_json::from_str::<Value>(&json) {
                    sink.lock().expect("delivered mutex poisoned").push(value);
                }
            }
            Ok(())
        });
        (channel, delivered)
    }

    /// A polled frame: what the sidecar's `/frame` carries beyond the
    /// sequence, status, and session the shell used to compare.
    fn polled(sequence: u64, tick: u64, status: &str) -> Value {
        serde_json::json!({
            "schemaVersion": 1,
            "sequence": sequence,
            "worldId": "world-1",
            "sessionId": "session-1",
            "status": status,
            "recentEvents": [],
            "state": { "tick": tick }
        })
    }

    /// A lifecycle for launch 1 with a recording subscriber installed.
    fn subscribed() -> (Lifecycle, Arc<Mutex<Vec<Value>>>) {
        let mut lifecycle = Lifecycle {
            launch_id: 1,
            ..Default::default()
        };
        let (channel, delivered) = recording_channel();
        apply_subscribe(&mut lifecycle, channel);
        (lifecycle, delivered)
    }

    #[test]
    fn an_eventless_tick_that_advances_time_without_a_new_sequence_is_forwarded() {
        let (mut lifecycle, delivered) = subscribed();
        let first = polled(5, 10, "running");
        let next_tick = polled(5, 11, "running");

        apply_frame(&mut lifecycle, 1, first.clone());
        apply_frame(&mut lifecycle, 1, next_tick.clone());

        let received = delivered.lock().expect("delivered mutex poisoned");
        assert_eq!(*received, vec![first, next_tick]);
    }

    #[test]
    fn a_degraded_reason_change_with_an_unchanged_status_is_forwarded() {
        let (mut lifecycle, delivered) = subscribed();
        let mut disk_full = polled(5, 10, "degraded");
        disk_full["degradedReason"] = serde_json::json!("disk-full");
        let mut store_error = polled(5, 10, "degraded");
        store_error["degradedReason"] = serde_json::json!("store-error");

        apply_frame(&mut lifecycle, 1, disk_full.clone());
        let refreshed = apply_frame(&mut lifecycle, 1, store_error.clone());

        assert!(refreshed, "the tray still learns of the new reason");
        let received = delivered.lock().expect("delivered mutex poisoned");
        assert_eq!(*received, vec![disk_full, store_error]);
    }

    #[test]
    fn a_catch_up_summary_that_appears_or_changes_with_nothing_else_different_is_forwarded() {
        let (mut lifecycle, delivered) = subscribed();
        let plain = polled(5, 10, "running");
        let mut summarized = plain.clone();
        summarized["catchUpSummary"] = serde_json::json!({
            "id": "summary-a", "appliedMs": 60000, "skippedMs": 0, "majorOutcomes": [], "atSequence": 4
        });
        let mut replaced = summarized.clone();
        replaced["catchUpSummary"]["atSequence"] = serde_json::json!(5);
        replaced["catchUpSummary"]["id"] = serde_json::json!("summary-b");

        apply_frame(&mut lifecycle, 1, plain.clone());
        apply_frame(&mut lifecycle, 1, summarized.clone());
        apply_frame(&mut lifecycle, 1, replaced.clone());

        let received = delivered.lock().expect("delivered mutex poisoned");
        assert_eq!(*received, vec![plain, summarized, replaced]);
    }

    #[test]
    fn a_replacement_summary_at_the_same_sequence_is_forwarded_when_only_its_id_differs() {
        let (mut lifecycle, delivered) = subscribed();
        let mut first = polled(5, 10, "running");
        first["catchUpSummary"] = serde_json::json!({
            "id": "summary-a", "appliedMs": 60000, "skippedMs": 0, "majorOutcomes": [], "atSequence": 4
        });
        let mut replacement = first.clone();
        replacement["catchUpSummary"]["id"] = serde_json::json!("summary-b");

        apply_frame(&mut lifecycle, 1, first.clone());
        // The same summary, repeated by the next poll: nothing to send.
        apply_frame(&mut lifecycle, 1, first.clone());
        apply_frame(&mut lifecycle, 1, replacement.clone());

        let received = delivered.lock().expect("delivered mutex poisoned");
        assert_eq!(*received, vec![first, replacement]);
    }

    #[test]
    fn a_change_only_in_the_recent_event_window_is_forwarded() {
        let (mut lifecycle, delivered) = subscribed();
        let quiet = polled(5, 10, "running");
        let mut windowed = quiet.clone();
        windowed["recentEvents"] = serde_json::json!([
            { "id": "evt-1", "sequence": 5, "tick": 10, "kind": "resource-traded", "subjects": [] }
        ]);

        apply_frame(&mut lifecycle, 1, quiet.clone());
        apply_frame(&mut lifecycle, 1, windowed.clone());

        let received = delivered.lock().expect("delivered mutex poisoned");
        assert_eq!(*received, vec![quiet, windowed]);
    }

    #[test]
    fn a_frame_identical_to_the_last_forwarded_one_is_not_sent_again() {
        let (mut lifecycle, delivered) = subscribed();
        let frame = polled(5, 10, "paused");

        apply_frame(&mut lifecycle, 1, frame.clone());
        apply_frame(&mut lifecycle, 1, frame.clone());
        apply_frame(&mut lifecycle, 1, frame.clone());

        let received = delivered.lock().expect("delivered mutex poisoned");
        assert_eq!(*received, vec![frame]);
    }

    #[test]
    fn a_stale_launch_frame_is_not_forwarded_even_when_it_differs() {
        let (mut lifecycle, delivered) = subscribed();
        lifecycle.launch_id = 2;

        let refreshed = apply_frame(&mut lifecycle, 1, polled(9, 99, "running"));

        assert!(!refreshed);
        assert!(delivered
            .lock()
            .expect("delivered mutex poisoned")
            .is_empty());
        assert_eq!(lifecycle.last_frame_body, None);
    }

    #[test]
    fn resubscribing_replays_the_latest_cached_frame_including_one_changed_only_by_a_tick() {
        let mut lifecycle = Lifecycle {
            launch_id: 1,
            ..Default::default()
        };
        // Polled with no subscriber: cached, nothing to send.
        apply_frame(&mut lifecycle, 1, polled(5, 10, "running"));
        let latest = polled(5, 11, "running");
        apply_frame(&mut lifecycle, 1, latest.clone());

        let (channel, delivered) = recording_channel();
        apply_subscribe(&mut lifecycle, channel);
        assert_eq!(
            *delivered.lock().expect("delivered mutex poisoned"),
            vec![latest.clone()]
        );

        // The same frame polled again is not re-sent to that subscriber.
        apply_frame(&mut lifecycle, 1, latest.clone());
        assert_eq!(delivered.lock().expect("delivered mutex poisoned").len(), 1);

        // A reload subscribes again and is replayed the cache once more.
        let (reloaded, reloaded_delivered) = recording_channel();
        apply_subscribe(&mut lifecycle, reloaded);
        assert_eq!(
            *reloaded_delivered.lock().expect("delivered mutex poisoned"),
            vec![latest]
        );
    }

    #[test]
    fn a_replay_on_subscribe_then_an_identical_poll_is_not_forwarded_and_a_changed_poll_is() {
        let mut lifecycle = Lifecycle {
            launch_id: 1,
            ..Default::default()
        };
        // Polled before any subscriber: cached, not yet forwarded.
        let cached = polled(5, 10, "running");
        apply_frame(&mut lifecycle, 1, cached.clone());
        assert_eq!(lifecycle.last_frame, None);

        // Subscribing replays the cache and marks it as the last forwarded frame.
        let (channel, delivered) = recording_channel();
        apply_subscribe(&mut lifecycle, channel);
        assert_eq!(
            *delivered.lock().expect("delivered mutex poisoned"),
            vec![cached.clone()]
        );
        assert_eq!(lifecycle.last_frame, extract_frame_key(&cached));
        assert_eq!(lifecycle.last_frame_body, Some(cached.clone()));

        // The next poll returns the very same frame: nothing is sent, and the
        // last-forwarded and cached state are exactly as the replay left them.
        apply_frame(&mut lifecycle, 1, cached.clone());
        assert_eq!(delivered.lock().expect("delivered mutex poisoned").len(), 1);
        assert_eq!(lifecycle.last_frame, extract_frame_key(&cached));
        assert_eq!(lifecycle.last_frame_body, Some(cached.clone()));

        // A poll that differs only by tick is forwarded and becomes the new baseline.
        let advanced = polled(5, 11, "running");
        apply_frame(&mut lifecycle, 1, advanced.clone());
        assert_eq!(
            *delivered.lock().expect("delivered mutex poisoned"),
            vec![cached, advanced.clone()]
        );
        assert_eq!(lifecycle.last_frame, extract_frame_key(&advanced));
        assert_eq!(lifecycle.last_frame_body, Some(advanced));
    }

    #[test]
    fn apply_frame_signals_a_tray_refresh_for_a_reason_change_with_an_unchanged_status_only() {
        let (mut lifecycle, delivered) = subscribed();
        let mut disk_full = polled(5, 10, "degraded");
        disk_full["degradedReason"] = serde_json::json!("disk-full");
        let mut store_error = polled(5, 10, "degraded");
        store_error["degradedReason"] = serde_json::json!("store-error");

        // The first degraded frame changes the status: the tray refreshes.
        assert!(apply_frame(&mut lifecycle, 1, disk_full.clone()));
        // Same status, new reason: the tray refreshes, and the frame is forwarded.
        assert!(apply_frame(&mut lifecycle, 1, store_error.clone()));
        assert_eq!(
            lifecycle.world.degraded_reason.as_deref(),
            Some("store-error")
        );
        // The identical frame again: no tray refresh, and nothing sent.
        assert!(!apply_frame(&mut lifecycle, 1, store_error.clone()));
        // A tick-only change forwards the frame but leaves the tray alone.
        let mut later = store_error.clone();
        later["state"]["tick"] = serde_json::json!(11);
        assert!(!apply_frame(&mut lifecycle, 1, later.clone()));

        assert_eq!(
            *delivered.lock().expect("delivered mutex poisoned"),
            vec![disk_full, store_error, later]
        );
    }

    #[test]
    fn a_frame_that_finishes_after_its_launch_ends_does_not_repopulate_state() {
        let mut lifecycle = Lifecycle::default();
        let launch_id = begin_spawn(&mut lifecycle).expect("spawn allowed");

        // The launch ends (termination or an explicit stop) while the
        // poll that produced this frame was still in flight.
        lifecycle.launch_id += 1;

        let before_id = lifecycle.launch_id;
        let before_last_frame = lifecycle.last_frame.clone();
        let before_body = lifecycle.last_frame_body.clone();
        let before_world = lifecycle.world.clone();

        let late_frame =
            serde_json::json!({ "sequence": 5, "status": "running", "sessionId": "old" });
        let refreshed = apply_frame(&mut lifecycle, launch_id, late_frame);

        assert!(!refreshed);
        assert_eq!(lifecycle.launch_id, before_id);
        assert_eq!(lifecycle.last_frame, before_last_frame);
        assert_eq!(lifecycle.last_frame_body, before_body);
        assert_eq!(lifecycle.world, before_world);
    }
}
