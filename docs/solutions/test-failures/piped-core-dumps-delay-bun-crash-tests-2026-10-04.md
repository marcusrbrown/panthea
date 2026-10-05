---
title: Piped core dumps delay Bun crash tests on Ubuntu
date: 2026-10-04
category: test-failures
module: workspace
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "Bun children remain alive after SIGABRT beyond the test deadline"
  - "Crash fixtures report SIGKILL or timed-out instead of the expected crash"
root_cause: config_error
resolution_type: config_change
tags: [bun, linux, ubuntu, coredump, prlimit, sigabrt, ci]
---

# Piped core dumps delay Bun crash tests on Ubuntu

## Problem

Bun 1.4.2 crash fixtures stalled on the Ubuntu runner but exited promptly on macOS. The delay changed the observed exit signal or exhausted the job deadline.

## Symptoms

The runner used Ubuntu 24.04.5 and Linux 6.17.0-1022-azure. Its `core_pattern` sent core dumps to `systemd-coredump` through a pipe.

Five bounded Bun controls remained alive at four seconds with `CoreDumping: 1`. A longer control exited after 18.3 seconds. One stalled child had about 6.1 GiB of virtual address space and 12 MiB of resident memory.

## What Didn't Work

`ulimit -c 0` did not prevent the piped dumps. Linux ignores the normal core-size limit for this path. A shell value of `ulimit -c 1` also does not specify one byte.

## Solution

Set the exact one-byte core limit for the Linux test runner:

```sh
prlimit --core=1:1 -- bun run test
```

The soft and hard limits both use bytes. This value suppresses the piped dump. All seven controls exited with `SIGABRT` in 4–56 ms under this limit.

The [CI workflow](../../../.github/workflows/ci.yaml) applies the limit to the test process. It does not change production processes or weaken crash assertions.

## Why This Works

The kernel dump path delayed termination. The controls isolated that path: inherited limits stalled, while the one-byte limit produced prompt exits with the original signal.

The observations do not establish the number of bytes that the dump helper transferred. Virtual size and resident size are different measurements.

## Prevention

If a Linux crash test stalls, inspect `core_pattern`, the child's core limit, and `CoreDumping`. Compare a control with the exact one-byte limit before changing assertions or blaming the runtime.

Read actual test logs. A green job does not establish that a focused subprocess control exercised the intended limit.

## Related Issues

- [Probe fix and diagnostic history, PR #118](https://github.com/marcusrbrown/panthea/pull/118)
- [Diagnostic CI run](https://github.com/marcusrbrown/panthea/actions/runs/37255711636)
- [Managed generator processes](../integration-issues/managed-generator-process-boundaries-2026-10-04.md)
