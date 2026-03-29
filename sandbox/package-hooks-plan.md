# Package Hooks Plan

Per-package pre/post-upgrade hooks for brew-bouncer.

## Motivation

Some casks lose state on upgrade. Parallels Desktop forgets registered VMs. There's no way for users to run custom logic around individual package upgrades — brew itself has no user-facing hook system. brew-bouncer already owns the per-package upgrade loop, making it the natural place to add this.

## Config Format

### Option A: Extend config file (recommended)

Add a `hooks` key to the existing config. Keeps everything in one file, no new parser, matches the existing pattern.

> **Note**: The config file format is being migrated from plain JSON to YAML (see `yaml-config-plan.md`). YAML supports comments natively, which is important for hook configs where users need to document what each hook does. Examples below use YAML.

```yaml
# Packages to skip during upgrade
ignore:
  - some-package

# Per-package upgrade hooks
hooks:
  # Parallels loses VM registrations on upgrade
  - target: parallels
    description: Save and restore Parallels VM registrations
    pre-upgrade: ~/.config/brew-bouncer/hooks/parallels-save-vms.sh
    post-upgrade: ~/.config/brew-bouncer/hooks/parallels-register-vms.sh

  - target: firefox
    post-upgrade: ~/.config/brew-bouncer/hooks/notify-upgrade.sh
```

**Why this over alternatives:**

| Approach | Pros | Cons |
|----------|------|------|
| Extend config file (YAML) | Single file, comments, readable hook definitions | YAML parser dependency |
| Hooks directory (pacman-style `.hook` files) | Self-documenting, easy to add/remove | New INI parser, different format from existing config |
| Inline shell in config | No separate files | String escaping is painful, hard to debug |

### Config Schema

```typescript
interface HookEntry {
  target: string;              // package name (exact match, no globs v1)
  description?: string;        // shown during upgrade
  "pre-upgrade"?: string;      // path to executable
  "post-upgrade"?: string;     // path to executable
  "on-failure"?: "warn" | "abort";  // default: "warn"
}

interface BouncerConfig {
  ignore: string[];
  hooks?: HookEntry[];
}
```

**Glob support**: Not in v1. Exact package name matching keeps the implementation simple and the behavior predictable. A `*` wildcard target could be added later if there's demand for "run this after every upgrade."

### Target Matching

Hooks match against the package name as it appears in `brew outdated` output (e.g. `parallels`, `firefox`, `google-chrome`). The match happens in the upgrade loop, before calling `brewUpgrade()`.

```typescript
// In the per-package loop
const packageHooks = config.hooks?.filter(h => h.target === pkg.name) ?? [];
```

## Hook Execution Model

### Lifecycle

Hooks slot into the existing per-package upgrade loop in `upgrade.ts` (lines 221-283):

```
for each package:
  1. Print package header (name, version diff)
  2. >>> Run pre-upgrade hooks <<<
  3. brew upgrade <package>        (streaming, user sees output)
  4. >>> Run post-upgrade hooks <<<
  5. Handle quarantine removal
  6. Handle restart
```

Pre-upgrade runs **before** `brewUpgrade()`. Post-upgrade runs **after**, regardless of whether the upgrade succeeded or failed — the hook receives the exit code as context (env var).

### No `pre-all` / `post-all` hooks in v1

These add complexity without a clear use case. The per-package hooks cover the Parallels scenario and similar cases. If someone wants "notify me when all upgrades are done," that's better handled by wrapping `brew bouncer upgrade` in a shell script.

### Script Format

**Shell scripts only.** The reasons:

1. brew-bouncer ships as a compiled Bun binary. Compiled Bun binaries cannot `import()` external `.ts` files at runtime — the bundler resolves everything at build time.
2. There's a `BUN_BE_BUN=1` hack (Bun v1.2.16+) that makes the compiled binary act as `bun`, but it's fragile and version-dependent.
3. Shell scripts are universal on macOS, need no runtime, and are what users already write for this kind of task.
4. Pacman, git, apt — all use executables (effectively shell scripts).

Scripts must be executable (`chmod +x`). brew-bouncer should check this and warn if not.

### Environment Variables

Hooks receive context via environment variables:

