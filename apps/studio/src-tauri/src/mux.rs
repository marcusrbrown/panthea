//! The request side and reply reader for the sidecar's newline-JSON stdio
//! protocol: `{id, op, args}` in, `{id, ok, result | error}` out.
//!
//! Requests carry monotonic ids and each has one pending reply, so replies may
//! arrive in any order. A request times out on its own, by op class. Every
//! sink and reply is fenced by the launch it belongs to: when a launch ends,
//! its pending requests fail as retryable, and nothing a dead launch still
//! says can complete a request of a later one.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Map, Value};
use tokio::sync::oneshot;

/// The longest reply line the reader keeps. Atlases are 1–600 KB as base64;
/// this leaves two orders of magnitude of headroom before a line is refused.
pub const MAX_LINE_BYTES: usize = 64 * 1024 * 1024;

/// How long a request waits for its reply, by what the op does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpClass {
    /// Reads of durable records and previews.
    Read,
    /// Queue and record changes, and the editor round trips.
    Write,
    /// Generation and abort, which may wait on the runtime.
    Long,
}

impl OpClass {
    pub const fn timeout(self) -> Duration {
        match self {
            OpClass::Read => Duration::from_secs(15),
            OpClass::Write => Duration::from_secs(60),
            OpClass::Long => Duration::from_secs(180),
        }
    }
}

/// Why a request got no result.
#[derive(Debug, Clone, PartialEq)]
pub enum MuxError {
    /// No sidecar is attached. Retryable.
    Unavailable,
    /// The sidecar went away with this request in flight, or a write to it
    /// failed. Retryable.
    Disconnected,
    /// No reply within the op class's bound. The request is forgotten, so a
    /// late reply is dropped.
    Timeout,
    /// The sidecar answered `ok: false`: its error object, split into the
    /// code, the message and everything else it carried.
    Refused {
        code: String,
        message: String,
        detail: Map<String, Value>,
    },
    /// The reply had neither a result nor an error.
    Malformed,
}

impl MuxError {
    pub fn retryable(&self) -> bool {
        matches!(self, MuxError::Unavailable | MuxError::Disconnected)
    }
}

/// Where request lines go: the sidecar's stdin.
pub trait LineSink: Send {
    fn write_line(&mut self, line: &str) -> io::Result<()>;
}

/// What became of one reply line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    /// It completed the request it names.
    Delivered,
    /// It came from a launch that is not the attached one.
    StaleLaunch,
    /// It names no pending request (answered, timed out, or never sent).
    UnknownId(String),
    /// It is not a reply that can be matched to a request (bad JSON, or no id).
    Unmatched,
}

struct Pending {
    launch: u64,
    tx: oneshot::Sender<Result<Value, MuxError>>,
}

#[derive(Default)]
struct Inner {
    /// Launches at or below this id may never attach again.
    floor: u64,
    launch: Option<u64>,
    sink: Option<Box<dyn LineSink>>,
    pending: HashMap<String, Pending>,
}

#[derive(Default)]
pub struct Mux {
    inner: Mutex<Inner>,
    next: AtomicU64,
}

impl Mux {
    pub fn new() -> Self {
        Self::default()
    }

    /// Attaches `sink` as the live sidecar of `launch_id`. Refuses, handing the
    /// sink back to be closed, when that launch (or a later one) has already
    /// been retired: a spawn that lost the race with a stop must not talk.
    pub fn attach(&self, launch_id: u64, sink: Box<dyn LineSink>) -> Result<(), Box<dyn LineSink>> {
        let mut inner = self.lock();
        if launch_id <= inner.floor {
            return Err(sink);
        }
        // A newer launch replaces whatever an older one left attached.
        inner.end_launches_before(launch_id);
        inner.launch = Some(launch_id);
        inner.sink = Some(sink);
        Ok(())
    }

    /// Ends every launch up to and including `launch_id`: drops its sink (which
    /// closes the sidecar's stdin), fails its pending requests as
    /// `Disconnected`, and refuses any later attach for it.
    pub fn retire(&self, launch_id: u64) {
        let mut inner = self.lock();
        inner.floor = inner.floor.max(launch_id);
        inner.end_launches_before(launch_id.saturating_add(1));
    }

