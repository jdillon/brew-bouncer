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
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["brew-bouncer", "permissions"]);

// Read-only. Grants cannot be written (SIP) and resetting them is the user's call.
export const TCC_DATABASES = [
  "/Library/Application Support/com.apple.TCC/TCC.db",
  join(homedir(), "Library/Application Support/com.apple.TCC/TCC.db"),
];

export interface PermissionGrant {
  service: string;
  requirement: Uint8Array;
}

export interface AppPermissions {
  packageName: string;
  appPath: string;
  grants: PermissionGrant[];
  /** Services whose stored requirement only matches the currently installed build. */
  pinned: string[];
  /** TCC was unreadable and the app is ad-hoc signed, so its grants likely reset on upgrade. */
  adhocUnverified: boolean;
}

export interface PermissionInspection {
  tccReadable: boolean;
  apps: AppPermissions[];
}

const SERVICES: Record<string, [label: string, anchor: string]> = {
  kTCCServiceAccessibility: ["Accessibility", "Privacy_Accessibility"],
  kTCCServicePostEvent: ["Accessibility", "Privacy_Accessibility"],
  kTCCServiceSystemPolicyAllFiles: ["Full Disk Access", "Privacy_AllFiles"],
  kTCCServiceScreenCapture: ["Screen Recording", "Privacy_ScreenCapture"],
  kTCCServiceListenEvent: ["Input Monitoring", "Privacy_ListenEvent"],
  kTCCServiceAppleEvents: ["Automation", "Privacy_Automation"],
  kTCCServiceDeveloperTool: ["Developer Tools", "Privacy_DevTools"],
  kTCCServiceSystemPolicyAppBundles: ["App Management", "Privacy_AppBundles"],
  kTCCServiceSystemPolicyDocumentsFolder: ["Documents folder", "Privacy_DocumentsFolder"],
  kTCCServiceSystemPolicyDesktopFolder: ["Desktop folder", "Privacy_DesktopFolder"],
  kTCCServiceSystemPolicyDownloadsFolder: ["Downloads folder", "Privacy_DownloadsFolder"],
  kTCCServiceSystemPolicyNetworkVolumes: ["Network volumes", "Privacy_NetworkVolume"],
  kTCCServiceSystemPolicyRemovableVolumes: ["Removable volumes", "Privacy_RemovableVolume"],
  kTCCServiceCamera: ["Camera", "Privacy_Camera"],
  kTCCServiceMicrophone: ["Microphone", "Privacy_Microphone"],
  kTCCServiceCalendar: ["Calendars", "Privacy_Calendars"],
  kTCCServiceReminders: ["Reminders", "Privacy_Reminders"],
  kTCCServiceAddressBook: ["Contacts", "Privacy_Contacts"],
  kTCCServicePhotos: ["Photos", "Privacy_Photos"],
  kTCCServiceBluetoothAlways: ["Bluetooth", "Privacy_Bluetooth"],
};

export function permissionLabel(service: string): string {
  return SERVICES[service]?.[0] ?? service.replace(/^kTCCService/, "");
}

export function permissionSettingsUrl(service: string): string {
  const anchor = SERVICES[service]?.[1];
  return `x-apple.systempreferences:com.apple.preference.security${anchor ? `?${anchor}` : ""}`;
}

/** True when a requirement names only build hashes, not a signing identity. */
export function isHashPinned(requirement: string): boolean {
  return /\bcdhash\b/.test(requirement) && !/\b(?:anchor|identifier|certificate)\b/.test(requirement);
}

/** Keep allowed rows that carry a stored code requirement. */
export function parseTccRows(rows: Array<Record<string, unknown>>): PermissionGrant[] {
  return rows.flatMap((row) =>
    typeof row.service === "string" && row.csreq instanceof Uint8Array && row.csreq.length > 0
      ? [{ service: row.service, requirement: row.csreq }]
      : []);
}

/** Opens every TCC database read-only, or returns null when any is unreadable (no Full Disk Access). */
function openTccDatabases(paths: string[]): Database[] | null {
  const opened: Database[] = [];
  try {
    for (const path of paths) {
      const db = new Database(path, { readonly: true });
      opened.push(db);
      db.query("select 1 from access limit 1").all();
    }
    return opened;
  } catch (error) {
    log.debug("TCC database unreadable: {error}", { error: String(error) });
    for (const db of opened) db.close();
    return null;
  }
}

