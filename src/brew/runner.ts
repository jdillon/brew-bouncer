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
 * Use this for long-running commands (update, upgrade) where the user
 * should see progress in real time.
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

export async function brewUpdateStreaming(): Promise<number> {
  return execStreaming(["update"]);
}

export async function brewOutdated(): Promise<ExecResult> {
  return exec(["outdated", "--greedy", "--json"]);
}

export async function brewUpgrade(packages?: string[]): Promise<ExecResult> {
  if (packages && packages.length > 0) {
    return exec(["upgrade", ...packages]);
  }
  return exec(["upgrade", "--greedy"]);
}

export async function brewUpgradeStreaming(packages?: string[]): Promise<number> {
  if (packages && packages.length > 0) {
    return execStreaming(["upgrade", ...packages]);
  }
  return execStreaming(["upgrade", "--greedy"]);
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