| Variable | Value | Available in |
|----------|-------|-------------|
| `BREW_BOUNCER_PACKAGE` | Package name (e.g. `parallels`) | pre, post |
| `BREW_BOUNCER_PACKAGE_TYPE` | `formula` or `cask` | pre, post |
| `BREW_BOUNCER_INSTALLED_VERSION` | Version before upgrade | pre, post |
| `BREW_BOUNCER_CURRENT_VERSION` | Version being upgraded to | pre, post |
| `BREW_BOUNCER_UPGRADE_EXIT_CODE` | Exit code from `brew upgrade` | post only |

This is how git hooks and pacman hooks pass context — env vars and/or stdin. Env vars are simpler for our case since we're always dealing with a single package.

### Execution

Use `Bun.spawn()` with `stdio: "inherit"` (same as `execStreaming`) so hook output is visible to the user. This matches the existing pattern where `brewUpgrade()` uses streaming output.

```typescript
async function runHook(
  hookPath: string,
  env: Record<string, string>,
  description?: string,
): Promise<{ exitCode: number }> {
  const resolved = hookPath.replace(/^~/, os.homedir());

  if (description) {
    console.log(chalk.dim(`  hook: ${description}`));
  }

  const proc = Bun.spawn([resolved], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, ...env },
  });

  const exitCode = await proc.exited;
  return { exitCode };
}
```

### Error Handling

Default behavior: **warn and continue** (`on-failure: "warn"`).

- Pre-upgrade hook fails → print warning, **skip the upgrade for this package**, continue to next package. Rationale: the pre-hook is presumably saving state needed for recovery. If it can't save state, upgrading is risky.
- Post-upgrade hook fails → print warning, continue to quarantine/restart handling.

With `on-failure: "abort"`:
- Pre-upgrade hook fails → same as warn (skip this package) but also prints a more prominent error.
- Post-upgrade hook fails → print error. Can't undo the upgrade, so this is still just a warning in practice.

> **Trade-off**: Making pre-upgrade failure skip the package is opinionated. Alternative: just warn and upgrade anyway. The skip behavior is safer for the Parallels case (don't upgrade if we couldn't save VM list), but might surprise users who expect hooks to be advisory. Worth getting feedback on this.

### Timeout

Hooks get a 30-second timeout by default. No config for this in v1 — if someone needs longer, they can background their work in the script. This prevents a broken hook from hanging the entire upgrade.

## CLI Commands

### `brew bouncer hooks list`

Show configured hooks in a table:

```
$ brew bouncer hooks list

Package      Phase          Script                                          Description
parallels    pre-upgrade    ~/.config/brew-bouncer/hooks/parallels-save…    Save VM registrations
parallels    post-upgrade   ~/.config/brew-bouncer/hooks/parallels-reg…     Restore VM registrations
firefox      post-upgrade   ~/.config/brew-bouncer/hooks/notify-upgrade…    (none)

3 hooks configured
```

Warns if any script path doesn't exist or isn't executable.

### `brew bouncer hooks test <package>`

Dry-run hooks for a package without actually upgrading:

```
$ brew bouncer hooks test parallels

Running pre-upgrade hooks for parallels...
  hook: Save VM registrations
  /Users/jason/.config/brew-bouncer/hooks/parallels-save-vms.sh
  exit code: 0

Running post-upgrade hooks for parallels...
  hook: Restore VM registrations
  /Users/jason/.config/brew-bouncer/hooks/parallels-register-vms.sh
  exit code: 0

All hooks passed.
```

Sets `BREW_BOUNCER_UPGRADE_EXIT_CODE=0` for post-upgrade hooks during test. Useful for debugging.

### No `hooks add` / `hooks remove` CLI

Users edit `config.json` directly. Adding CLI commands to manage JSON array entries is more complexity than it's worth — the config is simple enough to hand-edit, and a CLI would need to handle edge cases like duplicate targets, multiple hooks per package, etc.

If we get feedback that hand-editing is painful, we can add these later.

### Commander.js Registration

```typescript
const hooks = program
  .command("hooks")
  .description("Manage per-package upgrade hooks");

hooks
  .command("list")
  .description("Show configured hooks")
  .action(async () => { /* ... */ });

hooks
  .command("test")
  .argument("<package>", "Package name to test hooks for")
  .action(async (pkg) => { /* ... */ });
```

## Worked Example: Parallels Desktop

### Problem

When Parallels Desktop upgrades, it loses track of registered VMs. After upgrade, `prlctl list --all` returns empty. Users must manually re-register each `.pvm` file.

