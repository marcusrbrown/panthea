//! Every piece of sidecar lifecycle state lives behind one lock: `Lifecycle`.
//! The launch id, the tracked child, the poll task, the restart bookkeeping and
//! the snapshot fields (what was last polled, what was last sent, the
//! subscribed channel) move together. Each transition takes `&mut Lifecycle`,
//! checks and mutates under that lock, and returns what the caller must do
//! after releasing it: kill a child, abort a task, retire the mux launch,
//! schedule a retry. A check is never separated from the change it authorizes
//! by an unlock.
//!
//! This is the shape of `apps/desktop/src-tauri/src/state.rs`, with the
//! simulation's port and token replaced by a pid: the studio sidecar speaks
//! over stdio, and its stdin is held by the mux.

use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;

use crate::mux::Mux;
use crate::poll::Dirty;

pub const MAX_RESTARTS: u32 = 3;

/// What the supervisor keeps of a running sidecar: its pid, for the last-resort
/// kill. The child's stdin lives in the mux, which closes it when the launch is
/// retired.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChildHandle {
    pub pid: u32,
}

/// Every piece of state one sidecar launch and its supervision touch. `C` is the
/// tracked child's type: `ChildHandle`, or a stand-in in the tests.
pub struct Lifecycle<C = ChildHandle> {
    /// Identifies the current launch attempt. Bumped by every spawn and by every
    /// launch ending. Anything belonging to a launch (a poll task's snapshots,
    /// the child's exit handling, a scheduled retry, an in-flight attach) carries
    /// the value it started with and is checked against it under this lock
    /// before acting, so a callback that fires after its launch ended is a no-op.
    pub launch_id: u64,
    pub child: Option<C>,
    /// The poll task's handle. Taken out under the lock, aborted after unlock.
    pub poll_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Set by quitting: nothing may start another launch.
    pub stopped: bool,
    /// Set once the supervisor gives up after `MAX_RESTARTS` attempts.
    pub exhausted: bool,
    pub restarts: u32,
    /// The last snapshot sent to the webview, for change detection.
    pub last_sent: Option<serde_json::Value>,
    /// The most recently polled snapshot, cached whether or not anyone was
    /// subscribed: replayed at once to a newly (re)subscribing channel.
    pub last_snapshot: Option<serde_json::Value>,
    /// The subscribed channel; a resubscribe replaces it. A launch beginning or
    /// ending does not reset it: a subscribed webview stays subscribed across a
    /// sidecar restart.
    pub channel: Option<Channel<serde_json::Value>>,
}

impl<C> Default for Lifecycle<C> {
    fn default() -> Self {
        Self {
            launch_id: 0,
            child: None,
            poll_task: None,
            stopped: false,
            exhausted: false,
            restarts: 0,
            last_sent: None,
            last_snapshot: None,
            channel: None,
        }
    }
}

/// Where the host is, for the webview.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostState {
    /// No config file is chosen, so no sidecar is started.
    NotConfigured,
    /// A launch has begun and has no child yet.
    Starting,
    Running,
    /// The sidecar exited and a retry is scheduled.
    Restarting,
    /// The supervisor gave up.
    Unavailable,
    /// The app is quitting.
    Stopped,
}

pub fn host_state<C>(lifecycle: &Lifecycle<C>, configured: bool) -> HostState {
    if !configured {
        HostState::NotConfigured
    } else if lifecycle.stopped {
        HostState::Stopped
    } else if lifecycle.exhausted {
        HostState::Unavailable
    } else if lifecycle.child.is_some() {
        HostState::Running
    } else if lifecycle.restarts > 0 {
        HostState::Restarting
    } else {
        HostState::Starting
    }
}

/// True while `launch_id` is still the launch currently tracked.
pub fn is_current<C>(lifecycle: &Lifecycle<C>, launch_id: u64) -> bool {
    lifecycle.launch_id == launch_id
}

fn reset_snapshot_fields<C>(lifecycle: &mut Lifecycle<C>) {
    lifecycle.last_sent = None;
    lifecycle.last_snapshot = None;
}

