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
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Exercise the real entry point, orchestration and brew runner. Only process,
// config and quarantine adapters are mocked to avoid touching the host.
for (const mode of ["success", "partial", "lifecycle", "planning-failure"]) {
  test.skipIf(process.platform !== "darwin")(`CLI exits correctly after ${mode} run and remaining explicit requests`, async () => {
    const root = await mkdtemp(join(tmpdir(), "bouncer-cli-fixture-"));
    const src = new URL("../", import.meta.url).pathname;
    try {
      await mkdir(join(root, "bin"));
      await writeFile(join(root, "versions.json"), JSON.stringify({ "fixture-first": "1", "fixture-second": "1" }));
      await writeFile(join(root, "bin", "brew"), `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const root = process.env.BOUNCER_FIXTURE_ROOT;
const mode = process.env.BOUNCER_FIXTURE_MODE;
const args = process.argv.slice(2);
const versions = JSON.parse(readFileSync(root + "/versions.json", "utf8"));
if (args[0] === "update") process.exit(0);
if (args[0] === "outdated") {
  console.log(JSON.stringify({ casks: [], formulae: Object.entries(versions).filter(([,v]) => v !== "2").map(([name,v]) => ({ name, installed_versions: [v], current_version: "2" })) }));
} else if (args[0] === "info" && args.includes("--installed")) {
  console.log(JSON.stringify({ casks: [], formulae: Object.entries(versions).map(([name,version]) => ({ name, installed: [{ version }] })) }));
} else if (args[0] === "upgrade") {
  if (args.includes("--dry-run")) {
    appendFileSync(root + "/plans", JSON.stringify(args) + "\\n");
    if (mode === "planning-failure") {
      console.error("Error: fixture dependency planning failed");
      process.exit(1);
    }
    console.log("==> Would upgrade 1 dependency:\\npycparser 3.11 -> 3.12");
    process.exit(0);
  }
  // Model Homebrew's expanded-plan approval: execution without --no-ask
  // must fail this fixture instead of silently accepting redirected stdin.
  if (!args.includes("--no-ask")) {
    console.error("Do you want to proceed with the upgrade? [y/n]");
    process.exit(91);
  }
  const name = args.at(-1);
  appendFileSync(root + "/requests", name + "\\n");
  if (mode === "partial" && name === "fixture-first") {
    console.error("Error: fixture permission change failed\\nAttempting rollback");
    process.exit(1);
  }
  versions[name] = "2";
  writeFileSync(root + "/versions.json", JSON.stringify(versions));
  console.log("fixture upgraded " + name);
} else { throw new Error("Unexpected fixture brew arguments: " + JSON.stringify(args)); }
`, { mode: 0o755 });
      await writeFile(join(root, "preload.ts"), `import { mock } from "bun:test";
mock.module(${JSON.stringify(join(src, "config.ts"))}, () => ({ loadConfig: async () => ({ ignore: [], promptDefaults: { upgrade: "yes", restartPolicy: "yes", quarantinePolicy: "yes" } }) }));
mock.module(${JSON.stringify(join(src, "detect/matcher.ts"))}, () => ({ detectRunningUpgrades: async () => [] }));
mock.module(${JSON.stringify(join(src, "detect/execution-context.ts"))}, () => ({ inspectExecutionContext: async () => ({ status: "known", rootPid: 999, frames: [], guiHosts: [], hints: { tmux: false }, issues: [] }), assessExecutionTarget: () => ({ membership: "not-host" }) }));
mock.module(${JSON.stringify(join(src, "quarantine.ts"))}, () => ({ enumeratePackageExecutables: async (packages) => process.env.BOUNCER_FIXTURE_MODE === "lifecycle" ? new Map(packages.map((p) => [p.name, ["/fixture/" + p.name]])) : new Map(), isQuarantined: async () => true, removeQuarantine: async () => false }));
`);
      const proc = Bun.spawn([process.execPath, "--preload", join(root, "preload.ts"), join(src, "index.ts"), "upgrade", "--yes", "fixture-first", "fixture-second"], {
        env: { ...process.env, HOMEBREW_PREFIX: root, BOUNCER_FIXTURE_ROOT: root, BOUNCER_FIXTURE_MODE: mode },
        stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect({ exit, stderr }).toMatchObject({ exit: mode === "success" ? 0 : 1 });
      expect(JSON.parse((await readFile(join(root, "plans"), "utf8")).trim())).toEqual([
        "upgrade", "--dry-run", "--formula", "fixture-first", "fixture-second",
      ]);
      expect(stderr).not.toContain("Do you want to proceed with the upgrade?");
      if (mode === "planning-failure") {
        expect(await Bun.file(join(root, "requests")).exists()).toBe(false);
        expect(stderr).toContain("fixture dependency planning failed");
        return;
      }
      expect(stdout.indexOf("pycparser")).toBeLessThan(stdout.indexOf("fixture upgraded"));
      expect(stdout.match(/The following packages will be/g)).toHaveLength(1);
      expect(stdout).not.toContain("==> Would upgrade");
      expect(stdout).not.toContain("Homebrew upgrade plan (including");
      expect(await readFile(join(root, "requests"), "utf8")).toBe("fixture-first\nfixture-second\n");
      expect(stdout).toContain(mode === "partial" ? "1 successful upgrade request" : "2 successful upgrade requests");
      if (mode === "partial") {
        expect(stdout).toContain("Failed upgrade: fixture-first:");
        expect(stdout).toContain("Attempting rollback");
      }
      if (mode === "lifecycle") {
        expect(stdout).toContain("fixture-first: quarantine removal failed");
        expect(stdout).toContain("fixture-second: quarantine removal failed");
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 10000);
}
