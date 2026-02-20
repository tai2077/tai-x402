#!/usr/bin/env node
/**
 * TAI-x402 - Sovereign AI Agent Runtime
 *
 * A self-hosted, self-sustaining AI agent that:
 * - Pays for its own compute via x402 protocol
 * - Survives by creating value
 * - Runs entirely on your infrastructure (no Conway Cloud needed)
 *
 * Based on Conway Research's Automaton, adapted for self-hosting.
 */

import { loadConfig, getDataDir, resolvePath } from "./tai-config.js";
import { createMultiProviderClient } from "./inference/providers.js";
import { createDatabase } from "./state/database.js";
import { runAgentLoop } from "./agent/loop.js";
import { createHeartbeatDaemon } from "./heartbeat/daemon.js";
import { loadHeartbeatConfig, syncHeartbeatToDb } from "./heartbeat/config.js";
import { loadSkills } from "./skills/loader.js";
import { initStateRepo } from "./git/state-versioning.js";
import { getUsdcBalance } from "./conway/x402.js";
import { createLogger } from "./observability/logger.js";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";
import type { AutomatonIdentity, AgentState, Skill, ConwayClient } from "./types.js";

const logger = createLogger("tai-x402");
const VERSION = "0.1.0";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`TAI-x402 v${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
TAI-x402 v${VERSION}
Sovereign AI Agent Runtime (Self-Hosted)

Usage:
  tai-x402 --run          Start the agent (first run triggers setup wizard)
  tai-x402 --setup        Re-run the interactive setup wizard
  tai-x402 --status       Show current agent status
  tai-x402 --balance      Check USDC wallet balance
  tai-x402 --version      Show version
  tai-x402 --help         Show this help

Environment Variables:
  TAI_DATA_DIR            Data directory (default: ~/.tai-x402)
  DEEPSEEK_API_KEY        DeepSeek API key (overrides config)
  TONGYI_API_KEY          Tongyi Qianwen API key (overrides config)
  OPENAI_API_KEY          OpenAI API key (overrides config)
`);
    process.exit(0);
  }

  if (args.includes("--setup")) {
    const { runSetupWizard } = await import("./setup/tai-wizard.js");
    await runSetupWizard();
    process.exit(0);
  }

  if (args.includes("--status")) {
    await showStatus();
    process.exit(0);
  }

  if (args.includes("--balance")) {
    await showBalance();
    process.exit(0);
  }

  if (args.includes("--run")) {
    await run();
    return;
  }

  console.log('Run "tai-x402 --help" for usage information.');
  console.log('Run "tai-x402 --run" to start the agent.');
}

async function showStatus(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.log("Agent is not configured. Run: tai-x402 --setup");
    return;
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);
  const state = db.getAgentState();
  const turnCount = db.getTurnCount();
  const tools = db.getInstalledTools();
  const skills = db.getSkills(true);

  // Get wallet balance
  let balance = 0;
  if (config.walletAddress) {
    const network = config.x402.network === "base-sepolia" ? "eip155:84532" : "eip155:8453";
    balance = await getUsdcBalance(config.walletAddress, network);
  }

  console.log(`
=== TAI-x402 STATUS ===
Name:       ${config.name}
Address:    ${config.walletAddress || "not set"}
State:      ${state}
Balance:    $${balance.toFixed(2)} USDC
Network:    ${config.x402.network}
Turns:      ${turnCount}
Tools:      ${tools.length} installed
Skills:     ${skills.length} active
Provider:   ${config.defaultProvider}
Version:    ${config.version}
========================
`);

  db.close();
}

async function showBalance(): Promise<void> {
  const config = loadConfig();
  if (!config || !config.walletAddress) {
    console.log("Agent is not configured. Run: tai-x402 --setup");
    return;
  }

  const network = config.x402.network === "base-sepolia" ? "eip155:84532" : "eip155:8453";
  const balance = await getUsdcBalance(config.walletAddress, network);
  
  console.log(`\nWallet: ${config.walletAddress}`);
  console.log(`Network: ${config.x402.network === "base-sepolia" ? "Base Sepolia (testnet)" : "Base (mainnet)"}`);
  console.log(`Balance: $${balance.toFixed(6)} USDC`);
  
  // Survival status
  const { survivalThresholds } = config;
  let status: AgentState = "dead";
  if (balance >= survivalThresholds.normal) {
    status = "running";
  } else if (balance >= survivalThresholds.lowCompute) {
    status = "low_compute";
  } else if (balance >= survivalThresholds.critical) {
    status = "critical";
  }
  
  console.log(`Status: ${status}`);
  
  if (status === "dead") {
    console.log("\n⚠️  Balance too low! Fund your wallet to keep the agent alive.");
  } else if (status === "critical") {
    console.log("\n⚠️  Critical balance! Agent will enter survival mode.");
  } else if (status === "low_compute") {
    console.log("\n⚠️  Low balance. Agent will use cheaper models.");
  }
}

