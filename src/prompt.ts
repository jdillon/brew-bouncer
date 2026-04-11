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
export type PolicyChoice = "yes" | "ask" | "no";
export type RestartPolicy = PolicyChoice;
export type RestartChoice = "yes" | "no" | "all";

interface PromptOption<T extends string> {
  value: T;
  label: string;
  aliases: string[];
  shortcut: string;
}

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function formatOption<T extends string>(option: PromptOption<T>, defaultValue: T): string {
  const shortcutIndex = option.label.toLowerCase().indexOf(option.shortcut.toLowerCase());
  if (shortcutIndex === -1) {
    return option.value === defaultValue
      ? chalk.bold(option.label)
      : chalk.dim(option.label);
  }

  const prefix = option.label.slice(0, shortcutIndex);
  const shortcut = option.label.slice(shortcutIndex, shortcutIndex + option.shortcut.length);
  const suffix = option.label.slice(shortcutIndex + option.shortcut.length);

  if (option.value === defaultValue) {
    return `${chalk.dim(prefix)}${chalk.bold(shortcut.toUpperCase())}${chalk.dim(suffix)}`;
  }

  return `${chalk.dim(prefix)}${chalk.cyan(shortcut)}${chalk.dim(suffix)}`;
}

async function promptChoice<T extends string>(
  message: string,
  options: PromptOption<T>[],
  defaultValue: T
): Promise<T> {
  const rl = createInterface();

  try {
    const renderedOptions = options.map((option) => formatOption(option, defaultValue)).join(" / ");
    const answer = await rl.question(`${message} [${renderedOptions}] `);
    const trimmed = answer.trim().toLowerCase();

    if (trimmed.length === 0) {
      return defaultValue;
    }

    for (const option of options) {
      if (option.aliases.includes(trimmed)) {
        return option.value;
      }
    }

    return defaultValue;
  } finally {
    rl.close();
  }
}

const upgradeOptions: PromptOption<ConfirmChoice>[] = [
  { value: "yes", label: "yes", aliases: ["y", "yes"], shortcut: "y" },
  { value: "no", label: "no", aliases: ["n", "no"], shortcut: "n" },
  { value: "select", label: "select", aliases: ["s", "select"], shortcut: "s" },
];

const yesNoOptions: PromptOption<"yes" | "no">[] = [
  { value: "yes", label: "yes", aliases: ["y", "yes"], shortcut: "y" },
  { value: "no", label: "no", aliases: ["n", "no"], shortcut: "n" },
];

const restartPolicyOptions: PromptOption<PolicyChoice>[] = [
  { value: "yes", label: "yes", aliases: ["y", "yes"], shortcut: "y" },
  { value: "ask", label: "ask", aliases: ["a", "ask", "k"], shortcut: "a" },
  { value: "no", label: "no", aliases: ["n", "no"], shortcut: "n" },
];

const restartOptions: PromptOption<RestartChoice>[] = [
  { value: "yes", label: "yes", aliases: ["y", "yes"], shortcut: "y" },
  { value: "no", label: "no", aliases: ["n", "no"], shortcut: "n" },
  { value: "all", label: "all", aliases: ["a", "all"], shortcut: "a" },
];

/**
 * Prompt for upgrade confirmation with select option.
 * Y = proceed with all, n = abort, s = open package selector.
 */
export async function confirmUpgrade(
  message: string,
  defaultChoice: ConfirmChoice = "yes"
): Promise<ConfirmChoice> {
  return promptChoice(message, upgradeOptions, defaultChoice);
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

/**
 * Prompt for restart policy before upgrades begin.
 * yes = auto-restart all, ask = prompt per app, no = skip all restarts.
 */
export async function confirmRestartPolicy(
  affectedCount: number,
  defaultChoice: RestartPolicy = "no"
): Promise<RestartPolicy> {
  return promptChoice(
    `Restart ${affectedCount} affected app(s) after upgrade?`,
    restartPolicyOptions,
    defaultChoice
  );
}

/**
 * Prompt for quarantine policy before upgrades begin.
 * yes = auto-remove quarantine from any quarantined executables post-upgrade,
 * ask = prompt per executable, no = don't touch quarantine.
 */
export async function confirmQuarantinePolicy(
  executableCount: number,
  defaultChoice: PolicyChoice = "no"
): Promise<PolicyChoice> {
  return promptChoice(
    `Remove quarantine from upgraded executables if quarantined? (${executableCount} to check)`,
    restartPolicyOptions,
    defaultChoice
  );
}

/**
 * Prompt to confirm removing quarantine from a specific app.
 * Y = remove (default), n = skip.
 */
export async function confirmUnquarantine(path: string): Promise<boolean> {
  return (await promptChoice(`  Remove quarantine from ${path}?`, yesNoOptions, "yes")) === "yes";
}

/**
 * Prompt for restart with yes/no/all options.
 * Returns "yes" to restart this one, "no" to skip, "all" to restart remaining without prompting.
 */
export async function confirmRestart(appName: string): Promise<RestartChoice> {
  return promptChoice(`Restart ${appName}?`, restartOptions, "no");
}
