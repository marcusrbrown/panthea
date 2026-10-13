//! Ending a sidecar: close its stdin and send it SIGTERM, give it a bounded
//! time to tear down (abort the running job, stop its image server, release the
//! root's lock), then kill it. The signals and the wait are injected so the
//! decision is tested without a process or a clock.
//!
//! SIGTERM, not stdin EOF alone: end of input makes a session drain its queue
//! (the CLI's behaviour), so a quit during a generation would wait out the job
//! and then be killed mid-job, leaving the detached image server running. The
//! sidecar's interrupt path aborts the job and stops the owned server group
//! before it exits.
//!
//! Measured on an idle session (the real 71 MB store, 20 runs, source and
//! compiled): stdin EOF to exit takes 10–18 ms. A session that owns an image
//! server also waits for that server's term grace (2 s in the creative-run
//! config) before it can release the lock, and up to its kill wait (10 s) if the
//! server ignores TERM. The bound is derived from the config's own deadlines
//! (`quit_bound`); `QUIT_BOUND` is only the fallback when they cannot be read.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

/// The wait when the configured deadlines cannot be read.
pub const QUIT_BOUND: Duration = Duration::from_secs(5);

/// Added to the sidecar's own term grace and kill wait: the job abort, the lock
/// release and the process exit around them.
pub const QUIT_MARGIN: Duration = Duration::from_secs(3);

/// The longest a quit or a config change waits for the sidecar to exit by
/// itself: the runtime's term grace plus its kill wait (what the sidecar may
/// spend stopping the image server) plus `QUIT_MARGIN`. `None` when the config
/// has no readable positive `runtime.deadlines.termGraceMs` and `killMs`.
pub fn quit_bound_from_config(text: &str) -> Option<Duration> {
    let config: serde_json::Value = serde_json::from_str(text).ok()?;
    let deadlines = config.get("runtime")?.get("deadlines")?;
    let ms = |name: &str| deadlines.get(name)?.as_u64().filter(|ms| *ms > 0);
    Some(Duration::from_millis(ms("termGraceMs")? + ms("killMs")?) + QUIT_MARGIN)
}

/// `quit_bound_from_config` for the config file at `path`, or `QUIT_BOUND` when
/// the file cannot be read or has no usable deadlines.
pub fn quit_bound(path: &Path) -> Duration {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| quit_bound_from_config(&text))
        .unwrap_or(QUIT_BOUND)
}

/// The exit of one launch's child, as the supervisor learns of it.
pub trait ExitSignal {
    /// True if the child exited within `bound`. A child whose exit was already
    /// signalled answers at once.
    fn exited_within(&self, bound: Duration) -> bool;
}

impl ExitSignal for mpsc::Receiver<()> {
    fn exited_within(&self, bound: Duration) -> bool {
        // A disconnected sender means the event loop ended, which only happens
        // after the child's Terminated event (or its handle was dropped).
        !matches!(
            self.recv_timeout(bound),
            Err(mpsc::RecvTimeoutError::Timeout)
        )
    }
}

/// How a child came to its end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Teardown {
    /// It exited by itself within the bound.
    Graceful,
    /// It did not, and was killed.
    Killed,
    /// There was nothing to wait for: it had already gone.
    AlreadyGone,
}

/// Calls `term` with `pid`, waits for `exit` up to `bound`, then calls `kill`
/// with `pid`. With no `exit` the child is already gone (its Terminated event
/// was handled), so there is nothing to signal, wait for or kill.
pub fn wait_or_kill(
    pid: u32,
    exit: Option<&dyn ExitSignal>,
    bound: Duration,
    term: impl FnOnce(u32),
    kill: impl FnOnce(u32),
) -> Teardown {
    let Some(exit) = exit else {
        return Teardown::AlreadyGone;
    };
    term(pid);
    if exit.exited_within(bound) {
        return Teardown::Graceful;
    }
    kill(pid);
    Teardown::Killed
}

