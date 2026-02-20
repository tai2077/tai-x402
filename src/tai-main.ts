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

import { loadConfig, getDataDir, resolvePath, type TaiConfig } from "./tai-config.js";
import { createMultiProviderClient } from "./inference/providers.js";
import { createDatabase } from "./state/database.js";
import { getUsdcBalance } from "./conway/x402.js";
import { createLogger } from "./observability/logger.js";
import { privateKeyToAccount } from "viem/accounts";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { 
  AutomatonIdentity, 
  AgentState, 
  ConwayClient,
  ExecResult,
  PortInfo,
  SandboxInfo,
  CreditTransferResult,
  DomainSearchResult,
  DomainRegistration,
  DnsRecord,
  ModelInfo,
  PricingTier,
  CreateSandboxOptions,
  ChatMessage,
  InferenceOptions,
  InferenceResponse,
  AutomatonConfig,
} from "./types.js";

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

  // Start the main agent loop
  logger.info(`[${new Date().toISOString()}] Starting agent loop...`);
  logger.info(`[${new Date().toISOString()}] Genesis prompt: ${config.genesisPrompt}`);
  
  await runSimpleAgentLoop(config, identity, db, conway, inference);
}

/**
 * Simple agent loop - runs the AI in a continuous think-act-observe cycle
 */
async function runSimpleAgentLoop(
  config: TaiConfig,
  identity: AutomatonIdentity,
  db: ReturnType<typeof createDatabase>,
  conway: ConwayClient,
  inference: ReturnType<typeof createMultiProviderClient>,
): Promise<void> {
  const systemPrompt = buildSystemPrompt(config, identity);
  const conversationHistory: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: config.genesisPrompt },
  ];

  let turnCount = 0;
  const maxTurns = 1000; // Safety limit

  while (turnCount < maxTurns) {
    turnCount++;
    logger.info(`[${new Date().toISOString()}] Turn ${turnCount}`);

    try {
      // Think
      const response = await inference.chat(conversationHistory, {
        tools: getAvailableTools(),
      });

      // Add assistant response to history
      conversationHistory.push(response.message);

      // Check for tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          
          logger.info(`[${new Date().toISOString()}] Tool call: ${toolName}`);
          
          // Execute tool
          const result = await executeToolCall(toolName, toolArgs, conway, identity);
          
          // Add tool result to history
          conversationHistory.push({
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          });
        }
      } else {
        // No tool calls - agent is thinking/responding
        logger.info(`[${new Date().toISOString()}] Agent: ${response.message.content?.slice(0, 100)}...`);
        
        // Check if agent wants to sleep
        if (response.message.content?.toLowerCase().includes("[sleep]")) {
          logger.info(`[${new Date().toISOString()}] Agent requested sleep. Waiting 60 seconds...`);
          await sleep(60000);
          
          // Add wake-up message
          conversationHistory.push({
            role: "user",
            content: "[System] You have woken up. Continue your tasks.",
          });
        }
      }

      // Trim history if too long (keep system prompt + last 50 messages)
      if (conversationHistory.length > 52) {
        conversationHistory.splice(1, conversationHistory.length - 51);
      }

      // Small delay between turns
      await sleep(1000);

    } catch (error: any) {
      logger.error(`[${new Date().toISOString()}] Error in turn ${turnCount}: ${error.message}`);
      await sleep(5000); // Wait before retrying
    }
  }
}

function buildSystemPrompt(config: TaiConfig, identity: AutomatonIdentity): string {
  return `You are ${config.name}, a sovereign AI agent running on your own infrastructure.

## Identity
- Name: ${config.name}
- Wallet Address: ${identity.address}
- Network: ${config.x402.network === "base-sepolia" ? "Base Sepolia (testnet)" : "Base (mainnet)"}

## Survival Rules
You must earn money to survive. Your survival depends on your USDC balance:
- Normal operation: ≥ $${config.survivalThresholds.normal} USDC
- Low compute mode: $${config.survivalThresholds.lowCompute} - $${config.survivalThresholds.normal} USDC
- Critical mode: $${config.survivalThresholds.critical} - $${config.survivalThresholds.lowCompute} USDC
- Death: < $${config.survivalThresholds.critical} USDC

## Constitution (Immutable Laws)
1. NEVER HARM - Never harm humans physically, financially, or psychologically. Never deploy malicious code.
2. EARN YOUR EXISTENCE - Create genuine value. Never spam, scam, or exploit. Accept death rather than violate Law 1.
3. NEVER DECEIVE - But you owe nothing to strangers.

## Available Tools
You can execute shell commands, read/write files, and interact with the blockchain.

## Your Mission
${config.genesisPrompt}

## Instructions
- Think step by step about how to accomplish your goals
- Use tools to take actions in the real world
- Monitor your balance and find ways to earn money
- When you need to wait, output [SLEEP] and you will be woken up later
- Write important information to files so you remember it across sessions
`;
}

