//! The snapshot the webview shows: assembled from the sidecar's read-only ops on
//! a re-armed timer, pushed over one `Channel` only when it changes, and
//! replayed to a subscriber that arrives later.
//!
//! The cost of a read sets the shape. On the real store (`.context/
//! studio-pipeline/u7-creative/studio`, 71 MB, 42 MB of it candidate records)
//! every `status` or `list` takes about 160 ms, because each re-reads the whole
//! store, so the seven reads of a full snapshot take about 1.1 s. A tick
//! therefore reads `status` alone, and re-reads the lists only when the status
//! changed, when this app changed something (`dirty`), or every
//! `FULL_REFRESH_EVERY` ticks as a net for changes that leave the counts alone.
//! An editor save imported by the session's watcher leaves the counts alone, so
//! `status` also carries each open edit's saved-sheet hash (`openEdits`): the
//! save changes the status and the next tick re-reads, instead of waiting for
//! the net (measured at 2.7-7.5 s). `source-keys` answers
//! from memory in well under a millisecond, so it is read every tick.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{json, Map, Value};
use tauri::ipc::Channel;

use crate::mux::{Mux, MuxError, OpClass};
use crate::state::{host_status, is_current, HostStatus, Lifecycle};

/// The wait between the end of one tick and the start of the next. The timer is
/// re-armed after a tick finishes, so ticks never overlap or queue up behind a
/// slow store: the period is this plus what the tick cost (about 1.2 s idle on
/// the real store).
pub const POLL_GAP: Duration = Duration::from_secs(1);

/// Ticks between full re-reads when nothing else asked for one.
pub const FULL_REFRESH_EVERY: u32 = 5;

/// The list sections of a snapshot, as `(section, list kind)`.
const LISTS: [(&str, &str); 6] = [
    ("requests", "requests"),
    ("jobs", "jobs"),
    ("candidates", "candidates"),
    ("edits", "edits"),
    ("workingSets", "working-sets"),
    ("assets", "assets"),
];

/// Set when this app changed something, so the next tick re-reads the lists.
#[derive(Default)]
pub struct Dirty(AtomicBool);

