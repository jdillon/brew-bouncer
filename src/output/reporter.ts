import type { DetectedApp } from "../detect/matcher.ts";

const KIND_LABELS: Record<DetectedApp["kind"], string> = {
  "cask-gui": "GUI app",
  "formula-cli": "CLI process",
  "formula-service": "brew service",
};

export function formatReport(
  totalUpgraded: number,
  formulaeCount: number,
  caskCount: number,
  detected: DetectedApp[]
): string {
  const lines: string[] = [];

  lines.push(
    `Upgraded ${totalUpgraded} packages (${formulaeCount} formulae, ${caskCount} casks)`
  );

  if (detected.length === 0) {
    lines.push("No running apps or processes were affected.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(
    `${detected.length} running app(s) need restarting:`
  );
  lines.push("");

  for (const app of detected) {
    lines.push(
      `  ${padRight(app.displayName, 20)} ${app.packageName} ${app.oldVersion} -> ${app.newVersion}  (${KIND_LABELS[app.kind]})`
    );
  }

  return lines.join("\n");
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}
