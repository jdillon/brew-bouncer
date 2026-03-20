# brew-barback Research: Homebrew TUI/GUI Ecosystem

Research for a potential full terminal UI for Homebrew management, building on brew-bouncer's restart detection logic.

---

## 1. Existing Tools

### TUI Tools

#### taproom
- **URL**: https://github.com/hzqtc/taproom
- **Language**: Go (Bubble Tea + Lip Gloss)
- **Stars**: ~324 | **Last release**: v0.5.0 (Jan 2026) | **Active**
- **Features**: Real-time search, recursive dependency tree, reverse dependents, sort by popularity/size, install/upgrade/uninstall/pin from TUI, cask support, disk usage display
- **Install**: `brew install gromgit/brewtils/taproom`
- **Gaps**: No service management, no restart detection, no upgrade orchestration, no Brewfile support. Requires Nerd fonts.

#### Bold Brew (bbrew)
- **URL**: https://github.com/Valkyrie00/bold-brew
- **Language**: Go
- **Stars**: ~287 | **Last release**: v2.2.1 (Dec 2025) | **Active**
- **Features**: Formulae + cask management, Brewfile mode (local + remote URLs), fuzzy search, smart filters (installed/outdated/leaves/casks), analytics integration, security scanning
- **Notable**: Official Homebrew TUI for Project Bluefin/Aurora Linux desktops
- **Gaps**: No service management, no restart detection, no dependency visualization, no upgrade impact preview

#### BrewSage
- **URL**: https://github.com/gerdreiss/brewsage
- **Language**: Haskell (Brick TUI framework)
- **Stars**: ~8 | **Niche**
- **Features**: Identifies unused formulae (no dependents), offers deletion. TUI mode via `--tui` flag
- **Gaps**: Very narrow scope (orphan cleanup only). Not a general management tool

### GUI Tools

#### Cork
- **URL**: https://github.com/buresdv/Cork | https://corkmac.app
- **Language**: Swift/SwiftUI
- **Stars**: ~4.1k | **Active**
- **Features**: Package listing ~10x faster than brew, intentional vs dependency distinction, selective upgrades, dependency + reverse dependency view, service management via GUI, menu bar updates, package tagging (unique), cached download cleanup
- **Pricing**: Open source (Commons Clause license), compiled version 25 EUR
- **Gaps**: macOS-only GUI (not terminal). No restart detection, no upgrade impact preview

#### Applite
- **URL**: https://github.com/milanvarady/Applite
- **Language**: Swift/SwiftUI
- **Stars**: ~6.4k | **Last release**: v1.3.1 (May 2025)
- **Features**: App-store-like interface for casks only, categories, export/import, greedy upgrade toggle
- **Gaps**: Casks only (no formulae). No service management, no dependencies view. Targets non-technical users

#### Other GUIs
| Tool | Notes |
|------|-------|
| **Cakebrew** | Discontinued. Was the original Homebrew GUI |
| **Brewer X** | Paid commercial GUI. Low visibility |
| **BrewMate** | Electron-based cask manager. Lightweight |
| **WailBrew** | Go/Wails/React. Minimalistic, Cakebrew successor attempt |
| **Brewlet** | Menu bar only. Shows outdated counts |

### Meta-Updaters

#### topgrade
- **URL**: https://github.com/topgrade-rs/topgrade
- **Language**: Rust
- **Stars**: ~10k+ | **Active**
- **Features**: Universal updater (brew, apt, pip, npm, cargo, etc.), dry-run mode, source filtering
- **Relevant**: Runs `brew update && brew upgrade` as one of many sources. No TUI, no package browsing, no restart detection

### Ink-based Brew Tools

**None found.** No existing Ink/React-based TUI for Homebrew management exists on npm or GitHub. This is a clear gap.

---

## 2. TUI Framework Options (Bun/TypeScript)

### Ink (React for CLIs)
- **URL**: https://github.com/vadimdemedes/ink
- **Stars**: ~34.9k | **Version**: 5.x | **Active**
- **Ecosystem**: `@inkjs/ui` (TextInput, Spinner, StatusMessage, etc.), `ink-testing-library`, theming support
- **Notable users**: Claude Code, Gemini CLI, GitHub Copilot CLI, Cloudflare Wrangler, Gatsby CLI, Prisma

