# NetBird UI upgrade: evidence and recovery proposal

Research snapshot: 2026-10-20. No live package upgrade, service operation, permission change, app modification, or external submission was performed for this document. The reproduction and recovery below are proposals; neither has been executed.

## Finding and evidence boundaries

The initiating investigation reproduced the same 0.81.2 → 0.81.3 failure through Brew Bouncer and direct Homebrew. Its unified logs identified `kTCCServiceSystemPolicyAppBundles` denial for `chmod` against the installed UI scripts, attributed to Homebrew's portable Ruby rather than the launching terminal. This establishes the immediate permission failure from the supplied evidence. It does not establish which Homebrew or macOS change introduced it.

The handoff also recorded Homebrew attempting UI rollback, followed by launchctl EIO and missing-plist errors during installer recovery. Restoring the UI bundle does not prove restoration of service state, dependencies, or connectivity. Earlier observations were UI 0.81.2, CLI/daemon 0.81.3, a running daemon, and `Idle` with management/signal disconnected. These are historical observations, not a current health claim. No endpoints or configuration contents are reproduced here.

Independently checked in this workspace:

- Installed Homebrew HEAD is still `332963d53699d6a49b9d16bcb04b9fbc66ae5f00`; source was inspected read-only.
- The [0.81.2 template](https://raw.githubusercontent.com/netbirdio/netbird/v0.81.2/client/ui/netbird-ui.rb.tmpl) and [0.81.3 template](https://raw.githubusercontent.com/netbirdio/netbird/v0.81.3/client/ui/netbird-ui.rb.tmpl) have identical install/uninstall steps. They chmod the installed scripts before invoking the installer with sudo.
- The [current tap cask](https://raw.githubusercontent.com/netbirdio/homebrew-tap/main/Casks/netbird-ui.rb) still names 0.81.3. Its arm64 checksum matches the cached archive: `690a266cfb15367973707f0616f0d1a9691ce026cd346ad4e4225e680e9a99a1`. Reading ZIP metadata confirms both scripts are mode 0644. The 0.81.2 cache is now absent; identical script bytes across versions remain handoff evidence, not a repeated comparison.

## Ordering and compatibility hypothesis

Homebrew's [artifact order](https://raw.githubusercontent.com/Homebrew/brew/332963d53699d6a49b9d16bcb04b9fbc66ae5f00/Library/Homebrew/cask/artifact/abstract_artifact.rb) runs preflight steps before moving the app, then postflight steps. Thus the existing permission change occurs after placement in `/Applications`. The [step runner](https://raw.githubusercontent.com/Homebrew/brew/332963d53699d6a49b9d16bcb04b9fbc66ae5f00/Library/Homebrew/install_steps.rb) executes `set_permissions` with `sudo: false`. The [cask broker](https://raw.githubusercontent.com/Homebrew/brew/332963d53699d6a49b9d16bcb04b9fbc66ae5f00/Library/Homebrew/cask/artifact/install_steps.rb) retains nonprivileged steps inside the sandbox and routes declared privileged steps through the parent.

Homebrew's [privacy-isolation commit](https://github.com/Homebrew/brew/commit/1ecf91324200e85dc9aa97ce8d5453150b13a1c5) deliberately disclaims the parent's TCC responsibility for sandboxed workers. A compatibility interaction with modifying a protected installed app is therefore a strong hypothesis. A terminal privacy grant alone is not a demonstrated remedy for the worker path. Broad Ruby grants, disabling isolation, or resetting TCC are not proposed fixes.

The [vendor installer](https://raw.githubusercontent.com/netbirdio/netbird/v0.81.3/release_files/darwin-ui-installer.sh) stops/uninstalls/reinstalls/starts the daemon, suppresses several service failures, and opens the UI. A successful installer exit is insufficient evidence of daemon or VPN health. The [reported launchd teardown race](https://github.com/netbirdio/netbird/discussions/7108) is relevant to secondary service symptoms; it does not explain the preceding chmod denial and its workaround is not verified here.

## Candidate upstream remediation

Prefer packaging the scripts executable in the vendor release pipeline **before signing and notarizing**, preserving their modes in the distributed ZIP, then removing the redundant installed-bundle chmod. This eliminates this specific protected-app mutation but still requires service lifecycle testing.

A narrower cask experiment could move permission setting into `preflight_steps`, addressing `netbird_ui_darwin/installer.sh` and `uninstaller.sh` relative to `:staged_path`, and remove the postflight chmod. The remaining privileged installer call stays after app placement. This follows the inspected ordering; it is not a tested patch or a recommendation to edit the local cask.

Signing is an acceptance gate, not an assumed nonissue: the cask experiment changes an already signed downloaded bundle. [Apple's code-signing guidance](https://developer.apple.com/library/archive/technotes/tn2206/_index.html) recommends finalizing bundles before signing. It does not establish the exact mode-only outcome for this artifact. In the disposable environment, compare script hashes, modes, signature identity, strict bundle verification and Gatekeeper assessment before/after the mode change and after placement. Reject the candidate if validation degrades; do not ad-hoc re-sign, remove quarantine, or bypass Gatekeeper to make it pass. A vendor-built signed/notarized executable-mode release is the stronger candidate.

## Controlled reproduction proposal

Use a disposable macOS VM with the affected OS/build and architecture, a fresh local account, no host-mounted writable Homebrew/app/config directories, no production NetBird enrollment, and snapshot rollback. The [existing isolation design](execution-host-cask-testing.md) is useful precedent but is not an implemented TCC harness. A custom app directory alone cannot faithfully reproduce `/Applications` protection.

1. Record OS build, Homebrew commits, Ruby identity, terminal identity, privacy state, artifact hashes and modes. Keep auto-update disabled in the experiment so each pinned comparison remains meaningful. Use only synthetic configuration and sanitize logs before export.
2. Build a harmless fixture app/cask with two versions, a bundled 0644 script, and postflight permission change. Stub the installer to record execution; include no NetBird service hooks or network operations. Establish protected-app registration/use in the guest before replacement, and capture TCC attribution as well as command outcomes.
3. From identical snapshots compare Homebrew `1ecf91324200e85dc9aa97ce8d5453150b13a1c5` with its parent, holding cask, OS and permissions fixed. Separately compare preexisting-app replacement with a fresh install. Repeat trials. A failure specific to the changed commit supports compatibility regression; a synthetic nonreproduction leaves local app identity/state and fixture fidelity unresolved.
4. Compare original postflight chmod, staged preflight chmod, and vendor executable-mode archives. Require terminal prompts, attribution, modes, hashes, signing and Gatekeeper results, and rollback observations for each. Do not treat an unprotected-path pass as a TCC reproduction.
5. Only in a separately approved guest test, exercise the actual NetBird release and service lifecycle using disposable identity/config. Capture old-job disappearance before any replacement start, with bounded waits and explicit timeout errors. Verify UI, daemon and connectivity separately. This checks the second failure class after the primary permission failure is removed.

No guest was provisioned, and no claim of a fixed regression follows from source inspection.

## Recovery proposal for Jason's machine

Before any recovery, obtain explicit authorization for the exact mutation and an interruption window, with alternate access that does not depend on this VPN. Inventory the actual daemon arguments and configuration locations locally; make a protected, restorable backup preserving ownership/modes. Do not print keys, tokens, peer addresses or management endpoints, enroll a replacement identity, or delete configuration.

Recheck three independent states read-only: bundle-root `/Applications/Netbird UI.app/Info.plist` version and signature; installed CLI version plus `system/netbird` job/process executable; and sanitized NetBird status plus an owner-selected authorized connectivity check. A responding CLI establishes neither current tunnel health nor a healthy UI. Historical PID 60256 must not be reused as current evidence.

If the UI is restored and the daemon remains running, preserve that state while evaluating a verified vendor fix. A mixed version state should be recorded explicitly. If the daemon is absent or connectivity is impaired, first distinguish missing/invalid plist, stale job teardown, binary/config mismatch and management reachability. Do not create an empty plist or blindly repeat reinstall/bootout/bootstrap operations.

Any eventual repair must use a verified artifact and a tested, version-specific service procedure preserving config. Observe teardown completion before replacement service startup; fail on timeout rather than retrying destructive steps. Read back bundle version/signature, installed and running daemon versions, launchd state, sanitized status, and connectivity afterwards. Report rollback as attempted until those checks establish the intended state. This document authorizes none of those live actions.

## Upstream evidence draft — not submitted

----8<----
NetBird UI 0.81.2 to 0.81.3 fails at postflight chmod on macOS, followed by rollback service errors.

Direct Homebrew and Brew Bouncer produced the same initial chmod Operation not permitted failure for installer.sh and uninstaller.sh under /Applications/Netbird UI.app. The initiating investigation's unified logs attribute a SystemPolicyAppBundles denial to Homebrew portable Ruby, accessing chmod, rather than inherited terminal responsibility. Installed Homebrew was 332963d53699d6a49b9d16bcb04b9fbc66ae5f00.

The arm64 0.81.3 archive matches the cask SHA256 and ships both scripts mode 0644. Both version templates chmod installed scripts before the sudo installer call. Homebrew's sandbox privacy-isolation change is a compatibility hypothesis; no controlled before/after regression result is available. Exact macOS build and sanitized original log excerpts should be attached by the owner before filing.

Homebrew attempted UI rollback, then reported launchctl EIO and a missing daemon plist during recovery. These secondary errors do not prove that rollback restored service health. The historical restored UI was 0.81.2 while CLI/daemon were 0.81.3; connectivity was not confirmed healthy.

Could executable script modes be established in the vendor artifact before signing/notarization, avoiding this installed-bundle chmod? A staged preflight permission change is another experiment, contingent on strict signature/Gatekeeper validation. A disposable macOS comparison is still needed, and launchd recovery must be tested separately. No local privacy bypass or cask patch has been applied.
---->8----
