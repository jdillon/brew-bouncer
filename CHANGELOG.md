# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-07-25

### Added

- Config file is now YAML at `~/.config/brew-bouncer/config.yaml`.
  `config.json` still works as a deprecated fallback; startup fails fast
  on parse errors or if both files exist.
- Configurable prompt defaults (`promptDefaults`) for the upgrade,
  restart, and quarantine prompts.
- Summary of brew warnings and errors after an upgrade run.

### Changed

- Homebrew paths are now resolved at runtime via `src/brew/paths.ts`
  (`HOMEBREW_PREFIX` env → `/opt/homebrew` → `/usr/local` → `which brew`)
  instead of being hardcoded to `/opt/homebrew`. Respects custom install
  locations.

### Fixed

- Quarantine is now detected after each package upgrades instead of from
  a pre-upgrade approval snapshot. Casks whose binaries always ship
  quarantined (e.g. `claude-code`) were never in the approved list, so
  every upgrade left them quarantined.
- GUI app restart polls for actual quit instead of sleeping a fixed
  1500ms, escalates to SIGTERM after 10s, and verifies the app relaunched.
- GUI app restart no longer kills unrelated CLI processes that share a
  case-insensitive name. Cask-GUI detection now captures PIDs and the
  `.app` bundle path via `ps`. Restart targets those specific PIDs for
  quit verification and SIGTERM, with a defense-in-depth re-check that
  each PID's executable still resides under the originally-detected
  bundle path before signaling (guards against PID recycling).
  Launch verification scans `ps` for processes under the bundle path
  rather than matching the bundle name against the executable, which
  avoids false negatives for apps whose executable case or name differs
  from the bundle (e.g. `Firefox.app/Contents/MacOS/firefox`,
  `Visual Studio Code.app/Contents/MacOS/Electron`). Previously,
  restarting `Claude.app` could `pkill -ix Claude` and terminate the
  `claude` CLI binary because `-i` matched both names.
- When a cask-GUI app is detected only via osascript (ps did not see it,
  so no PIDs), the post-quit wait now re-scans the bundle path on every
  poll iteration instead of short-circuiting on an empty PID list or
  switching to PID-set tracking after the first scan. Without continuous
  rescanning, processes that spawn or persist after the initial scan
  were missed and the app could be reopened before fully quitting.
- Running-app aggregation no longer collapses two installations of the
  same app at different paths (e.g. `/Applications/Foo.app` and
  `~/Applications/Foo.app`). The merge previously keyed by lowercase
  bundle name, which caused the second entry to overwrite the first and
  drop its PIDs.
- `filterLivePids` now treats `EPERM` from `process.kill(pid, 0)` as
  alive (process exists but cannot be signaled by the caller) rather
  than dead, distinguishing it from `ESRCH`.
- Bundle-path resolution in cask matching now prefers the first matched
  entry that has a defined `bundlePath`, falling back to the first match
  only if none have one. This avoids defeating bundle-path verification
  when an osascript-only supplement happens to be matched first.
- Cask-GUI detection no longer mixes PIDs from sibling `.app` bundles
  when a cask declares multiple app artifacts. The restart layer can
  only target one `displayName`/`bundlePath`, so PIDs are now filtered
  to the primary bundle's set instead of being flattened across every
  matched bundle. Multi-`.app` casks may need a follow-up to restart
  each bundle independently.
- `ps` invocations use `-ww` to ensure unlimited output width, guarding
  against silent path truncation in environments where `ps` output is
  attached to a narrow terminal.
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