    /// Hands one stdout line from `launch_id`'s sidecar to the request it
    /// answers. Anything that matches no live request is dropped; the log
    /// names an id, never a payload.
    pub fn deliver(&self, launch_id: u64, line: &str) -> Delivery {
        let Ok(Value::Object(reply)) = serde_json::from_str::<Value>(line) else {
            return Delivery::Unmatched;
        };
        let Some(id) = reply.get("id").and_then(Value::as_str) else {
            return Delivery::Unmatched;
        };
        let pending = {
            let mut inner = self.lock();
            if inner.launch != Some(launch_id) {
                return Delivery::StaleLaunch;
            }
            match inner.pending.remove(id) {
                Some(pending) if pending.launch == launch_id => pending,
                Some(other) => {
                    // Not this launch's request: leave it for its own launch.
                    inner.pending.insert(id.to_string(), other);
                    return Delivery::StaleLaunch;
                }
                None => {
                    drop(inner);
                    eprintln!(
                        "panthea-studio: dropped a reply for unknown request id {}",
                        id.chars().take(64).collect::<String>()
                    );
                    return Delivery::UnknownId(id.to_string());
                }
            }
        };
        // A requester that already gave up has dropped its receiver.
        let _ = pending.tx.send(outcome(&reply));
        Delivery::Delivered
    }

    pub fn pending(&self) -> usize {
        self.lock().pending.len()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().expect("mux mutex poisoned")
    }

    /// Sends `op` with `args` and waits for its reply, at most as long as
    /// `class` allows.
    pub async fn request(&self, op: &str, args: Value, class: OpClass) -> Result<Value, MuxError> {
        let (tx, rx) = oneshot::channel();
        let id = {
            let mut inner = self.lock();
            let Some(launch) = inner.launch else {
                return Err(MuxError::Unavailable);
            };
            let id = format!("m{}", self.next.fetch_add(1, Ordering::Relaxed) + 1);
            let line = json!({ "id": id, "op": op, "args": args }).to_string();
            let Some(sink) = inner.sink.as_mut() else {
                return Err(MuxError::Unavailable);
            };
            // A broken pipe means the child is exiting. Its exit event retires the
            // launch; this request just fails retryably, whichever comes first.
            if sink.write_line(&line).is_err() {
                return Err(MuxError::Disconnected);
            }
            inner.pending.insert(id.clone(), Pending { launch, tx });
            id
        };
        match tokio::time::timeout(class.timeout(), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(MuxError::Disconnected),
            Err(_) => {
                self.lock().pending.remove(&id);
                Err(MuxError::Timeout)
            }
        }
    }
}

impl Inner {
    /// Ends every launch below `bound`: fails their pending requests and, if the
    /// attached sidecar is one of them, drops its sink.
    fn end_launches_before(&mut self, bound: u64) {
        let ended: Vec<String> = self
            .pending
            .iter()
            .filter(|(_, pending)| pending.launch < bound)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ended {
            if let Some(pending) = self.pending.remove(&id) {
                let _ = pending.tx.send(Err(MuxError::Disconnected));
            }
        }
        if self.launch.is_some_and(|launch| launch < bound) {
            self.launch = None;
            self.sink = None;
        }
    }
}

/// The result a reply line stands for.
fn outcome(reply: &Map<String, Value>) -> Result<Value, MuxError> {
    match reply.get("ok").and_then(Value::as_bool) {
        Some(true) => reply.get("result").cloned().ok_or(MuxError::Malformed),
        Some(false) => {
            let Some(Value::Object(error)) = reply.get("error") else {
                return Err(MuxError::Malformed);
            };
            let text = |key: &str| {
                error
                    .get(key)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            let detail = error
                .iter()
                .filter(|(key, _)| key.as_str() != "code" && key.as_str() != "message")
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            Err(MuxError::Refused {
                code: text("code"),
                message: text("message"),
                detail,
            })
        }
        None => Err(MuxError::Malformed),
    }
}

/// Splits a byte stream into lines however it is chunked. A line longer than
/// `MAX_LINE_BYTES` is discarded up to its newline and reported.
pub struct LineBuffer {
    buf: Vec<u8>,
    discarding: bool,
    max: usize,
}

/// One thing a `LineBuffer` found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Line {
    Text(String),
    /// A line that exceeded the bound; its bytes were dropped.
    TooLong,
}

