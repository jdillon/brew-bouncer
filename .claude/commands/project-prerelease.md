---
description: Audit changelog and draft entries for upcoming release
allowed-tools: Bash(git:*), Bash(jq:*), Bash(bd:*), Read, Edit, Grep, AskUserQuestion, Skill(beads)
model: haiku
---

Audit the changelog for missing entries since the last release and draft updates.

## Instructions

Follow these steps exactly in order.

### Step 1: Get the last release tag

```bash
git describe --tags --abbrev=0 2>/dev/null || echo "no tags yet"
```

### Step 2: Get commits and bead IDs since the tag

Replace `<TAG>` with actual tag from Step 1:

```bash
git log <TAG>..HEAD --oneline --no-merges
git log <TAG>..HEAD --format="%B" --no-merges | grep -oE "brew-bouncer-[a-z0-9]+" | sort -u
```

Also read CHANGELOG.md `[Unreleased]` section.

### Step 3: Categorize each commit

**INCLUDE if:**

- Commit type is `feat:` or `fix:`
- Change affects CLI users (commands, output, behavior)

**SKIP if:**

- Type is: `docs:`, `ci:`, `test:`, `chore:`, `bd:`, `bd sync:`, `refactor:`
- Change is in: `.claude/`, `.github/`, `scripts/`, `docs/`, `.beads/`
- Bead ID already in CHANGELOG.md

### Step 4: Get bead details

```bash
bd list --status=closed --limit=20
```

For each bead ID from commits:

```bash
bd show <bead-id>
```

### Step 5: Check for gaps

Compare closed beads vs beads in commits. Flag user-facing beads missing from commits.

### Step 6: Draft changelog entries

Format:

- One line per entry, max 80 chars
- Start with verb: "Add", "Fix", "Change", "Remove"
- Include bead ID: `(\`brew-bouncer-xxx\`)`
- Group by: Added, Changed, Fixed, Removed

### Step 7: Present report

Show:

1. **Commits analyzed** - hash, type, INCLUDE/SKIP, reason
2. **Beads referenced** - ID, title, type
3. **Gaps** - missing beads or "None"
4. **Draft entries** - grouped by section

### Step 8: Ask for confirmation

Use `AskUserQuestion`:

- Question: "Update CHANGELOG.md with these entries?"
- Header: "Changelog"
- Options: "Yes, update" / "No, skip"

### Step 9: Update CHANGELOG.md (if yes)

1. Find `## [Unreleased]`
2. Insert entries after it, before next version section
3. Merge with existing entries (no duplicates)
4. Do NOT commit
5. Tell user: "CHANGELOG.md updated. Review with `git diff CHANGELOG.md`"
