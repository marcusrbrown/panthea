// Spawns the real studio session (`bun tools/studio/src/index.ts session`) with
// the host's own argument builder, attaches its stdio to the host's own mux, and
// drives it through the host's own bridge: `status` answers, an unknown op gets
// one error reply, every op in the schema table reaches the session's
// dispatcher with its arguments intact, and closing stdin ends the session
// within the quit bound.
//
// Skips (rather than fails) if `bun` is not on PATH, so a Rust-only toolchain
// can still run `cargo test`. No test sleeps: each waits on the child's output
// or exit.

use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Instant;

use panthea_studio_lib::bridge::{self, CommandError};
use panthea_studio_lib::mux::{LineSink, Mux, OpClass, ReplyReader};
use panthea_studio_lib::poll::{Dirty, Poller};
use panthea_studio_lib::schema::OPS;
use panthea_studio_lib::teardown::{sidecar_args, wait_or_kill, ExitSignal, Teardown, QUIT_BOUND};
use serde_json::{json, Value};

const LAUNCH: u64 = 1;

struct StdinSink(ChildStdin);

impl LineSink for StdinSink {
    fn write_line(&mut self, line: &str) -> io::Result<()> {
        writeln!(self.0, "{line}")?;
        self.0.flush()
    }
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
}

fn bun_available() -> bool {
    Command::new("bun")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

struct Session {
    mux: Arc<Mux>,
    child: Child,
    dir: PathBuf,
}

impl Session {
    /// Starts the session on a temp studio root and the repository's content.
    fn start(name: &str) -> Session {
        let dir =
            std::env::temp_dir().join(format!("panthea-studio-it-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        let content = repo_root().join("content").join("greek");
        let config = dir.join("studio.json");
        std::fs::write(
            &config,
            json!({
                "studioRoot": dir.join("root"),
                "contentRoot": content,
                "registryRoot": content.join("assets").join("registry"),
            })
            .to_string(),
        )
        .expect("write config");

        let mut child = Command::new("bun")
            .arg(repo_root().join("tools/studio/src/index.ts"))
            .args(sidecar_args(&config, std::process::id()))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn the session");

        let mux = Arc::new(Mux::new());
        let stdin = child.stdin.take().expect("stdin");
        assert!(mux.attach(LAUNCH, Box::new(StdinSink(stdin))).is_ok());
        let mut stdout = child.stdout.take().expect("stdout");
        let reader_mux = mux.clone();
        thread::spawn(move || {
            let mut reader = ReplyReader::default();
            let mut buf = vec![0u8; 64 * 1024];
            while let Ok(n) = stdout.read(&mut buf) {
                if n == 0 {
                    break;
                }
                reader.feed(&reader_mux, LAUNCH, &buf[..n]);
            }
        });

        Session { mux, child, dir }
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .expect("tokio runtime")
    }

    /// Closes the session's stdin the way the host does (retiring the launch
    /// drops the sink), and waits for the exit within the quit bound.
    fn end(self) -> (Teardown, bool) {
        let started = Instant::now();
        self.mux.retire(LAUNCH);
        let (tx, rx) = mpsc::channel::<()>();
        let success = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = success.clone();
        let mut child = self.child;
        let reaper = thread::spawn(move || {
            let status = child.wait().expect("wait");
            flag.store(status.success(), std::sync::atomic::Ordering::SeqCst);
            let _ = tx.send(());
        });
        let rx_ref: &dyn ExitSignal = &rx;
        let mut killed = false;
        let outcome = wait_or_kill(0, Some(rx_ref), QUIT_BOUND, |_| killed = true);
        assert!(!killed, "the session must exit by itself on stdin close");
        reaper.join().expect("reaper");
        eprintln!(
            "sidecar_integration: stdin close -> exit took {:?}",
            started.elapsed()
        );
        let _ = std::fs::remove_dir_all(&self.dir);
        (outcome, success.load(std::sync::atomic::Ordering::SeqCst))
    }
}

#[test]
fn the_real_session_answers_status_refuses_an_unknown_op_once_and_ends_on_stdin_close() {
    if !bun_available() {
        eprintln!("skipping sidecar_integration: bun not found on PATH");
        return;
    }
    let session = Session::start("status");
    Session::runtime().block_on(async {
        let status = session
            .mux
            .request("status", json!({}), OpClass::Read)
            .await
            .expect("status answers");
        assert!(status["counts"].is_object(), "{status}");

        let unknown = session
            .mux
            .request("levitate", json!({}), OpClass::Read)
            .await
            .expect_err("an unknown op is refused");
        match unknown {
            panthea_studio_lib::mux::MuxError::Refused { code, .. } => {
                assert_eq!(code, "unknown-op");
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
        assert_eq!(session.mux.pending(), 0, "exactly one reply per request");

        // The session is still serving after a refusal.
        session
            .mux
            .request("status", json!({}), OpClass::Read)
            .await
            .expect("status still answers");
    });

    let (outcome, success) = session.end();
    assert_eq!(outcome, Teardown::Graceful);
    assert!(success, "the session exits 0 on end of input");
}

#[test]
fn every_op_in_the_schema_table_reaches_the_sessions_dispatcher_with_each_argument_name_known() {
    if !bun_available() {
        eprintln!("skipping sidecar_integration: bun not found on PATH");
        return;
    }
    let session = Session::start("parity");
    Session::runtime().block_on(async {
        let dirty = Dirty::default();
        bridge::studio_call(&session.mux, true, &dirty, "status", json!({}))
            .await
            .expect("the session is up");
        for spec in OPS {
            // The op itself: whatever the session says, it must know the name.
            let bare = bridge::studio_call(&session.mux, true, &dirty, spec.op, json!({})).await;
            assert!(reached_dispatcher(&bare), "{}: {bare:?}", spec.op);

            // Each argument alone, with a value of the wrong type for any
            // typed argument, so nothing runs: the dispatcher must not call
            // the name unknown.
            for arg in spec.args {
                let result = bridge::studio_call(
                    &session.mux,
                    true,
                    &dirty,
                    spec.op,
                    json!({ *arg: { "junk": [1] } }),
                )
                .await;
                assert!(reached_dispatcher(&result), "{} {arg}: {result:?}", spec.op);
                if let Err(error) = &result {
                    assert!(
                        !error
                            .message
                            .contains(&format!("unknown argument \"{arg}\"")),
                        "{} does not know {arg}: {}",
                        spec.op,
                        error.message
                    );
                }
            }
        }
    });
    let (outcome, _) = session.end();
    assert_eq!(outcome, Teardown::Graceful);
}

/// True if the session's own dispatcher answered: a result, or a refusal that is
/// not the host's (the session gone, a timeout, an unreadable reply) and not
/// "unknown op".
fn reached_dispatcher(result: &Result<Value, CommandError>) -> bool {
    match result {
        Ok(_) => true,
        Err(error) => {
            !error.retryable
                && !["timeout", "malformed-reply", "unknown-op"].contains(&error.code.as_str())
        }
    }
}

#[test]
fn a_call_outside_the_table_never_reaches_the_session_and_a_poll_assembles_a_snapshot() {
    if !bun_available() {
        eprintln!("skipping sidecar_integration: bun not found on PATH");
        return;
    }
    let session = Session::start("poll");
    Session::runtime().block_on(async {
        let dirty = Dirty::default();

        let refused = bridge::studio_call(
            &session.mux,
            true,
            &dirty,
            "export",
            json!({ "id": "e", "dir": "/tmp/should-never-be-written" }),
        )
        .await
        .unwrap_err();
        assert_eq!(refused.code, "unknown-op");
        assert!(!Path::new("/tmp/should-never-be-written").exists());

        let mut poller = Poller::default();
        let snapshot = poller.tick(&session.mux, &dirty).await.expect("a snapshot");
        for section in [
            "status",
            "requests",
            "jobs",
            "candidates",
            "edits",
            "workingSets",
            "assets",
            "keys",
        ] {
            assert!(!snapshot[section].is_null(), "{section}: {snapshot}");
        }
        assert_eq!(snapshot["errors"], json!({}));
        assert!(snapshot["keys"]["selections"].is_array());
    });
    let (outcome, _) = session.end();
    assert_eq!(outcome, Teardown::Graceful);
}