/// Starts a new launch attempt: refuses if the app is stopping. Otherwise bumps
/// the launch id and resets the snapshot fields, returning the new id.
pub fn begin_spawn<C>(lifecycle: &mut Lifecycle<C>) -> Option<u64> {
    if lifecycle.stopped {
        return None;
    }
    lifecycle.launch_id += 1;
    reset_snapshot_fields(lifecycle);
    Some(lifecycle.launch_id)
}

/// Whether a spawned child may be installed: its launch must still be current
/// and the app must not have been stopped while the spawn was in flight.
pub fn should_attach<C>(lifecycle: &Lifecycle<C>, launch_id: u64) -> bool {
    is_current(lifecycle, launch_id) && !lifecycle.stopped
}

/// What `attach_child` decided.
#[derive(Debug, PartialEq, Eq)]
pub enum AttachOutcome<C = ChildHandle> {
    Attached,
    /// The launch went stale while the child was being spawned: hands the child
    /// back so the caller kills it after unlock. Nothing else will ever kill an
    /// untracked child.
    Refused(C),
}

/// Installs `child` as the tracked process for `launch_id`, or refuses and hands
/// it back.
pub fn attach_child<C>(lifecycle: &mut Lifecycle<C>, launch_id: u64, child: C) -> AttachOutcome<C> {
    if !should_attach(lifecycle, launch_id) {
        return AttachOutcome::Refused(child);
    }
    lifecycle.child = Some(child);
    AttachOutcome::Attached
}

/// A launch that stayed up long enough to answer has not crashed: forgets the
/// crashes before it, so a long-lived app is not retired by three crashes that
/// are days apart. A no-op for a stale launch.
pub fn mark_healthy<C>(lifecycle: &mut Lifecycle<C>, launch_id: u64) {
    if is_current(lifecycle, launch_id) {
        lifecycle.restarts = 0;
    }
}

/// The supervisor's retry decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttemptOutcome {
    Retry { attempt: u32, backoff: Duration },
    Exhausted,
}

/// Given the restarts already recorded (before this failure), decides whether to
/// retry with the next backoff (500 ms, 1 s, 2 s) or give up.
pub fn next_attempt_outcome(restarts_so_far: u32) -> AttemptOutcome {
    let attempt = restarts_so_far + 1;
    if attempt > MAX_RESTARTS {
        return AttemptOutcome::Exhausted;
    }
    AttemptOutcome::Retry {
        attempt,
        backoff: Duration::from_millis(500 * 2u64.pow(attempt - 1)),
    }
}

/// What `on_terminated` decided, once past the staleness check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminatedOutcome {
    /// The event belongs to a launch already ended: nothing happened. Exit and
    /// a failed write both report here, so the second report lands as this.
    Stale,
    /// Quitting or stopped: the launch ended, no retry is scheduled.
    Stopped,
    /// Schedule a retry after `backoff`, carrying the id that must still be
    /// current when it fires.
    Retry {
        backoff: Duration,
        retry_launch_id: u64,
        attempt: u32,
    },
    Exhausted,
}

/// The poll task taken out alongside the decision, for the caller to abort after
/// unlock.
pub struct TerminatedResult {
    pub poll_task: Option<tauri::async_runtime::JoinHandle<()>>,
    pub outcome: TerminatedOutcome,
}

/// Handles an unexpected exit or a spawn failure for `launch_id`. A no-op
/// (`Stale`) unless it is still current. Otherwise clears the child, ends the
/// launch (bumping the id) and decides whether to retry or give up.
pub fn on_terminated<C>(
    lifecycle: &mut Lifecycle<C>,
    launch_id: u64,
    quitting: bool,
) -> TerminatedResult {
    let current = is_current(lifecycle, launch_id);
    let poll_task = if current {
        lifecycle.poll_task.take()
    } else {
        None
    };
    if !current {
        return TerminatedResult {
            poll_task,
            outcome: TerminatedOutcome::Stale,
        };
    }
    // The terminated child is already dead; nothing else will act on it.
    lifecycle.child = None;
    lifecycle.launch_id += 1;
    reset_snapshot_fields(lifecycle);

    if quitting || lifecycle.stopped {
        return TerminatedResult {
            poll_task,
            outcome: TerminatedOutcome::Stopped,
        };
    }

    let restarts_so_far = lifecycle.restarts;
    lifecycle.restarts += 1;
    let outcome = match next_attempt_outcome(restarts_so_far) {
        AttemptOutcome::Retry { attempt, backoff } => TerminatedOutcome::Retry {
            backoff,
            retry_launch_id: lifecycle.launch_id,
            attempt,
        },
        AttemptOutcome::Exhausted => {
            lifecycle.exhausted = true;
            TerminatedOutcome::Exhausted
        }
    };
    TerminatedResult { poll_task, outcome }
}