**Pros**:
- Massive adoption, battle-tested at scale
- React mental model = huge developer pool, hooks, state management
- Flexbox layout via Yoga (CSS-like positioning)
- Full TypeScript support, `create-ink-app` scaffolding
- Component composition, React DevTools support
- Rich ecosystem of 3rd-party components

**Cons**:
- **Bun compatibility is shaky**: Known issues with `useInput` stdin handling, `readline.close()` breakage, React 19 not supported yet. Claude Code itself runs Ink under Node, not Bun
- Workaround: compile with tsc, run with `node` (defeats the Bun advantage)
- Full VDOM re-render approach (redraws entire terminal including scrollback)
- No native mouse support
- Startup overhead from React runtime

**Bun verdict**: Usable but requires Node.js for execution. Bun-native Ink is not reliable as of Feb 2026.

### Rezi (Ink-compatible, native engine)
- **URL**: https://github.com/RtlZeroMemory/Rezi
- **Stars**: ~46 | **Version**: 0.1.0-alpha.11 (Feb 2026) | **Alpha**
- **Runtime**: Node 18+ or **Bun 1.3+** (first-class)
- **Engine**: TypeScript app layer + native C rendering engine (Zireael)

**Pros**:
- Explicit Bun support
- Ink-compatible API (familiar patterns)
- Performance: ~2-5x from native Rust baseline, ~35x faster than Ink in table rendering benchmarks
- Rich widget set: tables, virtual lists, code editors, diff viewers, file pickers, command palettes
- Minimal redraws via native framebuffer diffing

**Cons**:
- **Alpha software** -- APIs may change between releases
- 46 stars, tiny community, single primary contributor
- Prebuilt native binaries add distribution complexity
- Unproven at scale

**Bun verdict**: Most promising for Bun-native TUI, but too immature to bet a project on today.

### Blessed / neo-blessed
- **URL**: https://github.com/chjj/blessed / https://github.com/embarklabs/neo-blessed
- **Stars**: ~11.7k (blessed) / ~392 (neo-blessed)

