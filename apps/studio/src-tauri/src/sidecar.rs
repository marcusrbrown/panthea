//! Sidecar process supervision: starts the studio session with the chosen
//! config, hands its stdio to the mux, restarts it with backoff on an
//! unexpected exit, and ends it on quit or a config change by closing its stdin
//! and waiting a bounded time before killing it.
//!
//! Every check against shared lifecycle state and the mutation it authorizes
//! happen under the one `Lifecycle` lock (see state.rs). Spawning, killing and
//! waiting are blocking OS calls and run after unlocking; `attach_child`
//! installs a child under the lock afterwards and refuses it if its launch went
//! stale while the spawn was in flight.

use std::process::Command;
use std::sync::mpsc;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::config::ConfigStore;
use crate::mux::{LineSink, ReplyReader};
use crate::poll::{apply_snapshot, poll_loop, publish_host, Poller, POLL_GAP};
use crate::state::{
    apply_restart, attach_child, begin_spawn, mark_healthy, on_retry, on_terminated, stop,
    ApplyRestartResult, AttachOutcome, ChildHandle, Lifecycle, StopResult, StudioState,
    TerminatedOutcome, MAX_RESTARTS,
};
use crate::teardown::{sidecar_args, wait_or_kill, ExitSignal, QUIT_BOUND};

/// Matches the `externalBin` entry in `tauri.conf.json`; the target-triple
/// suffix is stripped by Tauri's sidecar bundling convention.
const SIDECAR_NAME: &str = "panthea-studio-sidecar";

/// The sidecar's stdin. Dropping it drops the child's write end, which is the
/// sidecar's end-of-input: its signal to tear down and exit.
struct ChildSink(CommandChild);

impl LineSink for ChildSink {
    fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        self.0
            .write(format!("{line}\n").as_bytes())
            .map_err(|error| std::io::Error::other(error.to_string()))
    }
}

/// Runs `task` on its own thread and returns at once: spawning a process is a
/// blocking OS call, and callers include the main thread (setup) and commands.
fn run_off_caller_thread(task: impl FnOnce() + Send + 'static) {
    std::thread::spawn(task);
}

fn kill_pid(pid: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-KILL", &pid.to_string()])
        .status();
}

fn lock<'a>(state: &'a StudioState) -> std::sync::MutexGuard<'a, Lifecycle> {
    state
        .lifecycle
        .lock()
        .expect("sidecar state mutex poisoned")
}

/// Pushes the host state to the subscriber if it changed. Called after every
/// lifecycle transition, once the lock that made it is released.
fn publish(app: &AppHandle) {
    publish_host(&mut lock(&app.state::<StudioState>()));
}

/// Starts the first launch when a config is chosen. With none, nothing starts
/// and the host reports not-configured.
pub fn spawn_sidecar(app: AppHandle) {
    let state = app.state::<StudioState>();
    let configured = app.state::<ConfigStore>().path().is_some();
    let launch_id = {
        let mut lifecycle = lock(&state);
        lifecycle.configured = configured;
        if configured {
            begin_spawn(&mut lifecycle)
        } else {
            None
        }
    };
    publish(&app);
    if let Some(launch_id) = launch_id {
        run_off_caller_thread(move || spawn_with_id(app, launch_id));
    }
}

/// Ends the running launch (close stdin, bounded wait, kill) and starts a fresh
/// one that reads the new config. The old session must be gone first: it holds
/// the root's lock. Blocks on the OS; call it off the main thread.
pub fn apply_restart_sidecar(app: AppHandle) {
    let configured = app.state::<ConfigStore>().path().is_some();
    let ApplyRestartResult {
        child,
        poll_task,
        replaced_launch,
        launch_id,
    } = {
        let state = app.state::<StudioState>();
        let mut lifecycle = lock(&state);
        lifecycle.configured = configured;
        apply_restart(&mut lifecycle)
    };
    publish(&app);
    if let Some(task) = poll_task {
        task.abort();
    }
    end_launch(&app, replaced_launch, child);
    if !configured {
        return;
    }
    // `apply_restart` began a launch only if not stopped; a first config chosen
    // after startup begins the launch here.
    let launch_id = launch_id.or_else(|| begin_spawn(&mut lock(&app.state::<StudioState>())));
    publish(&app);
    if let Some(launch_id) = launch_id {
        spawn_with_id(app, launch_id);
    }
}