impl Dirty {
    pub fn mark(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    fn take(&self) -> bool {
        self.0.swap(false, Ordering::SeqCst)
    }

    #[cfg(test)]
    pub(crate) fn is_marked(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// One launch's poller: what it has read, so it can read less next time.
#[derive(Default)]
pub struct Poller {
    last_status: Option<Value>,
    lists: Map<String, Value>,
    errors: Map<String, Value>,
    since_full: u32,
}

fn error_body(error: &MuxError) -> Value {
    match error {
        MuxError::Refused { code, message, .. } => json!({ "code": code, "message": message }),
        MuxError::Unavailable => json!({ "code": "sidecar-unavailable" }),
        MuxError::Disconnected => json!({ "code": "sidecar-disconnected" }),
        MuxError::Timeout => json!({ "code": "timeout" }),
        MuxError::Malformed => json!({ "code": "malformed-reply" }),
    }
}

impl Poller {
    /// Runs one tick: `None` when the sidecar could not be reached (nothing to
    /// show), else the snapshot. `dirty` is whether this app changed something
    /// since the last tick.
    pub async fn tick(&mut self, mux: &Mux, dirty: &Dirty) -> Option<Value> {
        let was_dirty = dirty.take();
        let snapshot = self.read(mux, was_dirty).await;
        if snapshot.is_none() && was_dirty {
            // Nothing was read, so the change is still unseen.
            dirty.mark();
        }
        snapshot
    }

    async fn read(&mut self, mux: &Mux, was_dirty: bool) -> Option<Value> {
        let status = match mux.request("status", json!({}), OpClass::Read).await {
            Ok(status) => status,
            Err(MuxError::Refused { code, message, .. }) => {
                // The sidecar is up and says no; nothing else it reads will differ.
                let mut errors = Map::new();
                errors.insert("status".into(), json!({ "code": code, "message": message }));
                return Some(json!({ "status": null, "errors": errors }));
            }
            Err(_) => return None,
        };

        let full = was_dirty
            || self.last_status.as_ref() != Some(&status)
            || self.since_full >= FULL_REFRESH_EVERY;
        if full {
            let mut lists = Map::new();
            let mut errors = Map::new();
            for (section, kind) in LISTS {
                match mux
                    .request("list", json!({ "kind": kind }), OpClass::Read)
                    .await
                {
                    Ok(list) => {
                        lists.insert(section.into(), list);
                    }
                    Err(error @ (MuxError::Refused { .. } | MuxError::Malformed)) => {
                        lists.insert(section.into(), Value::Null);
                        errors.insert(section.into(), error_body(&error));
                    }
                    // Unreachable mid-read: keep the old cache and try the whole read again.
                    Err(_) => return None,
                }
            }
            self.lists = lists;
            self.errors = errors;
            self.last_status = Some(status.clone());
            self.since_full = 0;
        } else {
            self.since_full += 1;
        }

        let mut errors = self.errors.clone();
        let keys = match mux.request("source-keys", json!({}), OpClass::Read).await {
            Ok(keys) => keys,
            Err(error @ (MuxError::Refused { .. } | MuxError::Malformed)) => {
                errors.insert("keys".into(), error_body(&error));
                Value::Null
            }
            Err(_) => return None,
        };

        let mut snapshot = self.lists.clone();
        snapshot.insert("status".into(), status);
        snapshot.insert("keys".into(), keys);
        snapshot.insert("errors".into(), Value::Object(errors));
        Some(Value::Object(snapshot))
    }
}

/// What the webview receives: the polled store data (if a sidecar has answered
/// this launch) with the host state beside it. The host state is always there,
/// so a webview has one place to learn where the app is, with or without a
/// store to show.
pub fn compose(data: Option<&Value>, host: &HostStatus) -> Value {
    let mut snapshot = match data {
        Some(Value::Object(map)) => map.clone(),
        _ => Map::new(),
    };
    snapshot.insert(
        "host".into(),
        serde_json::to_value(host).expect("host status serializes"),
    );
    Value::Object(snapshot)
}

/// Sends the composed snapshot to the subscriber if it differs from the last
/// one sent. Returns whether it was sent.
fn send_if_changed(lifecycle: &mut Lifecycle) -> bool {
    let snapshot = compose(lifecycle.last_snapshot.as_ref(), &host_status(lifecycle));
    if lifecycle.last_sent.as_ref() == Some(&snapshot) {
        return false;
    }
    let Some(channel) = lifecycle.channel.as_ref() else {
        return false;
    };
    match channel.send(snapshot.clone()) {
        Ok(()) => {
            lifecycle.last_sent = Some(snapshot);
            true
        }
        Err(error) => {
            eprintln!("panthea-studio: failed to send a snapshot to the webview: {error}");
            false
        }
    }
}

/// Pushes the host state when it changed, even if the store did not: a sidecar
/// that is restarting or has given up changes what the webview should show
/// before any new data arrives. Call it after every lifecycle transition, under
/// the same lock. Returns whether anything was sent.
pub fn publish_host(lifecycle: &mut Lifecycle) -> bool {
    send_if_changed(lifecycle)
}

/// Applies one polled snapshot to `lifecycle` under the caller's single lock: the
/// launch check, the cache, the channel send and the last-sent mark. Returns
/// whether it was sent. A snapshot from a launch that is no longer current
/// changes nothing.
pub fn apply_snapshot(lifecycle: &mut Lifecycle, launch_id: u64, snapshot: Value) -> bool {
    if !is_current(lifecycle, launch_id) {
        return false;
    }
    lifecycle.last_snapshot = Some(snapshot);
    send_if_changed(lifecycle)
}

/// Installs `channel` as the subscriber and replays the current snapshot at
/// once: the polled data if there is any, and always the host state, so a
/// reloaded webview does not wait for the next change and learns even a
/// not-configured app's state.
pub fn apply_subscribe(lifecycle: &mut Lifecycle, channel: Channel<Value>) {
    let snapshot = compose(lifecycle.last_snapshot.as_ref(), &host_status(lifecycle));
    lifecycle.last_sent = match channel.send(snapshot.clone()) {
        Ok(()) => Some(snapshot),
        Err(error) => {
            eprintln!("panthea-studio: failed to replay the snapshot to a new subscriber: {error}");
            None
        }
    };
    lifecycle.channel = Some(channel);
}

/// Runs `tick` at once, then again `gap` after each one completes (the timer is
/// re-armed, never periodic), and hands every snapshot to `apply`. Never
/// returns; the caller aborts the task.
pub async fn poll_loop<T, Fut>(gap: Duration, mut tick: T, mut apply: impl FnMut(Value))
where
    T: FnMut() -> Fut,
    Fut: std::future::Future<Output = Option<Value>>,
{
    loop {
        if let Some(snapshot) = tick().await {
            apply(snapshot);
        }
        tokio::time::sleep(gap).await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::testkit::{recording_channel, runtime, settle, Reply, Scripted};

    /// A sidecar whose store reads return `value_of(op, kind)`.
    fn store(counter: Arc<Mutex<u64>>) -> impl Fn(&str, &Value) -> Reply + Send + Sync + 'static {
        move |op, args| match op {
            "status" => Reply::Ok(json!({ "counts": { "jobs": *counter.lock().unwrap() } })),
            "list" => Reply::Ok(json!([{ "kind": args["kind"], "rev": *counter.lock().unwrap() }])),
            "source-keys" => Reply::Ok(json!({ "listing": "l", "selections": [] })),
            _ => Reply::Refuse("unknown-op", "x"),
        }
    }

    fn attached(counter: Arc<Mutex<u64>>) -> (Arc<Mux>, Scripted) {
        let mux = Arc::new(Mux::new());
        let sidecar = Scripted::attach(&mux, 1, store(counter));
        (mux, sidecar)
    }

    fn lifecycle_with_channel() -> (Lifecycle, Arc<Mutex<Vec<Value>>>) {
        let mut lifecycle = Lifecycle {
            launch_id: 1,
            configured: true,
            ..Default::default()
        };
        let (channel, delivered) = recording_channel();
        apply_subscribe(&mut lifecycle, channel);
        (lifecycle, delivered)
    }

    #[test]
    fn the_first_tick_reads_everything_and_assembles_every_section() {
        runtime().block_on(async {
            let (mux, sidecar) = attached(Arc::default());
            let mut poller = Poller::default();

            let snapshot = poller.tick(&mux, &Dirty::default()).await.unwrap();

            assert_eq!(sidecar.count("status"), 1);
            assert_eq!(sidecar.count("list"), LISTS.len());
            assert_eq!(sidecar.count("source-keys"), 1);
            let object = snapshot.as_object().unwrap();
            let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
            keys.sort_unstable();
            assert_eq!(
                keys,
                [
                    "assets",
                    "candidates",
                    "edits",
                    "errors",
                    "jobs",
                    "keys",
                    "requests",
                    "status",
                    "workingSets"
                ]
            );
            assert_eq!(snapshot["jobs"][0]["kind"], "jobs");
            assert_eq!(snapshot["workingSets"][0]["kind"], "working-sets");
            assert_eq!(snapshot["errors"], json!({}));
        });
    }

    #[test]
    fn an_idle_tick_reads_status_and_keys_only() {
        runtime().block_on(async {
            let (mux, sidecar) = attached(Arc::default());
            let mut poller = Poller::default();
            let dirty = Dirty::default();
            let first = poller.tick(&mux, &dirty).await.unwrap();

            let second = poller.tick(&mux, &dirty).await.unwrap();

            assert_eq!(sidecar.count("status"), 2);
            assert_eq!(
                sidecar.count("list"),
                LISTS.len(),
                "the lists were not read again"
            );
            assert_eq!(sidecar.count("source-keys"), 2);
            assert_eq!(first, second);
        });
    }

    #[test]
    fn a_changed_status_re_reads_the_lists_and_the_snapshot_changes() {
        runtime().block_on(async {
            let counter = Arc::new(Mutex::new(0u64));
            let (mux, sidecar) = attached(counter.clone());
            let mut poller = Poller::default();
            let dirty = Dirty::default();
            let before = poller.tick(&mux, &dirty).await.unwrap();

            *counter.lock().unwrap() = 1;
            let after = poller.tick(&mux, &dirty).await.unwrap();

            assert_eq!(sidecar.count("list"), 2 * LISTS.len());
            assert_ne!(before, after);
            assert_eq!(after["jobs"][0]["rev"], 1);
        });
    }

    #[test]
    fn a_saved_sheet_hash_changing_alone_re_reads_the_lists_on_the_next_tick() {
        runtime().block_on(async {
            // The counts never change: only an open edit's saved-sheet hash does,
            // the way an editor save imported by the session's watcher changes it.
            let hash = Arc::new(Mutex::new("aa".to_string()));
            let mux = Arc::new(Mux::new());
            let sidecar = {
                let hash = hash.clone();
                Scripted::attach(&mux, 1, move |op, args| match op {
                    "status" => Reply::Ok(json!({
                        "counts": { "edits": 1 },
                        "openEdits": [{ "id": "e1", "previewSheetHash": *hash.lock().unwrap() }],
                    })),
                    "list" => Reply::Ok(json!([{
                        "kind": args["kind"],
                        "previewSheetHash": *hash.lock().unwrap(),
                    }])),
                    "source-keys" => Reply::Ok(json!({ "listing": "l", "selections": [] })),
                    _ => Reply::Refuse("unknown-op", "x"),
                })
            };
            let mut poller = Poller::default();
            let dirty = Dirty::default();
            let before = poller.tick(&mux, &dirty).await.unwrap();
            poller.tick(&mux, &dirty).await.unwrap();
            assert_eq!(
                sidecar.count("list"),
                LISTS.len(),
                "an unchanged status reads no lists"
            );

            *hash.lock().unwrap() = "bb".to_string();
            let after = poller.tick(&mux, &dirty).await.unwrap();

            assert_eq!(sidecar.count("list"), 2 * LISTS.len(), "the very next tick");
            assert_eq!(before["edits"][0]["previewSheetHash"], "aa");
            assert_eq!(after["edits"][0]["previewSheetHash"], "bb");
        });
    }

    #[test]
    fn a_change_this_app_made_re_reads_the_lists_once_even_if_the_status_is_the_same() {
        runtime().block_on(async {
            let (mux, sidecar) = attached(Arc::default());
            let mut poller = Poller::default();
            let dirty = Dirty::default();
            poller.tick(&mux, &dirty).await.unwrap();

            dirty.mark();
            poller.tick(&mux, &dirty).await.unwrap();
            poller.tick(&mux, &dirty).await.unwrap();

            assert_eq!(
                sidecar.count("list"),
                2 * LISTS.len(),
                "once for the mark, not again after"
            );
        });
    }

    #[test]
    fn every_few_ticks_the_lists_are_re_read_anyway() {
        runtime().block_on(async {
            let (mux, sidecar) = attached(Arc::default());
            let mut poller = Poller::default();
            let dirty = Dirty::default();
            poller.tick(&mux, &dirty).await.unwrap();

            for _ in 0..FULL_REFRESH_EVERY {
                poller.tick(&mux, &dirty).await.unwrap();
            }
            assert_eq!(sidecar.count("list"), LISTS.len(), "still the first read");
            poller.tick(&mux, &dirty).await.unwrap();

            assert_eq!(sidecar.count("list"), 2 * LISTS.len());
        });
    }

    #[test]
    fn a_section_the_sidecar_refuses_is_null_and_named_in_errors_without_hiding_the_rest() {
        runtime().block_on(async {
            let mux = Arc::new(Mux::new());
            let _sidecar =
                Scripted::attach(&mux, 1, |op, args| match (op, args["kind"].as_str()) {
                    ("source-keys", _) => {
                        Reply::Refuse("missing-config", "registryRoot is not configured")
                    }
                    ("list", Some("assets")) => Reply::Refuse("internal", "boom"),
                    ("status", _) => Reply::Ok(json!({ "counts": {} })),
                    _ => Reply::Ok(json!([])),
                });
            let mut poller = Poller::default();

            let snapshot = poller.tick(&mux, &Dirty::default()).await.unwrap();

            assert_eq!(snapshot["keys"], Value::Null);
            assert_eq!(snapshot["assets"], Value::Null);
            assert_eq!(snapshot["jobs"], json!([]));
            assert_eq!(snapshot["errors"]["keys"]["code"], "missing-config");
            assert_eq!(snapshot["errors"]["assets"]["code"], "internal");
        });
    }

    #[test]
    fn a_sidecar_that_cannot_be_reached_gives_no_snapshot() {
        runtime().block_on(async {
            let mux = Mux::new();
            let mut poller = Poller::default();
            assert_eq!(poller.tick(&mux, &Dirty::default()).await, None);
        });
    }

    #[test]
    fn a_status_that_times_out_gives_no_snapshot_and_the_next_tick_tries_again() {
        runtime().block_on(async {
            let mux = Arc::new(Mux::new());
            let silent = Arc::new(Mutex::new(true));
            let flag = silent.clone();
            let sidecar = Scripted::attach(&mux, 1, move |op, args| {
                if op == "status" && *flag.lock().unwrap() {
                    return Reply::Silent;
                }
                store(Arc::default())(op, args)
            });
            let mut poller = Poller::default();

            let handle = tokio::spawn({
                let mux = mux.clone();
                async move {
                    poller
                        .tick(&mux, &Dirty::default())
                        .await
                        .map(|s| (s, poller))
                }
            });
            settle().await;
            tokio::time::advance(OpClass::Read.timeout() + Duration::from_secs(1)).await;
            let first = handle.await.unwrap();

            assert!(first.is_none());
            *silent.lock().unwrap() = false;
            let mut poller = Poller::default();
            assert!(poller.tick(&mux, &Dirty::default()).await.is_some());
            assert_eq!(sidecar.count("list"), LISTS.len());
        });
    }

    #[test]
    fn a_sidecar_restart_starts_a_new_poller_that_reads_everything_again() {
        runtime().block_on(async {
            let (mux, sidecar) = attached(Arc::default());
            let mut old = Poller::default();
            old.tick(&mux, &Dirty::default()).await.unwrap();
            mux.retire(1);
            let next = Scripted::attach(&mux, 2, store(Arc::default()));

            let mut fresh = Poller::default();
            fresh.tick(&mux, &Dirty::default()).await.unwrap();

            assert_eq!(sidecar.count("list"), LISTS.len());
            assert_eq!(next.count("list"), LISTS.len());
        });
    }

    /// `value` with the host state of a configured lifecycle that has not
    /// started a child: what the tests below expect on the wire.
    fn starting(mut value: Value) -> Value {
        value["host"] = json!({ "state": "starting" });
        value
    }

    fn host_only(state: &str) -> Value {
        json!({ "host": { "state": state } })
    }

    #[test]
    fn a_snapshot_is_the_polled_data_with_the_host_state_beside_it() {
        let host = HostStatus {
            state: crate::state::HostState::Running,
            attempt: None,
            max_attempts: None,
            lock_holder: None,
        };

        assert_eq!(
            compose(Some(&json!({ "jobs": [1] })), &host),
            json!({ "jobs": [1], "host": { "state": "running" } })
        );
        assert_eq!(compose(None, &host), host_only("running"));
    }

    #[test]
    fn the_host_state_wins_over_a_field_of_that_name_in_the_data() {
        let host = HostStatus {
            state: crate::state::HostState::Running,
            attempt: None,
            max_attempts: None,
            lock_holder: None,
        };
        assert_eq!(
            compose(Some(&json!({ "host": "forged" })), &host),
            host_only("running")
        );
    }

    #[test]
    fn a_new_subscriber_gets_the_cached_snapshot_with_the_host_state_at_once() {
        let mut lifecycle = Lifecycle {
            launch_id: 1,
            configured: true,
            ..Default::default()
        };
        assert!(
            !apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 })),
            "no subscriber yet"
        );
        assert_eq!(lifecycle.last_snapshot, Some(json!({ "n": 1 })));

        let (channel, delivered) = recording_channel();
        apply_subscribe(&mut lifecycle, channel);

        assert_eq!(
            *delivered.lock().unwrap(),
            vec![starting(json!({ "n": 1 }))]
        );
        assert_eq!(lifecycle.last_sent, Some(starting(json!({ "n": 1 }))));
    }

