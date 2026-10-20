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
export interface UpgradeDiagnostic {
  packageName: string;
  level: "warning" | "error";
  message: string;
}

/** Keep context, but drop terminal styling and overwritten progress frames. */
export function normalizeTerminalOutput(text: string): string {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n").map((line) => line.split("\r").at(-1) ?? "").join("\n")
    .replace(/[^\n]\x08/g, "");
}

export function collectUpgradeDiagnostics(
  packageName: string, stdout: string, stderr: string,
): UpgradeDiagnostic[] {
  const diagnostics: UpgradeDiagnostic[] = [];
  const seen = new Set<string>();
  // Do not attach stderr to an unterminated stdout block.
  for (const stream of [stdout, stderr]) {
    const lines = normalizeTerminalOutput(stream).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const nearby = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
      const shadowing = /\bshadow(?:s|ed|ing)?\b/i.test(line) &&
        /(?:\b(?:command|executable|binary|installation|PATH|Homebrew)\b|\/[\w.~@-]+\/)/i.test(nearby);
      const level = /^Error:/i.test(line) ? "error"
        : /^Warning:/i.test(line) || shadowing || /(?:takes? precedence.*PATH|PATH.*precedence)/i.test(line)
        ? "warning" : null;
      if (!level) continue;
      // Already-installed messages describe no-ops, not actionable warnings.
      if (/^Warning:.*already installed\.?$/i.test(line)) continue;
      let start = i;
      // A shadowing caveat may put the conflicting executable before its
      // explanation. Retain only nearby path-bearing lines, not phase output.
      if (shadowing || /precedence/i.test(line)) {
        while (start > Math.max(0, i - 3)) {
          const previous = lines[start - 1]!;
          if (!previous.trim() || /^(?:==>|Warning:|Error:)/i.test(previous.trim()) ||
              !/\/[\w.~@-]+\//.test(previous)) break;
          start--;
        }
      }
      const context = [...lines.slice(start, i).map((s) => s.trimEnd()), line];
      while (i + 1 < lines.length && context.length < 8) {
        const next = lines[i + 1]!;
        if (!next.trim() || /^(?:==>|Warning:|Error:)/i.test(next.trim())) break;
        // Homebrew continuation lines can be unindented. Stop at phase markers
        // and cap context, rather than replaying the remainder of the log.
        context.push(next.trimEnd());
        i++;
      }
      const message = context.join("\n");
      if (!seen.has(message)) diagnostics.push({ packageName, level, message });
      seen.add(message);
    }
  }
  return diagnostics;
}
