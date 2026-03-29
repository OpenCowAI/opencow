---
allowed-tools: Bash(git:*), Bash(pnpm lint), Bash(pnpm test), Bash(pnpm typecheck), Bash(pnpm build), Bash(node *), Bash(npm version *), Read, Edit, Grep, Glob
description: "Bump version, update changelog, run quality gates, commit, tag, and push a new release"
---

You are the release manager for the OpenCow open-source project. Your job is to execute a fully automated, safe release pipeline.

## Input

The user provides a version string as the argument: `$ARGUMENTS`

- Accept both `vX.Y.Z` and `X.Y.Z` formats
- Normalize to `X.Y.Z` for package.json and `vX.Y.Z` for git tags

## Context

- Current branch: !`git branch --show-current`
- Current version in package.json: !`node -p "require('./package.json').version"`
- Latest git tags: !`git tag --sort=-v:refname | head -5`
- Working tree status: !`git status --short`

---

## Execution Flow

Execute the following steps **strictly in order**. Each step must pass before proceeding.

### Step 0: Pre-flight Validation

**Checks** (any failure → **stop immediately** and explain):

1. **Argument present** — `$ARGUMENTS` must not be empty. If empty, output usage:
   ```
   Usage: /opencow.release vX.Y.Z
   Example: /opencow.release v0.4.0
   ```
2. **Valid semver** — must match `(v)?MAJOR.MINOR.PATCH` (no pre-release suffixes for now).
3. **Version is newer** — the target version must be strictly greater than the current version in `package.json`. Compare `major.minor.patch` numerically.
4. **Clean working tree** — `git status --porcelain` must be empty. If there are uncommitted changes, tell the user to commit or stash first.
5. **On `main` branch** — releases must be cut from `main`. If on another branch, warn the user.

**Output**:
```
[Pre-flight]
✓ Target version: X.Y.Z
✓ Current version: A.B.C → X.Y.Z
✓ Working tree: clean
✓ Branch: main
```

---

### Step 1: Update Version in `package.json`

Run:
```bash
npm version X.Y.Z --no-git-tag-version
```

This updates `package.json` (and `package-lock.json` if present). The `--no-git-tag-version` flag prevents npm from creating a commit or tag — we handle those ourselves.

**Verify** by reading back the version:
```bash
node -p "require('./package.json').version"
```

---

### Step 2: Update CHANGELOG.md

**Generate the changelog from actual commits** — never leave placeholder text.

1. Run `git log vA.B.C..HEAD --oneline` to list all commits since the previous release tag.
2. Categorize each commit into **Added** / **Changed** / **Fixed** based on its conventional commit type:
   - `feat` → Added
   - `refactor`, `perf`, `chore` → Changed
   - `fix` → Fixed
   - `docs`, `style`, `test` → omit (or include under Changed if user-facing)
3. Write concise, user-facing descriptions (not raw commit messages). Group related commits into single entries when they belong to the same feature.

Read the current `CHANGELOG.md`, then insert the new version section **at the top** (below the header), using today's date:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- Feature description derived from feat() commits

### Changed
- Change description derived from refactor()/perf() commits

### Fixed
- Fix description derived from fix() commits
```

Insert this **before** the previous version's `## [A.B.C]` heading. Do NOT delete or modify existing changelog entries.

If there is no `CHANGELOG.md`, create one with the standard "Keep a Changelog" header.

---

### Step 3: Quality Gates

Run **all four** checks. All must pass — any failure → **stop** and report the error.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

**Output**:
```
[Quality Gates]
✓ Lint: 0 errors
✓ TypeCheck: 0 errors
✓ Tests: NNN passed
✓ Build: success
```

---

### Step 4: Commit the Version Bump

Stage and commit with a standardized message:

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): bump version to X.Y.Z

Prepare release vX.Y.Z.
- Update package.json version
- Add CHANGELOG.md entry

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Important**: Only stage `package.json` and `CHANGELOG.md`. Do NOT use `git add .`.

---

### Step 5: Create Git Tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

Verify:
```bash
git tag --sort=-v:refname | head -3
```

---

### Step 6: Summary & Next Steps

**Output**:
```
═══════════════════════════════════════════════════
  ✅ Release vX.Y.Z prepared successfully!
═══════════════════════════════════════════════════

  Version bump:  A.B.C → X.Y.Z
  Commit:        <short hash> chore(release): bump version to X.Y.Z
  Tag:           vX.Y.Z

  Next steps:
    1. Review:    git log --oneline -3
    2. Push:      git push origin main && git push origin vX.Y.Z
    3. Monitor:   https://github.com/OpenCowAI/opencow/actions

  After CI completes, the GitHub Release will be created
  automatically with DMG/ZIP artifacts attached.
═══════════════════════════════════════════════════
```

**Ask the user**: "Ready to push to remote? (This will trigger the release CI pipeline)"

If the user confirms → run:
```bash
git push origin main && git push origin vX.Y.Z
```

---

## Constraints

1. **Sequential**: Steps 0 → 1 → 2 → 3 → 4 → 5 → 6, no skipping
2. **Blocking**: Stop immediately on any failure, explain clearly
3. **No force push**: Never use `--force` on any git operation
4. **Version source of truth**: Only `package.json` needs a manual version update; `appIdentity.ts` reads from the build-time `__APP_VERSION__` injection via `electron.vite.config.ts`
5. **Tag format**: Always `vX.Y.Z` (with `v` prefix)
6. **No secrets**: Never commit `.env*`, credentials, or tokens
7. **Atomic**: If any quality gate fails, the version bump commit must NOT be pushed
