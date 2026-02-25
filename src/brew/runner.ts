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
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const BREW_PATH = "/opt/homebrew/bin/brew";

export async function exec(args: string[]): Promise<ExecResult> {
  const proc = Bun.spawn([BREW_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

/**
 * Run a brew command with stdout/stderr streaming directly to the terminal.
 * Use for --verbose passthrough where the user wants to see everything.
 */
export async function execStreaming(args: string[]): Promise<number> {
  const proc = Bun.spawn([BREW_PATH, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc.exited;
}

export async function brewUpdate(): Promise<ExecResult> {
  return exec(["update"]);
}

export async function brewOutdated(): Promise<ExecResult> {
  return exec(["outdated", "--greedy", "--json"]);
}

/**
 * Upgrade a single package with full terminal passthrough.
 * Brew owns stdout/stderr so the user sees all output including
 * prompts, caveats, and progress.
 */
export async function brewUpgrade(name: string): Promise<number> {
  return execStreaming(["upgrade", name]);
}

export async function brewInfoJson(names: string[]): Promise<ExecResult> {
  return exec(["info", "--json=v2", ...names]);
}

export async function brewList(formula: string): Promise<ExecResult> {
  return exec(["list", formula]);
}

export async function brewServicesList(): Promise<ExecResult> {
  return exec(["services", "list"]);
}

/**
 * Query macOS pkg receipt for installed files.
 * Returns top-level .app bundle names found in the receipt.
 */
export async function pkgutilAppNames(pkgId: string): Promise<string[]> {
  const proc = Bun.spawn(["pkgutil", "--files", pkgId], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) return [];

  // Find top-level .app entries (e.g., "zoom.us.app" not nested ones)
  const apps: string[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (/^[^/]+\.app$/.test(line)) {
      apps.push(line);
    }
  }

  return apps;
}
