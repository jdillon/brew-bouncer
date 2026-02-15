#!/usr/bin/env bun

import { program } from "commander";
import { upgrade } from "./commands/upgrade.ts";
import { status } from "./commands/status.ts";
import { restart } from "./commands/restart.ts";
import { setLogLevel } from "./logger.ts";

program
  .name("brew bouncer")
  .description("Homebrew upgrade manager — update, upgrade, and restart what needs it")
  .version("0.1.0")
  .option("--debug", "Show all log output (debug + info + warn + error)")
  .option("--verbose", "Show info-level log output")
  .option("--quiet", "Suppress warnings, show errors only")
  .hook("preAction", () => {
    const opts = program.opts<{ debug?: boolean; verbose?: boolean; quiet?: boolean }>();
    setLogLevel(opts);
  });

program
  .command("upgrade")
  .description("Update, upgrade, and detect what needs restarting")
  .argument("[packages...]", "Specific packages to upgrade (default: all)")
  .option("-y, --yes", "Restart all affected apps without prompting", false)
  .action(async (packages: string[], opts: { yes: boolean }) => {
    await upgrade({ yes: opts.yes, only: packages.length > 0 ? packages : undefined });
  });

program
  .command("status")
  .description("Show outdated packages without upgrading")
  .action(async () => {
    await status();
  });

program
  .command("restart")
  .description("Detect and restart upgraded apps/processes")
  .action(async () => {
    await restart();
  });

program.parse();
