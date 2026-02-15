# Homebrew Integration

brew-bouncer registers as a Homebrew external command, allowing it to be invoked as `brew bouncer`.

## How it works

Homebrew resolves `brew <command>` by searching PATH for an executable named `brew-<command>`. When found, brew `exec`s it directly, passing all arguments through.

The entry point is `bin/brew-bouncer` — a thin shell wrapper that:

1. Provides `#:` comment lines that brew parses for `brew bouncer --help`
2. Delegates to `bun src/index.ts` for actual execution

The wrapper is symlinked into `/opt/homebrew/bin/` so brew can discover it.

## Development setup

```bash
# Make the wrapper executable (already done)
chmod +x bin/brew-bouncer

# Symlink into brew's PATH
ln -s "$(pwd)/bin/brew-bouncer" /opt/homebrew/bin/brew-bouncer

# Verify
brew bouncer --help
brew bouncer status
```

Since the symlink points at the source tree, code changes take effect immediately.

## Help text

Brew intercepts `--help` before the external command runs. It reads lines starting with `#:` from the script file and formats them as help output. These lines live in `bin/brew-bouncer`.

The `#:` format rules:
- `* \`command\`` on the first line becomes `Usage: brew command`
- Text in backticks gets **bold** formatting
- Text in `<angle brackets>` gets underline formatting

Commander's own help is available via `brew bouncer help` (without `--`).

## Why the shell wrapper is permanent

Brew parses `#:` comments from the raw file text (`path.read.lines.grep(/^#:/)`). A compiled native binary has no parseable text lines, so `brew bouncer --help` would fall back to brew's generic help.

The shell wrapper is the permanent entry point — even with a native binary:

```
bin/brew-bouncer          # shell wrapper: #: help lines + exec's the binary
bin/brew-bouncer-bin      # compiled native binary (bun build --compile)
```

The `exec` call replaces the shell process with the binary — no performance overhead. This is the same pattern brew itself uses (shell script dispatching to Ruby).

## Production distribution

For distribution via a Homebrew tap, both the wrapper and the binary go in the tap. Brew adds tap `cmd/` directories to its search path automatically.

```
homebrew-planet57/
├── Formula/
│   └── brew-bouncer.rb    # formula that installs the binary
├── cmd/
│   └── brew-bouncer       # shell wrapper, discoverable as `brew bouncer`
└── README.md
```
