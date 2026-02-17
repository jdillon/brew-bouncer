---
description: Prepare and tag a new release
argument-hint: [version]
allowed-tools: Bash(git:*), Bash(jq:*), Read, Edit, AskUserQuestion
model: sonnet
---

Prepare a release for brew-bouncer.

## Instructions

### Step 1: Gather release context

```bash
git branch --show-current
jq -r .version package.json
git describe --tags --abbrev=0 2>/dev/null || echo "no tags yet"
git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD --oneline --no-merges
```

### Step 2: Validate branch

Releases MUST be from `main` branch.

If on ANY OTHER branch: **STOP** and tell user to merge to main first.

### Step 3: Compute version

Default: bump patch (e.g., 0.1.0 → 0.1.1)

If user provided version ($ARGUMENTS), use that instead.

Use `AskUserQuestion` to confirm version.

### Step 4: Audit changelog

Read CHANGELOG.md `[Unreleased]` section. Compare commits since last tag.

**Only flag user-facing changes:**
- `feat:` that add/change CLI commands or behavior
- `fix:` that fix bugs users encounter

**Skip:**
- `docs:`, `ci:`, `test:`, `bd:`, `chore:` commits
- Changes in `.claude/`, `.github/`, `scripts/`, `docs/`, `.beads/`
- Commits already in changelog (matching bead ID)

If user-facing changes missing from changelog: **STOP** and ask user to update.

### Step 5: Execute release

Only after version confirmed AND changelog complete:

1. Validate `[Unreleased]` has content

2. Update CHANGELOG.md:
   - Add empty `## [Unreleased]` at top
   - Change old `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`

3. Update package.json version

4. Commit: `chore: release vX.Y.Z`

5. Create tag: `vX.Y.Z`

6. Push:
   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

7. Report success: "Release tagged. Workflow will run automatically: https://github.com/jdillon/brew-bouncer/actions"