fn spawn_retry(app: AppHandle, retry_launch_id: u64) {
    let launch_id = on_retry(&mut lock(&app.state::<StudioState>()), retry_launch_id);
    if let Some(launch_id) = launch_id {
        run_off_caller_thread(move || spawn_with_id(app, launch_id));
    }
}

/// Retires `launch` in the mux (failing its pending requests and closing its
/// stdin), then waits a bounded time for its child to exit and kills it if it
/// does not.
fn end_launch(app: &AppHandle, launch: u64, child: Option<ChildHandle>) {
    let state = app.state::<StudioState>();
    state.mux.retire(launch);
    let watch = state
        .exit_watch
        .lock()
        .expect("sidecar state mutex poisoned")
        .remove(&launch);
    let Some(child) = child else {
        return;
    };
    let outcome = wait_or_kill(
        child.pid,
        watch.as_ref().map(|rx| rx as &dyn ExitSignal),
        QUIT_BOUND,
        kill_pid,
    );
    eprintln!("panthea-studio: sidecar teardown: {outcome:?}");
}

/// Does the OS-level work for `launch_id`, already minted by the caller:
/// spawns the child, installs it under the lock (killing it if the launch went
/// stale), gives the mux its stdin, and starts the poll task.
fn spawn_with_id(app: AppHandle, launch_id: u64) {
    let Some(config) = app.state::<ConfigStore>().path() else {
        handle_termination(&app, "not-configured", launch_id);
        return;
    };
    let command = match app.shell().sidecar(SIDECAR_NAME) {
        // Raw output: the reader frames lines itself, with a bound.
        Ok(command) => command
            .args(sidecar_args(&config, std::process::id()))
            .set_raw_out(true),
        Err(error) => {
            eprintln!("panthea-studio: failed to resolve sidecar \"{SIDECAR_NAME}\": {error}");
            handle_termination(&app, "resolve", launch_id);
            return;
        }
    };
    let (mut rx, child) = match command.spawn() {
        Ok(pair) => pair,
        Err(error) => {
            eprintln!("panthea-studio: failed to spawn sidecar: {error}");
            handle_termination(&app, "spawn", launch_id);
            return;
        }
    };
    let pid = child.pid();
    let state = app.state::<StudioState>();

    let attached = attach_child(&mut lock(&state), launch_id, ChildHandle { pid });
    publish(&app);
    if let AttachOutcome::Refused(_) = attached {
        // The launch went stale (a newer spawn or a quit) while this child was
        // starting. It was never tracked, so nothing else will ever end it.
        if let Err(error) = child.kill() {
            eprintln!("panthea-studio: failed to kill a superseded sidecar: {error}");
        }
        return;
    }

    let (exit_tx, exit_rx) = mpsc::channel::<()>();
    state
        .exit_watch
        .lock()
        .expect("sidecar state mutex poisoned")
        .insert(launch_id, exit_rx);

    if state
        .mux
        .attach(launch_id, Box::new(ChildSink(child)))
        .is_err()
    {
        // Retired before it attached: dropping the sink closed stdin; make sure.
        kill_pid(pid);
    }

    let supervised = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = ReplyReader::default();
        while let Some(event) = rx.recv().await {
            match event {
                // Replies carry store data; they are delivered, never logged.
                CommandEvent::Stdout(bytes) => {
                    let mux = supervised.state::<StudioState>().mux.clone();
                    reader.feed(&mux, launch_id, &bytes);
                }
                CommandEvent::Stderr(bytes) => {
                    eprint!(
                        "panthea-studio-sidecar(stderr): {}",
                        String::from_utf8_lossy(&bytes)
                    );
                }
                CommandEvent::Error(error) => {
                    eprintln!("panthea-studio-sidecar: command error: {error}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!(
                        "panthea-studio-sidecar: terminated (code={:?}, signal={:?})",
                        payload.code, payload.signal
                    );
                    let _ = exit_tx.send(());
                    handle_termination(&supervised, "terminated", launch_id);
                    break;
                }
                _ => {}
            }
        }
    });

    start_polling(&app, launch_id);
}

