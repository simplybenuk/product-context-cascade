# Changelog

All notable changes to Mole should be documented here.

The format is loosely based on Keep a Changelog and uses lightweight SemVer.

## [Unreleased]

### Added
- Added MIT package metadata, a root `LICENSE` file, and a strict release guard.
- Added Node.js CI coverage for 18.x, 20.x, 22.x, and 24.x.
- Added packed-artifact and clean-install verification for the published package.

### Changed
- `mole upgrade [version]` now installs from an explicit `vX.Y.Z` release tag.
- Added release, upgrade, contribution, and development guidance for the
  open-source package lifecycle.

The intended MIT terms are prepared, but release publication remains blocked
until a maintainer confirms the copyright-holder line in `LICENSE`.

## [0.2.8] - 2026-06-17

### Fixed
- `mole inbox complete` now writes a machine-readable inbox-processing receipt and updates Molehill Metrics even when a synthesis run did not create a prior processing lock.

### Changed
- New CLI and UI captures now write directly to the flat `6-raw/inbox/` drop zone.
- Inbox guidance now treats locks and receipts as the durable processing state, while preserving compatibility with existing `quick-notes/`, `messages/`, `observations/`, and state-folder layouts.

## [0.2.7] - 2026-06-11

### Added
- Added Molehill Metrics for local processed inbox item counts under `governance/metrics/`.
- Added `mole inbox complete --processed <path>` support so processing receipts can record processed inbox items and update daily, weekly, and monthly metrics.
- Added `mole metrics backfill` to rebuild metrics from historical inbox processing receipts that already contain processed paths.
- Added a static local metrics dashboard at `governance/metrics/dashboard.html`.

### Changed
- CLI help, README, CLI docs, and inbox synthesis guidance now include the full current command surface and metrics workflow.
- Metrics dedupe canonicalizes processed paths so relative, `./`, and workspace-absolute spellings count as the same inbox item.

## [0.2.6] - 2026-05-28

### Added
- Added `mole bootstrap-context` guidance for first-time population of blank or starter-template `2-summaries/` and `3-indexes/`.
- Added `mole refresh top-layers` guidance for periodically reconciling summaries and indexes with lower-layer context.
- Added packaged `mole-bootstrap-context` and `mole-refresh-top-layers` skills.

### Changed
- Inbox synthesis guidance now treats blank, placeholder-only, or starter-template summaries and indexes as material top-layer gaps that should be populated from durable synthesis.

## [0.2.5] - 2026-05-22

### Added
- Added `cli/skills/mole-upgrade-workspace/SKILL.md` with a conservative workflow for upgrading older Mole workspaces.
- The new skill includes preflight checks, tooling refresh guidance, `mole doctor`/`mole check-updates` assessment, and ownership-based upgrade classification.

### Changed
- Upgrade guidance now explicitly codifies safe-only apply behavior (`safe-copy`) plus manual review requirements for `merge-carefully` and `never-overwrite` paths.

## [0.2.4] - 2026-05-16

### Added
- Added `4-context/stakeholders.md` as a living, evidence-backed stakeholder and organisation context file for Mole workspaces.
- Added `mole product-update <audience> <timescale> --format <format>` to generate stakeholder-specific product update instructions.
- Added a product update artifact template and packaged `mole-product-update` skill.
- Added stakeholder metadata fields for raw insight capture.

### Changed
- Inbox synthesis guidance now includes stakeholder memory updates for internal signals, leadership asks, update preferences, decision authority, and org-chart facts.
- README and CLI docs now describe stakeholder capture and product update workflows.

## [0.2.3] - 2026-05-16

### Added
- Added `4-context/personas.md` as a living, evidence-backed persona context file for Mole workspaces.
- `mole synthesise inbox` now reminds agents to update or create personas when inbox material contains durable user/customer signals.

### Changed
- Inbox synthesis guidance now includes persona maintenance and user-summary refresh rules.

## [0.2.2] - 2026-05-14

### Added
- `mole --help` now includes command descriptions, artifact types, examples, and a README link.
- `mole install skills` installs Mole agent skills into `~/.agents/skills` or `$AGENTS_HOME/skills`.
- Packaged Mole workflows as agent skills under `cli/skills/`.

### Changed
- Replaced bundled Codex prompt files with agent skill directories.
- `mole install codex` is now a deprecated compatibility alias for `mole install skills`.
- README and CLI docs now describe the agent skill installation flow.

## [0.2.1] - 2026-05-14

### Added
- `mole upgrade` now updates the globally installed Mole CLI from `github:simplybenuk/product-mole#main`.
- `mole new` / `mole init` now creates workspaces from an explicit scaffold allowlist.
- Added tracked `4-context/` and `5-evidence/` workspace placeholders.

### Changed
- New workspaces are clean Mole instances instead of copies of the Product Mole source repository.
- `mole doctor` now checks the full `0-bootstrap/` through `6-raw/` workspace structure.
- Workspace metadata no longer references source-only paths such as `docs/`, `templates/`, or `cli/`.

## [0.2.0] - 2026-03-29

### Added
- `docs/upgrade-and-instance-management.md` to define how local mole instances should track versions, ownership, and upgrades.
- `mole.instance-template.yaml` as a starter instance metadata file for adopted moles.
- `docs/release-checklist.md` for lightweight release discipline.
- Stronger upgrade guidance in the README, including the distinction between upstream-owned files and instance-owned content.

### Changed
- README repositioned the project as a reusable open-source PM operating system with an explicit upgrade path, not just a one-time template dump.
- Template update guidance expanded from simple upstream merge advice to a more realistic instance-management model.

## [0.1.0] - 2026-03-15

### Added
- Initial public scaffold for Mole.
- README as the primary user guide.
- Architecture/design guidance moved to `docs/architecture-and-design.md`.
- Local UI v0 scaffold retained on branch `feat/ui-v0-local-scaffold`.