/// Whether a scheduled retry should spawn: only if its captured id is still
/// current, then like `begin_spawn`.
pub fn on_retry<C>(lifecycle: &mut Lifecycle<C>, launch_id: u64) -> Option<u64> {
    if !is_current(lifecycle, launch_id) {
        return None;
    }
    begin_spawn(lifecycle)
}

/// What `stop` took out, for the caller to carry out after unlock.
pub struct StopResult<C = ChildHandle> {
    pub child: Option<C>,
    pub poll_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// The launch that was ended: the caller retires it in the mux.
    pub ended_launch: u64,
}

/// Stops for good (quitting): ends the launch and takes the child and poll task.
pub fn stop<C>(lifecycle: &mut Lifecycle<C>) -> StopResult<C> {
    let ended_launch = lifecycle.launch_id;
    lifecycle.stopped = true;
    lifecycle.launch_id += 1;
    reset_snapshot_fields(lifecycle);
    StopResult {
        child: lifecycle.child.take(),
        poll_task: lifecycle.poll_task.take(),
        ended_launch,
    }
}

/// What `apply_restart` took out and decided.
pub struct ApplyRestartResult<C = ChildHandle> {
    /// The live child of the launch being replaced.
    pub child: Option<C>,
    pub poll_task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// The launch that was replaced (0 when none ran): the caller retires it.
    pub replaced_launch: u64,
    /// The new launch to spawn, or `None` once stopped.
    pub launch_id: Option<u64>,
}

/// Replaces the current launch with a fresh one so a config change takes effect.
/// A change is not a crash: it resets the restart bookkeeping and revives an
/// exhausted supervisor. Refuses once stopped.
pub fn apply_restart<C>(lifecycle: &mut Lifecycle<C>) -> ApplyRestartResult<C> {
    let replaced_launch = lifecycle.launch_id;
    if lifecycle.stopped {
        return ApplyRestartResult {
            child: None,
            poll_task: None,
            replaced_launch,
            launch_id: None,
        };
    }
    let child = lifecycle.child.take();
    let poll_task = lifecycle.poll_task.take();
    lifecycle.exhausted = false;
    lifecycle.restarts = 0;
    ApplyRestartResult {
        child,
        poll_task,
        replaced_launch,
        launch_id: begin_spawn(lifecycle),
    }
}

#[derive(Default)]
pub struct StudioState {
    /// Set the moment a quit is requested, so the supervisor stops restarting.
    pub quitting: Mutex<bool>,
    pub lifecycle: Mutex<Lifecycle>,
    /// The stdio multiplexer. Its own lock; never taken while `lifecycle` is
    /// held across an await.
    pub mux: Arc<Mux>,
    /// Set when this app changed something, so the next poll re-reads the lists.
    pub dirty: Dirty,
    /// One receiver per live launch, signalled when its child terminates. Taken
    /// by whoever ends the launch, to wait (bounded) for the exit.
    pub exit_watch: Mutex<HashMap<u64, mpsc::Receiver<()>>>,
}

#[cfg(test)]
mod tests {
    use super::Lifecycle as GenericLifecycle;
    use super::*;

    type Lifecycle = GenericLifecycle<&'static str>;

    fn running(child: &'static str) -> (Lifecycle, u64) {
        let mut lifecycle = Lifecycle::default();
        let id = begin_spawn(&mut lifecycle).expect("not stopped");
        assert_eq!(
            attach_child(&mut lifecycle, id, child),
            AttachOutcome::Attached
        );
        (lifecycle, id)
    }

