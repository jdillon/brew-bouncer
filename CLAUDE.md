# Brew Bouncer

macOS Homebrew management CLI built with Bun.

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- Use `bun run` / `bun test` / `bun install` for all operations

## Architecture

- `src/index.ts` — CLI entry point
- `src/commands/` — command implementations (upgrade, status, restart)
- `src/brew/` — brew command execution and output parsing
- `src/detect/` — maps upgraded packages to running processes
- `src/output/` — report formatting

## Conventions

- Shell out to `/opt/homebrew/bin/brew` directly, parse `--json` output
- No external brew wrapper libraries
- Dry-run by default for any destructive operations
