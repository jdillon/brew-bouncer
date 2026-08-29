# Beads issues, exported before removal

> jdillon / Claude — 2026-08-29 — branch: chore/sandbox-notes
>
> Disposal: triage the 12 issues below — file the ones still worth doing as
> GitHub issues, drop the rest — then delete this directory. It exists only so
> the backlog survives the beads removal (PR #16, merge `f64e0d2`), which took
> the gitignored `.beads/` database with it.

Beads was removed from this project on 2026-08-29. Its database held 12 open or
in-progress issues with no other copy, so they were exported here first.

## Files

- `issues.jsonl` — full beads export, 23 records including closed ones. Source of truth.
- `issues-all.json` — the same 12 open/in-progress issues as JSON, with full descriptions.
- `issues-summary.txt` — one line each, for scanning.

## The backlog

| ID | Status | Type | Title |
|---|---|---|---|
| `brew-bouncer-d93` | open | feature p1 | Sequential per-package upgrade with inline restart prompts |
| `brew-bouncer-b0r` | in progress | bug p2 | Quarantine handling only covers GUI apps, needs to cover all executables |
| `brew-bouncer-1vu` | in progress | task p2 | Homebrew distribution: deliver bun-based CLI as bottle |
| `brew-bouncer-1i9` | open | bug p2 | Caveat extraction from brew output stream is broken |
| `brew-bouncer-lmy` | open | feature p2 | Add commands to manage the ignore list |
| `brew-bouncer-67l` | open | task p2 | Generate native binary with `bun build --compile` |
| `brew-bouncer-5p1` | open | task p2 | Investigate test coverage opportunities |
| `brew-bouncer-1d3` | open | task p2 | Restart each .app bundle independently for multi-.app casks |
| `brew-bouncer-cbn` | open | task p2 | Restart each .app bundle independently for multi-.app casks |
| `brew-bouncer-8ut` | open | feature p3 | Add per-package pre/post-upgrade hooks |
| `brew-bouncer-a9r` | open | feature p3 | brew-barback: Full TUI for Homebrew management |
| `brew-bouncer-b20` | open | feature p3 | Implement standalone restart command |

Notes for triage:

- `1d3` and `cbn` are the same issue filed twice — both are the multi-`.app`
  restart follow-up from PR #14's review. Keep one.
- `b0r` and `1vu` are marked in progress, but both predate the current state of
  the code; check what actually shipped before re-filing.
- `5p1` (test coverage) is partly answered — `src/detect/formulae.test.ts`
  landed in PR #15 and is the repo's first test file.