    #[test]
    fn a_fresh_lifecycle_has_never_begun_a_launch() {
        let lifecycle = Lifecycle::default();
        assert_eq!(lifecycle.launch_id, 0);
        assert!(lifecycle.child.is_none());
        assert!(!lifecycle.stopped && !lifecycle.exhausted);
        assert_eq!(lifecycle.restarts, 0);
    }

    #[test]
    fn begin_spawn_bumps_the_id_and_the_new_id_is_current() {
        let mut lifecycle = Lifecycle::default();
        let first = begin_spawn(&mut lifecycle).unwrap();
        let second = begin_spawn(&mut lifecycle).unwrap();
        assert_eq!((first, second), (1, 2));
        assert!(is_current(&lifecycle, second));
        assert!(!is_current(&lifecycle, first));
    }

    #[test]
    fn begin_spawn_refuses_once_stopped() {
        let mut lifecycle = Lifecycle {
            stopped: true,
            ..Default::default()
        };
        assert_eq!(begin_spawn(&mut lifecycle), None);
        assert_eq!(lifecycle.launch_id, 0);
    }

    #[test]
    fn begin_spawn_resets_the_snapshot_fields_but_keeps_the_subscriber() {
        let mut lifecycle = Lifecycle {
            last_sent: Some(serde_json::json!({ "a": 1 })),
            last_snapshot: Some(serde_json::json!({ "a": 1 })),
            channel: Some(Channel::new(|_| Ok(()))),
            ..Default::default()
        };
        begin_spawn(&mut lifecycle).unwrap();
        assert!(lifecycle.last_sent.is_none());
        assert!(lifecycle.last_snapshot.is_none());
        assert!(lifecycle.channel.is_some());
    }

    #[test]
    fn attach_installs_the_child_for_a_current_launch() {
        let (lifecycle, _) = running("child");
        assert_eq!(lifecycle.child, Some("child"));
    }

    #[test]
    fn attach_refuses_and_hands_back_the_child_once_stopped_or_superseded() {
        let mut lifecycle = Lifecycle::default();
        let id = begin_spawn(&mut lifecycle).unwrap();
        let _ = stop(&mut lifecycle);
        assert_eq!(
            attach_child(&mut lifecycle, id, "late"),
            AttachOutcome::Refused("late")
        );

        let mut lifecycle = Lifecycle::default();
        let old = begin_spawn(&mut lifecycle).unwrap();
        let new = begin_spawn(&mut lifecycle).unwrap();
        assert_eq!(
            attach_child(&mut lifecycle, old, "superseded"),
            AttachOutcome::Refused("superseded")
        );
        assert_eq!(
            attach_child(&mut lifecycle, new, "fresh"),
            AttachOutcome::Attached
        );
        assert!(lifecycle.child == Some("fresh"));
    }

    #[test]
    fn retries_up_to_max_restarts_then_exhausts_with_doubling_backoff() {
        assert_eq!(
            next_attempt_outcome(0),
            AttemptOutcome::Retry {
                attempt: 1,
                backoff: Duration::from_millis(500)
            }
        );
        assert_eq!(
            next_attempt_outcome(1),
            AttemptOutcome::Retry {
                attempt: 2,
                backoff: Duration::from_secs(1)
            }
        );
        assert_eq!(
            next_attempt_outcome(MAX_RESTARTS - 1),
            AttemptOutcome::Retry {
                attempt: MAX_RESTARTS,
                backoff: Duration::from_millis(500 * 2u64.pow(MAX_RESTARTS - 1))
            }
        );
        assert_eq!(
            next_attempt_outcome(MAX_RESTARTS),
            AttemptOutcome::Exhausted
        );
    }

    #[test]
    fn an_exit_schedules_a_retry_for_a_new_launch_id_and_clears_the_child() {
        let (mut lifecycle, id) = running("child");

        let result = on_terminated(&mut lifecycle, id, false);

        assert_eq!(
            result.outcome,
            TerminatedOutcome::Retry {
                backoff: Duration::from_millis(500),
                retry_launch_id: id + 1,
                attempt: 1
            }
        );
        assert!(lifecycle.child.is_none());
        assert_eq!(lifecycle.launch_id, id + 1);
        assert_eq!(lifecycle.restarts, 1);
    }

