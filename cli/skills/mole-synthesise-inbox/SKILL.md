---
name: mole-synthesise-inbox
description: Synthesise the current Mole inbox into higher-signal context while preserving the capture, distil, retrieve, create operating model.
---

# Mole Synthesise Inbox

Use this skill inside a Mole instance.

## Goal

Turn raw inbox material into more useful, higher-signal outputs while preserving the core operating model: capture low, distil up, retrieve top-down, create.

## Workflow

1. Validate the workspace root with `mole doctor`, then run `mole inbox audit` before reading context. The audit must recursively inspect `6-raw/inbox/`, including legacy subfolders such as `quick-notes/`, `messages/`, `observations/`, or `new/`; treat every non-README file outside retained `archive/` content as a candidate until a receipt or explicit skip disposition explains it. Then read `0-bootstrap/`, `1-routing/`, relevant summaries/indexes, and the audited inbox contents.
2. Cluster related raw items into themes/signals.
3. Create or update appropriate files in `5-evidence/` and/or `4-context/` when justified.
4. For user/customer signals, check `4-context/personas.md`; update a matching persona or create a new persona section when the inbox material is relevant to a durable user type. Keep persona changes evidence-backed and mark weak signals as hypotheses.
5. For internal stakeholder signals, executive asks, leadership concerns, update preferences, decision authority, or org-chart facts, check `4-context/stakeholders.md`; update a matching stakeholder profile or create a new stakeholder section when the inbox material is relevant to a durable person, group, forum, or function. Keep stakeholder changes evidence-backed and mark weak signals as hypotheses.
6. Update `3-indexes/` or `2-summaries/` when the new signal materially changes higher-level context. If relevant summary or index files are blank, placeholder-only, or still contain starter-template content, treat that as a material top-layer gap and populate them from the synthesised durable context. Update `2-summaries/user-summary.md` when persona changes materially affect user understanding.
7. Add missing human questions to `governance/input-queue.md` if important decisions cannot be made from the available context.
8. Claim one run before processing with `mole inbox claim "Your Name"`, keep the returned `run_id`, and pass `--run-id` plus `--processor` to heartbeat, checkpoint, and completion commands. Use `mole inbox checkpoint --processed <path>` as each item is safely promoted so a restart can resume from `processed_paths`. Finish with `mole inbox complete --run-id <run-id> --processor "Your Name" --processed <path> ... "summary"`, including one `--processed` flag for each inbox item actually processed. Do not include items that were only inspected, skipped, or left for later. Normal completion fails closed when the lock is missing, expired, or owned by another processor. Use `--override-missing-lock --reason "..."` or the explicit stale-lock override only after checking the run history and synced-folder state.
9. Run `mole inbox audit` again. Do not declare a no-op or complete the run while unexplained live files remain; report every intentionally skipped path and reason. Then report what was synthesised, what personas were created or updated, what stakeholders were created or updated, what other files changed, and what still needs human input.

Avoid over-promoting weak signals. Distil responsibly.

Metrics count processed inbox item paths in `governance/metrics/`. They must not contain raw insight text or source content.
