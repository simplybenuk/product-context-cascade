# Issue 20 release readiness

Status: READY FOR HUMAN TESTING

Issue: [Make Mole explicitly open-source, testable, and releasable](https://github.com/simplybenuk/product-mole/issues/20)

## Objective

Make the repository's open-source licence, supported test matrix, package
contents, tagged release model, versioned upgrade path, and release gates
explicit and verifiable.

## Approved decisions and assumptions

- The maintainer selected MIT as the intended project licence.
- The repository does not establish a legal copyright holder. The `LICENSE`
  file therefore uses a clearly marked placeholder rather than guessing an
  individual or company.
- Release publication is intentionally blocked until a maintainer replaces
  that placeholder with the confirmed holder.
- The declared CI support matrix is Node.js 18.x, 20.x, 22.x, and 24.x.
- Stable CLI upgrades use immutable `vX.Y.Z` tags, never the moving `main`
  branch.

## Delivered scope

- Added root and CLI MIT metadata and a full MIT licence template.
- Added release-consistency checks for versions, licence metadata/text,
  README install target, and confirmed release holder/tag requirements.
- Added packed-artifact verification with clean install and CLI smoke test.
- Added GitHub Actions coverage for the declared Node.js matrix.
- Updated README, CLI README, contribution guidance, upgrade guidance, the
  template update guide, the command-surface guide, and the release checklist.
- Updated `mole upgrade [version]` to resolve a tagged release explicitly.
- Preserved prerelease suffixes when checking README/version alignment.
- Made packed-artifact verification execute the installed npm `.bin/mole`
  shim.
- Added this traceability artifact for review and release handoff.

## Acceptance traceability

1. Licence: MIT metadata and terms are present; strict release validation
   remains blocked by the unconfirmed holder.
2. Tests: root `npm test` runs the complete CLI test suite.
3. CI: `.github/workflows/ci.yml` runs tests and package/release checks on each
   declared Node.js version.
4. Tagged release: `check:versions`, `check:release`, and
   `check:release:tag` enforce alignment across `VERSION`, both package files,
   README, changelog, licence, and tag.
5. Versioned install/upgrade: documentation and CLI use `#vX.Y.Z` targets.
6. Checklist and package guard: `docs/release-checklist.md` names the gates,
   while `check:package` verifies the packed file set and clean installation.

## Validation log

Update this section as validation is rerun. The expected strict-release blocker
is retained until the maintainer supplies the legal holder.

- Baseline root `npm test`: passed before implementation (42 tests).
- Final root `npm test`: passed (46 tests).
- Final `npm --prefix cli test`: passed (46 tests).
- `npm run check:versions`: passed with the expected holder warning.
- `npm run check:package`: passed; 111 packed files, clean install, and CLI
  bin-shim help smoke test passed.
- Syntax checks and `git diff --check`: passed.
- `npm run check:release`: failed only with the expected unconfirmed-holder
  blocker.
- Tag gate diagnostic: failed only because this review commit is not tagged
  `v0.2.8`; tagging is a release step after merge.

## Independent review

Verdict: READY FOR HUMAN TESTING

- No remaining implementation, package-boundary, upgrade-safety, or
  documentation defects were found after the review remediations.
- Release publication remains blocked intentionally until a maintainer
  confirms the copyright-holder line in `LICENSE`; the strict guard reports
  exactly that failure.
- Human focus: inspect the MIT holder decision, run the documented tagged
  install/upgrade flow against a release tag, and verify that workspace-local
  context remains untouched by the global CLI refresh.
- The packed artifact includes the required licence, CLI, scaffold, metadata,
  and upgrade manifest files; the installed bin-shim smoke check passed.
- Follow-up review findings were fixed: prerelease suffixes are preserved in
  README version checks, and a regression test covers the corrected parser.

After human output testing, hand the accepted change to `bwh-archive-change`.
If testing finds more work, return the change to `bwh-development`.

## Next handoff

Commit and publish the draft PR linked to issue #20, with the holder blocker
called out for maintainer action. Do not merge or tag this branch.
