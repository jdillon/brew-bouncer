# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CI workflow for typecheck and test compile (`brew-bouncer-1vu`)
- Release workflow for multi-architecture native binary distribution (`brew-bouncer-1vu`)
- Homebrew formula template for tap automation (`brew-bouncer-1vu`)
- Changelog and release slash commands (`brew-bouncer-huq`)

## [0.1.0] - 2026-02-14

Initial release. macOS Homebrew upgrade manager with targeted restart detection.

### Added

- `status` command — show outdated packages with running process detection
- `upgrade` command — interactive upgrade with preview, confirmation, and restart prompts
- Interactive package selector (checkbox UI) for selective upgrades
- Running process detection for casks via osascript, ps, and pkgutil strategies
- Running process detection for formulae via brew services and binary matching
- Installer-manual cask filtering (auto-skip casks brew can't upgrade)
- Upgrade output capture to `~/.local/state/brew-bouncer/upgrade-YYYY-MM-DD.log`
- App restart dispatcher (GUI quit+reopen, brew services restart, manual instructions)
- Concurrency-limited process detection pool
- Brew extension wrapper (`bin/brew-bouncer`) for `brew bouncer` dispatch
- Config file support at `~/.config/brew-bouncer/config.json` (ignore list)
