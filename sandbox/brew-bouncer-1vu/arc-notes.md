# Homebrew Distribution: Deliver Bun-based CLI as Bottle

Arc ID: brew-bouncer-1vu
Source: bead brew-bouncer-1vu
Started: 2026-02-15

## Mindsets
(none loaded)

## Context
Distribute brew-bouncer CLI via Homebrew tap (jdillon/homebrew-planet57). Decision changed: **native binary via `bun build --compile`** instead of source distribution. No bun runtime dependency for end users.

Two targets: darwin-arm64 (58MB), darwin-x64 (63MB). Shell wrapper `bin/brew-bouncer` still needed for `#:` help text — formula generates it at install time, execs the native binary.

Linux support is future work — core brew commands work on Linuxbrew but detection/restart logic is macOS-specific (osascript, System Events, .app bundles, open -a). Abstracting that is a separate bead.

## Structure
- brew-bouncer-1vu: Homebrew distribution (in_progress)
- brew-bouncer-67l: Native binary — effectively merged into 1vu, can close

## Learnings
- `bun build --compile` cross-compiles trivially: `--target=bun-darwin-x64` downloads the target runtime automatically
- Binary embeds full bun runtime (~58-63MB) — compressed in GitHub release will be smaller
- Homebrew formula for native binary is simpler than source: no `depends_on "bun"`, no `bun install` during install
- Formula generates the `#:` wrapper in `def install` rather than shipping a separate file — cleaner than trying to get the wrapper from the tarball
- GitHub Actions: need separate macOS runners per arch (macos-latest=arm64, macos-13=x64)

## Discovered Work
- brew-bouncer-oct: License file needed before first release
- brew-bouncer-huq: CHANGELOG needed for release validation (currently skipped)
- Future: Linux support — abstract detect/ and restart.ts behind platform interface

## References
- Commando workflow: ~/ws/jdillon/commando/.github/workflows/release.yml
- Commando formula template: ~/ws/jdillon/commando/.github/formula-template.rb
- Tap repo: https://github.com/jdillon/homebrew-planet57
- homebrew-planet57 branch: feat/brew-bouncer

## Cycle Log
### Cycle 1 - 2026-02-15
Started arc. Initial plan was source distribution (commando model).

### Cycle 2 - 2026-02-15
Done: CI workflow, release workflow, formula template, placeholder formula in tap repo
- Pivoted to native binary approach (no bun dependency for users)
- Verified `bun build --compile` works locally for both arm64 and x64
- Created `.github/workflows/ci.yml` (typecheck + test compile)
- Created `.github/workflows/release.yml` (build matrix → release → update tap)
- Created `.github/formula-template.rb` (per-arch URLs + SHA256 placeholders)
- Created `Formula/brew-bouncer.rb` placeholder in homebrew-planet57 on feat/brew-bouncer branch
- Fixed stale `restart` reference in bin/brew-bouncer `#:` help

Next: Commit and push changes in both repos. Need `HOMEBREW_TAP_TOKEN` secret configured on brew-bouncer repo. Then test first release: bump version, tag, push, verify workflow. Also close brew-bouncer-67l since native binary is now part of this bead's CI pipeline.

Notes: Consider whether to add `tmp/` and build artifacts to .gitignore
