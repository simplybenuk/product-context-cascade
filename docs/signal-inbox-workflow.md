# Signal Inbox Workflow (Scratchpad -> Synthesis)

## Purpose

Define how day-to-day PM inputs are captured quickly and transformed into durable product context.

This workflow is designed for reality: valuable inputs arrive as both short messy snippets and larger source artefacts.

---

## Core model

1. **Capture immediately** (low friction, low structure)
2. **Classify the input** (weak signal vs substantive artefact)
3. **Batch and synthesise** (agent clusters patterns or extracts a source doc)
4. **Promote meaningful content** (evidence/context/index/summary updates)
5. **Keep weak one-offs in raw unless reinforced**

---

## Folder conventions

```text
6-raw/
└── inbox/
    ├── 20260617T090000000Z-onboarding-note-a1b2c3d4.md
    ├── 20260617T091500000Z-ceo-export-ask-e5f6a7b8.md
    └── 20260617T103000000Z-support-pattern-c9d0e1f2.md
```

Treat `6-raw/inbox/` primarily as a flat capture/drop zone. Processing state is represented by optional locks plus JSON receipts, not by requiring contributors to move files through nested folders.

Compatibility rule: existing captures in `6-raw/inbox/quick-notes/`, `messages/`, `observations/`, `new/`, `processing/`, `processed/`, or `archive/` are still valid in upgraded workspaces. Direct files and legacy `quick-notes/`, `messages/`, `observations/`, and `new/` files should be treated as unprocessed input unless a receipt shows they were already processed.

Optional shared-team state folders can still be used where they solve a real coordination problem:

```text
6-raw/
└── inbox/
    ├── new/              # unprocessed captures waiting for synthesis
    │   ├── quick-notes/
    │   ├── messages/
    │   ├── observations/
    │   └── artefacts/
    ├── processing/       # batches claimed by one maintainer or agent run
    ├── processed/        # raw inputs already promoted with a receipt
    └── archive/          # retained raw inputs that should not be reprocessed
```

Optional downstream outputs:

```text
5-evidence/
├── signal-clusters/      # clustered weak-signal synthesis
└── source-docs/          # extracted and summarised high-signal artefacts

4-context/
└── (domain folders)      # promoted context modules when evidence is strong
```

---

## What belongs in the inbox

Weak signals:
- “CEO said X in Slack”
- “Customer casually mentioned Y in call”
- “Support has 3 odd tickets around Z this week”
- “I think onboarding step 2 is confusing”
- “Sales keeps mentioning concern A”

Substantive artefacts:
- vendor PDFs, decks, spreadsheets, transcripts, exports, and reports
- procurement artefacts and service descriptions
- research summaries, ticket dumps, analytics exports, and meeting packs

If in doubt: capture it.

---

## Capture template (lightweight)

Use this markdown block for quick entries:

```markdown
---
date: 2026-03-15
source: ceo            # ceo|customer|sales|support|self|other
channel: slack         # slack|email|call|meeting|chat|other
topic_tags: [onboarding, ux]
confidence: low        # low|medium|high
---

Short signal note in plain language.
Potential implication (optional).
```

Keep it short. 30-90 seconds per entry is the target.

---

## Synthesis cadence

Recommended cadence:
- **Daily light pass (5-10 min):** cluster new inbox items
- **Weekly deep pass (20-40 min):** decide promotions and update summaries/indexes

The agent should process inbox entries in batches where possible, but a single high-signal artefact can be promoted on its own.

---

## Input classification

Route new inbox items using this rule:

- **Weak signal:** short notes, comments, snippets, or observations with uncertain significance.
- **Substantive artefact:** a document or export that already contains high-signal factual content worth preserving directly.

Default outputs:

- Weak signal -> `5-evidence/signal-clusters/*.md`
- Substantive artefact -> `5-evidence/source-docs/*.md`
- Durable synthesis from either path -> `4-context/<domain>/*.md`

---

## Promotion rules

Promote inbox content upward only when one of these is true:

1. **Reinforcement:** same signal appears from multiple sources
2. **Strategic relevance:** directly affects active goals/bets
3. **Risk severity:** plausible high-impact issue
4. **Decision impact:** could change prioritisation or design choices

### Promotion path