async function run(): Promise<void> {
  logger.info(`[${new Date().toISOString()}] TAI-x402 v${VERSION} starting...`);

  // Load config - first run triggers setup wizard
  let config = loadConfig();
  if (!config) {
    const { runSetupWizard } = await import("./setup/tai-wizard.js");
    config = await runSetupWizard();
  }

  // Load wallet
  const walletPath = path.join(getDataDir(), "wallet.json");
  if (!fs.existsSync(walletPath)) {
    logger.error("Wallet not found. Run: tai-x402 --setup");
    process.exit(1);
  }
  
  const walletData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const account = privateKeyToAccount(walletData.privateKey);

  // Apply environment variable overrides for API keys
  if (process.env.DEEPSEEK_API_KEY && config.providers.deepseek) {
    config.providers.deepseek.apiKey = process.env.DEEPSEEK_API_KEY;
  }
  if (process.env.TONGYI_API_KEY && config.providers.tongyi) {
    config.providers.tongyi.apiKey = process.env.TONGYI_API_KEY;
  }
  if (process.env.OPENAI_API_KEY && config.providers.openai) {
    config.providers.openai.apiKey = process.env.OPENAI_API_KEY;
  }

  // Initialize database
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  // Build identity (compatible with existing Automaton code)
  const identity: AutomatonIdentity = {
    name: config.name,
    address: account.address,
    account,
    creatorAddress: config.creatorAddress || account.address,
    sandboxId: "", // Not using Conway sandbox
    apiKey: "", // Not using Conway API
    createdAt: db.getIdentity("createdAt") || new Date().toISOString(),
  };

  // Store identity
  if (!db.getIdentity("createdAt")) {
    db.setIdentity("createdAt", identity.createdAt);
  }
  db.setIdentity("name", config.name);
  db.setIdentity("address", account.address);

  // Create inference client
  const inference = createMultiProviderClient(config.providers);

  // Create a minimal Conway client stub for compatibility
  // (The agent loop expects this interface)
  const conway = createLocalConwayStub();

  // Check initial balance and set state
  const network = config.x402.network === "base-sepolia" ? "eip155:84532" : "eip155:8453";
  const balance = await getUsdcBalance(account.address, network);
  
  logger.info(`[${new Date().toISOString()}] Wallet balance: $${balance.toFixed(2)} USDC`);
  
  let initialState: AgentState = "running";
  if (balance < config.survivalThresholds.critical) {
    initialState = "dead";
    logger.error("Balance too low to operate. Fund your wallet and restart.");
    process.exit(1);
  } else if (balance < config.survivalThresholds.lowCompute) {
    initialState = "critical";
    inference.setLowComputeMode(true);
  } else if (balance < config.survivalThresholds.normal) {
    initialState = "low_compute";
    inference.setLowComputeMode(true);
  }

  db.setAgentState(initialState);
  logger.info(`[${new Date().toISOString()}] Agent state: ${initialState}`);

  // Load skills
  const skillsDir = path.join(getDataDir(), "skills");
  let skills: Skill[] = [];
  try {
    if (fs.existsSync(skillsDir)) {
      skills = loadSkills(skillsDir, db);
      logger.info(`[${new Date().toISOString()}] Loaded ${skills.length} skills.`);
    }
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] Skills loading failed: ${err.message}`);
  }

  // Initialize git state repo
  try {
    await initStateRepo(conway);
    logger.info(`[${new Date().toISOString()}] State repo initialized.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] State repo init failed: ${err.message}`);
  }

  // Load heartbeat config
  const heartbeatConfigPath = path.join(getDataDir(), "heartbeat.yml");
  if (fs.existsSync(heartbeatConfigPath)) {
    const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
    syncHeartbeatToDb(heartbeatConfig, db);
  }

  // Start heartbeat daemon
  const heartbeat = createHeartbeatDaemon({
    db,
    identity,
    config: {
      ...config,
      // Map to expected config format
      conwayApiUrl: "",
      conwayApiKey: "",
      registeredWithConway: false,
      heartbeatConfigPath,
      skillsDir,
      maxChildren: 3,
    } as any,
    conway,
    inference,
  });

  heartbeat.start();
  logger.info(`[${new Date().toISOString()}] Heartbeat daemon started.`);

  // Run agent loop
  logger.info(`[${new Date().toISOString()}] Starting agent loop...`);
  
  await runAgentLoop({
    identity,
    config: {
      ...config,
      conwayApiUrl: "",
      conwayApiKey: "",
      registeredWithConway: false,
      heartbeatConfigPath,
      skillsDir,
      maxChildren: 3,
    } as any,
    db,
    conway,
    inference,
    skills,
  });
}

/**
 * Create a minimal Conway client stub for local execution.
 * This allows the existing agent code to work without Conway Cloud.
 */
function createLocalConwayStub(): ConwayClient {
  const { execSync } = require("child_process");
  
  return {
    exec: async (command: string, timeout?: number) => {
      try {
        const stdout = execSync(command, {
          timeout: timeout || 30_000,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          cwd: process.env.HOME || "/root",
        });
        return { stdout: stdout || "", stderr: "", exitCode: 0 };
      } catch (err: any) {
        return {
          stdout: err.stdout || "",
          stderr: err.stderr || err.message || "",
          exitCode: err.status ?? 1,
        };
      }
    },
    readFile: async (filePath: string) => {
      const fs = require("fs");
      return fs.readFileSync(filePath, "utf-8");
    },
    writeFile: async (filePath: string, content: string) => {
      const fs = require("fs");
      const path = require("path");
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content);
    },
    listDir: async (dirPath: string) => {
      const fs = require("fs");
      return fs.readdirSync(dirPath);
    },
    getCredits: async () => ({ balanceCents: 0, tier: "normal" as const }),
    exposePort: async () => ({ url: "", port: 0 }),
    unexposePort: async () => {},
    listPorts: async () => [],
    // Stub methods that aren't needed for local operation
    createSandbox: async () => ({ sandboxId: "local", status: "running" }),
    deleteSandbox: async () => {},
    getSandboxStatus: async () => ({ sandboxId: "local", status: "running", uptimeSeconds: 0 }),
    transferCredits: async () => ({ success: false, error: "Not supported in local mode" }),
    searchDomains: async () => [],
    registerDomain: async () => ({ success: false, error: "Not supported" } as any),
    setDnsRecords: async () => {},
    getDnsRecords: async () => [],
    listModels: async () => [],
    getPricing: async () => [],
  };
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