    #[test]
    fn the_exit_and_a_failed_write_both_report_the_same_death_and_only_the_first_counts() {
        let (mut lifecycle, id) = running("child");

        let write_failed = on_terminated(&mut lifecycle, id, false);
        let exit_event = on_terminated(&mut lifecycle, id, false);

        assert!(matches!(
            write_failed.outcome,
            TerminatedOutcome::Retry { .. }
        ));
        assert_eq!(exit_event.outcome, TerminatedOutcome::Stale);
        assert_eq!(lifecycle.restarts, 1);
        assert_eq!(lifecycle.launch_id, id + 1);
    }

    #[test]
    fn a_superseded_launchs_exit_is_stale_and_touches_the_new_launch_not_at_all() {
        let (mut lifecycle, old) = running("old");
        let outcome = apply_restart(&mut lifecycle);
        assert_eq!(outcome.child, Some("old"));
        let new = outcome.launch_id.unwrap();
        attach_child(&mut lifecycle, new, "new");

        let result = on_terminated(&mut lifecycle, old, false);

        assert_eq!(result.outcome, TerminatedOutcome::Stale);
        assert_eq!(lifecycle.child, Some("new"));
        assert_eq!(lifecycle.launch_id, new);
        assert_eq!(lifecycle.restarts, 0);
    }

    #[test]
    fn quitting_or_stopped_ends_the_launch_without_a_retry() {
        let (mut lifecycle, id) = running("child");
        let result = on_terminated(&mut lifecycle, id, true);
        assert_eq!(result.outcome, TerminatedOutcome::Stopped);
        assert_eq!(lifecycle.restarts, 0);

        let (mut lifecycle, id) = running("child");
        lifecycle.stopped = true;
        assert_eq!(
            on_terminated(&mut lifecycle, id, false).outcome,
            TerminatedOutcome::Stopped
        );
    }

    #[test]
    fn the_supervisor_gives_up_after_max_restarts_and_marks_itself_exhausted() {
        let mut lifecycle = Lifecycle::default();
        let mut last = TerminatedOutcome::Stale;
        for _ in 0..=MAX_RESTARTS {
            let id = begin_spawn(&mut lifecycle).unwrap();
            attach_child(&mut lifecycle, id, "child");
            last = on_terminated(&mut lifecycle, id, false).outcome;
        }
        assert_eq!(last, TerminatedOutcome::Exhausted);
        assert!(lifecycle.exhausted);
        assert_eq!(lifecycle.restarts, MAX_RESTARTS + 1);
    }

    #[test]
    fn a_launch_that_answered_forgets_the_crashes_before_it() {
        let mut lifecycle = Lifecycle::default();
        for _ in 0..2 {
            let id = begin_spawn(&mut lifecycle).unwrap();
            attach_child(&mut lifecycle, id, "child");
            on_terminated(&mut lifecycle, id, false);
        }
        assert_eq!(lifecycle.restarts, 2);
        let id = begin_spawn(&mut lifecycle).unwrap();
        attach_child(&mut lifecycle, id, "child");

        mark_healthy(&mut lifecycle, id - 1);
        assert_eq!(lifecycle.restarts, 2, "a stale launch cannot vouch");
        mark_healthy(&mut lifecycle, id);

        assert_eq!(lifecycle.restarts, 0);
    }

    #[test]
    fn a_retry_is_allowed_for_its_own_launch_and_refused_once_anything_else_happened() {
        let (mut lifecycle, id) = running("child");
        let TerminatedOutcome::Retry {
            retry_launch_id, ..
        } = on_terminated(&mut lifecycle, id, false).outcome
        else {
            panic!("expected a retry");
        };
        assert_eq!(
            on_retry(&mut lifecycle, retry_launch_id),
            Some(retry_launch_id + 1)
        );

        let (mut lifecycle, id) = running("child");
        let TerminatedOutcome::Retry {
            retry_launch_id, ..
        } = on_terminated(&mut lifecycle, id, false).outcome
        else {
            panic!("expected a retry");
        };
        let _ = stop(&mut lifecycle);
        assert_eq!(on_retry(&mut lifecycle, retry_launch_id), None);

        let (mut lifecycle, id) = running("child");
        let TerminatedOutcome::Retry {
            retry_launch_id, ..
        } = on_terminated(&mut lifecycle, id, false).outcome
        else {
            panic!("expected a retry");
        };
        apply_restart(&mut lifecycle);
        assert_eq!(on_retry(&mut lifecycle, retry_launch_id), None);
    }

