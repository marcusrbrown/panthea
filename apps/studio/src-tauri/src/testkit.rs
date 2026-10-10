//! Test support: a scripted stand-in for the sidecar behind a real `Mux`, and a
//! paused-time runtime. Nothing here sleeps on a real clock.

use std::io;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::runtime::{Builder, Runtime};
use tokio::sync::Notify;

use crate::mux::{LineSink, Mux};

/// Time is paused: sleeping and timing out advance a virtual clock.
pub(crate) fn runtime() -> Runtime {
    Builder::new_current_thread()
        .enable_time()
        .start_paused(true)
        .build()
        .expect("tokio runtime")
}

/// What the scripted sidecar answers to one request.
pub(crate) enum Reply {
    Ok(Value),
    Refuse(&'static str, &'static str),
    /// Never answers, so the request waits for its timeout.
    Silent,
}

type Seen = Arc<Mutex<Vec<(String, Value)>>>;

/// A sidecar that answers by script. Every request it receives is recorded.
pub(crate) struct Scripted {
    seen: Seen,
}

struct Pipe {
    queue: Arc<Mutex<Vec<Value>>>,
    wake: Arc<Notify>,
}

impl LineSink for Pipe {
    fn write_line(&mut self, line: &str) -> io::Result<()> {
        let request: Value = serde_json::from_str(line).expect("a request line is JSON");
        self.queue.lock().unwrap().push(request);
        self.wake.notify_one();
        Ok(())
    }
}

impl Scripted {
    /// Attaches a scripted sidecar to `mux` as `launch` and starts its responder
    /// on the current runtime.
    pub(crate) fn attach(
        mux: &Arc<Mux>,
        launch: u64,
        script: impl Fn(&str, &Value) -> Reply + Send + Sync + 'static,
    ) -> Scripted {
        let queue = Arc::new(Mutex::new(Vec::<Value>::new()));
        let wake = Arc::new(Notify::new());
        let seen: Seen = Arc::default();
        let attached = mux.attach(
            launch,
            Box::new(Pipe {
                queue: queue.clone(),
                wake: wake.clone(),
            }),
        );
        assert!(attached.is_ok(), "the launch must be attachable");
        let responder_mux = mux.clone();
        let responder_seen = seen.clone();
        tokio::spawn(async move {
            loop {
                wake.notified().await;
                let batch: Vec<Value> = std::mem::take(&mut *queue.lock().unwrap());
                for request in batch {
                    let id = request["id"].as_str().unwrap().to_string();
                    let op = request["op"].as_str().unwrap().to_string();
                    let args = request["args"].clone();
                    let reply = script(&op, &args);
                    responder_seen.lock().unwrap().push((op, args));
                    let line = match reply {
                        Reply::Ok(result) => json!({ "id": id, "ok": true, "result": result }),
                        Reply::Refuse(code, message) => json!({
                            "id": id,
                            "ok": false,
                            "error": { "code": code, "message": message }
                        }),
                        Reply::Silent => continue,
                    };
                    responder_mux.deliver(launch, &line.to_string());
                }
            }
        });
        Scripted { seen }
    }

    /// Every `(op, args)` it has received, in order.
    pub(crate) fn seen(&self) -> Vec<(String, Value)> {
        self.seen.lock().unwrap().clone()
    }

    pub(crate) fn count(&self, op: &str) -> usize {
        self.seen().iter().filter(|(seen, _)| seen == op).count()
    }
}

/// A channel that records every body sent to it.
pub(crate) fn recording_channel() -> (Channel<Value>, Arc<Mutex<Vec<Value>>>) {
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

/// Lets spawned tasks run until each waits on something.
pub(crate) async fn settle() {
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
}