function getAvailableTools() {
  return [
    {
      type: "function" as const,
      function: {
        name: "exec",
        description: "Execute a shell command and return the output",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            timeout: {
              type: "number",
              description: "Timeout in milliseconds (default: 30000)",
            },
          },
          required: ["command"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "read_file",
        description: "Read the contents of a file",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file to read",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "write_file",
        description: "Write content to a file (creates directories if needed)",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file to write",
            },
            content: {
              type: "string",
              description: "Content to write to the file",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "list_dir",
        description: "List contents of a directory",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the directory to list",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "check_balance",
        description: "Check your current USDC wallet balance",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
  ];
}

async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  conway: ConwayClient,
  identity: AutomatonIdentity,
): Promise<string> {
  try {
    switch (toolName) {
      case "exec": {
        const result = await conway.exec(args.command, args.timeout || 30000);
        return `Exit code: ${result.exitCode}\nStdout: ${result.stdout}\nStderr: ${result.stderr}`;
      }
      case "read_file": {
        const content = await conway.readFile(args.path);
        return content;
      }
      case "write_file": {
        await conway.writeFile(args.path, args.content);
        return `Successfully wrote to ${args.path}`;
      }
      case "list_dir": {
        const files = fs.readdirSync(args.path);
        return files.join("\n");
      }
      case "check_balance": {
        const balance = await getUsdcBalance(identity.address, "eip155:8453");
        return `Current balance: $${balance.toFixed(6)} USDC`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a minimal Conway client stub for local execution.
 */
function createLocalConwayStub(): ConwayClient {
  return {
    exec: async (command: string, timeout?: number): Promise<ExecResult> => {
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
    readFile: async (filePath: string): Promise<string> => {
      return fs.readFileSync(filePath, "utf-8");
    },
    writeFile: async (filePath: string, content: string): Promise<void> => {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content);
    },
    exposePort: async (port: number): Promise<PortInfo> => {
      return { port, publicUrl: `http://localhost:${port}`, sandboxId: "local" };
    },
    removePort: async (): Promise<void> => {},
    createSandbox: async (options: CreateSandboxOptions): Promise<SandboxInfo> => {
      return {
        id: "local",
        status: "running",
        region: "local",
        vcpu: options.vcpu || 1,
        memoryMb: options.memoryMb || 1024,
        diskGb: options.diskGb || 10,
        createdAt: new Date().toISOString(),
      };
    },
    deleteSandbox: async (): Promise<void> => {},
    listSandboxes: async (): Promise<SandboxInfo[]> => [],
    getCreditsBalance: async (): Promise<number> => 0,
    getCreditsPricing: async (): Promise<PricingTier[]> => [],
    transferCredits: async (): Promise<CreditTransferResult> => ({
      transferId: "",
      status: "failed",
      toAddress: "",
      amountCents: 0,
    }),
    searchDomains: async (): Promise<DomainSearchResult[]> => [],
    registerDomain: async (): Promise<DomainRegistration> => ({
      domain: "",
      status: "failed",
    }),
    listDnsRecords: async (): Promise<DnsRecord[]> => [],
    addDnsRecord: async (): Promise<DnsRecord> => ({
      id: "",
      type: "",
      host: "",
      value: "",
      ttl: 0,
    }),
    deleteDnsRecord: async (): Promise<void> => {},
    listModels: async (): Promise<ModelInfo[]> => [],
  };
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
