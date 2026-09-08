# Template Update Guide (Upstream → Local Instance)

Use this when you have a live mole instance and want to pull structural/template updates safely.

This guide is the practical companion to:
- [upgrade-and-instance-management.md](./upgrade-and-instance-management.md)

## Recommended model

- **Upstream template repo:** `product-mole`
- **Your working repo:** your private instance with real context
- **Your local metadata file:** `mole.instance.yaml`

## One-time setup (in your working repo)

```bash
git remote add upstream git@github.com:simplybenuk/product-mole.git
git fetch upstream --tags
```

Copy the upstream starter metadata file into your instance:

```bash
cp mole.instance-template.yaml mole.instance.yaml
```

Then update it with your real local customisations over time.

## Practical update flow

### 1. Check what release you are on
Read:
- `mole.instance.yaml`
- upstream `CHANGELOG.md`
- upstream release/tag notes

### 2. Fetch latest upstream releases

```bash
git fetch upstream --tags
```

### 3. Review what changed before merging
Prefer reading the changelog and upgrade docs first, rather than blindly merging.

### 4. Merge a tagged release (preferred)

```bash
git checkout main
git merge v0.2.8   # replace with the release you want
```

Or merge upstream main if you are deliberately tracking unreleased work:

```bash
git checkout main
git fetch upstream
git merge upstream/main
```

### 5. Resolve by ownership class

#### Usually safe to take from upstream
- `0-bootstrap/`
- `1-routing/`
- `templates/`
- `docs/`

#### Review carefully
- `README.md`
- `2-summaries/`
- `3-indexes/`
- selected governance files

#### Preserve local truth
- `4-context/`
- `5-evidence/`
- `6-raw/`

### 6. Update your instance metadata
After a successful upgrade, update `mole.instance.yaml` with:
- `last_upgraded_from`
- `last_upgraded_to`
- any new local structural drift

## Conflict guidance

- Prefer preserving real project truth over template neatness.
- Reapply upstream structural improvements deliberately if your instance has drifted.
- If both upstream and local changed a merge-sensitive file, keep the local truth and manually pull in the useful upstream improvements.

## Branch + PR policy (template repo)

- No direct pushes to `main`.
- Create a branch per change.
- Open PR and merge after review.
- Tag stable releases with full SemVer tags (`v0.2.8`, `v0.3.0`, ...).
- Include upgrade notes whenever adopter behaviour should change.
