# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Brew Bouncer — macOS Homebrew upgrade manager that detects which running apps/processes were affected and walks the user through restarting them. Replaces the common post-upgrade reboot with targeted restarts.

## Commands

```bash
bun run dev                    # Run CLI (bun run src/index.ts)
bun run typecheck              # Type check (tsc --noEmit)
./bin/brew-bouncer status      # Run via brew extension wrapper
brew bouncer upgrade           # Run via brew dispatch (requires symlink)
```

No test suite yet. No lint setup.

## Tech Stack

- **Runtime**: Bun (not Node.js) — use `bun run` / `bun test` / `bun install`
- **Language**: TypeScript strict mode (ESNext target, bundler module resolution)
- **CLI**: commander (arg parsing), chalk (colors), cli-table3 (tables), @inquirer/prompts (checkbox selector)
- **Logging**: @logtape/logtape + @logtape/pretty, silent by default, controlled by `--debug`/`--verbose`/`--quiet`

## Architecture

### Core flow

Both `status` and `upgrade` follow the same pipeline:

```
brew update → brew outdated --greedy --json → filter → detect running processes → display
```

`upgrade` adds: confirm (with interactive package selector) → `brew upgrade <explicit names>` → re-detect → restart prompts.

### Key design decisions

- **Explicit package names to brew upgrade** — never `brew upgrade --greedy` without a package list. What the user sees in the preview = exactly what gets upgraded.
- **Installer-manual cask detection** — casks with `installer: { manual: ... }` artifacts are filtered to "skipped" because brew refuses to auto-upgrade them (would cause exit code 1).
- **Never bail on upgrade failure** — brew returns 1 for partial failures. Always continue to detection and restart, which is the whole point of the tool.
- **Per-package passthrough upgrades** — each package is upgraded individually via `execStreaming` (inherit), so brew owns the terminal. The user sees all output including prompts, caveats, and errors in real time.

### Module responsibilities

- `src/commands/` — orchestration only, no brew logic
- `src/brew/runner.ts` — all subprocess execution (`exec`, `execStreaming`). Uses `BREW_PATH` from `src/brew/paths.ts`.
- `src/brew/paths.ts` — Homebrew prefix/bin/brew-binary detection. Resolves `HOMEBREW_PREFIX` env → `/opt/homebrew` → `/usr/local` → `which brew`, synchronously at module load.
- `src/brew/parser.ts` — JSON/text parsing, package filtering, installer-manual detection. Pure functions, no I/O.
- `src/detect/` — maps packages to running processes using multiple strategies:
  - Casks: osascript (System Events) + ps (.app bundles) + pkgutil fallback
  - Formulae: brew services list + brew list (binaries) matched against ps, batched through pool with concurrency=8
- `src/output/format.ts` — shared rendering (tables, version formatting, status tags). Used by both status and upgrade.
- `src/prompt.ts` — all user interaction (confirmUpgrade with Y/n/select, checkbox selector, restart prompts)
- `src/pool.ts` — generic concurrency-limited async task runner
- `src/restart.ts` — app restart dispatcher (osascript quit+reopen for GUI, brew services restart for services, manual message for CLI)

### Brew extension integration

`bin/brew-bouncer` is a shell wrapper with `#:` comment lines that brew parses for help text. Symlinked to `/opt/homebrew/bin/brew-bouncer` for `brew bouncer` dispatch. The wrapper is permanent — even native binaries need it because brew requires parseable `#:` text in the script.

## Conventions

- Shell out to `brew` (path resolved via `src/brew/paths.ts`) directly, parse `--json` output where available
- No external brew wrapper libraries
- Config lives at `~/.config/brew-bouncer/config.yaml` (ignore list; legacy `config.json` still supported)
- Spinner output goes to stderr, data output to stdout
- Package type indicators: 🍺 formula, 🍷 cask
