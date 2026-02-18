# bin/brew-bouncer

The `#:` comment lines are parsed by brew for `brew bouncer --help`. Brew intercepts `--help` at dispatch, so users never reach commander's help via that flag.

## Maintaining help text

The `#:` block must mirror `bun run src/index.ts --help` output. When commands or options change:

1. Run `bun run src/index.ts --help`
2. Update the `#:` lines in `bin/brew-bouncer` to match
3. Keep the trailing note about `brew bouncer help [command]` for subcommand help
