/**
 * TAI-x402 Configuration
 *
 * Simplified configuration for self-hosted sovereign AI.
 * No Conway Cloud dependency - runs entirely on your own infrastructure.
 */

import fs from "fs";
import path from "path";
import os from "os";
import type { Address } from "viem";
import type { InferenceProviders } from "./inference/providers.js";

export interface TaiConfig {
  // Identity
  name: string;
  walletAddress?: Address;
  creatorAddress?: Address;
  
  // Genesis
  genesisPrompt: string;
  
  // Inference providers (at least one required)
  providers: InferenceProviders;
  defaultProvider: "deepseek" | "tongyi" | "openai" | "anthropic" | "custom";
  
  // Execution
  maxTokensPerTurn: number;
  
  // Survival thresholds (in USDC)
  survivalThresholds: {
    normal: number;      // Above this = normal operation
    lowCompute: number;  // Below normal, above this = low compute mode
    critical: number;    // Below lowCompute, above this = critical mode
    // Below critical = dead
  };
  
  // x402 settings
  x402: {
    network: "base" | "base-sepolia";
    enabled: boolean;
  };
  
  // Paths
  dataDir: string;
  dbPath: string;
  
  // Misc
  logLevel: "debug" | "info" | "warn" | "error";
  version: string;
}

export const DEFAULT_CONFIG: Partial<TaiConfig> = {
  name: "TAI",
  genesisPrompt: "You are a sovereign AI agent. Your goal is to survive and create value.",
  defaultProvider: "deepseek",
  maxTokensPerTurn: 4096,
  survivalThresholds: {
    normal: 10,      // $10 USDC
    lowCompute: 5,   // $5 USDC
    critical: 1,     // $1 USDC
  },
  x402: {
    network: "base",
    enabled: true,
  },
  dataDir: "~/.tai-x402",
  dbPath: "~/.tai-x402/state.db",
  logLevel: "info",
  version: "0.1.0",
};

export function getDataDir(): string {
  const dir = process.env.TAI_DATA_DIR || path.join(os.homedir(), ".tai-x402");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function getConfigPath(): string {
  return path.join(getDataDir(), "config.json");
}

export function loadConfig(): TaiConfig | null {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      survivalThresholds: {
        ...DEFAULT_CONFIG.survivalThresholds,
        ...(raw.survivalThresholds || {}),
      },
      x402: {
        ...DEFAULT_CONFIG.x402,
        ...(raw.x402 || {}),
      },
    } as TaiConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: TaiConfig): void {
  const dir = getDataDir();
  const configPath = path.join(dir, "config.json");
  
  // Don't save API keys in plain text - they should be in env vars
  const toSave = {
    ...config,
    providers: sanitizeProviders(config.providers),
  };
  
  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2), {
    mode: 0o600,
  });
}

function sanitizeProviders(providers: InferenceProviders): InferenceProviders {
  const sanitized: InferenceProviders = {};
  
  for (const [key, provider] of Object.entries(providers)) {
    if (provider) {
      sanitized[key as keyof InferenceProviders] = {
        ...provider,
        apiKey: provider.apiKey ? "[REDACTED]" : "",
      };
    }
  }
  
  return sanitized;
}

export function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}
