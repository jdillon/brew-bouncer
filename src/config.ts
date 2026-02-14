import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "brew-bouncer");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface BouncerConfig {
  ignore: string[];
}

const DEFAULT_CONFIG: BouncerConfig = {
  ignore: [],
};

export async function loadConfig(): Promise<BouncerConfig> {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (await file.exists()) {
      const data = await file.json();
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch {
    // Config doesn't exist or is invalid — use defaults
  }
  return DEFAULT_CONFIG;
}

export function configPath(): string {
  return CONFIG_FILE;
}
