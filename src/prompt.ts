import * as readline from "node:readline/promises";

export async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === "y";
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
      `Restart ${appName}? [y/N/a(ll)] `
    );
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === "a" || trimmed === "all") return "all";
    if (trimmed === "y" || trimmed === "yes") return "yes";
    return "no";
  } finally {
    rl.close();
  }
}
