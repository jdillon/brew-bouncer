# Brew Bouncer

Brew Bouncer is a Bun and TypeScript CLI for previewing Homebrew upgrades and guiding restarts of affected applications and services.

## Repository work

- Use `moon run root:setup` to provision the pinned Bun toolchain and dependencies. Use `moon run root:check`, `moon run root:build-verify`, and `moon run root:prepush` for validation.
- Run the source CLI with `moon run root:cli -- <arguments>`. The `brew bouncer` command runs the installed release and is not a source checkout check.
- Keep explicit package names in upgrade calls. Continue affected-process detection and restart guidance after a partial `brew upgrade` failure.
- Do not run a real package upgrade while validating repository changes.
- Read `docs/brew-integration.md` for integration details.

`src/commands/` orchestrates status and upgrade. `src/brew/` owns Homebrew calls and parsing; `src/detect/` maps packages to running processes; `src/restart.ts` handles restart policy. Both commands update Homebrew, inspect outdated packages, filter them, detect running processes, then display results. Bun tests live under `src/`.

## Agent instructions

Read `AGENTS.local.md` after this file when it exists. Before repository work, read all unscoped Markdown rules in `.agents/rules/`. Before reading or changing a path, read every rule whose `paths:` frontmatter matches that path. Re-evaluate scoped rules when work expands to another path.