### Hook Scripts

**`~/.config/brew-bouncer/hooks/parallels-save-vms.sh`**:
```bash
#!/bin/bash
# Save list of registered VMs before Parallels upgrade
set -euo pipefail

VM_LIST="$HOME/.config/brew-bouncer/.parallels-vms"
prlctl list --all --output name,path --no-header > "$VM_LIST"
echo "Saved $(wc -l < "$VM_LIST" | tr -d ' ') VM registrations"
```

**`~/.config/brew-bouncer/hooks/parallels-register-vms.sh`**:
```bash
#!/bin/bash
# Re-register VMs after Parallels upgrade
set -euo pipefail

VM_LIST="$HOME/.config/brew-bouncer/.parallels-vms"

if [[ ! -f "$VM_LIST" ]]; then
  echo "Warning: No saved VM list found"
  exit 1
fi

while IFS=$'\t' read -r name path; do
  if [[ -d "$path" ]]; then
    echo "Registering: $name ($path)"
    prlctl register "$path" --name "$name" 2>/dev/null || true
  fi
done < "$VM_LIST"

rm "$VM_LIST"
echo "VM re-registration complete"
```

### Config

```yaml
# ~/.config/brew-bouncer/config.yaml
hooks:
  # Parallels loses VM registrations on upgrade — save before, restore after
  - target: parallels
    description: Save and restore Parallels VM registrations
    on-failure: abort
    pre-upgrade: ~/.config/brew-bouncer/hooks/parallels-save-vms.sh
    post-upgrade: ~/.config/brew-bouncer/hooks/parallels-register-vms.sh
```

### Upgrade Flow

```
$ brew bouncer upgrade

Updating Homebrew...
...

Outdated packages:
  🍷 parallels   19.4.1 → 20.0.0   (running: Parallels Desktop)
  🍺 jq          1.7.1  → 1.8

Upgrade 2 packages? [Y/n/select] y

How should we handle restarts? [yes/ask/no] ask

🍷 parallels 19.4.1 → 20.0.0
  hook: Save and restore Parallels VM registrations (pre)
  Saved 3 VM registrations
  ==> Upgrading parallels
  ...brew output...
  hook: Save and restore Parallels VM registrations (post)
  Registering: Ubuntu 24.04 (/Users/jason/Parallels/Ubuntu 24.04.pvm)
  Registering: Windows 11 (/Users/jason/Parallels/Windows 11.pvm)
  Registering: macOS Sequoia (/Users/jason/Parallels/macOS Sequoia.pvm)
  VM re-registration complete
  Restart Parallels Desktop? [y/N] n

🍺 jq 1.7.1 → 1.8
  ==> Upgrading jq
  ...brew output...

Done. 2 upgraded, 0 failed, 0 skipped.
```

## Implementation Scope

### What to build

1. **Config loading** — extend `src/config.ts` to parse `hooks` array, validate paths
2. **Hook runner** — new `src/hooks.ts` module: resolve paths, set env vars, spawn with timeout
3. **Upgrade loop integration** — add pre/post hook calls in `src/commands/upgrade.ts`
4. **`hooks list` command** — new subcommand showing configured hooks
5. **`hooks test` command** — dry-run hook execution

### What NOT to build (v1)

- Glob/wildcard targets
- `pre-all` / `post-all` lifecycle hooks
- `hooks add` / `hooks remove` CLI commands
- TypeScript hook support
- Hook ordering / priority
- Hook output capture (always streaming)

## Open Questions

1. **Pre-upgrade failure behavior**: Should a failed pre-hook skip the package upgrade (safe, opinionated) or just warn and proceed (flexible, risky)? Current proposal: skip.

2. **Multiple hooks per phase**: If two hooks match the same package for the same phase, run both? In config order? Current proposal: yes, config order, stop on first failure if `on-failure: "abort"`.

3. **Hook discovery during `status`**: Should `brew bouncer status` indicate which packages have hooks configured? Could be useful for visibility but adds noise.

4. **Tilde expansion**: The config uses `~` in paths. Should we also support `$HOME` and other env vars? Current proposal: just `~`, matching shell convention.

5. **Hook script scaffolding**: Should `hooks test` create the hooks directory if it doesn't exist? Should there be a `hooks init <package>` that creates a template script? Probably not in v1.