function readGrants(databases: Database[], bundleId: string): PermissionGrant[] {
  return databases.flatMap((db) => parseTccRows(db.query(
    "select service, csreq from access where client = ? and client_type = 0 and auth_value = 2",
  ).all(bundleId) as Array<Record<string, unknown>>));
}

async function run(cmd: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

async function withRequirementFile<T>(requirement: Uint8Array, use: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "brew-bouncer-csreq-"));
  try {
    const path = join(dir, "requirement.csreq");
    await writeFile(path, requirement);
    return await use(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function requirementText(requirement: Uint8Array): Promise<string> {
  return withRequirementFile(requirement, async (path) => {
    const result = await run(["csreq", "-r", path, "-t"]);
    if (result.exitCode !== 0) throw new Error(`csreq exited ${result.exitCode}: ${result.stderr.trim()}`);
    return result.stdout.trim();
  });
}

/** Whether an app still satisfies a stored requirement; null when the app is gone. */
export async function satisfiesRequirement(requirement: Uint8Array, appPath: string): Promise<boolean | null> {
  return withRequirementFile(requirement, async (path) => {
    const result = await run(["codesign", "-v", "-R", path, appPath]);
    if (result.exitCode === 0) return true;
    // codesign exits 3 when the code fails the supplied requirement.
    if (result.exitCode === 3) return false;
    if (result.stderr.includes("No such file")) return null;
    throw new Error(`codesign exited ${result.exitCode}: ${result.stderr.trim()}`);
  });
}

async function bundleIdentifier(appPath: string): Promise<string | null> {
  const result = await run(["plutil", "-extract", "CFBundleIdentifier", "raw", "-o", "-", `${appPath}/Contents/Info.plist`]);
  return result.exitCode === 0 ? result.stdout.trim() || null : null;
}

async function isAdhocSigned(appPath: string): Promise<boolean> {
  const result = await run(["codesign", "-dr", "-", appPath]);
  const designated = `${result.stdout}\n${result.stderr}`.match(/designated => (.+)/)?.[1];
  return result.exitCode === 0 && designated !== undefined && isHashPinned(designated);
}

/** Look up allowed privacy grants for every .app among the package executables. */
export async function inspectPackagePermissions(
  packageExecutables: Map<string, string[]>,
  databases: string[] = TCC_DATABASES,
): Promise<PermissionInspection> {
  const appPaths = [...packageExecutables].flatMap(([packageName, paths]) =>
    paths.filter((path) => path.endsWith(".app")).map((appPath) => ({ packageName, appPath })));
  if (appPaths.length === 0) return { tccReadable: true, apps: [] };

  const opened = openTccDatabases(databases);
  const apps: AppPermissions[] = [];
  try {
    for (const { packageName, appPath } of appPaths) {
      if (!opened) {
        if (await isAdhocSigned(appPath)) {
          apps.push({ packageName, appPath, grants: [], pinned: [], adhocUnverified: true });
        }
        continue;
      }
      const bundleId = await bundleIdentifier(appPath);
      if (!bundleId) continue;
      const grants = readGrants(opened, bundleId);
      if (grants.length === 0) continue;
      const pinned: string[] = [];
      for (const grant of grants) {
        if (isHashPinned(await requirementText(grant.requirement))) pinned.push(grant.service);
      }
      apps.push({ packageName, appPath, grants, pinned, adhocUnverified: false });
    }
  } finally {
    for (const db of opened ?? []) db.close();
  }
  return { tccReadable: opened !== null, apps };
}

/** Services whose stored requirement the installed (upgraded) app no longer satisfies. */
export async function findStaleGrants(app: AppPermissions): Promise<string[]> {
  const stale: string[] = [];
  for (const grant of app.grants) {
    if (await satisfiesRequirement(grant.requirement, app.appPath) === false) stale.push(grant.service);
  }
  return [...new Set(stale)];
}

export function appDisplayName(appPath: string): string {
  return basename(appPath).replace(/\.app$/, "");
}