impl Default for LineBuffer {
    fn default() -> Self {
        Self::with_max(MAX_LINE_BYTES)
    }
}

impl LineBuffer {
    pub fn with_max(max: usize) -> Self {
        Self {
            buf: Vec::new(),
            discarding: false,
            max,
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<Line> {
        let mut found = Vec::new();
        let mut rest = bytes;
        while let Some(at) = rest.iter().position(|&byte| byte == b'\n') {
            self.append(&rest[..at]);
            found.push(self.finish_line());
            rest = &rest[at + 1..];
        }
        self.append(rest);
        found
    }

    fn append(&mut self, bytes: &[u8]) {
        if self.discarding {
            return;
        }
        if self.buf.len() + bytes.len() > self.max {
            self.buf = Vec::new();
            self.discarding = true;
        } else {
            self.buf.extend_from_slice(bytes);
        }
    }

    fn finish_line(&mut self) -> Line {
        if std::mem::take(&mut self.discarding) {
            self.buf.clear();
            return Line::TooLong;
        }
        if self.buf.last() == Some(&b'\r') {
            self.buf.pop();
        }
        let text = String::from_utf8_lossy(&self.buf).into_owned();
        self.buf.clear();
        Line::Text(text)
    }
}

/// Reads one launch's stdout bytes, however they are chunked, and delivers each
/// complete line to `mux`. A line over the bound is dropped (its request then
/// times out); nothing from a line is logged.
#[derive(Default)]
pub struct ReplyReader {
    lines: LineBuffer,
}

impl ReplyReader {
    pub fn feed(&mut self, mux: &Mux, launch_id: u64, bytes: &[u8]) -> Vec<Delivery> {
        self.lines
            .push(bytes)
            .into_iter()
            .map(|line| match line {
                Line::Text(text) => mux.deliver(launch_id, &text),
                Line::TooLong => {
                    eprintln!("panthea-studio: dropped a reply line over the size bound");
                    Delivery::Unmatched
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use serde_json::json;
    use tokio::runtime::{Builder, Runtime};

    use super::*;

    /// Time is paused: sleeping and timing out advance a virtual clock, so no
    /// test waits on a real one.
    fn runtime() -> Runtime {
        Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .expect("tokio runtime")
    }

    #[derive(Clone, Default)]
    struct Wire {
        lines: Arc<Mutex<Vec<String>>>,
        broken: Arc<Mutex<bool>>,
        closed: Arc<Mutex<bool>>,
    }

    impl Wire {
        fn sink(&self) -> Box<dyn LineSink> {
            Box::new(FakeSink(self.clone()))
        }
        fn sent(&self) -> Vec<Value> {
            self.lines
                .lock()
                .unwrap()
                .iter()
                .map(|line| serde_json::from_str(line).expect("a request line is JSON"))
                .collect()
        }
        fn id_of(&self, index: usize) -> String {
            self.sent()[index]["id"].as_str().unwrap().to_string()
        }
        fn break_pipe(&self) {
            *self.broken.lock().unwrap() = true;
        }
        fn closed(&self) -> bool {
            *self.closed.lock().unwrap()
        }
    }

    struct FakeSink(Wire);

    impl LineSink for FakeSink {
        fn write_line(&mut self, line: &str) -> io::Result<()> {
            if *self.0.broken.lock().unwrap() {
                return Err(io::Error::from(io::ErrorKind::BrokenPipe));
            }
            self.0.lines.lock().unwrap().push(line.to_string());
            Ok(())
        }
    }

    impl Drop for FakeSink {
        fn drop(&mut self) {
            *self.0.closed.lock().unwrap() = true;
        }
    }

    fn ok(id: &str, result: Value) -> String {
        json!({ "id": id, "ok": true, "result": result }).to_string()
    }

    fn refused(id: &str, error: Value) -> String {
        json!({ "id": id, "ok": false, "error": error }).to_string()
    }

    fn attached(launch: u64) -> (Arc<Mux>, Wire) {
        let mux = Arc::new(Mux::new());
        let wire = Wire::default();
        assert!(mux.attach(launch, wire.sink()).is_ok());
        (mux, wire)
    }

    fn spawn_request(
        mux: &Arc<Mux>,
        op: &'static str,
        args: Value,
        class: OpClass,
    ) -> tokio::task::JoinHandle<Result<Value, MuxError>> {
        let mux = mux.clone();
        tokio::spawn(async move { mux.request(op, args, class).await })
    }

    /// Lets spawned tasks run until they wait on something.
    async fn settle() {
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    #[test]
    fn a_request_is_one_json_line_with_a_fresh_id_and_its_arguments_unchanged() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let args = json!({ "kind": "jobs", "nested": { "a": [1, 2, 3] } });
            let first = spawn_request(&mux, "list", args.clone(), OpClass::Read);
            let second = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            let sent = wire.sent();
            assert_eq!(sent.len(), 2);
            assert_eq!(sent[0]["op"], "list");
            assert_eq!(sent[0]["args"], args);
            assert_eq!(sent[1]["op"], "status");
            assert_ne!(sent[0]["id"], sent[1]["id"]);
            let raw = wire.lines.lock().unwrap().clone();
            assert!(raw.iter().all(|line| !line.contains('\n')));
            assert_eq!(
                sent[0]
                    .as_object()
                    .unwrap()
                    .keys()
                    .cloned()
                    .collect::<Vec<_>>()
                    .len(),
                3
            );

            mux.deliver(1, &ok(&wire.id_of(0), json!(1)));
            mux.deliver(1, &ok(&wire.id_of(1), json!(2)));
            first.await.unwrap().unwrap();
            second.await.unwrap().unwrap();
        });
    }

    #[test]
    fn ids_only_grow_across_launches() {
        runtime().block_on(async {
            let mux = Arc::new(Mux::new());
            let first_wire = Wire::default();
            mux.attach(1, first_wire.sink()).ok().unwrap();
            let a = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;
            mux.retire(1);
            let _ = a.await;

            let second_wire = Wire::default();
            mux.attach(2, second_wire.sink()).ok().unwrap();
            let b = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            assert_ne!(first_wire.id_of(0), second_wire.id_of(0));
            mux.deliver(2, &ok(&second_wire.id_of(0), json!(null)));
            b.await.unwrap().unwrap();
        });
    }

    #[test]
    fn concurrent_requests_each_get_their_own_reply_whatever_order_the_replies_come_in() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let a = spawn_request(&mux, "list", json!({ "kind": "jobs" }), OpClass::Read);
            let b = spawn_request(&mux, "list", json!({ "kind": "edits" }), OpClass::Read);
            let c = spawn_request(&mux, "sheet", json!({ "workingSetId": "w" }), OpClass::Read);
            settle().await;
            assert_eq!(mux.pending(), 3);

            assert_eq!(
                mux.deliver(1, &ok(&wire.id_of(2), json!("third"))),
                Delivery::Delivered
            );
            assert_eq!(
                mux.deliver(1, &ok(&wire.id_of(0), json!("first"))),
                Delivery::Delivered
            );
            assert_eq!(
                mux.deliver(1, &ok(&wire.id_of(1), json!("second"))),
                Delivery::Delivered
            );

            assert_eq!(a.await.unwrap().unwrap(), json!("first"));
            assert_eq!(b.await.unwrap().unwrap(), json!("second"));
            assert_eq!(c.await.unwrap().unwrap(), json!("third"));
            assert_eq!(mux.pending(), 0);
        });
    }

    #[test]
    fn an_ok_false_reply_is_a_refusal_carrying_the_sidecars_code_message_and_details() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let call = spawn_request(&mux, "publish", json!({ "id": "a" }), OpClass::Write);
            settle().await;

            mux.deliver(
                1,
                &refused(
                    &wire.id_of(0),
                    json!({ "code": "revision-mismatch", "message": "stale", "expected": "abc" }),
                ),
            );

            let error = call.await.unwrap().unwrap_err();
            assert_eq!(
                error,
                MuxError::Refused {
                    code: "revision-mismatch".into(),
                    message: "stale".into(),
                    detail: json!({ "expected": "abc" }).as_object().unwrap().clone(),
                }
            );
            assert!(!error.retryable());
        });
    }

    #[test]
    fn a_reply_with_neither_result_nor_error_is_malformed() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let call = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            mux.deliver(1, &json!({ "id": wire.id_of(0), "ok": true }).to_string());

            assert_eq!(call.await.unwrap(), Err(MuxError::Malformed));
        });
    }

    #[test]
    fn a_reply_with_an_unknown_id_is_dropped_and_no_pending_request_is_touched() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let call = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            assert_eq!(
                mux.deliver(1, &ok("m999", json!("stray"))),
                Delivery::UnknownId("m999".into())
            );
            assert_eq!(mux.pending(), 1);

            mux.deliver(1, &ok(&wire.id_of(0), json!("mine")));
            assert_eq!(call.await.unwrap().unwrap(), json!("mine"));
        });
    }

    #[test]
    fn a_line_that_cannot_be_matched_is_dropped_without_a_panic() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let call = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            for line in [
                "not json",
                "[]",
                "42",
                r#"{"id":null,"ok":false,"error":{"code":"invalid-request","message":"x"}}"#,
                r#"{"ok":true,"result":1}"#,
                r#"{"id":7,"ok":true,"result":1}"#,
                "",
            ] {
                assert_eq!(mux.deliver(1, line), Delivery::Unmatched, "{line}");
            }
            assert_eq!(mux.pending(), 1);

            mux.deliver(1, &ok(&wire.id_of(0), json!(1)));
            call.await.unwrap().unwrap();
        });
    }

    #[test]
    fn a_timeout_fails_only_its_own_request_and_a_late_reply_for_it_is_dropped() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let read = spawn_request(&mux, "status", json!({}), OpClass::Read);
            let long = spawn_request(&mux, "generate", json!({}), OpClass::Long);
            settle().await;

            tokio::time::advance(OpClass::Read.timeout() + Duration::from_secs(1)).await;
            settle().await;

            assert_eq!(read.await.unwrap(), Err(MuxError::Timeout));
            assert_eq!(mux.pending(), 1);
            assert!(!MuxError::Timeout.retryable());
            assert_eq!(
                mux.deliver(1, &ok(&wire.id_of(0), json!("late"))),
                Delivery::UnknownId(wire.id_of(0))
            );

            mux.deliver(1, &ok(&wire.id_of(1), json!("queued")));
            assert_eq!(long.await.unwrap().unwrap(), json!("queued"));
        });
    }

    #[test]
    fn the_op_classes_wait_reads_shortest_and_generation_longest() {
        assert!(OpClass::Read.timeout() < OpClass::Write.timeout());
        assert!(OpClass::Write.timeout() < OpClass::Long.timeout());
        assert_eq!(OpClass::Read.timeout(), Duration::from_secs(15));
    }

    #[test]
    fn a_reply_that_beats_the_timeout_is_not_failed_by_it() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let call = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            tokio::time::advance(OpClass::Read.timeout() - Duration::from_secs(1)).await;
            mux.deliver(1, &ok(&wire.id_of(0), json!("in time")));

            assert_eq!(call.await.unwrap().unwrap(), json!("in time"));
            assert_eq!(mux.pending(), 0);
        });
    }

    #[test]
    fn a_sidecar_exit_fails_every_pending_request_as_retryable_and_closes_its_stdin() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let a = spawn_request(&mux, "status", json!({}), OpClass::Read);
            let b = spawn_request(&mux, "generate", json!({}), OpClass::Long);
            settle().await;
            assert!(!wire.closed());

            mux.retire(1);

            for call in [a, b] {
                let error = call.await.unwrap().unwrap_err();
                assert_eq!(error, MuxError::Disconnected);
                assert!(error.retryable());
            }
            assert_eq!(mux.pending(), 0);
            assert!(wire.closed());
            let after = mux.request("status", json!({}), OpClass::Read).await;
            assert_eq!(after, Err(MuxError::Unavailable));
            assert!(MuxError::Unavailable.retryable());
        });
    }

    #[test]
    fn a_request_before_any_sidecar_is_attached_is_unavailable() {
        runtime().block_on(async {
            let mux = Mux::new();
            assert_eq!(
                mux.request("status", json!({}), OpClass::Read).await,
                Err(MuxError::Unavailable)
            );
        });
    }

    #[test]
    fn a_restart_gets_a_new_launch_and_the_old_launchs_late_replies_are_ignored() {
        runtime().block_on(async {
            let mux = Arc::new(Mux::new());
            let old = Wire::default();
            mux.attach(1, old.sink()).ok().unwrap();
            let before = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;
            let old_id = old.id_of(0);
            mux.retire(1);
            assert_eq!(before.await.unwrap(), Err(MuxError::Disconnected));

            let new = Wire::default();
            mux.attach(2, new.sink()).ok().unwrap();
            let after = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            // The old child's last words, still in flight when the new launch attached.
            assert_eq!(
                mux.deliver(1, &ok(&old_id, json!("from the old launch"))),
                Delivery::StaleLaunch
            );
            // And a reply that names the new request but comes from the old launch.
            assert_eq!(
                mux.deliver(1, &ok(&new.id_of(0), json!("forged by the old launch"))),
                Delivery::StaleLaunch
            );
            assert_eq!(mux.pending(), 1);

            mux.deliver(2, &ok(&new.id_of(0), json!("from the new launch")));
            assert_eq!(after.await.unwrap().unwrap(), json!("from the new launch"));
        });
    }

    #[test]
    fn retiring_an_old_launch_leaves_a_newer_one_alone() {
        runtime().block_on(async {
            let mux = Arc::new(Mux::new());
            let new = Wire::default();
            mux.attach(2, new.sink()).ok().unwrap();
            let call = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            // The first launch's Terminated event arrives after the second attached.
            mux.retire(1);

            assert_eq!(mux.pending(), 1);
            assert!(!new.closed());
            mux.deliver(2, &ok(&new.id_of(0), json!("fine")));
            assert_eq!(call.await.unwrap().unwrap(), json!("fine"));
        });
    }

    #[test]
    fn a_launch_retired_before_it_attached_is_refused_and_the_sink_is_handed_back() {
        let mux = Mux::new();
        mux.retire(3);
        let wire = Wire::default();

        let refused = mux.attach(3, wire.sink());
        let older = mux.attach(2, wire.sink());

        assert!(refused.is_err());
        assert!(older.is_err());
        drop(refused);
        assert!(wire.closed());
        assert!(mux.attach(4, Wire::default().sink()).is_ok());
    }

    #[test]
    fn a_failed_write_fails_that_request_as_retryable_and_leaves_nothing_pending() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            wire.break_pipe();

            let result = mux.request("status", json!({}), OpClass::Read).await;

            assert_eq!(result, Err(MuxError::Disconnected));
            assert_eq!(mux.pending(), 0);
        });
    }

    #[test]
    fn a_write_that_loses_the_race_with_the_exit_leaves_one_clean_outcome_for_each_request() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let first = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;

            // The child dies: the next write hits a broken pipe, then the exit is reported.
            wire.break_pipe();
            let second = mux.request("list", json!({}), OpClass::Read).await;
            mux.retire(1);

            assert_eq!(second, Err(MuxError::Disconnected));
            assert_eq!(first.await.unwrap(), Err(MuxError::Disconnected));
            assert_eq!(mux.pending(), 0);
            assert_eq!(
                mux.request("status", json!({}), OpClass::Read).await,
                Err(MuxError::Unavailable)
            );
        });
    }

    #[test]
    fn a_reply_after_its_request_was_answered_is_an_unknown_id() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let call = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;
            let id = wire.id_of(0);

            assert_eq!(mux.deliver(1, &ok(&id, json!(1))), Delivery::Delivered);
            call.await.unwrap().unwrap();

            assert_eq!(mux.deliver(1, &ok(&id, json!(2))), Delivery::UnknownId(id));
        });
    }

    #[test]
    fn a_line_buffer_yields_complete_lines_across_chunk_boundaries() {
        let mut lines = LineBuffer::default();
        assert_eq!(lines.push(b"{\"id\":\"m"), vec![]);
        assert_eq!(
            lines.push(b"1\"}\n{\"id\":\"m2\"}\npart"),
            vec![
                Line::Text("{\"id\":\"m1\"}".into()),
                Line::Text("{\"id\":\"m2\"}".into())
            ]
        );
        assert_eq!(lines.push(b"ial\r\n"), vec![Line::Text("partial".into())]);
        assert_eq!(lines.push(b"\n"), vec![Line::Text(String::new())]);
    }

    #[test]
    fn a_multi_megabyte_line_arrives_whole_however_it_is_chunked() {
        let body = "A".repeat(6 * 1024 * 1024);
        let line = format!("{{\"id\":\"m1\",\"ok\":true,\"result\":{{\"base64\":\"{body}\"}}}}\n");
        let mut lines = LineBuffer::default();
        let mut found = Vec::new();

        for chunk in line.as_bytes().chunks(7919) {
            found.extend(lines.push(chunk));
        }

        assert_eq!(found.len(), 1);
        let Line::Text(text) = &found[0] else {
            panic!("expected the whole line");
        };
        assert_eq!(text.len(), line.len() - 1);
        let parsed: Value = serde_json::from_str(text).unwrap();
        assert_eq!(
            parsed["result"]["base64"].as_str().unwrap().len(),
            body.len()
        );
    }

    #[test]
    fn a_line_over_the_bound_is_dropped_once_and_the_next_line_is_read_normally() {
        let mut lines = LineBuffer::with_max(16);
        let mut found = Vec::new();

        found.extend(lines.push(&[b'x'; 10]));
        found.extend(lines.push(&[b'y'; 10]));
        found.extend(lines.push(&[b'z'; 10]));
        found.extend(lines.push(b"\nshort\n"));

        assert_eq!(found, vec![Line::TooLong, Line::Text("short".into())]);
    }

    #[test]
    fn a_line_exactly_at_the_bound_is_kept() {
        let mut lines = LineBuffer::with_max(4);
        assert_eq!(lines.push(b"abcd\n"), vec![Line::Text("abcd".into())]);
        assert_eq!(lines.push(b"abcde\n"), vec![Line::TooLong]);
    }

    #[test]
    fn the_reply_reader_delivers_each_complete_line_to_its_request_across_chunks() {
        runtime().block_on(async {
            let (mux, wire) = attached(1);
            let a = spawn_request(&mux, "status", json!({}), OpClass::Read);
            let b = spawn_request(&mux, "list", json!({}), OpClass::Read);
            settle().await;
            let both = format!(
                "{}\n{}\n",
                ok(&wire.id_of(1), json!("second")),
                ok(&wire.id_of(0), json!("first"))
            );
            let mut reader = ReplyReader::default();

            let mut delivered = Vec::new();
            for chunk in both.as_bytes().chunks(5) {
                delivered.extend(reader.feed(&mux, 1, chunk));
            }

            assert_eq!(delivered, vec![Delivery::Delivered, Delivery::Delivered]);
            assert_eq!(a.await.unwrap().unwrap(), json!("first"));
            assert_eq!(b.await.unwrap().unwrap(), json!("second"));
        });
    }

    #[test]
    fn the_reply_reader_ignores_a_launch_that_is_not_attached() {
        runtime().block_on(async {
            let (mux, wire) = attached(2);
            let call = spawn_request(&mux, "status", json!({}), OpClass::Read);
            settle().await;
            let line = format!("{}\n", ok(&wire.id_of(0), json!("x")));

            let from_old = ReplyReader::default().feed(&mux, 1, line.as_bytes());

            assert_eq!(from_old, vec![Delivery::StaleLaunch]);
            assert_eq!(mux.pending(), 1);
            mux.retire(2);
            let _ = call.await;
        });
    }

    #[test]
    fn invalid_utf8_in_a_line_is_replaced_not_fatal() {
        let mut lines = LineBuffer::default();
        let found = lines.push(b"a\xffb\n");
        assert_eq!(found, vec![Line::Text("a\u{fffd}b".into())]);
    }
}
