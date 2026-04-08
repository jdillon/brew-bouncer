# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Homebrew paths are now resolved at runtime via `src/brew/paths.ts`
  (`HOMEBREW_PREFIX` env → `/opt/homebrew` → `/usr/local` → `which brew`)
  instead of being hardcoded to `/opt/homebrew`. Respects custom install
  locations.

### Fixed

- Quarantine handling now covers all executables, not just cask `.app`
  bundles. CLI casks (e.g. `claude-code`), pkg-installed casks, and formula
  binaries previously approved by the user get re-approved after upgrade.
  Previously only GUI apps in `/Applications` were checked.

## [0.2.0] - 2026-03-23

### Added

- Quarantine management for cask upgrades: preserve user's unquarantine approvals
  across upgrades with configurable policy (yes/ask/no)
- Dev/release version identification via build stamping (dev builds show
  e.g. 0.1.1-dev+branch.abc1234)
- Restart policy prompt: ask upfront whether to auto-restart, ask per-app, or
  skip all restarts

### Changed

- Disable spinners when --debug or --verbose is enabled (prevents garbled log
  output)

### Fixed

- Compiled binary crash: migrate logging from pino to LogTape (pino's worker
  threads fail in standalone binaries)

## [0.1.1] - 2026-03-20

### Fixed

- Release workflow: use single `macos-latest` runner with cross-compilation
  instead of deprecated `macos-13` for x64 builds

## [0.1.0] - 2026-03-20

Initial release. macOS Homebrew upgrade manager with targeted restart detection.

### Added

- `status` command — show outdated packages with running process detection
- `upgrade` command — interactive upgrade with preview, confirmation, and restart prompts
- Interactive package selector (checkbox UI) for selective upgrades
- Running process detection for casks via osascript, ps, and pkgutil strategies
- Running process detection for formulae via brew services and binary matching
- Cask CLI binary detection for casks that install binaries instead of .app bundles
- Installer-manual cask filtering (auto-skip casks brew can't upgrade)
- Upgrade output capture to `~/.local/state/brew-bouncer/upgrade-YYYY-MM-DD.log`
- App restart dispatcher (GUI quit+reopen, brew services restart, manual instructions)
- Concurrency-limited process detection pool
- Brew extension wrapper (`bin/brew-bouncer`) for `brew bouncer` dispatch
- Config file support at `~/.config/brew-bouncer/config.json` (ignore list)
- CI workflow for typecheck, license check, and test compile
- Release workflow for multi-architecture native binary distribution
- Homebrew formula template for tap automation
- Apache 2.0 license and automated license header checking
- Changelog and release slash commands
