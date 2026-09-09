# Mole

Mole is a portable, local-first context operating system for product managers and AI assistants.

Current version: `0.2.8`

It gives teams a file-based place to capture messy product inputs, distil them into structured evidence, and generate better roadmaps, specs, decisions, and prioritisation work from shared context. Mole is designed to work locally, in synced folders such as SharePoint/OneDrive or Google Drive, or alongside a codebase in Git.

---

## Installation

### 1. Install from GitHub

```bash
npm install -g github:simplybenuk/product-mole#v0.2.8
mole --help
```

This installs the `mole` command globally from the tagged `v0.2.8` release.
Replace the tag with the release you want. Installing from `main` is for
contributors or users who explicitly want unreleased changes.

### 2. Create a Mole workspace

```bash
mole new my-mole
cd my-mole
```

This creates a clean workspace scaffold with bootstrap guidance, routing rules, summaries, indexes, context/evidence folders, an inbox, and lightweight governance files. You do not need to clone the Mole repository to create or use a workspace.

### 3. Install agent skills

Install the optional Mole agent skills:

```bash
mole install skills
```

This copies skill directories into `~/.agents/skills/`, or `$AGENTS_HOME/skills/` when `AGENTS_HOME` is set. The installer prints the Mole mascot and lists the installed skills.

### 4. Try the CLI

```bash
mole doctor
mole insight "Users trust CSV export more than dashboard totals"
mole insight --stakeholder CEO "Asked whether enterprise onboarding is improving"
mole bootstrap-context
mole product-update CEO 2-weeks --format email
mole critique idea "Improve regulated-customer onboarding"
mole create roadmap
```

### 5. Try the skills

After installing skills, ask your agent for Mole-specific work such as:

- Capture this Mole insight: users trust CSV export more than dashboard totals.
- Bootstrap this Mole workspace context.
- Synthesise the Mole inbox.
- Refresh the Mole top layers.
- Create a Mole roadmap.
- Create a Mole product spec.
- Review the Mole input queue.
- Critique this idea using the current Mole context.
- Generate a product update for the CEO for the last two weeks in email format.
- Upgrade this Mole workspace from an older version using a safe apply + manual review plan.

## Commands

| Command | What it does |
| --- | --- |
| `mole --help` | Prints CLI usage, examples, and supported commands. |
| `mole new <workspace-name>` | Creates a new Mole workspace from the bundled scaffold. |
| `mole init [target-dir]` | Backwards-compatible alias for `mole new`. |
| `mole install skills` | Installs Mole agent skills into `~/.agents/skills/` or `$AGENTS_HOME/skills/`. |
| `mole doctor` | Checks source and instance versions plus required instance folders. |
| `mole check-updates` | Reports whether the installed Mole source is newer than the current workspace. |
| `mole insight "<text>"` | Captures a raw insight into `6-raw/inbox/`. |
| `mole note "<text>"` | Alias for `mole insight`. |
| `mole signal "<text>"` | Alias for `mole insight`. |
| `mole insight --stakeholder CEO "<text>"` | Captures an insight with stakeholder metadata for later synthesis. |
| `mole product-update <audience> <timescale> --format <format>` | Prints an agent instruction for a stakeholder-specific product update. |
| `mole critique <target> [claim-or-path]` | Prints an agent instruction for a context-grounded critique. |
| `mole bootstrap-context` | Prints an agent instruction for first-time summary/index population. |
| `mole refresh top-layers` | Prints an agent instruction for refreshing stale, blank, or incomplete summaries and indexes. |
| `mole create roadmap [output-path]` | Creates a roadmap draft from the roadmap template. |
| `mole create spec [output-path]` | Creates a product spec draft from the spec template. |
| `mole create decision-brief [output-path]` | Creates a decision brief draft. |
| `mole create strategy-memo [output-path]` | Creates a strategy memo draft. |
| `mole create prioritisation-draft [output-path]` | Creates a prioritisation draft. |
| `mole create product-update [output-path]` | Creates a product update draft from the product update template. |
| `mole synthesise <target>` | Prints an agent instruction for synthesising a target using the Mole operating model. |
| `mole review <target>` | Prints an agent instruction for reviewing a target and surfacing next actions. |
| `mole inbox claim [processor]` | Claims a run with a leased, owned lock and returns its `run_id`. |
| `mole inbox heartbeat --run-id <id>` | Renews the matching active run lease for a long processing pass. |
| `mole inbox checkpoint --run-id <id> [--processed <path>]` | Saves partial progress in the matching active run for restart-safe processing. |
| `mole inbox audit` | Recursively audits live files, leases, sync conflicts, overrides, and receipts. |
| `mole inbox complete [options] [summary]` | Writes one idempotent receipt for the owned run, records metrics, and releases its lock. |
| `mole inbox override-stale [options]` | Replaces an expired lock only after an explicit, auditable recovery decision. |
| `mole metrics backfill` | Rebuilds local metrics from inbox processing receipts that already contain processed paths. |
| `mole upgrade` | Updates the globally installed Mole CLI from the latest unreleased `main` branch. |

