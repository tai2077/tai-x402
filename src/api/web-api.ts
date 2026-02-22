/**
 * TAI-x402 Web API
 * 
 * 为前端网站提供 API 接口
 */

import http from "http";
import { UserSystem } from "../user/user-system.js";
import { createLogger } from "../observability/logger.js";
import { getUsdcBalance } from "../conway/x402.js";

const logger = createLogger("web-api");

export interface WebApiConfig {
  port: number;
  userSystem: UserSystem;
  corsOrigins?: string[];
}

export function createWebApi(config: WebApiConfig) {
  const { port, userSystem, corsOrigins = ["https://tai.tii.mom", "http://localhost:3000"] } = config;

  const server = http.createServer(async (req, res) => {
    // CORS
    const origin = req.headers.origin || "";
    if (corsOrigins.includes(origin) || corsOrigins.includes("*")) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`);
    
    try {
      // 路由
      if (url.pathname === "/api/health") {
        return jsonResponse(res, { status: "ok", time: new Date().toISOString() });
      }

      if (url.pathname === "/api/user/info" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!userId) {
          return jsonResponse(res, { error: "Missing userId" }, 400);
        }
        const user = userSystem.getUser(userId);
        if (!user) {
          return jsonResponse(res, { error: "User not found" }, 404);
        }
        return jsonResponse(res, {
          id: user.id,
          nickname: user.nickname,
          balance: user.balance,
          balanceYuan: (user.balance / 100).toFixed(2),
          walletAddress: user.walletAddress,
          createdAt: user.createdAt,
        });
      }

      if (url.pathname === "/api/user/balance" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        if (!userId) {
          return jsonResponse(res, { error: "Missing userId" }, 400);
        }
        const balance = userSystem.getBalance(userId);
        return jsonResponse(res, {
          points: balance,
          yuan: (balance / 100).toFixed(2),
        });
      }

      if (url.pathname === "/api/user/transactions" && req.method === "GET") {
        const userId = url.searchParams.get("userId");
        const limit = parseInt(url.searchParams.get("limit") || "20");
        if (!userId) {
          return jsonResponse(res, { error: "Missing userId" }, 400);
        }
        const transactions = userSystem.getTransactions(userId, limit);
        return jsonResponse(res, { transactions });
      }

      if (url.pathname === "/api/wallet/balance" && req.method === "GET") {
        const address = url.searchParams.get("address");
        if (!address) {
          return jsonResponse(res, { error: "Missing address" }, 400);
        }
        const balance = await getUsdcBalance(address as `0x${string}`, "eip155:84532");
        return jsonResponse(res, {
          usdc: balance,
          network: "base-sepolia",
        });
      }

      if (url.pathname === "/api/market/prices" && req.method === "GET") {
        const prices = await fetchMarketPrices();
        return jsonResponse(res, { prices });
      }

      // 404
      return jsonResponse(res, { error: "Not found" }, 404);

    } catch (error: any) {
      logger.error(`API error: ${error.message}`);
      return jsonResponse(res, { error: "Internal server error" }, 500);
    }
  });

  return {
    start: () => {
      server.listen(port, () => {
        logger.info(`Web API started on port ${port}`);
      });
    },
    stop: () => {
      server.close();
    },
  };
}

function jsonResponse(res: http.ServerResponse, data: any, status: number = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function fetchMarketPrices(): Promise<any[]> {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,dogecoin&vs_currencies=usd,cny&include_24hr_change=true"
    );
    const data = await resp.json() as any;
    
    const tokens = [
      { id: "bitcoin", symbol: "BTC", name: "Bitcoin", icon: "₿" },
      { id: "ethereum", symbol: "ETH", name: "Ethereum", icon: "Ξ" },
      { id: "solana", symbol: "SOL", name: "Solana", icon: "◎" },
      { id: "binancecoin", symbol: "BNB", name: "BNB", icon: "🔶" },
      { id: "dogecoin", symbol: "DOGE", name: "Dogecoin", icon: "🐕" },
    ];

    return tokens.map(t => ({
      symbol: t.symbol,
      name: t.name,
      icon: t.icon,
      priceUsd: data[t.id]?.usd || 0,
      priceCny: data[t.id]?.cny || 0,
      change24h: data[t.id]?.usd_24h_change || 0,
    }));
  } catch {
    return [];
  }
}
