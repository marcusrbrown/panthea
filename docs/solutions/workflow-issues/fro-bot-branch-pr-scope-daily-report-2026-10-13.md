---
title: A branch-pr delivery rule overrode the scheduled run's daily report issue
date: 2026-10-13
category: workflow-issues
module: workspace
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - A scheduled or dispatched agent prompt sets a PR delivery mode and also needs a fixed non-PR output
  - Changing output-mode or SCHEDULE_PROMPT in .github/workflows/fro-bot.yaml
tags: [fro-bot, branch-pr, output-mode, scheduled-run, prompt-scope, daily-report]
---

# A branch-pr delivery rule overrode the scheduled run's daily report issue

## Context

The scheduled Fro Bot pass runs with `output-mode: branch-pr`, which its autohealing fixes need in order to push branches. In that mode the action adds a delivery rule to the prompt: deliver the result through a branch, commit, push and pull request. The schedule prompt also says the daily report is a single issue, rotated each day. In one run the delivery rule won over the prompt's daily-report rule: the run committed the report as a file and opened a PR (#221) instead of rotating the issue.

## Guidance

Scope the delivery mode inside the prompt that runs under it. `SCHEDULE_PROMPT` now says:

```text
The branch-pr delivery mode covers only autohealing code fixes
(categories 1-4). The daily report is always this issue: never commit
it to the repository and never open a PR for it.
```

Keep the schedule on `branch-pr`. Working-dir mode forbids delivering code, so switching modes would break autohealing.

## Why This Matters

The broad injected rule and the narrower prompt instruction are both in front of the model, and nothing tells it which one wins. It resolved the conflict differently on different days. One explicit sentence of scope removes the ambiguity. Without it, the failure is silent: the run succeeds, a stray PR appears, and the report rotation stops.

## When to Apply

- Any agent workflow whose delivery mode is broader than one of its required outputs.
- Changing `output-mode`, `SCHEDULE_PROMPT`, or the action version.

## Related

- [A prompt commanding an old action hides a new option](../best-practices/prompt-commanding-old-action-hides-new-option-2026-10-03.md): the same prompt-steers-the-model failure
