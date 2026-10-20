# Upgrade diagnostics and recovery review

Completed in `jdillon/upgrade-diagnostics-and-recovery`, based on `e305c31aca0b644da4548c759a8dc2854aa3b1d6`. Implementation and validation were completed before publication authorization. No live upgrade, service operation, privacy change, cache deletion, or original-checkout edit was performed.

## Result

- Complete: terminal diagnostics capture and actionable multiline warning/error extraction. Interactive execution uses Bun's native PTY, with output forwarding, input without key logging, echo-off prompts, resizing, and job stop/resume. Redirected descriptors retain stdin EOF and separate streams.
- Complete: installed-receipt observations and fresh outdated lists reconcile targets changed by earlier operations. Those targets retain quarantine/restart accounting without redundant upgrade requests. Additional observed dependencies are reported separately; requests still name only selected packages.
- Complete: failed requests continue through installed-state observation, process detection, selected-package quarantine handling, GUI recovery, and later targets. Detection can match exact old keg identities after cleanup. Unverified rollback remains explicitly unverified.
- Complete: final names for failed upgrades, lifecycle failures, warnings, dependency-updated targets and outstanding restart/checks. Successful requests, observed version changes, no observed version change, skipped work, quarantine checks/removals and recovery reopens have separate accounting. The command returns nonzero after failures and guidance finish.
- Complete: [NetBird investigation and recovery proposal](netbird-upgrade-recovery.md), including evidence attribution, signing gates, isolated comparison design, recovery preconditions and an unsubmitted upstream draft.
- Complete: independent read-only adversarial review; all material findings resolved and rechecked. No remaining material findings reported within the inspected scope.

## Changed files

| Area | Files |
|---|---|
| Terminal execution and receipt/diagnostic parsing | `src/brew/runner.ts`, `src/brew/diagnostics.ts`, `src/brew/state.ts` |
| Upgrade orchestration and exit boundary | `src/commands/upgrade.ts`, `src/index.ts` |
| Recovery observations | `src/detect/matcher.ts`, `src/quarantine.ts` |
| Regression coverage | `src/brew/runner.test.ts`, `src/brew/diagnostics.test.ts`, `src/brew/state.test.ts`, `src/commands/upgrade.test.ts`, `src/commands/cli.test.ts`, `src/detect/matcher.test.ts` |
| Evidence | This note and `docs/netbird-upgrade-recovery.md` |

## Validation

Repository setup completed through `moon run root:setup`. The host Moon 2.6.2 did not satisfy this checkout; Moon 2.5.5 was provisioned with proto, then selected through the command environment. Repository configuration and host Homebrew were unchanged. Bun was the configured 1.4.2.

All final checks exited zero with the pinned Moon directory prepended to PATH:

- `moon run root:check`: 104 tests, 275 assertions; typecheck and license checks passed.
- `moon run root:build-verify`: compiled macOS arm64 binary; version and help passed.
- `moon run root:prepush`: passed, including the same 104 tests.
- `git diff --check`: passed.

Coverage includes real harmless PTY fixtures for terminal descriptors, live prompts, `/dev/tty`, hidden input, ANSI output, resize, Ctrl-C, Ctrl-Z and resume; redirected stream/EOF fixtures; failed spawning; multiline permission/rollback and command-shadowing messages; seven dependency-updated targets; old-keg process matching; indirect changes outside selection; transient observation/probe errors; quarantine discovery/inspection/removal failures; and real source CLI subprocesses against a fake Homebrew for success, partial failure and lifecycle-failure exit statuses.

The macOS `script` alternative failed the resize fixture and was replaced with the tested native PTY implementation. Test fixtures were isolated and disposed; none executed a real upgrade or host lifecycle action.

## Limits and next action

Mixed terminal/redirection preserves inherited terminal descriptors; those streams cannot also be captured by this implementation. Such runs explicitly report incomplete diagnostics. Fully interactive and fully redirected paths are covered by fixtures.

Receipt differences are observed version/install/removal changes, not proof of file integrity, causality in the presence of concurrent package changes, or verified rollback. Same-version file replacement is not measurable from receipts. Actual privileged sudo and Homebrew cask installation were not exercised.

NetBird is not fixed by these CLI changes. The next proposed step is the disposable macOS comparison in the linked document: harmless protected-app fixture first, then separately authorized vendor/service testing. Shipping executable scripts before signing/notarization is a candidate remediation, not a validated release fix. No live recovery is authorized by this note.
