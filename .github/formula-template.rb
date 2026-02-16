# Homebrew formula for brew-bouncer
# Install: brew tap jdillon/planet57 && brew install brew-bouncer

class BrewBouncer < Formula
  desc "Homebrew upgrade manager — upgrade and restart affected apps"
  homepage "https://github.com/jdillon/brew-bouncer"
  license "Apache-2.0"
  version "__VERSION__"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/jdillon/brew-bouncer/releases/download/v__VERSION__/brew-bouncer-darwin-arm64"
      sha256 "__SHA256_ARM64__"
    else
      url "https://github.com/jdillon/brew-bouncer/releases/download/v__VERSION__/brew-bouncer-darwin-x64"
      sha256 "__SHA256_X64__"
    end
  end

  def install
    binary = Dir["brew-bouncer-darwin-*"].first || "brew-bouncer-darwin-arm64"
    mv binary, "brew-bouncer-bin"
    chmod 0755, "brew-bouncer-bin"

    # Install the native binary to libexec
    libexec.install "brew-bouncer-bin"

    # Install the shell wrapper for brew dispatch (#: help text)
    # The wrapper execs the native binary instead of bun
    (bin/"brew-bouncer").write <<~SH
      #!/bin/bash
      #:  * `bouncer` [<subcommand>]
      #:
      #:  Homebrew upgrade manager — update, upgrade, and restart what needs it.
      #:
      #:  `brew bouncer status`
      #:  Show outdated packages and detect which running apps need restarting.
      #:
      #:  `brew bouncer upgrade` [<packages...>]
      #:  Update, upgrade, and interactively restart affected apps.
      #:  Use `--yes` to skip confirmations.
      #:
      #:  `--debug`   Show debug-level log output
      #:  `--verbose` Show info-level log output
      #:  `--quiet`   Suppress warnings, show errors only

      exec "#{libexec}/brew-bouncer-bin" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/brew-bouncer --version")
  end
end