/// The arguments the sidecar is started with: the session, the chosen config
/// file, and the host's pid for the sidecar's own parent-death guard.
pub fn sidecar_args(config: &Path, parent_pid: u32) -> Vec<String> {
    vec![
        "session".into(),
        "--config".into(),
        config.to_string_lossy().into_owned(),
        "--parent-pid".into(),
        parent_pid.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;

    struct Fake {
        exits: bool,
        asked: RefCell<Vec<Duration>>,
    }

    impl Fake {
        fn exits() -> Self {
            Fake {
                exits: true,
                asked: RefCell::default(),
            }
        }
        fn hangs() -> Self {
            Fake {
                exits: false,
                asked: RefCell::default(),
            }
        }
    }

    impl ExitSignal for Fake {
        fn exited_within(&self, bound: Duration) -> bool {
            self.asked.borrow_mut().push(bound);
            self.exits
        }
    }

    #[test]
    fn a_sidecar_that_exits_within_the_bound_is_not_killed() {
        let fake = Fake::exits();
        let killed = Cell::new(None);

        let result = wait_or_kill(
            77,
            Some(&fake),
            QUIT_BOUND,
            |_| {},
            |pid| killed.set(Some(pid)),
        );

        assert_eq!(result, Teardown::Graceful);
        assert_eq!(killed.get(), None);
        assert_eq!(*fake.asked.borrow(), vec![QUIT_BOUND]);
    }

    #[test]
    fn a_sidecar_that_does_not_exit_in_time_is_killed_by_its_pid() {
        let fake = Fake::hangs();
        let killed = Cell::new(None);

        let result = wait_or_kill(
            77,
            Some(&fake),
            QUIT_BOUND,
            |_| {},
            |pid| killed.set(Some(pid)),
        );

        assert_eq!(result, Teardown::Killed);
        assert_eq!(killed.get(), Some(77));
    }

    #[test]
    fn a_child_that_already_exited_is_neither_waited_for_nor_killed() {
        let killed = Cell::new(false);

        let result = wait_or_kill(
            77,
            None,
            QUIT_BOUND,
            |_| killed.set(true),
            |_| killed.set(true),
        );

        assert_eq!(result, Teardown::AlreadyGone);
        assert!(!killed.get());
    }

    #[test]
    fn a_real_exit_signal_answers_once_it_has_been_sent_and_after_the_sender_is_gone() {
        let (tx, rx) = mpsc::channel::<()>();
        tx.send(()).unwrap();
        assert!(rx.exited_within(Duration::ZERO));

        let (tx, rx) = mpsc::channel::<()>();
        drop(tx);
        assert!(rx.exited_within(Duration::ZERO));
    }

    #[test]
    fn a_real_exit_signal_that_never_comes_times_out_without_waiting_longer_than_asked() {
        let (_tx, rx) = mpsc::channel::<()>();
        assert!(!rx.exited_within(Duration::ZERO));
    }

    /// Records the order in which the quit path acts.
    struct Ordered<'a> {
        exits: bool,
        log: &'a RefCell<Vec<String>>,
    }

    impl ExitSignal for Ordered<'_> {
        fn exited_within(&self, bound: Duration) -> bool {
            self.log
                .borrow_mut()
                .push(format!("wait {}s", bound.as_secs()));
            self.exits
        }
    }

    #[test]
    fn quitting_signals_term_before_it_waits_and_kills_only_after_the_bound() {
        let log = RefCell::new(Vec::new());
        let hangs = Ordered {
            exits: false,
            log: &log,
        };

        let result = wait_or_kill(
            77,
            Some(&hangs),
            Duration::from_secs(15),
            |pid| log.borrow_mut().push(format!("term {pid}")),
            |pid| log.borrow_mut().push(format!("kill {pid}")),
        );

        assert_eq!(result, Teardown::Killed);
        assert_eq!(*log.borrow(), vec!["term 77", "wait 15s", "kill 77"]);
    }

    #[test]
    fn a_sidecar_that_exits_after_term_is_never_killed() {
        let log = RefCell::new(Vec::new());
        let exits = Ordered {
            exits: true,
            log: &log,
        };

        let result = wait_or_kill(
            77,
            Some(&exits),
            Duration::from_secs(15),
            |pid| log.borrow_mut().push(format!("term {pid}")),
            |pid| log.borrow_mut().push(format!("kill {pid}")),
        );

        assert_eq!(result, Teardown::Graceful);
        assert_eq!(*log.borrow(), vec!["term 77", "wait 15s"]);
    }

    #[test]
    fn a_child_that_is_already_gone_is_not_signalled() {
        let signalled = Cell::new(false);

        wait_or_kill(77, None, QUIT_BOUND, |_| signalled.set(true), |_| {});

        assert!(!signalled.get());
    }

    #[test]
    fn the_quit_bound_is_the_configured_term_grace_and_kill_wait_plus_a_margin() {
        let config = r#"{"studioRoot":"x","runtime":{"port":1,"pollMs":100,"deadlines":
            {"httpMs":10000,"startupMs":120000,"generationMs":300000,"termGraceMs":2000,"killMs":10000}}}"#;

        assert_eq!(
            quit_bound_from_config(config),
            Some(Duration::from_millis(2000 + 10_000) + QUIT_MARGIN)
        );
        let slow = config.replace("\"termGraceMs\":2000", "\"termGraceMs\":30000");
        assert_eq!(
            quit_bound_from_config(&slow),
            Some(Duration::from_millis(30_000 + 10_000) + QUIT_MARGIN)
        );
    }

    #[test]
    fn a_config_without_readable_deadlines_has_no_derived_bound() {
        assert_eq!(quit_bound_from_config("not json"), None);
        assert_eq!(quit_bound_from_config(r#"{"studioRoot":"x"}"#), None);
        assert_eq!(
            quit_bound_from_config(
                r#"{"runtime":{"deadlines":{"termGraceMs":"2000","killMs":1}}}"#
            ),
            None
        );
        assert_eq!(
            quit_bound_from_config(r#"{"runtime":{"deadlines":{"termGraceMs":-1,"killMs":1}}}"#),
            None
        );
    }

    #[test]
    fn a_config_file_that_cannot_be_read_falls_back_to_the_fixed_bound() {
        assert_eq!(
            quit_bound(Path::new("/nonexistent/studio.json")),
            QUIT_BOUND
        );
    }

    #[test]
    fn the_bound_covers_a_term_grace_with_room_and_stays_short() {
        assert!(QUIT_BOUND >= Duration::from_secs(3));
        assert!(QUIT_BOUND <= Duration::from_secs(10));
    }

    #[test]
    fn the_sidecar_is_started_as_a_session_on_the_chosen_config_with_the_hosts_pid() {
        let args = sidecar_args(Path::new("/Users/owner/studio.json"), 4242);
        assert_eq!(
            args,
            vec![
                "session",
                "--config",
                "/Users/owner/studio.json",
                "--parent-pid",
                "4242"
            ]
        );
    }

    #[test]
    fn a_config_path_that_looks_like_a_flag_stays_one_argument() {
        let args = sidecar_args(Path::new("--root=/etc"), 1);
        assert_eq!(args[1], "--config");
        assert_eq!(args[2], "--root=/etc");
        assert_eq!(args.len(), 5);
    }
}
