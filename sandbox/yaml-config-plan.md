# Config Migration Plan: JSON → YAML

## Recommendation: YAML via `yaml` (eemeli/yaml)

### Why YAML over JSONC

| Factor | YAML | JSONC |
|--------|------|-------|
| Comments | Native, first-class | Technically non-standard (VS Code extension of JSON) |
| Readability for hooks/scripts | Multiline strings, no escaping braces | Still JSON — escape-heavy, noisy |
| Ecosystem precedent | GitHub Actions, Docker Compose, Kubernetes, Homebrew's own formula DSL | VS Code settings, tsconfig |
| User familiarity for CLI tools | High — this is what people expect | Lower — feels like "JSON with workarounds" |
| Library maturity | Excellent | Good, but niche |

JSONC solves the comment problem but doesn't solve the ergonomics problem. Hook definitions will contain shell commands, globs, and descriptions — YAML handles these cleanly, JSONC doesn't.

### Why `yaml` over `js-yaml`

| | `yaml` (eemeli) | `js-yaml` (nodeca) |
|---|---|---|
| Gzipped size | 31.5 KB | 12.7 KB |
| TypeScript types | Built-in | Needs `@types/js-yaml` |
| Comment preservation | Yes (round-trip) | No |
| YAML spec | 1.1 + 1.2 | 1.2 only |
| Dependencies | 0 | 0 |
| Bun compile issues | None known | None known |

The size difference (19 KB gzipped) is negligible for a CLI binary. Comment preservation matters — if brew-bouncer ever writes/updates the config (e.g. `brew bouncer ignore <pkg>`), we want to preserve the user's comments. `yaml` is the only option that supports this.

### JSONC fallback assessment

Not needed. JSONC adds complexity (two config formats to support) for marginal benefit. If YAML has issues in compiled Bun, we should fix the YAML path rather than maintain a fallback. The `jsonc-parser` package (6.6 KB gzipped, Microsoft/VS Code) exists if we ever need it, but there's no reason to plan for it now.

## File naming

Use `config.yaml` (not `.yml`). Rationale:
- `.yaml` is the official extension per the YAML spec
- GitHub, Docker Compose, and most modern tools have standardized on `.yaml`
- Avoids the eternal `.yml` vs `.yaml` question by picking the canonical one

Config path: `~/.config/brew-bouncer/config.yaml`

## Config format with hooks

Current `config.json`:
```json
{
  "ignore": ["some-package"]
}
```

Proposed `config.yaml`:
```yaml
# Packages to skip during upgrade
ignore:
  - some-package
  - another-package

# Per-package hooks — run shell commands at lifecycle points
hooks:
  firefox:
    # Close all windows gracefully before upgrading
    pre-upgrade: |
      osascript -e 'tell application "Firefox" to quit'
    # Open the "what's new" page after restart
    post-restart: |
      open -a Firefox https://mozilla.org/whats-new

  docker:
    # Stop containers before upgrading Docker
    pre-upgrade: |
      docker stop $(docker ps -q) 2>/dev/null || true
    post-upgrade: |
      docker start $(docker ps -aq --filter "status=exited") 2>/dev/null || true

  # Simple case — just a pre-upgrade command
  postgresql@17:
    pre-upgrade: brew services stop postgresql@17

# Global hooks — run for every package
global-hooks:
  # Log all upgrades to a file
  post-upgrade: |
    echo "$(date): upgraded $BOUNCER_PACKAGE from $BOUNCER_OLD_VERSION to $BOUNCER_NEW_VERSION" >> ~/brew-upgrades.log
```

> The hook structure shown here is illustrative for the config format discussion. Actual hook lifecycle events, environment variables, and execution semantics will be defined in the package-hooks plan.

## Migration strategy

### Approach: prioritized file lookup, no auto-migration

The config module tries files in order:
1. `config.yaml` — preferred
2. `config.json` — legacy fallback

