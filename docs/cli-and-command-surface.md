# CLI and Command Surface

## Purpose

Define the future command experience for the mole so the system is usable as a tool, not just as a template.

The command surface should hide structural complexity and let product managers ask for outcomes.

---

## Design principle

Prefer outcome-oriented commands over structure-oriented commands.

Good:
- `create roadmap`
- `create spec`
- `synthesise inbox`
- `review input queue`

Less good:
- `read layer 2 summaries`
- `promote file x to layer 4`

The architecture exists to improve output quality. It should not become the product interface.

---

## Command shape recommendation

Use a short, memorable root command.

### Recommended working root
- `mole`

Reasons:
- short
- descriptive enough
- works in CLI form
- does not force a slash-command mental model

Slash commands like `/PCC create roadmap` can still exist later inside chat tools or local UIs, but the product should not depend on them as the primary interface.

---

## v1 command groups

### Create
Used to generate product outputs from the current mole.

Examples:
```bash
mole create roadmap
mole create spec
mole create strategy-memo
mole create prioritisation-draft
mole create decision-brief
```

### Critique
Used to pressure-test ideas and artefacts against the current mole context.

Examples:
```bash
mole critique idea
mole critique strategy
mole critique roadmap
mole critique spec
mole critique decision-brief
```

The thin CLI implementation accepts `mole critique <target> [claim-or-path]` for `idea`, `strategy`, `roadmap`, `spec`, and `decision-brief`. It prints an agent instruction that names the retrieval path and expected critique sections. It does not claim that the CLI itself has read the workspace or produced the judgement.

### Insight / note / signal capture
Used to capture chat-native or CLI-native raw context without making users think about folders.

Every new capture records an immutable source ID and content hash. Existing
local files or imported exports can be adopted into the same registry:

~~~bash
mole sources register 6-raw/inbox/export.csv --source-type imported_export
mole sources import 6-raw/inbox/export.csv --channel import
mole sources sync src_<id>
mole sources migrate
mole sources migrate --write
mole sources audit
~~~

Migration is report-only unless --write is supplied. It does not rewrite raw
files or reference text. Filename-only matches are ambiguous; exact-path,
content-hash, and original-date checks are required before adoption.

Examples:
```bash
mole insight "Users trust CSV export more than dashboard totals"
mole note "CEO wants a faster path to pilot for regulated prospects"
mole signal "Support volume spikes after pricing page changes"
```

### Synthesise
Used to turn lower-layer/raw material into higher-signal context.

Examples:
```bash
mole synthesise inbox
mole synthesise signals
mole synthesise evidence
```

### Bootstrap / refresh top layers
Used to populate or reconcile `2-summaries/` and `3-indexes/` when they are blank, starter-template-only, stale, or incomplete.

Examples:
```bash
mole bootstrap-context
mole refresh top-layers
```

### Review
Used to inspect what needs human input or validation.

Examples:
```bash
mole review input-queue
mole review stale-summaries
mole review conflicts
```

### Init / upgrade
Used to scaffold or evolve an instance.

Examples:
```bash
mole init
mole check-updates
mole upgrade
```

---

## Output philosophy

Commands should produce:
- a file output in the correct part of the mole,
- a short human-readable summary,
- and optionally a retrieval receipt.

Example:

```bash
mole create roadmap
```

Could:
1. read the relevant layers,
2. create `4-context/product/roadmap-2026-q2.md` or a draft in a staging area,
3. print what it used,
4. list missing human inputs.

---

## Initial implementation recommendation

Do not try to build a magical full AI runner first.

Start with a thin command layer that:
- knows the repo shape
- knows where outputs should go
- knows which templates to use
- knows which prompts/instructions to surface to an agent

This could begin as a Node CLI with commands that scaffold files and emit recommended prompts/workflows.

---

## Future compatibility

The command vocabulary should work across:
- local terminal use
- chat slash-command wrappers
- local UI buttons/actions
- future agent integrations

So define the verbs well now, even if the backend remains simple at first.

---

## Recommendation

Build the product around:
- root command: `mole`
- key verbs: `init`, `create`, `insight`, `synthesise`, `review`, `doctor`, `check-updates`, `upgrade`

That is a much stronger foundation than `/PCC` as the primary identity.
