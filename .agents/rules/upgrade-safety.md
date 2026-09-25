---
paths:
  - "src/commands/upgrade.ts"
  - "src/brew/**"
  - "src/restart.ts"
---

# Upgrade safety

- Pass explicit selected package names to Homebrew upgrades.
- On partial upgrade failure, continue detecting affected running processes and offer restart guidance.
- Preserve user-visible Homebrew output and prompts during package upgrades.