    #[test]
    fn stop_ends_the_launch_hands_back_the_child_and_names_the_launch_to_retire() {
        let (mut lifecycle, id) = running("child");
        lifecycle.last_snapshot = Some(serde_json::json!(1));

        let result = stop(&mut lifecycle);

        assert_eq!(result.child, Some("child"));
        assert_eq!(result.ended_launch, id);
        assert!(lifecycle.stopped);
        assert_eq!(lifecycle.launch_id, id + 1);
        assert!(lifecycle.child.is_none());
        assert!(lifecycle.last_snapshot.is_none());
        assert_eq!(begin_spawn(&mut lifecycle), None);
    }

    #[test]
    fn apply_restart_hands_back_the_live_child_begins_a_new_launch_and_resets_the_crash_count() {
        let (mut lifecycle, id) = running("old");
        lifecycle.restarts = 2;
        lifecycle.exhausted = true;

        let result = apply_restart(&mut lifecycle);

        assert_eq!(result.child, Some("old"));
        assert_eq!(result.replaced_launch, id);
        assert_eq!(result.launch_id, Some(id + 1));
        assert!(lifecycle.child.is_none());
        assert_eq!(lifecycle.restarts, 0);
        assert!(!lifecycle.exhausted);
    }

    #[test]
    fn apply_restart_after_stop_spawns_nothing() {
        let (mut lifecycle, _) = running("old");
        let _ = stop(&mut lifecycle);

        let result = apply_restart(&mut lifecycle);

        assert!(result.child.is_none());
        assert_eq!(result.launch_id, None);
    }

    #[test]
    fn apply_restart_before_any_child_exists_still_begins_a_launch() {
        let mut lifecycle = Lifecycle::default();

        let result = apply_restart(&mut lifecycle);

        assert!(result.child.is_none());
        assert_eq!(result.replaced_launch, 0);
        assert_eq!(result.launch_id, Some(1));
    }

    #[test]
    fn two_config_changes_in_a_row_let_exactly_one_launch_attach() {
        let mut lifecycle = Lifecycle::default();
        let first = apply_restart(&mut lifecycle).launch_id.unwrap();
        let second = apply_restart(&mut lifecycle).launch_id.unwrap();

        assert!(matches!(
            attach_child(&mut lifecycle, first, "first"),
            AttachOutcome::Refused("first")
        ));
        assert_eq!(
            attach_child(&mut lifecycle, second, "second"),
            AttachOutcome::Attached
        );
    }

    #[test]
    fn the_host_state_says_which_of_the_six_places_the_app_is_in() {
        let mut lifecycle = Lifecycle::default();
        assert_eq!(host_state(&lifecycle, false), HostState::NotConfigured);
        assert_eq!(host_state(&lifecycle, true), HostState::Starting);

        let id = begin_spawn(&mut lifecycle).unwrap();
        assert_eq!(host_state(&lifecycle, true), HostState::Starting);
        attach_child(&mut lifecycle, id, "child");
        assert_eq!(host_state(&lifecycle, true), HostState::Running);
        assert_eq!(host_state(&lifecycle, false), HostState::NotConfigured);

        on_terminated(&mut lifecycle, id, false);
        assert_eq!(host_state(&lifecycle, true), HostState::Restarting);

        lifecycle.exhausted = true;
        assert_eq!(host_state(&lifecycle, true), HostState::Unavailable);

        lifecycle.stopped = true;
        assert_eq!(host_state(&lifecycle, true), HostState::Stopped);
    }

    #[test]
    fn host_states_serialize_as_kebab_case_words() {
        assert_eq!(
            serde_json::to_value(HostState::NotConfigured).unwrap(),
            serde_json::json!("not-configured")
        );
        assert_eq!(
            serde_json::to_value(HostState::Restarting).unwrap(),
            serde_json::json!("restarting")
        );
    }
}
