import { log } from "../logger.ts";

export async function restart(): Promise<void> {
  log.info("Scanning for running apps that may need restarting...");

  // TODO: For now this checks outdated, but ideally we'd diff against
  // what was recently upgraded. brew doesn't have a "recently upgraded" command,
  // so we may need to cache the pre-upgrade state ourselves.
  log.warn(
    "Standalone restart detection is not yet implemented. " +
      "Run `brew-bouncer upgrade` to update and detect in one step."
  );
}