## Stakeholder memory and product updates

Mole can maintain internal stakeholder context alongside user personas. Use `4-context/stakeholders.md` to capture people, groups, org-chart relationships, product interests, recurring questions, communication preferences, decision authority, and evidence links.

A typical workflow is:

```bash
mole insight --stakeholder CEO "Asked for clearer enterprise onboarding metrics"
mole synthesise inbox
mole inbox audit
mole product-update CEO 2-weeks --format email
```

Inbox synthesis should promote durable stakeholder signals into `4-context/stakeholders.md`. Product update generation then retrieves that stakeholder memory, relevant summaries, indexes, product context, evidence, and recent raw material to tailor an update for the audience and requested format. Supported formats are intentionally flexible, for example email, Teams message, blog post, or executive brief.

## Summary and index setup

New or migrated workspaces often start with blank or starter-template files in `2-summaries/` and `3-indexes/`. Populate those top layers explicitly before relying on daily inbox synthesis:

```bash
mole bootstrap-context
```

Use the printed instruction with your agent. It should read the lower layers and inbox material, then create the first useful summaries and indexes without inventing unsupported facts.

After larger synthesis passes, or whenever the top layers feel stale, run:

```bash
mole refresh top-layers
```

Daily `mole synthesise inbox` remains focused on promoting new material, but blank or placeholder summaries and indexes now count as material gaps that should be filled when relevant durable context is synthesised.

## Molehill Metrics

Mole tracks lightweight local processing metrics under `governance/metrics/`. Metrics count processed inbox item paths, not raw insight content and not individual users.

When finishing inbox work, include each inbox item that was actually processed:

```bash
mole inbox claim "Your Name"
mole inbox checkpoint --run-id <run-id> --processor "Your Name" --processed 6-raw/inbox/a.md
mole inbox complete --run-id <run-id> --processor "Your Name" --processed 6-raw/inbox/a.md "Promoted one customer signal"
```

Before and after synthesis, run `mole inbox audit`. It validates the workspace root, recursively scans the live inbox, excludes only the instructional root README and retained archive content, and reports files not explained by processing receipts. Do not declare a no-op while the final audit reports unexplained files.

Use repeated `--processed` flags for multiple items. Do not include items that were only inspected, skipped, or left for later. The local dashboard is available at `governance/metrics/dashboard.html`.

For existing workspaces, run `mole metrics backfill` after upgrading to rebuild metrics from historical `governance/run-receipts/inbox-processing/` receipts. Backfill counts only receipt `processed` paths with valid completion dates; it does not infer from raw inbox folders or read raw insight content.

## Shared-folder processing

The inbox workflow works in a local folder and in a folder synced by OneDrive, SharePoint, Google Drive, Dropbox, or a similar client. The lock is still a set of files, not a service-side distributed lock. Each mutating operation serializes local lock updates and verifies the complete lock state plus its monotonic version before and after writing, but a sync client can still delay, duplicate, or reorder file changes.

For every processing pass:

1. Run `mole doctor` and `mole inbox audit`.
2. Claim a run and keep its `run_id`: `mole inbox claim "Your Name"`.
3. Pass the exact returned `--run-id` and `--processor` to every heartbeat, checkpoint, and completion. These mutating commands refuse a missing, malformed, or different run ID. Checkpoint each promoted path so a restart can skip paths already recorded in `processed_paths`.
4. Complete only after the promoted output and retrieval receipt exist. The receipt stores the run, lease, claimed paths, processed paths, unresolved paths, and lock snapshot.
5. Run `mole inbox audit` again.

