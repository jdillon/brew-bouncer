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

export function extractFormulaBinaries(brewListOutput: string): string[] {
  return brewListOutput
    .trim()
    .split("\n")
    .filter((line) => /\/(s?bin)\//.test(line))
    .map((line) => line.trim().split("/").pop() ?? "")
    .filter(Boolean);
}

export function matchFormulaToRunningProcesses(
  binaries: string[],
  processes: RunningProcess[]
): RunningProcess[] {
  const matched: RunningProcess[] = [];
  const seen = new Set<number>();

  for (const binary of binaries) {
    for (const proc of processes) {
      if (proc.name === binary && !seen.has(proc.pid)) {
        matched.push(proc);
        seen.add(proc.pid);
      }
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
  return match ? { name: match.name, status: match.status } : null;
}
