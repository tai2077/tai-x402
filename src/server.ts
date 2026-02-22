/**
 * TAI-x402 统一启动入口
 * 
 * 启动所有服务：
 * - Web API (端口 3401)
 * - Revenue Server (端口 3402)
 * - 飞书机器人 (端口 3403)
 */

import { createWebApi } from "./api/web-api.js";
import { UserSystem } from "./user/user-system.js";
import { createLogger } from "./observability/logger.js";
import { getDataDir } from "./tai-config.js";
import path from "path";

const logger = createLogger("server");

async function startServer() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           TAI-x402 Server v0.1.0                           ║
╚════════════════════════════════════════════════════════════╝
`);

  const dataDir = getDataDir();
  
  // 初始化用户系统
  const userDbPath = path.join(dataDir, "users.db");
  const userSystem = new UserSystem(userDbPath);
  logger.info("用户系统初始化完成");

  // 启动 Web API
  const webApi = createWebApi({
    port: 3401,
    userSystem,
    corsOrigins: ["https://tai.tii.mom", "http://localhost:3000", "*"],
  });
  webApi.start();

  console.log(`
✅ 服务启动成功!

📡 Web API: http://localhost:3401
   - GET /api/health
   - GET /api/user/info?userId=xxx
   - GET /api/user/balance?userId=xxx
   - GET /api/user/transactions?userId=xxx
   - GET /api/market/prices
   - GET /api/wallet/balance?address=xxx
`);

  // 优雅退出
  process.on("SIGINT", () => {
    logger.info("收到退出信号，正在关闭...");
    userSystem.close();
    process.exit(0);
  });
}

startServer().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
