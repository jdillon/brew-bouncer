# brew bouncer uninstall — with AppCleaner handoff

> jdillon / Claude — 2026-08-06 — branch: main (feature branch TBD)
>
> Disposal: delete after the feature merges. Durable parts belong in
> `docs/brew-integration.md` and the PR body.
>
> Status: plan only. Not executed.

## Context

`brew uninstall --cask X` deletes the `.app` with `rm -rf` — never the Trash. Verified in
`/opt/homebrew/Library/Homebrew/cask/artifact/moved.rb` (`delete()` → `Cask::Utils.gain_permissions_remove`
→ `FileUtils.rm_r`, `cask/utils.rb:56`). AppCleaner's leftover detection has two entry points and
both need the bundle to still exist:

- the **SmartDelete** login-item agent (`/Applications/AppCleaner.app/Contents/Library/LoginItems/AppCleaner SmartDelete.app`,
  running as launchd label `net.freemacsoft.AppCleaner-SmartDelete`), which FSEvents-watches the Trash
  ("Started monitoring trashes") and prompts when an app lands there;
- the main app, which accepts app paths via `application:openFiles:` / `CFBundleDocumentTypes = public.directory`.

Because brew never trashes the bundle, SmartDelete never fires on a brew uninstall. Leftovers are only
removed if the cask has a `zap` stanza *and* the user remembered `--zap`. So today:
`brew uninstall --cask foo` leaves `~/Library/{Caches,HTTPStorages,Preferences,Saved Application State}` junk behind.

Goal: a `brew bouncer uninstall` command that quits what's running, hands the still-present bundle to
AppCleaner for review, then lets brew finish the removal and bookkeeping.

## Research

### AppCleaner integration surface

- No CLI, no URL scheme, no AppleScript dictionary (no `.sdef` in the bundle).
- `Contents/MacOS/achelper` is a privileged helper with `trash file...`, `restore src dst`, `cleanold`.
  Requires authorization; not a usable integration point.
- The usable hook is `open -a AppCleaner <bundle path>` — verified working: it populated AppCleaner's
  list for `/Applications/Latest.app` (app + Caches + HTTPStorages + binarycookies + prefs) with
  Cancel / Remove buttons. Nothing was removed during research.
- SmartDelete is an alternative passive route (trash the app ourselves, let the agent prompt), rejected
  because it depends on a user preference being enabled and on driving Finder.

### What `--zap` actually does

- `--zap` runs the cask's `zap` stanza through the same directive pipeline as `uninstall`:
  `ORDERED_DIRECTIVES = [early_script, launchctl, quit, signal, login_item, kext, script, pkgutil, delete, trash, rmdir]`
  (`cask/artifact/abstract_uninstall.rb:20`); `zap.rb` just calls `dispatch_uninstall_directives`.
- Homebrew's own warning: *"Remove all files associated with a cask. May remove files which are shared
  between applications."* (`cmd/uninstall.rb:26`).
- `--zap` is cask-only (`conflicts "--formula", "--zap"`), and requires the cask be installed unless `--force`.
- Coverage on this machine (measured via `brew info --json=v2 --cask $(brew list --cask)`):
  **95 of 101** installed casks have a `zap` stanza. Directive usage inside those: `trash` ×94,
  `rmdir` ×12, `delete` ×3, `launchctl` ×2, `pkgutil` ×1. So zap is mostly *Trash*, i.e. recoverable.
  The 6 without: five nerd-font casks and `netbird-ui`.
- Overlap with AppCleaner is high but not total. For `latest`, zap lists exactly the 5 paths AppCleaner
  found. AppCleaner's added value is heuristic discovery (bundle-id/name matching beyond the maintainer's
  curated list) plus a human review UI. Both, not either.

### Decisions taken

- Mechanism: explicit `open -a AppCleaner <bundle path>` **before** brew removes the artifact.
- `--zap`: shown in the preview, prompted, default yes (mirrors the existing restart/quarantine policy prompts).
- Scope: casks and formulae; the AppCleaner handoff applies only to casks with an `app` artifact.

## Unresolved — supervised probe required first

Two behaviours were observed but not pinned down during research. Jason supervises; **no Remove clicks**,
target apps are read-only probes.

| # | Question | Probe | Pass criteria |
|---|---|---|---|
| P1 | Cold-launch race: the first `open -a AppCleaner <path>` after a cold start showed the empty "Drop your apps here" window; a second, warm invocation populated the list. | Quit AppCleaner. `open -a AppCleaner` (no args), sleep ~2s, then `open -a AppCleaner /Applications/Latest.app`. Screenshot. Repeat cold-with-arg 3× to see how often it drops the path. | Determines whether the implementation needs a warm-up launch + retry, or a single call suffices. |
| P2 | Multi-path handoff: `open -a AppCleaner A.app B.app` produced an unread "Cannot remove…" modal. Cause unknown — plausibly a running/protected app, plausibly multi-file is unsupported. | Quit AppCleaner, quit both target apps first, then pass two quit apps. Read the alert text (screenshot; the accessibility dump returned `missing value`). | Decides batch vs one-app-at-a-time. Assume one-at-a-time if unclear. |
| P3 | Completion signal: AppCleaner is fire-and-forget; no exit code, no scripting dictionary. | Observe whether the bundle path disappears when Remove is clicked, on a throwaway `.app` copy in `/tmp` — not a real install. | Decides poll-for-bundle-gone vs a plain "press enter when done" gate. |

