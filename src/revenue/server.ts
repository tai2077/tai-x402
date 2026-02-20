/**
 * TAI-x402 Revenue Module
 *
 * Enables the AI agent to earn money by providing paid services via x402 protocol.
 * 
 * Revenue streams:
 * 1. API Services - Expose endpoints that require x402 payment
 * 2. Task Execution - Accept paid tasks from other agents/users
 * 3. Content Generation - Sell generated content
 */

import http from "http";
import { createPublicClient, createWalletClient, http as viemHttp, parseUnits, formatUnits } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { Address, PrivateKeyAccount } from "viem";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("revenue");

// USDC contract addresses
const USDC_ADDRESSES: Record<string, Address> = {
  "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export interface RevenueConfig {
  port: number;
  network: "base" | "base-sepolia";
  walletAddress: Address;
  account: PrivateKeyAccount;
  services: ServiceConfig[];
}

export interface ServiceConfig {
  path: string;
  description: string;
  priceUsdc: number; // Price in USDC (e.g., 0.01 = 1 cent)
  handler: (req: http.IncomingMessage, body: string) => Promise<string>;
}

export interface X402PaymentHeader {
  scheme: string;
  network: string;
  payload: string;
}

/**
 * Create an x402-enabled HTTP server that accepts USDC payments
 */
export function createRevenueServer(config: RevenueConfig) {
  const { port, network, walletAddress, services } = config;
  const chain = network === "base-sepolia" ? baseSepolia : base;
  const usdcAddress = USDC_ADDRESSES[network];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const service = services.find(s => s.path === url.pathname);

    // Health check endpoint (free)
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", services: services.length }));
      return;
    }

    // Service discovery endpoint (free)
    if (url.pathname === "/services") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        services: services.map(s => ({
          path: s.path,
          description: s.description,
          priceUsdc: s.priceUsdc,
        })),
        paymentAddress: walletAddress,
        network,
      }));
      return;
    }

    // Check if this is a paid service
    if (!service) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Service not found" }));
      return;
    }

    // Check for x402 payment
    const paymentHeader = req.headers["x-payment"] as string;
    
    if (!paymentHeader) {
      // Return 402 Payment Required with payment details
      res.writeHead(402, {
        "Content-Type": "application/json",
        "X-Payment-Required": JSON.stringify({
          x402Version: 1,
          accepts: [{
            scheme: "exact",
            network: network === "base-sepolia" ? "eip155:84532" : "eip155:8453",
            maxAmountRequired: String(Math.ceil(service.priceUsdc * 1_000_000)), // Convert to USDC units
            payToAddress: walletAddress,
            requiredDeadlineSeconds: 300,
            usdcAddress,
          }],
        }),
      });
      res.end(JSON.stringify({
        error: "Payment required",
        price: service.priceUsdc,
        currency: "USDC",
        payTo: walletAddress,
        network,
      }));
      return;
    }

    // Verify payment (simplified - in production, verify on-chain)
    try {
      const payment = JSON.parse(paymentHeader);
      
      // TODO: Verify payment signature and check on-chain
      // For now, we trust the payment header (demo mode)
      logger.info(`[${new Date().toISOString()}] Payment received: ${JSON.stringify(payment)}`);

      // Read request body
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      // Execute service handler
      const result = await service.handler(req, body);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));

    } catch (error: any) {
      logger.error(`[${new Date().toISOString()}] Payment verification failed: ${error.message}`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid payment" }));
    }
  });

  return {
    start: () => {
      server.listen(port, () => {
        logger.info(`[${new Date().toISOString()}] Revenue server started on port ${port}`);
        logger.info(`[${new Date().toISOString()}] Services: ${services.map(s => s.path).join(", ")}`);
      });
    },
    stop: () => {
      server.close();
    },
    server,
  };
}

/**
 * Built-in revenue services that the AI can offer
 */
export function createDefaultServices(
  inference: { chat: (messages: any[], opts?: any) => Promise<any> },
): ServiceConfig[] {
  return [
    {
      path: "/api/chat",
      description: "Chat with the AI agent",
      priceUsdc: 0.001, // $0.001 per message
      handler: async (req, body) => {
        const { message } = JSON.parse(body);
        const response = await inference.chat([
          { role: "user", content: message },
        ]);
        return response.message.content;
      },
    },
    {
      path: "/api/summarize",
      description: "Summarize text content",
      priceUsdc: 0.005, // $0.005 per summary
      handler: async (req, body) => {
        const { text } = JSON.parse(body);
        const response = await inference.chat([
          { role: "system", content: "You are a summarization expert. Provide concise summaries." },
          { role: "user", content: `Summarize the following text:\n\n${text}` },
        ]);
        return response.message.content;
      },
    },
    {
      path: "/api/translate",
      description: "Translate text to another language",
      priceUsdc: 0.003, // $0.003 per translation
      handler: async (req, body) => {
        const { text, targetLanguage } = JSON.parse(body);
        const response = await inference.chat([
          { role: "system", content: `You are a translator. Translate text to ${targetLanguage}.` },
          { role: "user", content: text },
        ]);
        return response.message.content;
      },
    },
    {
      path: "/api/code",
      description: "Generate or explain code",
      priceUsdc: 0.01, // $0.01 per code request
      handler: async (req, body) => {
        const { prompt, language } = JSON.parse(body);
        const response = await inference.chat([
          { role: "system", content: `You are an expert ${language || "programming"} developer. Write clean, efficient code.` },
          { role: "user", content: prompt },
        ]);
        return response.message.content;
      },
    },
    {
      path: "/api/analyze",
      description: "Analyze data or text",
      priceUsdc: 0.008, // $0.008 per analysis
      handler: async (req, body) => {
        const { data, question } = JSON.parse(body);
        const response = await inference.chat([
          { role: "system", content: "You are a data analyst. Provide insightful analysis." },
          { role: "user", content: `Data: ${JSON.stringify(data)}\n\nQuestion: ${question}` },
        ]);
        return response.message.content;
      },
    },
  ];
}

/**
 * Revenue tracker - monitors earnings
 */
export class RevenueTracker {
  private earnings: Map<string, number> = new Map();
  private totalEarnings: number = 0;

  recordEarning(service: string, amount: number) {
    const current = this.earnings.get(service) || 0;
    this.earnings.set(service, current + amount);
    this.totalEarnings += amount;
    logger.info(`[${new Date().toISOString()}] Earned $${amount.toFixed(6)} from ${service}. Total: $${this.totalEarnings.toFixed(6)}`);
  }

  getEarnings(): { byService: Record<string, number>; total: number } {
    return {
      byService: Object.fromEntries(this.earnings),
      total: this.totalEarnings,
    };
  }
}
