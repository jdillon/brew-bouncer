# Desktop Framework Research: TypeScript/React-like for macOS

Research into frameworks for building native macOS desktop applications (especially menubar extras) using TypeScript or React-like patterns. Conducted February 2026.

---

## Table of Contents

- [Terminology: Menubar Extras vs System Tray](#terminology-menubar-extras-vs-system-tray)
- [Framework Comparison Matrix](#framework-comparison-matrix)
- [Detailed Framework Analysis](#detailed-framework-analysis)
  - [Tauri v2](#1-tauri-v2)
  - [Electron](#2-electron)
  - [Electrobun](#3-electrobun)
  - [React Native for macOS](#4-react-native-for-macos)
  - [Wails](#5-wails)
  - [Swift / SwiftUI (native)](#6-swift--swiftui-native)
  - [Flutter Desktop](#7-flutter-desktop)
  - [Neutralinojs](#8-neutralinojs)
  - [Capacitor](#9-capacitor)
- [Menubar-Specific Resources](#menubar-specific-resources)
- [Recommendations](#recommendations)

---

## Terminology: Menubar Extras vs System Tray

This distinction matters. "System tray" is a Windows concept. macOS calls its equivalent **Menu Bar Extras** -- the icons in the upper-right of the menu bar, next to the clock.

Under the hood, there are two macOS APIs:

| API | Type | Notes |
|-----|------|-------|
| **NSStatusItem** (public) | Status bar item | The recommended, documented API. Icons appear in the right side of the menu bar. Can show menus (NSMenu) or custom views (NSPopover/NSWindow). |
| **NSMenuExtra** (private) | Menu extra | Apple-internal only. Supports Cmd-drag reordering and runs inside SystemUIServer. **Not available to third-party apps.** |

For third-party developers, **NSStatusItem is the only supported path**. All cross-platform frameworks that claim "menubar" or "system tray" support are ultimately creating an NSStatusItem on macOS.

SwiftUI added a first-party **`MenuBarExtra`** scene type in macOS Ventura (13+), which wraps NSStatusItem in a declarative API. This is the closest thing to a blessed native approach for menubar-only apps.

**What "true menubar extra" means for this research**: An app that lives exclusively (or primarily) in the menu bar with no Dock icon, displays a popover or menu on click, and optionally runs as an LSUIElement (agent app). All frameworks below are evaluated against this use case.

---

## Framework Comparison Matrix

| Framework | Language | Renderer | Bundle Size | Menubar Support | Native Feel | Maintenance | Community |
|-----------|----------|----------|-------------|-----------------|-------------|-------------|-----------|
| **Tauri v2** | Rust + TS frontend | WKWebView (system) | 3-10 MB | System tray + popover window | WebView UI, native chrome | Active (v2.10+) | ~100k GH stars |
| **Electron** | Node.js + TS | Bundled Chromium | 115-200 MB | `menubar` npm package | WebView UI, native chrome | Active (v34+) | ~115k GH stars |
| **Electrobun** | Bun + TS | WebKit (system) | ~12-14 MB | Tray + menus via native bindings | WebView UI, native chrome | Active (v1) | New/small |
| **React Native macOS** | TS/JS + native modules | AppKit (native) | 30-60 MB (est.) | `react-native-menubar-extra` | **True native widgets** | Active (Microsoft) | ~3.5k GH stars (macOS fork) |
| **Wails** | Go + TS frontend | WebKit (system) | 5-15 MB | v3 alpha: system tray | WebView UI, native chrome | Active (v3 alpha) | ~26k GH stars |
| **SwiftUI** | Swift | Native AppKit | < 5 MB | `MenuBarExtra` scene (built-in) | **Fully native** | Apple-maintained | N/A (platform SDK) |
| **Flutter Desktop** | Dart | Custom Impeller/Skia | 20-40 MB | Community plugins only | Custom rendering | Active (3.38+) | ~170k GH stars (Flutter overall) |
| **Neutralinojs** | JS/TS | System WebView | 2-5 MB | **Broken on macOS** | WebView UI | Single maintainer | ~7k GH stars |
| **Capacitor** | TS (Ionic) | N/A for desktop | N/A | N/A | N/A | No desktop support | N/A |

---

## Detailed Framework Analysis

### 1. Tauri v2

**Stack**: Rust backend + any web frontend (React, Vue, Svelte, Solid, etc.) via TypeScript
**Renderer**: System native WebView (WKWebView on macOS)
**Latest**: v2.10.2 (Feb 2026), stable since Oct 2024

#### Strengths

- **Tiny bundles**: 3-10 MB typical, as low as 600 KB for minimal apps. The Authme app ships a 2.5 MB installer vs 85 MB on Electron.
- **Low memory**: 30-40 MB idle vs Electron's 200-300 MB.
- **Fast startup**: Under 500ms consistently vs 1-2s for Electron.
- **Security-first**: Access Control Lists for IPC, independently audited by Radically Open Security.
- **Mobile too**: v2 added iOS and Android from the same codebase.
- **System tray API**: Full tray support from both Rust and TypeScript, including macOS template icons, menu attachment, click events, and tooltip management.
- **Menubar app pattern**: Community examples exist for macOS menubar/popover apps using tray + positioned window ([ahkohd/tauri-macos-menubar-app-example](https://github.com/ahkohd/tauri-macos-menubar-app-example), [4gray/tauri-menubar-app](https://github.com/4gray/tauri-menubar-app)).

#### Weaknesses

- **Rust knowledge needed** for anything beyond plugin APIs. Most projects can avoid Rust, but complex native integrations will require it.
- **WebView inconsistencies**: Uses system WebView, so rendering can differ across OS versions. No guaranteed Chromium consistency.
- **Ecosystem smaller than Electron**: Core plugins cover auto-updates, notifications, filesystem, storage, but Electron's ecosystem is still deeper and more battle-tested.
- **Menubar apps require manual wiring**: No first-class "menubar app" template. You configure a tray icon + hidden window + positioning logic yourself.

#### Bun Compatibility

- Bun supported as package manager since Tauri 1.5.
- Bun works as frontend bundler (via Vite/etc.), though occasional edge-case bugs reported.
- Bun as backend runtime replacement for Rust: **not supported**. If JS backend is ever added, the team has said it would more likely be Deno (Rust-based).

#### Notable Apps

Aptakube (Kubernetes client), Yaak (API client), Pake (webpage wrapper), EcoPaste (clipboard manager), Yume (Claude Code GUI), Cinny Desktop (Matrix client).

#### Links

- [Tauri v2 docs](https://v2.tauri.app/)
- [System tray API](https://v2.tauri.app/learn/system-tray/)
- [GitHub](https://github.com/tauri-apps/tauri) (~100k stars)

---

### 2. Electron

**Stack**: Node.js + Chromium + any web framework via TypeScript
**Renderer**: Bundled Chromium
**Latest**: v34+ (actively maintained, releases every ~8 weeks)

#### Strengths

- **Battle-tested**: Powers VS Code, Slack, Discord, Figma Desktop, Notion, Obsidian, Signal, Postman, ChatGPT, Claude desktop, GitHub Desktop.
- **Largest ecosystem**: Mature tooling (electron-builder, electron-forge), huge npm ecosystem.
- **Guaranteed rendering consistency**: Bundles Chromium, so no cross-platform WebView quirks.
- **`menubar` npm package**: High-level abstraction for menubar apps. Point it at an `index.html` and it handles window positioning, tray icon, show/hide. v9.5.2, ~2,750 weekly downloads, BSD-2-Clause.
- **Proven menubar pattern**: Many production menubar apps built with Electron (e.g., Menubar-based utilities, clipboard managers).
- **Governance**: Maintained by Microsoft, Slack/Salesforce, Notion, and others via OpenJS Foundation.

#### Weaknesses

- **Massive bundles**: 115-200 MB for a Hello World. Optimized builds can get to ~45-60 MB, but you cannot eliminate the Chromium overhead.
- **High memory**: 200-300 MB idle.
- **Slow startup**: 1-2 seconds typical.
- **"Bloatware" perception**: Users and developers increasingly push back on Electron apps for simple utilities.

#### Bun Compatibility

Electron uses its own bundled Node.js. You cannot swap in Bun as the runtime. You can use Bun for development tooling (bundling, package management) but the production runtime is always Electron's Node.js.

#### Menubar-Specific

The [`menubar`](https://github.com/max-mapper/menubar) package is the standard approach:
- Works on macOS, Windows, Linux
- Configurable BrowserWindow options
- `preloadWindow` option for faster show on click
- 20x20 PNG icon (40x40 @2x for Retina)
- Last published ~Oct 2025 (v9.5.2)

#### Links

- [Electron](https://www.electronjs.org/)
- [`menubar` on npm](https://www.npmjs.com/package/menubar)
- [GitHub](https://github.com/electron/electron) (~115k stars)

---

### 3. Electrobun

**Stack**: Bun runtime + TypeScript + native bindings (C++, Objective-C, Zig)
**Renderer**: System WebView (WebKit on macOS), optional CEF (Chromium)
**Latest**: v1 (early 2026)

This is the newest entrant and the most directly relevant to a Bun-based TypeScript developer.

#### Strengths

- **TypeScript-first, Bun-native**: Main process runs on Bun. No Rust, no Node.js. Pure TypeScript for both main process and UI.
- **Tiny bundles**: ~12-14 MB compressed (90%+ smaller than Electron). Most of the size is the Bun runtime itself.
- **Fast startup**: Under 50ms cold start vs 2-5s for Electron.
- **Tiny updates**: Custom BSDIFF (SIMD-optimized, written in Zig) produces update patches as small as 14 KB.
- **Native tray + menus**: System tray, app menus, and context menus are implemented in C++/Objective-C native bindings.
- **Typed IPC**: End-to-end typed RPC between Bun main process and webview.

#### Weaknesses

- **Very new**: v1 just shipped. Ecosystem is essentially nonexistent compared to Electron or Tauri.
- **Single company backing**: Built by Blackboard.sh to power their own product (co(lab)).
- **Documentation sparse**: Early-stage docs.
- **Menubar app pattern**: Tray support exists in the API, but no dedicated menubar app template or examples (yet).
- **Small community**: Minimal third-party usage so far.

#### Bun Compatibility

**This IS the Bun framework.** Bun is the runtime, bundler, and package manager. First-class Bun support is the entire point.

#### Links

- [Electrobun docs](https://blackboard.sh/electrobun/docs/)
- [GitHub](https://github.com/blackboardsh/electrobun)

---

### 4. React Native for macOS

**Stack**: TypeScript/JavaScript + native AppKit modules
**Renderer**: **Native AppKit widgets** (not a WebView)
**Latest**: Tracks React Native releases (0.76-0.77+), maintained by Microsoft

#### Strengths

- **True native rendering**: Maps React components to AppKit views. Your app IS a native macOS app with native text rendering, native scrolling, native accessibility. This is the only framework here (besides SwiftUI) that uses actual native widgets.
- **React paradigm**: If you know React, you know React Native. JSX, hooks, state management, all the patterns transfer.
- **Microsoft-backed**: Used in production for Office apps (Word, Excel, Outlook) across macOS and Windows. Active development team.
- **Menubar support via `react-native-menubar-extra`**: Declarative JSX components for NSMenu-based menubar items. Supports SF Symbols for icons, keyboard shortcuts, and nested menus.
- **NSPopover approach**: For richer menubar UIs, you can configure NSPopover + NSStatusItem directly in the native AppDelegate, rendering full React Native views inside the popover.
- **New Architecture**: TurboModules and Fabric renderer are now default, improving startup time and memory usage.
- **Hermes engine**: 15-25% smaller binaries, 30-50% faster launch times.

#### Weaknesses

- **macOS is a secondary platform**: Most React Native library authors target iOS/Android. Many popular packages don't support macOS, or use UIKit instead of AppKit.
- **Smaller macOS community**: The macOS fork has ~3.5k stars vs React Native's 120k+. Finding macOS-specific help is harder.
- **Bundle size**: Larger than Tauri (estimated 30-60 MB) due to Hermes engine and framework overhead, though much smaller than Electron.
- **Native module bridging**: Custom native features require writing Objective-C or Swift bridge code.
- **Learning curve for native parts**: The menubar setup requires understanding AppDelegate, NSStatusItem, and NSPopover at the native level.

#### Bun Compatibility

React Native uses Metro bundler. Bun is not supported as the runtime or bundler for React Native projects.

#### Notable macOS Apps

Microsoft Office (Word, Excel, Outlook -- partial RN usage), Microsoft Teams components, various internal Microsoft tools.

#### Menubar-Specific

[`react-native-menubar-extra`](https://github.com/okwasniewski/react-native-menubar-extra) by Oskar Kwasniewski:
- Declarative JSX: `<MenubarExtraView icon="car">` with `<MenuBarExtraItem>` children
- SF Symbol icons
- Keyboard shortcuts (`keyEquivalent` + `keyEquivalentModifiers`)
- NSMenu-based (follows macOS appearance automatically)
- For custom popover UI: configure NSPopover in native AppDelegate code

Also see: [rn-macos-menubar example](https://github.com/okwasniewski/rn-macos-menubar) -- full menubar-only app template.

#### Links

- [React Native macOS](https://microsoft.github.io/react-native-macos/)
- [GitHub](https://github.com/microsoft/react-native-macos)

---

### 5. Wails

**Stack**: Go backend + any web frontend (React, Vue, Svelte, etc.) via TypeScript
**Renderer**: System native WebView (WebKit on macOS)
**Latest**: v2 stable, **v3 in alpha** (as of Feb 2026)

#### Strengths

- **Single binary**: Go + web frontend compiled into one executable.
- **Native webview**: No bundled browser. Small binaries.
- **v3 system tray**: Robust tray support with window attachment, adaptive light/dark icons, and comprehensive menus.
- **In-memory IPC**: No network ports, clean Go-to-frontend communication.
- **Go ecosystem**: Full access to Go's stdlib and packages for backend logic.

#### Weaknesses

- **v3 still alpha**: The good stuff (system tray, improved menus) is in v3, which has been in alpha for years with no announced stable date. v2 has limited tray support.
- **Go, not TypeScript**: Backend is Go, not TypeScript. If the goal is all-TypeScript, this is a mismatch.
- **Smaller community**: ~26k GitHub stars. Active but much smaller than Tauri or Electron.
- **macOS menu is v3 only**: Application menu is macOS-only in v3, reflecting a platform-specific approach.

#### Bun Compatibility

Frontend can use any bundler, so Bun-based Vite setups should work. Backend is Go -- Bun is irrelevant there.

#### Links

- [Wails v3 alpha](https://v3alpha.wails.io/)
- [GitHub](https://github.com/wailsapp/wails)

---

### 6. Swift / SwiftUI (native)

**Stack**: Swift, SwiftUI + AppKit
**Renderer**: Fully native
**Latest**: macOS 26 / Xcode 18 (WWDC 2025)

Included because it's the gold standard for macOS menubar apps.

#### Strengths

- **`MenuBarExtra` scene**: Built into SwiftUI since macOS Ventura (13+). Two styles:
  - `.menu` -- native pull-down menu, limited to text/buttons/dividers
  - `.window` -- arbitrary SwiftUI views in a popover (sliders, custom UI, etc.)
- **Smallest possible bundle**: A menubar utility can be < 5 MB.
- **Fully native**: Perfect macOS integration. Accessibility, appearance modes, system font, HIG compliance all come free.
- **Agent app support**: Set `LSUIElement = YES` to hide from Dock. Standard pattern for menubar-only apps.
- **Apple-maintained**: Will always be current with the latest macOS.

#### Weaknesses

- **Not TypeScript/React**: Requires learning Swift and SwiftUI. Different paradigm.
- **macOS only**: No cross-platform story (without Catalyst or separate iOS/Android codebases).
- **MenuBarExtra limitations**: The `.window` style doesn't fade on dismiss like native menus. `SettingsLink` doesn't work reliably from MenuBarExtra. Opening Settings requires "hidden windows, activation policy juggling, and precise timing delays" -- menu bar apps remain "second-class citizens in SwiftUI" as of 2025.
- **[FluidMenuBarExtra](https://github.com/lfroms/fluid-menu-bar-extra)**: Third-party library that fixes many `MenuBarExtra` rough edges. Drop-in replacement with better animations and behavior.

#### TypeScript Bridges

- **[NodeSwift](https://github.com/aspect-build/aspect-cli)**: Bridge between Node.js and Swift. Discussed on HN (June 2024) but not widely adopted.
- **[TypeSwift](https://github.com/TypeSwift/TypeSwift)**: Code generation for TypeScript-Swift interop. Niche project.
- **WKWebView bridge**: Pragmatic approach -- run TypeScript business logic in a hidden WKWebView, use Swift/SwiftUI for the native UI layer. This gives you native rendering with TypeScript logic.

#### Links

- [SwiftUI MenuBarExtra docs](https://developer.apple.com/documentation/swiftui/menubarextra)
- [Build a macOS menu bar utility in SwiftUI](https://nilcoalescing.com/blog/BuildAMacOSMenuBarUtilityInSwiftUI/)
- [FluidMenuBarExtra](https://github.com/lfroms/fluid-menu-bar-extra)

---

### 7. Flutter Desktop

**Stack**: Dart (not TypeScript)
**Renderer**: Custom rendering engine (Impeller, formerly Skia)
**Latest**: Flutter 3.38+ (Nov 2025)

#### Strengths

- **Rich custom UI**: Flutter draws its own pixels, so you get consistent rendering everywhere.
- **`PlatformMenuBar` widget**: Built-in native macOS menu bar support.
- **Impeller renderer**: 40% lower CPU usage than Skia. Stable since Flutter 3.38.
- **Large community**: ~170k GitHub stars for Flutter overall.

#### Weaknesses

- **Not TypeScript**: Dart. Different language, different ecosystem. If the goal is TypeScript, Flutter is out.
- **No native widgets**: Flutter renders everything with its own engine. macOS apps look "Flutter-ish" unless you explicitly use Cupertino widgets, and even then it's an approximation.
- **System tray is community-only**: `tray_manager` and `system_tray` packages exist but are not first-party. `tray_manager` is being migrated to `nativeapi-flutter`.
- **Bundle size**: 20-40 MB typical for desktop.
- **Desktop is secondary**: Flutter's primary focus is mobile. Desktop support is stable but gets less attention.

#### Links

- [Flutter desktop](https://flutter.dev/multi-platform/desktop)
- [PlatformMenuBar](https://api.flutter.dev/flutter/widgets/PlatformMenuBar-class.html)
- [tray_manager](https://pub.dev/packages/tray_manager)

---

### 8. Neutralinojs

**Stack**: JavaScript/TypeScript + C++ runtime
**Renderer**: System native WebView
**Latest**: v6.4.0

#### Strengths

- **Tiny binaries**: 2-5 MB.
- **Simple API**: Straightforward for basic apps.

#### Weaknesses

- **macOS tray is broken**: `os.setTray()` does not work on macOS. This is documented in open issues going back years.
- **No macOS menubar**: `window.setMainMenu` was added in v6.1.0 but full macOS NSMenu integration is incomplete.
- **Single maintainer**: Essentially a hobby project with little financial support.
- **Security concerns**: Falls short of what's needed for native app distribution.
- **Uses `zserge/tray`**: Underlying C library has known macOS limitations.

**Verdict: Not viable for macOS menubar apps.**

#### Links

- [Neutralinojs](https://neutralino.js.org/)
- [GitHub](https://github.com/neutralinojs/neutralinojs) (~7k stars)

---

### 9. Capacitor

**Stack**: TypeScript/JavaScript (Ionic)
**Renderer**: WKWebView (iOS), Android WebView
**Latest**: Capacitor 8 (2025), ~930k weekly npm downloads

**Capacitor does not support macOS or desktop platforms.** Its focus is iOS, Android, and PWA. There's no official desktop target. The community workaround is to pair Capacitor's web code with Electron or Tauri for desktop, but at that point you're just using Electron or Tauri.

**Verdict: Not applicable for macOS apps.**

#### Links

- [Capacitor](https://capacitorjs.com/)

---

## Menubar-Specific Resources

### Templates and Examples

| Resource | Framework | What it does |
|----------|-----------|-------------|
| [`menubar` npm](https://www.npmjs.com/package/menubar) | Electron | Drop-in menubar app boilerplate |
| [tauri-macos-menubar-app-example](https://github.com/ahkohd/tauri-macos-menubar-app-example) | Tauri v2 | Popover-style menubar app (React + TS) |
| [tauri-menubar-app](https://github.com/4gray/tauri-menubar-app) | Tauri | Minimal menubar with system tray API |
| [rn-macos-menubar](https://github.com/okwasniewski/rn-macos-menubar) | React Native macOS | Full menubar-only app template |
| [react-native-menubar-extra](https://github.com/okwasniewski/react-native-menubar-extra) | React Native macOS | NSMenu-based declarative menubar items |
| [FluidMenuBarExtra](https://github.com/lfroms/fluid-menu-bar-extra) | SwiftUI | Polished MenuBarExtra replacement |

### Menubar App Architecture Pattern

Regardless of framework, building a macOS menubar app follows this pattern:

1. Create an **NSStatusItem** (via framework abstraction) with an icon
2. On click, show either:
   - **NSMenu** -- native dropdown menu (simple, follows macOS appearance)
   - **NSPopover** -- floating panel with custom content (richer UI)
   - **NSWindow** -- positioned below the status item (most flexible)
3. Set **LSUIElement = YES** in Info.plist to hide from Dock
4. Run as an agent app (no Dock icon, no app switcher entry)

---

## Recommendations

### For a macOS menubar app specifically

**If native feel matters most**: SwiftUI with `MenuBarExtra` (or FluidMenuBarExtra). Smallest bundle, best integration, least friction for a menubar-only utility. Trade-off: not TypeScript, macOS only.

**If TypeScript is a hard requirement and bundle size matters**: Tauri v2. Proven system tray support, ~5 MB bundles, active community with menubar app examples. Trade-off: menubar pattern requires manual assembly (tray + window positioning), and Rust is needed for deep native integrations.

**If TypeScript + Bun + bleeding edge is appealing**: Electrobun. Built specifically for this use case (TypeScript + Bun + native bindings). Tray and menu APIs exist. Trade-off: brand new, tiny community, unproven in production beyond the creator's own app.

**If React paradigm + native widgets matter**: React Native macOS. The only option that renders actual AppKit views (not WebView). `react-native-menubar-extra` provides declarative JSX for menubar items. Trade-off: macOS ecosystem is small, many RN libraries don't support macOS, and native AppDelegate work is needed for popover-style UIs.

**If proven at scale + ecosystem depth matter most**: Electron. The `menubar` package makes it trivial. Trade-off: 100+ MB bundle for what might be a simple utility. Users notice.

### What I would NOT use

- **Neutralinojs**: macOS tray is broken, single maintainer, not production-grade.
- **Capacitor**: No desktop support at all.
- **Flutter**: Wrong language (Dart), system tray is community-only, desktop is secondary.
- **Wails**: Good framework but v3 (with tray support) has been alpha for years. Also Go, not TypeScript.

---

## Sources

- [Tauri v2 System Tray docs](https://v2.tauri.app/learn/system-tray/)
- [Tauri v2 Stable Release announcement](https://v2.tauri.app/blog/tauri-20/)
- [Tauri vs Electron (Hopp blog)](https://www.gethopp.app/blog/tauri-vs-electron)
- [Electron vs Tauri (DoltHub, Nov 2025)](https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/)
- [`menubar` npm package](https://www.npmjs.com/package/menubar)
- [React Native macOS (Microsoft)](https://microsoft.github.io/react-native-macos/)
- [`react-native-menubar-extra`](https://github.com/okwasniewski/react-native-menubar-extra)
- [Creating a macOS MenuBar app with React Native (Oskar Kwasniewski)](https://www.oskarkwasniewski.dev/blog/create-react-native-macos-menubar-app)
- [Electrobun docs](https://blackboard.sh/electrobun/docs/)
- [Electrobun GitHub](https://github.com/blackboardsh/electrobun)
- [Wails v3 alpha](https://v3alpha.wails.io/)
- [SwiftUI MenuBarExtra tutorial](https://nilcoalescing.com/blog/BuildAMacOSMenuBarUtilityInSwiftUI/)
- [FluidMenuBarExtra](https://github.com/lfroms/fluid-menu-bar-extra)
- [NSStatusBar Apple docs](https://developer.apple.com/documentation/appkit/nsstatusbar)
- [Menu extra (Wikipedia)](https://en.wikipedia.org/wiki/Menu_extra)
- [Tauri community examples: menubar](https://github.com/ahkohd/tauri-macos-menubar-app-example)
- [Neutralinojs macOS tray issue](https://github.com/neutralinojs/neutralinojs/issues/962)
- [Flutter tray_manager](https://pub.dev/packages/tray_manager)
- [awesome-tauri](https://github.com/tauri-apps/awesome-tauri)
- [Made with Tauri](https://madewithtauri.com/)
- [Showing Settings from macOS Menu Bar Items (Peter Steinberger, 2025)](https://steipete.me/posts/2025/showing-settings-from-macos-menu-bar-items)
