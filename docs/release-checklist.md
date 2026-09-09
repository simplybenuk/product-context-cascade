# Release checklist

Use this for lightweight, branch-based releases of Mole.

The normal release path is:

```text
feature/* -> PR -> main -> tag vX.Y.Z
```

Keep `main` in a generally releasable state. Do not create a permanent
`staging` branch unless the project has a separate deployed environment that
needs it.

## Automated gates

Run these from the repository root before asking for a release review:

- [ ] `npm test` passes
- [ ] `npm run check:versions` passes
- [ ] `npm run check:package` passes and verifies the packed artifact can be
  installed and its CLI can run
- [ ] CI is green on every declared Node.js support line: 18.x, 20.x, 22.x,
  and 24.x
- [ ] `npm run check:release` passes
- [ ] If checking the exact tagged commit, `npm run check:release:tag` passes

The strict release check catches version drift, missing MIT metadata or license
text, a missing packaged `LICENSE`, a stale README install target, and an
unconfirmed copyright holder. The tag variant also requires `HEAD` to point at
`vX.Y.Z`.

## Before release

- [ ] Changes are on a feature/docs/fix branch, not direct on `main`
- [ ] README still reflects the current recommended operating model
- [ ] Upgrade implications are documented if structure or workflow changed
- [ ] `CHANGELOG.md` updated
- [ ] `VERSION` updated
- [ ] Root and CLI package versions match `VERSION`
- [ ] `LICENSE` contains the maintainer-confirmed copyright holder
- [ ] Root and CLI package metadata declare `MIT`
- [ ] Any new templates/docs are linked from README where appropriate

## For upgrade-affecting releases

- [ ] `docs/upgrade-and-instance-management.md` updated if the model changed
- [ ] `mole.instance-template.yaml` updated if instance metadata expectations changed
- [ ] Clear notes added for adopters about:
  - what can be copied directly
  - what needs manual merge
  - what is optional

## Optional release branch

When several changes need to be tested together, create a temporary release
branch from `main`, for example `release/0.3.0`.

- [ ] Only release-stabilisation fixes are added to the release branch
- [ ] Release candidates use a pre-release tag such as `v0.3.0-rc.1` when useful
- [ ] Fixes made on the release branch are merged back into `main`
- [ ] The release branch is deleted after the release

## Release

- [ ] Merge the change or release branch into `main`
- [ ] Confirm the release commit is the exact commit that will be tagged
- [ ] Create Git tag (`vX.Y.Z`)
- [ ] Push tag
- [ ] If useful, create a GitHub Release with short upgrade notes

## Versioning

- Patch releases (`X.Y.Z`) contain fixes and documentation or tooling changes
  that do not add a new user-facing capability.
- Minor releases (`X.Y.0`) add backwards-compatible commands, workflows, or
  features.
- Major releases (`X.0.0`) contain breaking changes to the CLI, workspace
  structure, or upgrade model.

Do not bump the version for every merged pull request. Bump it once in the
release change, then use the matching Git tag as the stable release point.
