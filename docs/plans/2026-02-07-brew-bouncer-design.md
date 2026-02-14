# Brew Bouncer - Design Document

**Date:** 2026-02-07
**Status:** Approved

## Overview

A Bun CLI tool that wraps Homebrew's update/upgrade workflow, detects which running
apps and processes correspond to upgraded packages, and reports what needs restarting.
Defaults to dry-run mode.

## CLI Interface

```
$ bouncer upgrade            # update + upgrade + detect (dry-run default)
$ bouncer upgrade --restart  # actually restart detected apps/services
$ bouncer status             # show outdated packages without upgrading
$ bouncer restart            # re-scan and restart (if brew was run manually)
```

## Architecture

```
bouncer upgrade
    |
    +- 1. Run `brew update` (capture output)
    +- 2. Run `brew outdated --greedy` (snapshot before upgrading)
    +- 3. Run `brew upgrade --greedy` (capture output, parse upgraded packages)
    +- 4. For each upgraded package:
    |     +- Determine type: formula vs cask (`brew info --json=v2`)
    |     +- For casks: find .app bundle path (from cask info artifacts)
    |     +- For formulae: find installed binaries (`brew list --formula <pkg>`)
    |     +- Check if any matching process is running
    +- 5. Report: list of running apps/processes that were upgraded
          +- Dry-run default: "These need restarting" (no action taken)
```

## Package-to-Process Detection

### Casks (GUI apps)

- `brew info --json=v2 --cask <name>` returns `artifacts` array with app bundle names
- Check running GUI apps via `osascript` querying System Events
- Match upgraded cask artifact names against running process names
- Edge cases: some casks install CLI tools too (Docker), some install
  preference panes or drivers (skip these)

### Formulae (CLI tools / services)

- `brew list <formula>` shows installed file paths -- filter to `bin/` and `sbin/`
- Check if those binary names appear in `ps aux` output
- For brew services: `brew services list` cross-referenced with upgraded list

### Output Format (dry-run)

```
Upgraded 12 packages (8 formulae, 4 casks)

Running apps that were upgraded:
  Firefox.app        (firefox 135.0 -> 136.0)     [cask - GUI app]
  Slack.app          (slack 4.41 -> 4.42)          [cask - GUI app]

Running processes that were upgraded:
  node               (node 22.1 -> 22.2)           [formula - CLI]

Running services that were upgraded:
  postgresql@17      (17.2 -> 17.3)                [formula - brew service]

No action taken (dry-run). Use --restart to restart these.
```

## Project Structure

```
src/
  index.ts              # CLI entry point (arg parsing)
  commands/
    upgrade.ts          # orchestrates update -> upgrade -> detect -> report
    status.ts           # shows outdated packages
    restart.ts          # standalone restart detection
  brew/
    runner.ts           # executes brew commands, captures output
    parser.ts           # parses brew JSON output, outdated lists
  detect/
    casks.ts            # cask -> running GUI app detection
    formulae.ts         # formula -> running process/service detection
    matcher.ts          # process matching logic
  output/
    reporter.ts         # formats the dry-run / restart report
```

## Error Handling

- `brew update` fails: report error, stop. Don't upgrade on stale state
- `brew upgrade` partial failure: detect/report on packages that did succeed
- Capture stderr separately so brew warnings don't pollute parsed output

## Edge Cases

- Cask with no .app artifact (fonts, drivers, quicklook plugins): skip
- Multiple processes per package (Docker): report parent app only
- Process name != package name: `brew info --json` artifacts handle mapping
- Brew services vs raw launchd: v1 only handles `brew services list` entries

## Explicit Non-Goals (v1)

- No auto-restart without `--restart` flag
- No `sudo` operations (warn and skip)
- No rollback if restart fails
- No menu bar GUI (separate project/phase)

## Dependencies

Minimal. Bun built-in `Bun.spawn` for process execution. Small arg parser
or hand-rolled (CLI surface is small). No external brew wrapper libraries --
shell out to `brew` directly and parse `--json` output.

## Future: Menu Bar App

Research completed on React-based macOS menu bar approaches. Top candidates:

1. **Tauri v2 + React** -- best size/perf balance (2.5-10 MB, 30-40 MB RAM)
2. **Swift + React hybrid** -- most native, ~100 lines Swift shell + React in WKWebView

Decision deferred until CLI tool is proven.
