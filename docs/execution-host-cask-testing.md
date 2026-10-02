# Execution-host cask testing

## Purpose

Brew Bouncer protects a cask when that cask's application is part of Brew
Bouncer's execution context. Unit tests cover process-tree classification and
upgrade policy, but they do not exercise an actual Homebrew cask replacement.

The integration harness described here provides a repeatable upgrade without
waiting for a terminal application release or changing the developer's
Homebrew installation.

## Isolation boundary

Each run owns a generated directory containing a disposable Homebrew clone and
all of its mutable state:

- repository, prefix, Cellar, Caskroom, and taps;
- cache, logs, temporary files, configuration, and trust records;
- cask application destination; and
- generated applications, archives, fixtures, and test output.

The harness invokes the clone's exact `bin/brew` and points Brew Bouncer at its
prefix. It must not tap, install, upgrade, or uninstall anything through the
developer's normal Homebrew executable.

Before installation, the harness must resolve and verify every writable
Homebrew path. It fails closed if any path is outside the generated run
directory or resolves to `/opt/homebrew`, `/usr/local`, `/Applications`, or the
developer's normal Homebrew directories. Cleanup likewise operates only on a
validated run directory.

## Test package

The harness builds versions 1 and 2 of a small executable packaged as
`Brew Bouncer Harness.app`. The executable launches the repository's compiled
Brew Bouncer binary as a child, providing a real `.app` ancestor and stable
bundle identity.

A private tap exists only inside the disposable Homebrew clone. Its cask uses
local versioned artifacts and installs the application into the run directory.
After version 1 starts, the harness publishes version 2 to that isolated tap
and asks Brew Bouncer to upgrade only the harness cask.

## Required assertions

The test succeeds only when:

- Brew Bouncer identifies the harness bundle as part of its execution context;
- Homebrew is invoked with `--no-quit` for the protected cask;
- Brew Bouncer does not run its own quit or reopen path;
- the version 1 process remains alive while the installed bundle becomes
  version 2; and
- output tells the user to restart the host manually after Brew Bouncer exits.

Setup, policy, Homebrew, assertion, and cleanup failures must be reported as
distinct failure classes.

## Fidelity levels

The default local test uses an executable located inside an application bundle
without starting AppKit. This exercises Brew Bouncer's process and bundle
detection plus a real cask upgrade while avoiding LaunchServices registration
in the developer's login session.

A separate full-fidelity acceptance test may run an `NSApplication` host in an
ephemeral macOS VM. That test covers AppKit termination and
`NSRunningApplication` behavior without affecting the developer's account. It
is not required for the hermetic local integration test.

## Repository shape

When implemented, keep the executable source, controller, and operator notes
under `integration/execution-host/`, with an explicit opt-in Moon task. Generated
Homebrew state and application artifacts remain outside the repository and are
never committed.

The harness is macOS-only and requires the Swift compiler from Command Line
Tools. It must never operate on cmux, Ghostty, Orca, iTerm2, or any other
existing package.