**Pros**:
- Extremely feature-rich widget system (buttons, lists, tables, forms, terminals)
- Efficient screen damage buffer rendering (painter's algorithm)
- Full mouse support
- Inspired Go's `termui`

**Cons**:
- **Unmaintained** (blessed last published 10 years ago; neo-blessed gets occasional patches)
- No TypeScript types
- No Bun testing/support
- Widget-based paradigm feels dated vs component composition

**Verdict**: Not recommended for new projects.

### terminal-kit
- **URL**: https://github.com/cronvel/terminal-kit
- **Stars**: ~3.3k | **Active**

**Pros**:
- 256 colors, mouse, input fields, progress bars, screen buffers, image loading
- No ncurses dependency
- Fine-grained terminal control
- Lower-level = more flexibility

**Cons**:
- Procedural API, not declarative
- Limited TypeScript support
- No component model (build everything from primitives)
- No Bun-specific support

**Verdict**: Good for low-level needs, but too much from-scratch work for a full TUI app.

### Charm / Bubble Tea (Go, for comparison)
- **URL**: https://github.com/charmbracelet/bubbletea
- **Stars**: ~30k+ | **Ecosystem**: Lip Gloss, Bubbles, BubbleZone, Harmonica
- **Architecture**: Elm-style MVU (Model-View-Update)
- **Used by**: taproom, chezmoi, trufflehog, AWS eks-node-viewer

**Relevance**: Both taproom and bbrew chose Go + Bubble Tea. It's the dominant TUI framework overall. If brew-barback were written in Go, this would be the obvious choice. But it means forking away from the Bun/TypeScript ecosystem and abandoning code sharing with brew-bouncer.

### Framework Recommendation

For brew-barback in the Bun/TS ecosystem:

1. **Ink (run via Node)** -- pragmatic choice today. Accept the Node runtime for execution, use Bun for everything else (install, test, build). This is what Claude Code does.
2. **Watch Rezi** -- if it reaches beta/1.0 with stable APIs, it could be the ideal Bun-native option.
3. **Alternative**: Write it in Go with Bubble Tea. Better TUI ecosystem, but loses code sharing with brew-bouncer and requires learning Go.

---

## 3. Homebrew API Surface

### Commands with JSON Output

| Command | JSON flag | Returns |
|---------|-----------|---------|
| `brew info <name>` | `--json=v2` | Full formula + cask metadata (versions, deps, license, homepage, artifacts) |
| `brew info --installed` | `--json=v2` | All installed packages with local install details |
| `brew info --eval-all` | `--json=v2` | Every formula + cask in all taps (slow, large) |
| `brew outdated` | `--json` | Outdated formulae + casks with installed/current versions |
| `brew services list` | `--json` | Service name, status, user, plist path |
| `brew services info <name>` | `--json` | Single service details |
| `brew tap-info` | `--json` | Tap metadata |
| `brew livecheck` | `--json` | Upstream version check results |

### Commands Without JSON (parse text or use other approaches)

| Command | Output | Notes |
|---------|--------|-------|
| `brew search <term>` | Text list | No JSON flag; use formulae.brew.sh API instead |
| `brew deps <name>` | Text list | `--tree` for tree view, `--installed` for local only |
| `brew leaves` | Text list | `-r` = manually installed, `-p` = installed as dep |
| `brew list <formula>` | File paths | Shows installed files (useful for binary detection) |
| `brew uses --installed <name>` | Text list | Reverse deps (slow) |
| `brew pin` / `brew unpin` | Status | No JSON |
| `brew autoremove --dry-run` | Text list | Orphaned dependencies |
| `brew doctor` | Diagnostic text | Health check |
| `brew cleanup --dry-run` | Text list | Stale files that would be removed |

### Online API (no local brew needed)

| Endpoint | URL |
|----------|-----|
| All formulae | `https://formulae.brew.sh/api/formula.json` |
| Single formula | `https://formulae.brew.sh/api/formula/<name>.json` |
| All casks | `https://formulae.brew.sh/api/cask.json` |
| Single cask | `https://formulae.brew.sh/api/cask/<name>.json` |
| Analytics | `https://formulae.brew.sh/api/analytics/install/30d.json` (30/90/365d) |

**Key notes**:
- Schema is not formally documented outside `formula.rb` source
- Fields can be added without version bumps
- `--eval-all` is required for non-installed packages when querying locally
- `brew services` now auto-refreshes JSON API data on every call (Homebrew 5+), which can cause unexpected delays

### Already Implemented in brew-bouncer

The existing `src/brew/runner.ts` wraps:
- `brew outdated --greedy --json`
- `brew info --json=v2 <names>`
- `brew list <formula>`
- `brew services list`
- `brew upgrade <packages>`
- `pkgutil --files` (for cask app name resolution)

---

## 4. Feature Gap Analysis

### What brew-barback could uniquely provide

**Restart detection + upgrade orchestration (from brew-bouncer)**
- No existing tool detects which running processes/apps will be affected by upgrades
- No existing tool offers guided restart after upgrade
- This is brew-bouncer's core differentiator and would carry over

**Integrated service management with upgrade awareness**
- taproom/bbrew: no service support
- Cork: has service management but no upgrade-aware restart flow
- Gap: "upgrade postgresql, then restart the service" as a single flow

**Upgrade impact preview**
- Show *before* upgrading: which running apps need restart, which services will be affected, which dependencies will change
- No existing tool does this

**Dependency health dashboard**
- Combine `brew deps --tree`, `brew leaves`, `brew autoremove --dry-run`, and `brew doctor` into a single view
- Identify orphaned deps, broken links, conflicting versions
- taproom has dependency trees but not the health/cleanup angle

**Brewfile diff / drift detection**
- Compare current system state against a Brewfile
- Show what's installed but not in Brewfile (drift), what's in Brewfile but not installed
- bbrew has Brewfile mode but not diff/drift

**Multi-version conflict detection**
- Identify when multiple versions of the same tool are linked
- Detect PATH conflicts between brew-installed and system tools
- Common pain point (multiple Pythons, multiple Gits)

### Common user complaints that existing tools don't address

1. **Blind upgrades**: `brew upgrade` upgrades everything with no preview of impact. Users want per-package control with clear consequences
2. **Service restart amnesia**: After upgrading redis/postgres/nginx, users forget to restart services. No tool connects "upgraded package" to "running service needs restart"
3. **Auto-update hijacking**: `brew install foo` triggers full update. No TUI offers install-without-update
4. **Dependency confusion**: Hard to understand why a package is installed, what depends on it, whether it's safe to remove
5. **Post-upgrade caveats get buried**: brew prints caveats during upgrade scrollback. No tool surfaces them after the fact

---

## 5. Architecture Sketch

### Relationship to brew-bouncer

**Option A: Monorepo with shared packages** (recommended)
```
brew-workspace/
  packages/
    brew-core/        # Shared: runner, parser, detect logic, types
    brew-bouncer/     # CLI tool (commander-based, current code)
    brew-barback/     # TUI app (Ink-based)
  package.json        # Bun workspace root
```
- Extract `src/brew/` and `src/detect/` into `brew-core`
- Both tools import from `brew-core`
- brew-bouncer stays as-is for quick CLI usage
- brew-barback is the interactive TUI

**Option B: brew-barback imports brew-bouncer as dependency**
- Less refactoring upfront
- Tighter coupling, harder to evolve independently

**Option C: Separate repo, copy shared code**
- Simple but code diverges over time

### Core Views / Screens

```
Main Dashboard
  +-- Package Browser (formulae + casks)
  |     +-- Search / filter / sort
  |     +-- Detail panel (info, deps, dependents, versions)
  |     +-- Actions: install, uninstall, pin/unpin
  |
  +-- Upgrade Center
  |     +-- Outdated list with version diff
  |     +-- Impact preview (running apps, services affected)
  |     +-- Selective upgrade with restart orchestration
  |     +-- Post-upgrade caveats summary
  |
  +-- Services Panel
  |     +-- Status list (running/stopped/error)
  |     +-- Start/stop/restart actions
  |     +-- Log viewer
  |
  +-- Health / Maintenance
  |     +-- Dependency tree browser
  |     +-- Orphan detection (autoremove candidates)
  |     +-- Doctor output
  |     +-- Cleanup preview
  |     +-- Brewfile drift (if Brewfile exists)
  |
  +-- Tap Manager
        +-- List taps, add/remove
        +-- Show tap formula counts
```

### Data Flow

```
                    +-----------+
                    | brew CLI  |  (shell out to /opt/homebrew/bin/brew)
                    +-----+-----+
                          |
                    +-----v-----+
                    | brew-core |  runner.ts, parser.ts (typed JSON parsing)
                    +-----+-----+
                          |
              +-----------+-----------+
              |                       |
        +-----v-----+          +-----v-----+
        |  detect/   |          |  state    |  (cached package list, services,
        |  matcher   |          |  store    |   process snapshots)
        +-----+-----+          +-----+-----+
              |                       |
              +-----------+-----------+
                          |
                    +-----v-----+
                    |  Ink App  |  React components, hooks, views
                    +-----------+
```

### Key Technical Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Framework | Ink 5 + React 18 | Proven at scale, largest ecosystem |
| Runtime | Bun for install/test, Node for execution | Ink + Bun stdin bugs are unresolved |
| State | React context + useReducer | Sufficient for TUI complexity, no external lib needed |
| Data refresh | Poll on focus / manual refresh key | Avoid constant brew subprocess spawning |
| Layout | Tab-based navigation between views | Standard TUI pattern, keeps mental model simple |
| Packaging | Bun compile to standalone binary (if possible) or npm/brew distribution | Single binary ideal for Homebrew users |

---

## Summary

The Homebrew TUI space has two active competitors (taproom and bbrew), both written in Go. Neither handles service management, restart detection, or upgrade impact analysis. The GUI space (Cork, Applite) serves different audiences (native macOS users vs terminal users).

brew-barback's core differentiator would be **upgrade-aware restart orchestration** -- the brew-bouncer logic surfaced through an interactive TUI. Combined with a dependency health dashboard and service management, it would be the most complete terminal-based Homebrew management tool.

The framework choice comes down to: **Ink (proven, run via Node)** vs **Go + Bubble Tea (better TUI ecosystem, lose TS code sharing)**. Ink is the pragmatic path if Jason wants to reuse brew-bouncer logic and stay in the TypeScript ecosystem.