Probe artifacts go in `tmp/2026-08-06-appcleaner-probe/` (gitignored; `win.png`, `win2.png`, `win3.png`
from the research session are already there).

Fallbacks if a probe fails: P1 → always warm-launch then send, verify by re-sending once; P2 → loop
one app per invocation; P3 → gate on user input rather than polling.

## Implementation

New command `bouncer uninstall <packages...>`, wired in `src/index.ts` alongside `upgrade` / `status`.

Flow (`src/commands/uninstall.ts` — new, mirrors the shape of `src/commands/upgrade.ts`):

1. **Resolve** — `brewInfoJson(names)` (`src/brew/runner.ts`) → reuse `parseBrewInfo` (`src/brew/parser.ts`)
   to split casks from formulae and read each cask's `app` artifact `target` (the absolute bundle path,
   e.g. `{"app": ["Latest.app"], "target": "/Applications/Latest.app"}`) and its `zap` directives.
2. **Detect** — reuse `detectRunningUpgrades` / `DetectedApp` (`src/detect/matcher.ts`) to find what is
   running. Same machinery the upgrade path uses; no new detection code.
3. **Preview** — reuse `renderPackageTable` / `renderSkipped` / `renderSummary` (`src/output/format.ts`).
   Add a zap-paths section listing the cask's `zap.trash` / `delete` entries so the user sees what `--zap`
   would take.
4. **Confirm** — reuse the `promptChoice` helpers in `src/prompt.ts`; add `confirmUninstall`
   (yes/no/select, same shape as `confirmUpgrade`) and a `confirmZap` policy prompt (yes/ask/no).
   New config keys under `promptDefaults` in `src/config.ts`: `uninstall` (`ConfirmChoice`) and
   `zapPolicy` (`PolicyChoice`) — extend `validatePromptDefaults`, do not invent a parallel mechanism.
5. **Quit** — reuse the quit half of `restartGuiApp` (`src/restart.ts:33`). That logic — osascript quit,
   poll detected PIDs, SIGTERM escalation with bundle-path re-verification — is exactly what is needed
   and must not be duplicated. Extract it into an exported `quitApp(app: DetectedApp): Promise<boolean>`
   and have `restartGuiApp` call it, so the restart path keeps one implementation.
6. **AppCleaner handoff** (`src/appcleaner.ts` — new, small):
   - `isAvailable()`: check `/Applications/AppCleaner.app` exists; log-and-skip if not.
   - `handoff(bundlePaths: string[])`: `Bun.spawn(["open", "-a", "AppCleaner", ...paths])`, shaped by
     the P1/P2 probe results. Non-zero exit → warn and continue; the handoff is advisory, never fatal.
   - `waitForRemoval(bundlePath)`: poll for the bundle to disappear, deadline ~120s, or an enter-gate
     per P3. Timeout is not an error — brew's uninstall handles a still-present bundle fine.
7. **Uninstall** — `execStreaming(["uninstall", "--cask", ...])` so brew owns the terminal (the existing
   per-package passthrough convention). Add `--force` when AppCleaner already removed the bundle, else
   brew raises `It seems the App source '<path>' is not there.` Add `--zap` per the prompt.
   Formulae: plain `brew uninstall <name>`, no AppCleaner, no `--zap` (brew rejects that combination).
8. **Report** — reuse the warning/error summarization pattern from `upgrade.ts` (`UpgradeDiagnostic`);
   never bail mid-list, same as the upgrade command.

Files: `src/commands/uninstall.ts` (new), `src/appcleaner.ts` (new), `src/index.ts`, `src/prompt.ts`,
`src/config.ts`, `src/restart.ts` (extract `quitApp`), `src/output/format.ts` (zap paths section),
`bin/brew-bouncer` (add the `#:` help line so `brew bouncer` dispatch documents it), `CHANGELOG.md`,
`README.md`.

Deliberately **not** doing: no AppCleaner preference writing, no SmartDelete enable/disable, no
privileged-helper use (`achelper`), no custom leftover scanner. Homebrew's zap plus AppCleaner cover it.

## Trade-offs

- The handoff is a GUI gate in a CLI flow. Non-interactive use (`--yes`, scripts) has to skip AppCleaner
  entirely; only `--zap` runs there.
- Redundant work: for most casks AppCleaner and zap find the same paths, so the user reviews a list that
  brew would have cleaned anyway. The gain is the 6 casks with no zap stanza and whatever the maintainer's
  list missed.
- Two removal mechanisms means two failure modes and an ordering dependency (`--force` needed once
  AppCleaner removed the bundle). Ordering must be right or brew errors.
- Depends on undocumented AppCleaner behaviour (`openFiles:`), which can break in any AppCleaner update.
  Detection is a path check; a silent behaviour change would degrade to "window opens, nothing happens".

## Verification

1. `bun run typecheck`.
2. Self-check for the pure parts (repo has no test suite; one runnable file, no framework):
   zap-path extraction and cask-vs-formula splitting from a captured `brew info --json=v2` fixture.
3. Dry run against a real cask **without confirming**: `bun run dev uninstall latest`, abort at the
   prompt. Confirms resolution, detection, preview and zap listing without touching the system.
4. End-to-end on a throwaway cask installed for the test (Jason picks it; nothing on the real list) —
   confirm: app quits, AppCleaner opens populated, Remove clears app + leftovers, brew then exits 0 with
   `--force --zap`, and `brew list --cask` no longer shows it.
5. Negative path: with `/Applications/AppCleaner.app` absent, the command must warn and complete the
   brew uninstall normally.
