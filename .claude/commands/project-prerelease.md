---
description: Audit changelog and draft entries for upcoming release
allowed-tools: Bash(git:*), Bash(jq:*), Read, Edit, Grep, AskUserQuestion
model: haiku
---

Audit the changelog for missing entries since the last release and draft updates.

## Instructions

Follow these steps exactly in order.

### Step 1: Get the last release tag

```bash
git describe --tags --abbrev=0 2>/dev/null || echo "no tags yet"
```

### Step 2: Get commits since the tag

Replace `<TAG>` with actual tag from Step 1:

```bash
git log <TAG>..HEAD --oneline --no-merges
```

Also read CHANGELOG.md `[Unreleased]` section.

### Step 3: Categorize each commit

**INCLUDE if:**

- Commit type is `feat:` or `fix:`
- Change affects CLI users (commands, output, behavior)

**SKIP if:**

- Type is: `docs:`, `ci:`, `test:`, `chore:`, `refactor:`
- Change is in: `.claude/`, `.github/`, `scripts/`, `docs/`
- Already in CHANGELOG.md

### Step 4: Check for gaps

Read the full commit bodies for anything user-facing that the subject line
alone doesn't convey:

```bash
git log <TAG>..HEAD --format="%h %s%n%b" --no-merges
```

### Step 5: Draft changelog entries

Format:

- One line per entry, max 80 chars
- Start with verb: "Add", "Fix", "Change", "Remove"
- Group by: Added, Changed, Fixed, Removed

### Step 6: Present report

Show:

1. **Commits analyzed** - hash, type, INCLUDE/SKIP, reason
2. **Gaps** - anything user-facing not yet in the changelog, or "None"
3. **Draft entries** - grouped by section

### Step 7: Ask for confirmation

Use `AskUserQuestion`:

- Question: "Update CHANGELOG.md with these entries?"
- Header: "Changelog"
- Options: "Yes, update" / "No, skip"

### Step 8: Update CHANGELOG.md (if yes)

1. Find `## [Unreleased]`
2. Insert entries after it, before next version section
3. Merge with existing entries (no duplicates)
4. Do NOT commit
5. Tell user: "CHANGELOG.md updated. Review with `git diff CHANGELOG.md`"