fn start_polling(app: &AppHandle, launch_id: u64) {
    let poller = Arc::new(tokio::sync::Mutex::new(Poller::default()));
    let tick_app = app.clone();
    let apply_app = app.clone();
    let task = tauri::async_runtime::spawn(poll_loop(
        POLL_GAP,
        move || {
            let app = tick_app.clone();
            let poller = poller.clone();
            async move {
                let state = app.state::<StudioState>();
                let mux = state.mux.clone();
                let mut poller = poller.lock().await;
                poller.tick(&mux, &state.dirty).await
            }
        },
        move |snapshot: Value| {
            let state = apply_app.state::<StudioState>();
            let mut lifecycle = lock(&state);
            // A launch that answered has not crashed: forget the crashes before it.
            mark_healthy(&mut lifecycle, launch_id);
            apply_snapshot(&mut lifecycle, launch_id, snapshot);
        },
    ));
    let state = app.state::<StudioState>();
    let mut lifecycle = lock(&state);
    if lifecycle.launch_id == launch_id {
        lifecycle.poll_task = Some(task);
    } else {
        drop(lifecycle);
        task.abort();
    }
}

/// Handles a spawn failure or an unexpected exit for `launch_id`: a no-op unless
/// it is still current. Otherwise retires the launch in the mux, aborts its poll
/// task after unlock, and schedules a backoff retry or gives up.
fn handle_termination(app: &AppHandle, reason: &str, launch_id: u64) {
    let state = app.state::<StudioState>();
    let quitting = *state.quitting.lock().expect("sidecar state mutex poisoned");
    let result = on_terminated(&mut lock(&state), launch_id, quitting);
    publish(app);
    state
        .exit_watch
        .lock()
        .expect("sidecar state mutex poisoned")
        .remove(&launch_id);
    if let Some(task) = result.poll_task {
        task.abort();
    }
    // Fails this launch's pending requests as retryable, whichever of a failed
    // write and the exit event got here first.
    state.mux.retire(launch_id);

    match result.outcome {
        TerminatedOutcome::Stale | TerminatedOutcome::Stopped => {}
        TerminatedOutcome::Retry {
            backoff,
            retry_launch_id,
            attempt,
        } => {
            eprintln!(
                "panthea-studio: sidecar attempt failed ({reason}); retrying in {backoff:?} (attempt {attempt}/{MAX_RESTARTS})"
            );
            let app_for_retry = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(backoff);
                spawn_retry(app_for_retry, retry_launch_id);
            });
        }
        TerminatedOutcome::Exhausted => {
            eprintln!(
                "panthea-studio: sidecar exceeded {MAX_RESTARTS} restart attempts (last failure: {reason}); giving up"
            );
        }
    }
}

/// Quits for good: nothing may start another launch, and the running one is
/// ended (stdin closed, bounded wait, kill). Safe to call more than once.
pub fn quit_sidecar(app: &AppHandle) {
    let state = app.state::<StudioState>();
    *state.quitting.lock().expect("sidecar state mutex poisoned") = true;
    let StopResult {
        child,
        poll_task,
        ended_launch,
    } = stop(&mut lock(&state));
    publish(app);
    if let Some(task) = poll_task {
        task.abort();
    }
    end_launch(app, ended_launch, child);
}
