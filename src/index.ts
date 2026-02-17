#!/usr/bin/env bun
/*
 * Copyright 2026 Jason Dillon
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { program } from "commander";
import { upgrade } from "./commands/upgrade.ts";
import { status } from "./commands/status.ts";
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
    const globalOpts = program.opts<{ verbose?: boolean }>();
    await upgrade({
      yes: opts.yes,
      verbose: globalOpts.verbose ?? false,
      only: packages.length > 0 ? packages : undefined,
    });
  });

program
  .command("status")
  .description("Show outdated packages without upgrading")
  .action(async () => {
    await status();
  });

program.parse();
