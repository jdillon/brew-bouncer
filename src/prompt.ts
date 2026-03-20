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
import * as readline from "node:readline/promises";
import { checkbox } from "@inquirer/prompts";
import type { OutdatedPackage } from "./brew/parser.ts";
import type { DetectedApp } from "./detect/matcher.ts";
import { shortVersion, formatStatus } from "./output/format.ts";
import chalk from "chalk";

export type ConfirmChoice = "yes" | "no" | "select";

/**
 * Prompt for upgrade confirmation with select option.
 * Y = proceed with all, n = abort, s = open package selector.
 */
export async function confirmUpgrade(message: string): Promise<ConfirmChoice> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      `${message} [${chalk.bold("Y")}/${chalk.dim("n")}/${chalk.cyan("s")}elect] `
    );
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === "n" || trimmed === "no") return "no";
    if (trimmed === "s" || trimmed === "select") return "select";
    return "yes";
  } finally {
    rl.close();
  }
}

/**
 * Interactive checkbox selector for choosing which packages to upgrade.
 * All packages start checked; user unchecks what they don't want.
 */
export async function selectPackages(
  packages: OutdatedPackage[],
  detectedMap: Map<string, DetectedApp>
): Promise<OutdatedPackage[]> {
  // Build choice labels with version info and restart status
  const choices = packages.map((pkg) => {
    const detected = detectedMap.get(pkg.name);
    const version = `${chalk.red(shortVersion(pkg.installedVersions[0] ?? ""))} ${chalk.dim("→")} ${chalk.green(shortVersion(pkg.currentVersion))}`;
    const status = detected ? `  ${formatStatus(detected)}` : "";
    const label = `${chalk.white(pkg.name)}  ${version}${status}`;

    return {
      name: label,
      value: pkg.name,
      checked: true,
    };
  });

  const selected = await checkbox({
    message: "Select packages to upgrade",
    choices,
    pageSize: 20,
    loop: false,
    shortcuts: {
      all: "a",
      invert: "i",
    },
    theme: {
      prefix: chalk.cyan("?"),
      icon: {
        checked: chalk.green("◉"),
        unchecked: chalk.dim("◯"),
        cursor: chalk.cyan("❯"),
      },
      style: {
        highlight: (text: string) => chalk.cyan(text),
        help: (text: string) => chalk.dim(text),
        renderSelectedChoices: (selected: ReadonlyArray<{ name?: string; value: string }>) =>
          chalk.green(`${selected.length} selected`),
      },
    },
  });

  const selectedSet = new Set(selected);
  return packages.filter((p) => selectedSet.has(p.name));
}

export type PolicyChoice = "yes" | "ask" | "no";

/**
 * Prompt for quarantine policy before upgrades begin.
 * yes = auto-remove quarantine from all previously-approved apps,
 * ask = prompt per app, no = don't touch quarantine.
 */
export async function confirmQuarantinePolicy(approvedCount: number): Promise<PolicyChoice> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      `Remove quarantine from ${approvedCount} previously-approved app(s) after upgrade? [${chalk.dim("y")}es / ${chalk.bold("N")}o / as${chalk.cyan("k")}] `
    );
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === "y" || trimmed === "yes") return "yes";
    if (trimmed === "k" || trimmed === "ask") return "ask";
    return "no";
  } finally {
    rl.close();
  }
}

export type RestartChoice = "yes" | "no" | "all";

/**
 * Prompt for restart with yes/no/all options.
 * Returns "yes" to restart this one, "no" to skip, "all" to restart remaining without prompting.
 */
export async function confirmRestart(appName: string): Promise<RestartChoice> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      `Restart ${appName}? [${chalk.dim("y")}/${chalk.bold("N")}/${chalk.cyan("a")}ll] `
    );
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === "a" || trimmed === "all") return "all";
    if (trimmed === "y" || trimmed === "yes") return "yes";
    return "no";
  } finally {
    rl.close();
  }
}