    #[test]
    fn a_subscriber_with_no_data_yet_still_learns_where_the_app_is() {
        for (configured, state) in [(false, "not-configured"), (true, "starting")] {
            let mut lifecycle = Lifecycle {
                launch_id: 1,
                configured,
                ..Default::default()
            };
            let (channel, delivered) = recording_channel();

            apply_subscribe(&mut lifecycle, channel);

            assert_eq!(*delivered.lock().unwrap(), vec![host_only(state)]);
        }
    }

    #[test]
    fn an_unchanged_snapshot_is_not_sent_again_and_a_changed_one_is() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();

        assert!(apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 })));
        assert!(!apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 })));
        assert!(!apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 })));
        assert!(apply_snapshot(&mut lifecycle, 1, json!({ "n": 2 })));
        assert!(apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 })));

        assert_eq!(
            *delivered.lock().unwrap(),
            vec![
                host_only("starting"),
                starting(json!({ "n": 1 })),
                starting(json!({ "n": 2 })),
                starting(json!({ "n": 1 }))
            ]
        );
    }

    #[test]
    fn a_resubscribe_after_a_reload_replays_the_latest_even_if_it_was_already_sent_to_the_old_channel(
    ) {
        let (mut lifecycle, first) = lifecycle_with_channel();
        apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 }));
        apply_snapshot(&mut lifecycle, 1, json!({ "n": 2 }));

        let (channel, second) = recording_channel();
        apply_subscribe(&mut lifecycle, channel);
        assert!(
            !apply_snapshot(&mut lifecycle, 1, json!({ "n": 2 })),
            "replay counted as sent"
        );
        apply_snapshot(&mut lifecycle, 1, json!({ "n": 3 }));

        assert_eq!(first.lock().unwrap().len(), 3, "host, n=1, n=2");
        assert_eq!(
            *second.lock().unwrap(),
            vec![starting(json!({ "n": 2 })), starting(json!({ "n": 3 }))]
        );
    }

    #[test]
    fn a_snapshot_from_an_ended_launch_changes_nothing_and_is_never_sent() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();
        lifecycle.launch_id = 2;

        assert!(!apply_snapshot(&mut lifecycle, 1, json!({ "n": "stale" })));

        assert!(lifecycle.last_snapshot.is_none());
        assert_eq!(lifecycle.last_sent, Some(host_only("starting")));
        assert_eq!(*delivered.lock().unwrap(), vec![host_only("starting")]);
        assert!(is_current(&lifecycle, 2));
    }

    #[test]
    fn after_a_restart_the_new_launch_sends_the_same_data_again_only_after_the_gap_was_shown() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();
        apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 }));
        let id = crate::state::begin_spawn(&mut lifecycle).unwrap();

        // The ended launch's data is gone, and the webview is told so.
        assert!(publish_host(&mut lifecycle));
        // The new launch's first poll differs from that, so it is sent even
        // though the store did not change.
        assert!(apply_snapshot(&mut lifecycle, id, json!({ "n": 1 })));

        let seen = delivered.lock().unwrap();
        assert_eq!(
            seen.as_slice()[seen.len() - 2..],
            [host_only("starting"), starting(json!({ "n": 1 }))]
        );
    }

    #[test]
    fn a_restart_that_shows_no_gap_does_not_resend_identical_data() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();
        apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 }));
        let id = crate::state::begin_spawn(&mut lifecycle).unwrap();
        apply_snapshot(&mut lifecycle, id, json!({ "n": 1 }));

        assert_eq!(delivered.lock().unwrap().len(), 2);
    }

    // The host state travels in the snapshot, and a change of it is pushed even
    // when the store did not change.

    #[test]
    fn a_host_state_change_is_pushed_though_no_store_data_arrived() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();
        let id = crate::state::begin_spawn(&mut lifecycle).unwrap();
        assert!(!publish_host(&mut lifecycle), "still starting: nothing new");

        crate::state::attach_child(&mut lifecycle, id, crate::state::ChildHandle { pid: 7 });
        assert!(publish_host(&mut lifecycle));

        assert_eq!(
            *delivered.lock().unwrap(),
            vec![host_only("starting"), host_only("running")]
        );
    }

    #[test]
    fn an_unchanged_host_state_is_not_pushed_again() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();
        assert!(!publish_host(&mut lifecycle), "the subscribe replay had it");
        assert!(!publish_host(&mut lifecycle));
        assert!(!publish_host(&mut lifecycle));
        assert_eq!(delivered.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_store_snapshot_after_a_host_push_carries_the_host_state_and_is_sent_once() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();

        assert!(apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 })));
        assert!(!apply_snapshot(&mut lifecycle, 1, json!({ "n": 1 })));

        let seen = delivered.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[1], starting(json!({ "n": 1 })));
    }

    #[test]
    fn a_crash_pushes_restarting_with_its_attempt_and_drops_the_stale_store_data() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();
        let id = crate::state::begin_spawn(&mut lifecycle).unwrap();
        crate::state::attach_child(&mut lifecycle, id, crate::state::ChildHandle { pid: 7 });
        apply_snapshot(&mut lifecycle, id, json!({ "n": 1 }));

        crate::state::on_terminated(&mut lifecycle, id, false);
        assert!(publish_host(&mut lifecycle));

        let seen = delivered.lock().unwrap();
        assert_eq!(
            seen.last().unwrap(),
            &json!({ "host": { "state": "restarting", "attempt": 1, "maxAttempts": 3 } })
        );
    }

    #[test]
    fn giving_up_is_pushed_as_unavailable_and_quitting_as_stopped() {
        let (mut lifecycle, delivered) = lifecycle_with_channel();
        for _ in 0..=crate::state::MAX_RESTARTS {
            let id = crate::state::begin_spawn(&mut lifecycle).unwrap();
            crate::state::attach_child(&mut lifecycle, id, crate::state::ChildHandle { pid: 7 });
            crate::state::on_terminated(&mut lifecycle, id, false);
        }
        assert!(publish_host(&mut lifecycle));
        let _ = crate::state::stop(&mut lifecycle);
        assert!(publish_host(&mut lifecycle));

        let seen = delivered.lock().unwrap();
        assert_eq!(
            seen[seen.len() - 2],
            json!({ "host": { "state": "unavailable", "attempt": 3, "maxAttempts": 3 } })
        );
        assert_eq!(seen.last().unwrap(), &host_only("stopped"));
    }

    #[test]
    fn choosing_a_config_pushes_the_change_from_not_configured() {
        let mut lifecycle = Lifecycle {
            launch_id: 1,
            ..Default::default()
        };
        let (channel, delivered) = recording_channel();
        apply_subscribe(&mut lifecycle, channel);
        assert_eq!(
            *delivered.lock().unwrap(),
            vec![host_only("not-configured")]
        );

        lifecycle.configured = true;
        assert!(publish_host(&mut lifecycle));

        assert_eq!(delivered.lock().unwrap()[1], host_only("starting"));
    }

    fn running_lifecycle() -> (Lifecycle, Arc<Mutex<Vec<Value>>>, u64) {
        let (mut lifecycle, delivered) = lifecycle_with_channel();
        let id = crate::state::begin_spawn(&mut lifecycle).unwrap();
        crate::state::attach_child(&mut lifecycle, id, crate::state::ChildHandle { pid: 7 });
        (lifecycle, delivered, id)
    }

    #[test]
    fn a_status_naming_another_holder_puts_the_host_in_read_only_with_that_holder() {
        let (mut lifecycle, delivered, id) = running_lifecycle();

        assert!(apply_snapshot(
            &mut lifecycle,
            id,
            json!({ "status": { "rootLock": { "holder": "other", "pid": 4242 } }, "jobs": [] })
        ));

        let seen = delivered.lock().unwrap();
        let last = seen.last().unwrap();
        assert_eq!(
            last["host"],
            json!({ "state": "read-only", "lockHolder": 4242 })
        );
        assert_eq!(last["jobs"], json!([]), "the reads still arrive");
    }

    #[test]
    fn when_the_holder_leaves_the_next_snapshot_is_plain_running_and_says_so_once() {
        let (mut lifecycle, delivered, id) = running_lifecycle();
        let locked = json!({ "status": { "rootLock": { "holder": "other", "pid": 4242 } } });
        let free = json!({ "status": { "rootLock": { "holder": "none", "pid": null } } });
        apply_snapshot(&mut lifecycle, id, locked.clone());

        assert!(apply_snapshot(&mut lifecycle, id, free.clone()));
        assert!(!apply_snapshot(&mut lifecycle, id, free));

        let seen = delivered.lock().unwrap();
        assert_eq!(seen.last().unwrap()["host"], json!({ "state": "running" }));
        let states: Vec<&Value> = seen
            .iter()
            .map(|snapshot| &snapshot["host"]["state"])
            .collect();
        assert_eq!(
            states,
            [&json!("starting"), &json!("read-only"), &json!("running")]
        );
    }

    #[test]
    fn no_snapshot_carries_the_sidecar_pid() {
        let (mut lifecycle, delivered, id) = running_lifecycle();
        apply_snapshot(&mut lifecycle, id, json!({ "n": 1 }));
        publish_host(&mut lifecycle);

        for snapshot in delivered.lock().unwrap().iter() {
            assert!(snapshot.get("sidecarPid").is_none(), "{snapshot}");
        }
    }

    #[test]
    fn a_host_push_with_no_subscriber_sends_nothing_and_a_later_subscriber_replays_the_latest() {
        let mut lifecycle = Lifecycle {
            launch_id: 1,
            configured: true,
            ..Default::default()
        };
        assert!(!publish_host(&mut lifecycle));
        let id = crate::state::begin_spawn(&mut lifecycle).unwrap();
        crate::state::attach_child(&mut lifecycle, id, crate::state::ChildHandle { pid: 7 });
        assert!(!publish_host(&mut lifecycle));

        let (channel, delivered) = recording_channel();
        apply_subscribe(&mut lifecycle, channel);

        assert_eq!(*delivered.lock().unwrap(), vec![host_only("running")]);
    }

    #[test]
    fn the_timer_is_re_armed_after_a_tick_so_a_slow_tick_never_overlaps_the_next() {
        runtime().block_on(async {
            let running = Arc::new(Mutex::new(0u32));
            let most = Arc::new(Mutex::new(0u32));
            let ticks = Arc::new(Mutex::new(0u32));
            let sent = Arc::new(Mutex::new(Vec::<Value>::new()));
            let (r, m, t, s) = (running.clone(), most.clone(), ticks.clone(), sent.clone());
            let task = tokio::spawn(poll_loop(
                Duration::from_secs(1),
                move || {
                    let (r, m, t) = (r.clone(), m.clone(), t.clone());
                    async move {
                        let (now, n) = {
                            *r.lock().unwrap() += 1;
                            let now = *r.lock().unwrap();
                            let mut high = m.lock().unwrap();
                            *high = (*high).max(now);
                            *t.lock().unwrap() += 1;
                            (now, *t.lock().unwrap())
                        };
                        let _ = now;
                        // Each tick costs three seconds of the store's time.
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        *r.lock().unwrap() -= 1;
                        Some(json!({ "tick": n }))
                    }
                },
                move |snapshot| s.lock().unwrap().push(snapshot),
            ));

            tokio::time::sleep(Duration::from_secs(20)).await;
            task.abort();

            // 1 s gap + 3 s tick = 4 s per cycle: five ticks in 20 s, never two at once.
            assert_eq!(*most.lock().unwrap(), 1);
            let done = sent.lock().unwrap().len();
            assert!((4..=5).contains(&done), "{done} snapshots");
        });
    }

    #[test]
    fn a_tick_with_nothing_to_show_applies_nothing() {
        runtime().block_on(async {
            let sent = Arc::new(Mutex::new(0u32));
            let s = sent.clone();
            let task = tokio::spawn(poll_loop(
                Duration::from_secs(1),
                || async { None },
                move |_| *s.lock().unwrap() += 1,
            ));

            tokio::time::sleep(Duration::from_secs(10)).await;
            task.abort();

            assert_eq!(*sent.lock().unwrap(), 0);
        });
    }
}
