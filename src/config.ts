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
import { homedir } from "node:os";
import { join } from "node:path";
import { getLogger } from "@logtape/logtape";
import { parse } from "yaml";

const log = getLogger(["brew-bouncer", "config"]);

const CONFIG_DIR = join(homedir(), ".config", "brew-bouncer");
const CONFIG_YAML = join(CONFIG_DIR, "config.yaml");
const CONFIG_JSON = join(CONFIG_DIR, "config.json");

export interface BouncerConfig {
  ignore: string[];
}

const DEFAULT_CONFIG: BouncerConfig = {
  ignore: [],
};

let loadedConfigPath: string | undefined;

function validateConfig(data: unknown, path: string): BouncerConfig {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${path}: config must be a YAML/JSON object, got ${Array.isArray(data) ? "array" : typeof data}`);
  }
  const obj = data as Record<string, unknown>;
  if ("ignore" in obj) {
    if (!Array.isArray(obj.ignore) || !obj.ignore.every((v) => typeof v === "string")) {
      throw new Error(`${path}: "ignore" must be an array of strings`);
    }
  }
  return { ...DEFAULT_CONFIG, ...obj } as BouncerConfig;
}

export async function loadConfig(): Promise<BouncerConfig> {
  const yamlExists = await Bun.file(CONFIG_YAML).exists();
  const jsonExists = await Bun.file(CONFIG_JSON).exists();

  if (yamlExists && jsonExists) {
    throw new Error(
      `Ambiguous config: both ${CONFIG_YAML} and ${CONFIG_JSON} exist. Remove one.`,
    );
  }

  if (yamlExists) {
    const text = await Bun.file(CONFIG_YAML).text();
    const data = parse(text) ?? {};
    const config = validateConfig(data, CONFIG_YAML);
    log.debug("Loaded config from {path} (ignore: {ignore})", {
      path: CONFIG_YAML,
      ignore: config.ignore.join(", ") || "none",
    });
    loadedConfigPath = CONFIG_YAML;
    return config;
  }

  if (jsonExists) {
    const data = await Bun.file(CONFIG_JSON).json();
    const config = validateConfig(data, CONFIG_JSON);
    log.debug("Loaded config from {path} (ignore: {ignore})", {
      path: CONFIG_JSON,
      ignore: config.ignore.join(", ") || "none",
    });
    log.warn("{path} is deprecated, rename to config.yaml", { path: CONFIG_JSON });
    loadedConfigPath = CONFIG_JSON;
    return config;
  }

  log.debug("Using default config (no ignore list)");
  loadedConfigPath = CONFIG_YAML;
  return DEFAULT_CONFIG;
}

export function configPath(): string {
  return loadedConfigPath ?? CONFIG_YAML;
}
