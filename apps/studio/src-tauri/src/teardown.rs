//! Ending a sidecar: close its stdin, give it a bounded time to tear down (stop
//! its image server, release the root's lock), then kill it. The wait and the
//! kill are injected so the decision is tested without a process or a clock.
//!
//! Measured on an idle session (the real 71 MB store, 20 runs, source and
//! compiled): stdin EOF to exit takes 10–18 ms. A session that owns an image
//! server also waits for that server's term grace (2 s in the creative-run
//! config) before it can release the lock. `QUIT_BOUND` covers that with room,
//! and stays short enough that quitting never feels hung.

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

/// The longest a quit or a config change waits for the sidecar to exit by itself.
pub const QUIT_BOUND: Duration = Duration::from_secs(5);

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

/// Waits for `exit` up to `bound`, then calls `kill` with `pid`. With no `exit`
/// the child is already gone (its Terminated event was handled), so there is
/// nothing to wait for and nothing to kill.
pub fn wait_or_kill(
    pid: u32,
    exit: Option<&dyn ExitSignal>,
    bound: Duration,
    kill: impl FnOnce(u32),
) -> Teardown {
    let Some(exit) = exit else {
        return Teardown::AlreadyGone;
    };
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

        let result = wait_or_kill(77, Some(&fake), QUIT_BOUND, |pid| killed.set(Some(pid)));

        assert_eq!(result, Teardown::Graceful);
        assert_eq!(killed.get(), None);
        assert_eq!(*fake.asked.borrow(), vec![QUIT_BOUND]);
    }

    #[test]
    fn a_sidecar_that_does_not_exit_in_time_is_killed_by_its_pid() {
        let fake = Fake::hangs();
        let killed = Cell::new(None);

        let result = wait_or_kill(77, Some(&fake), QUIT_BOUND, |pid| killed.set(Some(pid)));

        assert_eq!(result, Teardown::Killed);
        assert_eq!(killed.get(), Some(77));
    }

    #[test]
    fn a_child_that_already_exited_is_neither_waited_for_nor_killed() {
        let killed = Cell::new(false);

        let result = wait_or_kill(77, None, QUIT_BOUND, |_| killed.set(true));

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