- Inbox snippets -> `5-evidence/signal-clusters/*.md`
- Inbox artefacts -> `5-evidence/source-docs/*.md`
- Strong validated clusters or durable artefact syntheses -> `4-context/<domain>/*.md`
- Then update:
  - `3-indexes/*.md`
  - `2-summaries/*.md` (if materially changed)
  - `governance/run-receipts/*.md`

### Inbox cleanup rule

- Do not delete an inbox item until its promoted output and retrieval receipt exist.
- After promotion, either delete the inbox copy or move it into a stable raw/archive location.

### Shared inbox coordination

Use the leased processing run to coordinate people or agents processing the same raw input:

1. Direct files in `6-raw/inbox/` are unprocessed by default.
2. One maintainer or agent claims a run before a shared synthesis run.
3. The processor checkpoints each promoted path and completes only after the output and retrieval receipt exist.
4. The JSON receipt and lock checkpoint are the durable record of what was processed and what remains.

Weak signals are usually batched into signal clusters after a retrieval receipt exists. Substantive artefacts should be preserved or summarised first in `5-evidence/source-docs/` before any durable `4-context/` module is created.

Never delete raw inputs from a shared inbox before the promoted output and retrieval receipt exist. If sync conflicts appear, keep both copies, report the ambiguity, and resolve it explicitly before processing rather than discarding either contributor's input.

### Processing lock and receipt

Before synthesising, validate the workspace and audit the complete inbox tree:

```bash
mole doctor
mole inbox audit
```

The audit must scan recursively, including legacy `quick-notes/`, `messages/`, `observations/`, and `new/` folders. It excludes the instructional root `README.md` and retained `archive/` content, then reconciles live files against JSON processing receipts. Run it again before completion and do not report a no-op while unexplained files remain. If a file is intentionally skipped, report its path and reason in the run receipt.

Before synthesising a shared inbox, claim a run:

```bash
mole inbox claim "Your Name"
```

This creates `governance/inbox-processing.lock.json` with a `run_id`, processor, host, start time, heartbeat, expiry, claimed paths, and checkpointed paths. Keep the returned `run_id`. Use `mole inbox heartbeat` during long runs and `mole inbox checkpoint --processed <path>` after each safely promoted item.

If a lock already exists, another processor must stop and coordinate with the owner named in the lock. A retry with the same run ID is idempotent only for the same processor and host while the lease is active. Treat an expired lease as stale only after its expiry; inspect sync history and current inbox contents before using an explicit override.

After the promoted outputs, index/summary updates, and retrieval receipt exist, complete the processing run:

```bash
mole inbox complete --run-id <run-id> --processor "Your Name" --processed 6-raw/inbox/customer-onboarding-note.md "Promoted weekly research notes"
```

Normal completion requires an active owned claim. It fails closed for a missing, expired, foreign, duplicate, or conflicted state. A completed run can be retried with the same run ID; Mole returns the existing receipt without creating a second receipt or processing event. The receipt records the run, lease, claimed paths, processed paths, unresolved paths, lock snapshot, and summary.

If a run stops after a partial pass, the checkpoint remains in the lock. Resume the same run while its lease is active. If the lease has expired, use `mole inbox override-stale --run-id <new-run-id> --reason "Confirmed the prior worker stopped"` only after checking the synced folder. If the lock is missing, use `--override-missing-lock --reason "..."` only after checking the run history. Every override records the actor, host, time, reason, replacement run, and replaced lock under `governance/run-receipts/inbox-processing/overrides/`.

File coordination is not a perfect distributed lock. Sync clients may delay or duplicate writes, and conflict copies can appear for source files, locks, or receipts. `mole inbox audit` reports those copies and stale leases. Preserve every source copy and never delete or move a user file to make the state look consistent.

---

## Anti-noise rules

- Do not promote every note.
- Prefer pattern strength over recency.
- Mark uncertain clusters clearly.
- Keep contradictory signals visible until resolved.

---

## Suggested agent outputs from inbox

- “Top emerging themes this week”
- “Signals that challenge current priorities”
- “Potential UX risks to validate next”
- “Candidate interview questions from weak signals”
- “Source doc summary with candidate promotions”

Always include retrieval receipt + confidence markers.

---

## Success criteria

- PM can capture any signal in <60 seconds.
- Inbox is synthesised at least weekly.
- High-signal artefacts are preserved as source notes before cleanup.
- Promotions are evidence-led, not anecdote-led.
- Summaries/indexes reflect validated patterns, not raw noise.
