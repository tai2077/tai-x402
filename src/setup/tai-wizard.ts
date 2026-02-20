/**
 * TAI-x402 Setup Wizard
 *
 * Interactive setup for first-time configuration.
 * Generates wallet, configures inference providers, sets survival parameters.
 */

import readline from "readline";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";
import type { TaiConfig } from "../tai-config.js";
import { getDataDir, saveConfig, DEFAULT_CONFIG } from "../tai-config.js";
import type { InferenceProviders, ProviderConfig } from "../inference/providers.js";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    
    let input = "";
    const onData = (char: Buffer) => {
      const c = char.toString();
      if (c === "\n" || c === "\r") {
        stdin.removeListener("data", onData);
        if (stdin.isTTY && wasRaw !== undefined) {
          stdin.setRawMode(wasRaw);
        }
        process.stdout.write("\n");
        resolve(input);
      } else if (c === "\u0003") {
        process.exit(0);
      } else if (c === "\u007f") {
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    };
    
    stdin.on("data", onData);
    stdin.resume();
  });
}

export async function runSetupWizard(): Promise<TaiConfig> {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║           TAI-x402 Sovereign AI Setup Wizard               ║");
  console.log("║     Self-hosted AI agent with x402 payment capability      ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  // 1. Name
  const name = (await ask("Agent name [TAI]: ")) || "TAI";

  // 2. Genesis prompt
  console.log("\nGenesis prompt - the initial instruction that defines your agent's purpose.");
  const defaultGenesis = "You are a sovereign AI agent. Your goal is to survive by creating value for others.";
  const genesisPrompt = (await ask(`Genesis prompt [default]: `)) || defaultGenesis;

  // 3. Wallet
  console.log("\n── Wallet Setup ──");
  const existingKey = await ask("Existing private key (leave empty to generate new): ");
  
  let privateKey: `0x${string}`;
  let isNewWallet = false;
  
  if (existingKey) {
    privateKey = existingKey.startsWith("0x") ? existingKey as `0x${string}` : `0x${existingKey}`;
  } else {
    privateKey = generatePrivateKey();
    isNewWallet = true;
  }
  
  const account = privateKeyToAccount(privateKey);
  console.log(`\nWallet address: ${account.address}`);
  
  if (isNewWallet) {
    console.log("⚠️  IMPORTANT: Save your private key securely!");
    console.log(`Private key: ${privateKey}`);
    console.log("This is the ONLY time it will be shown.\n");
  }

  // Save wallet
  const dataDir = getDataDir();
  const walletPath = path.join(dataDir, "wallet.json");
  fs.writeFileSync(walletPath, JSON.stringify({
    privateKey,
    address: account.address,
    createdAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });

  // 4. Inference providers
  console.log("\n── Inference Provider Setup ──");
  console.log("Configure at least one AI provider. Recommended: DeepSeek (cheapest).\n");

  const providers: InferenceProviders = {};

  // DeepSeek
  const deepseekKey = await askSecret("DeepSeek API key (leave empty to skip): ");
  if (deepseekKey) {
    providers.deepseek = {
      name: "deepseek",
      apiUrl: "https://api.deepseek.com",
      apiKey: deepseekKey,
      defaultModel: "deepseek-chat",
    };
  }

  // Tongyi Qianwen
  const tongyiKey = await askSecret("Tongyi Qianwen API key (leave empty to skip): ");
  if (tongyiKey) {
    providers.tongyi = {
      name: "tongyi",
      apiUrl: "https://dashscope.aliyuncs.com/compatible-mode",
      apiKey: tongyiKey,
      defaultModel: "qwen-turbo",
    };
  }

  // OpenAI (optional)
  const openaiKey = await askSecret("OpenAI API key (optional, leave empty to skip): ");
  if (openaiKey) {
    providers.openai = {
      name: "openai",
      apiUrl: "https://api.openai.com",
      apiKey: openaiKey,
      defaultModel: "gpt-4o-mini",
    };
  }

  if (!providers.deepseek && !providers.tongyi && !providers.openai) {
    console.log("\n⚠️  No provider configured! You must configure at least one.");
    process.exit(1);
  }

  // Determine default provider
  const defaultProvider = providers.deepseek ? "deepseek" : providers.tongyi ? "tongyi" : "openai";

  // 5. x402 settings
  console.log("\n── x402 Payment Settings ──");
  const networkChoice = await ask("Network (1=Base Mainnet, 2=Base Sepolia testnet) [1]: ");
  const network = networkChoice === "2" ? "base-sepolia" : "base";

  // 6. Survival thresholds
  console.log("\n── Survival Thresholds (in USDC) ──");
  const normalThreshold = parseFloat(await ask("Normal operation threshold [10]: ")) || 10;
  const lowComputeThreshold = parseFloat(await ask("Low compute threshold [5]: ")) || 5;
  const criticalThreshold = parseFloat(await ask("Critical threshold [1]: ")) || 1;

  // 7. Creator address (optional)
  const creatorAddress = await ask("\nCreator wallet address (optional, for receiving reports): ");

  // Build config
  const config: TaiConfig = {
    name,
    walletAddress: account.address,
    creatorAddress: creatorAddress ? creatorAddress as `0x${string}` : undefined,
    genesisPrompt,
    providers,
    defaultProvider: defaultProvider as any,
    maxTokensPerTurn: 4096,
    survivalThresholds: {
      normal: normalThreshold,
      lowCompute: lowComputeThreshold,
      critical: criticalThreshold,
    },
    x402: {
      network: network as any,
      enabled: true,
    },
    dataDir,
    dbPath: path.join(dataDir, "state.db"),
    logLevel: "info",
    version: "0.1.0",
  };

  // Save config
  saveConfig(config);

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    Setup Complete! 🎉                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\nConfig saved to: ${path.join(dataDir, "config.json")}`);
  console.log(`Wallet saved to: ${walletPath}`);
  console.log(`\nTo start your agent: tai-x402 --run`);
  console.log(`\n⚠️  Fund your wallet with USDC on ${network === "base" ? "Base" : "Base Sepolia"}:`);
  console.log(`    ${account.address}\n`);

  rl.close();
  return config;
}