Normal completion refuses a missing, expired, foreign, duplicate, or conflicted state. If a lease is stale, inspect the folder's sync history and preserve all copies before using `mole inbox override-stale --run-id <new-run-id> --reason "..."`; the replacement ID must not already have a completion receipt. If the lock is missing, use `--override-missing-lock --run-id <run-id> --reason "..."` only when the run history is clear. Run IDs are validated before they become receipt filenames. Each override records the actor, host, time, reason, replacement run, and replaced lock under `governance/run-receipts/inbox-processing/overrides/`.

Mole never deletes or moves source files to resolve a sync conflict. Conflict-named source files, lock copies, and duplicate receipt files are reported by `mole inbox audit`; keep every copy until a person decides how to handle it.

The audit also fails closed when receipts from different run IDs claim the same canonical inbox path. Those split-brain paths are excluded from the normal processed count, and metrics backfill reports them without counting them. Malformed override JSON is likewise reported as invalid rather than silently omitted.

## How Mole Works

Mole is a file-based context system with progressive layers.

- Top layers are small, high-signal, and cheap to read.
- Lower layers are richer, more detailed, and more expensive.
- Agents should descend only as needed.

The core operating principle is:

**Capture low -> Distil up -> Retrieve top-down -> Create**

Humans capture quickly, agents structure and synthesise, humans review and steer, and outputs are generated from layered context instead of from a blank prompt.

## Updating after new changes

Mole separates the installed tool from generated working instances.

When the source/tool changes, update the global install:

```bash
npm install -g github:simplybenuk/product-mole#v0.2.8
mole install skills
```

Use a tagged version for stable updates. Use `#main` only when you need the
latest unreleased source.

If your installed `mole upgrade` only prints upgrade documentation, you are on an older placeholder build. Run the `npm install -g ...` command once; after `0.2.1`, `mole upgrade` performs that update for you.

Why both?
- `npm install -g ...` refreshes the CLI, bundled scaffold, docs, and skill files
- `mole install skills` refreshes the agent skills so new workflows and updates actually appear

Then restart or refresh your agent session if needed.

To inspect a working instance before upgrading it, run these from inside the workspace folder:

```bash
mole doctor
mole check-updates
```

`doctor` reports:
- source version from `VERSION`
- instance version from `mole.instance.yaml`
- core folder checks
- a warning when instance metadata is missing

`check-updates` is currently a read-only report. It compares source and instance versions, then lists:
- safe additions from `upgrade-ownership.json`
- manual review paths that may contain local customisation

`mole upgrade` updates the installed Mole CLI and bundled scaffold. It does not rewrite an existing workspace's local product context.

## What currently works

### Raw inbox flow
You can still drop files manually into:
- `6-raw/inbox/`

That remains a first-class workflow. When the inbox contains user/customer signals, synthesis should also update `4-context/personas.md` so the workspace builds a living set of evidence-backed personas over time.

### Command capture flow
You can also capture through commands:
- `mole insight "..."`
- `mole-insight` skill after running `mole install skills`

### Creation flow
You can create draft artifacts such as:
- roadmap
- spec
- decision brief
- strategy memo
- prioritisation draft
- product update

## Current prototype status

This is early but usable.

What exists now:
- file-native mole structure
- CLI scaffold
- agent skill installation
- source/instance version checks
- read-only update report using `upgrade-ownership.json`
- raw insight capture
- draft artifact generation
- stakeholder memory and product update guidance
- lightweight local Molehill Metrics for processed inbox items
- docs for upgrade/adoption/command UX

What is still lightweight:
- synthesis logic is instruction-driven rather than deeply automated
- command set is intentionally small
- naming/brand may still evolve

## Local UI (v0 scaffold)

A minimal local HTML UI is included for immediate testing:

- start server: `node ui/server.mjs`
- open: `http://localhost:4173`
- guide: [ui/README.md](ui/README.md)

Current v0 features:
- Quick Capture form (writes to `6-raw/inbox/`)
- Waiting on Human queue viewer
- Basic repo explorer

## Suggested Monday opener

Ask:

> What inputs do you need from me today?

Then answer the top 3 asks in `governance/input-queue.md`.