If `config.json` is found but `config.yaml` is not, load the JSON and log a deprecation notice to stderr (respecting `--quiet`):

```
note: ~/.config/brew-bouncer/config.json is deprecated, rename to config.yaml
```

No auto-migration. Reasons:
- The config is simple enough to migrate by hand (rename + add a couple dashes)
- Auto-migration risks mangling the file if something goes wrong
- Writing to the user's filesystem without being asked is rude
- Users who never see the warning (no upgrades pending) don't need to migrate

If both files exist, abort with an error. Ambiguity is a config problem the user should resolve:

```
error: Ambiguous config: both ~/.config/brew-bouncer/config.yaml and ~/.config/brew-bouncer/config.json exist. Remove one.
```

### Timeline

- **v0.3.0**: Add YAML support alongside JSON. Deprecation notice for JSON.
- **v0.4.0 or later**: Consider dropping JSON support (evaluate based on how long v0.3 has been out).

## Implementation steps

### 1. Add `yaml` dependency

```bash
bun add yaml
```

Adds `yaml` to `dependencies` in `package.json`. Verify it works in compiled binary:

```bash
bun run build && ./dist/brew-bouncer status
```

### 2. Update `BouncerConfig` interface

Extend the interface to include the hooks structure (exact shape TBD by package-hooks plan):

```typescript
export interface BouncerConfig {
  ignore: string[];
  hooks?: Record<string, PackageHooks>;
  "global-hooks"?: GlobalHooks;
}
```

### 3. Rewrite `loadConfig()` in `src/config.ts`

```typescript
import { parse } from "yaml";

const CONFIG_DIR = join(homedir(), ".config", "brew-bouncer");
const CONFIG_YAML = join(CONFIG_DIR, "config.yaml");
const CONFIG_JSON = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<BouncerConfig> {
  // Try YAML first
  const yamlFile = Bun.file(CONFIG_YAML);
  if (await yamlFile.exists()) {
    const text = await yamlFile.text();
    const data = parse(text);
    // Check for ambiguous dual-config
    const jsonFile = Bun.file(CONFIG_JSON);
    if (await jsonFile.exists()) {
      log.warn("Both config.yaml and config.json exist, using config.yaml");
    }
    return { ...DEFAULT_CONFIG, ...data };
  }

  // Fall back to JSON (deprecated)
  const jsonFile = Bun.file(CONFIG_JSON);
  if (await jsonFile.exists()) {
    const data = await jsonFile.json();
    log.warn("config.json is deprecated, rename to config.yaml");
    return { ...DEFAULT_CONFIG, ...data };
  }

  return DEFAULT_CONFIG;
}
```

### 4. Update `configPath()` to reflect actual loaded file

Currently returns a hardcoded path. Change to return whichever file was actually loaded (or the preferred path if neither exists):

```typescript
export async function configPath(): Promise<string> {
  if (await Bun.file(CONFIG_YAML).exists()) return CONFIG_YAML;
  if (await Bun.file(CONFIG_JSON).exists()) return CONFIG_JSON;
  return CONFIG_YAML; // default for new installs
}
```

> Note: this changes `configPath()` from sync to async. Check callers — currently used in `status` command output. May need adjustment.

### 5. Verify compiled binary

```bash
bun run build
./dist/brew-bouncer status
./dist/brew-bouncer upgrade --dry-run
```

Confirm YAML parsing works in the compiled binary, not just in `bun run dev`.

### 6. Update README

Document the config file location and format. Show a minimal example.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `yaml` breaks in compiled Bun | Low (pure JS, no native deps) | Test in CI with `bun run build:verify` |
| Users confused by format change | Low (small user base, simple config) | Deprecation warning, both formats supported |
| YAML parsing errors on malformed config | Medium | Catch parse errors, show file path + line number in error message |
| Comment-preserving round-trip needed before hooks ship | Low (no config writes today) | `yaml` supports it when we need it |
