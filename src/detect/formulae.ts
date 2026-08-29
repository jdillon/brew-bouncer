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
import { getLogger } from "@logtape/logtape";

const log = getLogger(["brew-bouncer", "detect", "formulae"]);

export interface RunningProcess {
  pid: number;
  name: string;
  command: string;
}

export async function getRunningProcesses(): Promise<RunningProcess[]> {
  const proc = Bun.spawn(["ps", "axo", "pid,comm"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const lines = stdout.trim().split("\n").slice(1); // skip header
  log.debug("Running processes: {count}", { count: lines.length });
  return lines
    .map((line) => {
      const trimmed = line.trim();
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) return null;

      const pid = parseInt(trimmed.slice(0, spaceIdx), 10);
      const command = trimmed.slice(spaceIdx + 1).trim();
      // Extract just the binary name from the full path
      const name = command.split("/").pop() ?? command;

      return { pid, name, command };
    })
    .filter((p): p is RunningProcess => p !== null);
}

const KEG_ROOT = /^(.*\/Cellar\/[^/]+\/[^/]+)\//;

/**
 * Reduce `brew list <formula>` output to the keg roots it covers, e.g.
 * "/opt/homebrew/Cellar/awscli/2.36.33_1/". A formula with several installed
 * versions yields one prefix per keg.
 */
export function extractKegPrefixes(brewListOutput: string): string[] {
  const prefixes = new Set<string>();

  for (const line of brewListOutput.trim().split("\n")) {
    const match = KEG_ROOT.exec(line.trim());
    if (match) prefixes.add(`${match[1]}/`);
  }

  return [...prefixes];
}

/**
 * Match processes running from inside a formula's keg.
 *
 * Matching on the full executable path rather than its basename: `ps` reports
 * the resolved real path, so anything launched through Homebrew's bin symlinks
 * still lands under the keg. Basename matching claimed unrelated processes —
 * awscli vendors libexec/bin/python, which matched any running python.
 *
 * Prefix (not exact path) because plenty of formulae run from outside the keg's
 * top-level bin: moon from libexec/bin, python@3.14 from Frameworks.
 */
export function matchFormulaToRunningProcesses(
  kegPrefixes: string[],
  processes: RunningProcess[]
): RunningProcess[] {
  const matched: RunningProcess[] = [];
  const seen = new Set<number>();

  for (const prefix of kegPrefixes) {
    let found = false;
    for (const proc of processes) {
      if (proc.command.startsWith(prefix) && !seen.has(proc.pid)) {
        log.debug("Keg {prefix} matched PID {pid} ({command})", {
          prefix,
          pid: proc.pid,
          command: proc.command,
        });
        matched.push(proc);
        seen.add(proc.pid);
        found = true;
      }
    }
    if (!found) {
      log.debug("Keg {prefix} has nothing running", { prefix });
    }
  }

  return matched;
}

/**
 * Match processes by executable basename. Used for cask binary artifacts, which
 * symlink into the Caskroom rather than a keg, so there is no path prefix to
 * scope by. Looser than the formula path above — a same-named process from
 * elsewhere still matches.
 */
export function matchBinaryNamesToRunningProcesses(
  binaries: string[],
  processes: RunningProcess[]
): RunningProcess[] {
  const matched: RunningProcess[] = [];
  const seen = new Set<number>();

  for (const binary of binaries) {
    let found = false;
    for (const proc of processes) {
      if (proc.name === binary && !seen.has(proc.pid)) {
        log.debug("Binary {binary} matched PID {pid}", { binary, pid: proc.pid });
        matched.push(proc);
        seen.add(proc.pid);
        found = true;
      }
    }
    if (!found) {
      log.debug("Binary {binary} not running", { binary });
    }
  }

  return matched;
}

export interface RunningService {
  name: string;
  status: string;
}

export function matchFormulaToRunningServices(
  formulaName: string,
  services: Array<{ name: string; status: string }>
): RunningService | null {
  const match = services.find(
    (s) => s.name === formulaName && s.status === "started"
  );
  if (match) {
    log.debug("Formula {name} matched running service", { name: formulaName });
  }
  return match ? { name: match.name, status: match.status } : null;
}
