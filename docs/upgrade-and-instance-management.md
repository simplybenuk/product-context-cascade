# Upgrade and Instance Management

## Why this matters

Mole is easy to **adopt** as a template, but harder to **evolve** once a live working instance has drifted from upstream.

That is the real product problem.

A PM or team will naturally customise:
- naming
- folder shape
- summaries
- topic modules
- operating conventions
- local workflow docs

Once that happens, "just pull the latest template" stops being a satisfying answer.

This document defines a more honest model for upgrading mole instances over time.

---

## Core principle

**Scaffold once, upgrade by declared migrations.**

Do not treat downstream instances as if they can be blindly overwritten by a newer template.
Treat them as living systems with:
- upstream-owned structure
- merge-sensitive shared files
- instance-owned local truth

---

## Three ownership classes

### 1) Upstream-owned
These files/folders are primarily framework structure and can usually be updated from upstream with low risk.

Typical examples:
- `0-bootstrap/`
- `1-routing/`
- `templates/`
- `docs/`
- some governance docs

### 2) Merge carefully
These are shared surfaces where both upstream and adopters are likely to edit.
They often need deliberate review during upgrades.

Typical examples:
- `README.md`
- `2-summaries/`
- `3-indexes/`
- `governance/input-queue.md`
- `governance/change-log.md`

### 3) Instance-owned
These represent live product truth, evidence, raw capture, and team-specific context.
Upstream should not overwrite these.

Typical examples:
- `4-context/`
- `5-evidence/`
- `6-raw/`

---

## Required instance metadata

Every adopted mole instance should maintain a small metadata file:
- `mole.instance.yaml`

Use the provided starter template:
- [`../mole.instance-template.yaml`](../mole.instance-template.yaml)

This file should record:
- current mole version
- original release used to scaffold the instance
- last upgrade applied
- meaningful local customisations
- ownership expectations if they differ from defaults

This is intentionally lightweight. It is not meant to become bureaucracy.
It exists so the instance has an upgrade memory.

---

## Release model for upstream

Upstream should publish releases with:
- a semantic version (`VERSION`)
- a changelog entry (`CHANGELOG.md`)
- a matching Git tag (`vX.Y.Z`)
- a package that passes the repository test, release-consistency, and packed-artifact checks
- upgrade notes when instance migration matters

Install a stable CLI from its tag when bootstrapping or repairing an older
installation:

```bash
npm install -g github:simplybenuk/product-mole#v0.2.8
```

Once the current CLI is installed, `mole upgrade [version]` performs the same
refresh from a stable tag. Pass `0.2.8` or `v0.2.8` to choose a release. With no
argument, the CLI reuses the tag matching its installed version. It does not
follow the moving `main` branch, so an upgrade target is reproducible.

Every upgrade-affecting release should clearly say:
- what changed
- what can be copied directly
- what is optional
- what likely needs manual merge

---

## Recommended upgrade workflow for adopters

### 1. Track upstream separately from your live instance
Treat upstream as the evolving framework source.
Treat your adopted repo as a working instance.

### 2. Record your local customisations
Use `mole.instance.yaml` to note important drift.

### 3. Upgrade intentionally
For each upstream release:
- review changelog
- review upgrade notes
- decide which changes you want
- apply them explicitly
- update instance metadata

### 4. Prefer patch-style upgrades
Think in terms of:
- adding a new template
- copying a new docs file
- manually merging guidance into shared files
- optionally adopting a new folder/module

Do **not** expect safe automatic replacement of deeply customised files.

---

## What a good release should contain

A good release should make adoption easier by declaring:

### Safe to copy directly
Examples:
- new docs in `docs/`
- new templates in `templates/`
- new routing guidance in `1-routing/`

### Manual merge recommended
Examples:
- changes to `README.md`
- edits to `2-summaries/` starter content
- changes to governance files teams may have customised

### Optional adoption
Examples:
- new domain folders
- alternative workflow patterns
- local UI ideas
- feature-flagged concepts

---

## Refresh the installed tool and the local instance separately

The global CLI and a downstream working instance are different things. Refresh
the first from a release tag, then apply the second through the ownership model:

```bash
mole upgrade 0.2.8
mole install skills
```

The command updates the globally installed CLI and bundled scaffold. It does
not rewrite an existing instance's local product context. Review the changelog
and release notes, then apply only the upstream-owned additions and deliberate
manual merges that fit the instance.

---

## Longer-term path

The current CLI refreshes the installed tool from a tagged release but does
not automatically merge changes into a customised workspace.

Potential future improvements:

```bash
npx product-mole init
npx product-mole check-updates
npx product-mole upgrade --report
```

That CLI would eventually:
- scaffold a new instance
- inspect `mole.instance.yaml`
- compare instance version to upstream release
- apply safe additions
- flag merge-sensitive files
- generate an upgrade report

But this should come **after** the ownership model is stable.

---

## Recommendation

Treat Mole as a lightweight open-source PM operating system.
Its credibility will come from:
- clear structure
- honest upgrade semantics
- stable release points
- good documentation

Not from pretending that a heavily customised file-native system can be automatically upgraded with no trade-offs.
