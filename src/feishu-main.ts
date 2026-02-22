#!/usr/bin/env node
/**
 * TAI-x402 飞书机器人启动入口
 * 
 * 让中国用户通过飞书使用 TAI 服务
 */

import { FeishuBot } from "./channels/feishu-bot.js";
import { UserSystem } from "./user/user-system.js";
import { MessageHandler } from "./handlers/message-handler.js";
import { createMultiProviderClient } from "./inference/providers.js";
import { loadConfig, getDataDir } from "./tai-config.js";
import { createLogger } from "./observability/logger.js";
import path from "path";
import fs from "fs";

const logger = createLogger("feishu-main");

interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  port: number;
}

async function main(): Promise<void> {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           TAI-x402 飞书机器人 v0.1.0                        ║
║     让中国用户通过飞书使用 AI 助手和交易服务                  ║
╚════════════════════════════════════════════════════════════╝
`);

  // 加载配置
  const taiConfig = loadConfig();
  if (!taiConfig) {
    console.error("请先运行 tai-x402 --setup 完成基础配置");
    process.exit(1);
  }

  // 加载飞书配置
  const feishuConfigPath = path.join(getDataDir(), "feishu.json");
  let feishuConfig: FeishuConfig;

  if (fs.existsSync(feishuConfigPath)) {
    feishuConfig = JSON.parse(fs.readFileSync(feishuConfigPath, "utf-8"));
  } else {
    // 从环境变量读取
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;

    if (!appId || !appSecret) {
      console.log(`
❌ 缺少飞书配置

请设置环境变量:
  export FEISHU_APP_ID=cli_xxxxx
  export FEISHU_APP_SECRET=xxxxx

或创建配置文件 ${feishuConfigPath}:
{
  "appId": "cli_xxxxx",
  "appSecret": "xxxxx",
  "port": 3403
}

获取飞书应用凭证:
1. 访问 https://open.feishu.cn/app
2. 创建企业自建应用
3. 获取 App ID 和 App Secret
4. 在「事件订阅」中配置回调地址
5. 添加「接收消息」权限
`);
      process.exit(1);
    }

    feishuConfig = {
      appId,
      appSecret,
      port: parseInt(process.env.FEISHU_PORT || "3403"),
    };

    // 保存配置
    fs.writeFileSync(feishuConfigPath, JSON.stringify(feishuConfig, null, 2));
  }

  // 初始化用户系统
  const userDbPath = path.join(getDataDir(), "users.db");
  const userSystem = new UserSystem(userDbPath);
  logger.info("用户系统初始化完成");

  // 初始化 AI 推理
  const inference = createMultiProviderClient(taiConfig.providers);
  logger.info("AI 推理客户端初始化完成");

  // 创建消息处理器（先声明，后面设置 bot）
  let messageHandler: MessageHandler;

  // 创建飞书机器人
  const bot = new FeishuBot({
    appId: feishuConfig.appId,
    appSecret: feishuConfig.appSecret,
    verificationToken: feishuConfig.verificationToken,
    port: feishuConfig.port,
    onMessage: async (message) => {
      return await messageHandler.handleMessage(message);
    },
  });

  // 初始化消息处理器
  messageHandler = new MessageHandler({
    userSystem,
    inference,
    bot,
  });

  // 启动机器人
  bot.start();

  console.log(`
✅ 飞书机器人启动成功!

📡 回调地址: http://YOUR_SERVER:${feishuConfig.port}
   请在飞书开放平台配置此地址

📝 配置步骤:
1. 打开 https://open.feishu.cn/app/${feishuConfig.appId}
2. 进入「事件订阅」
3. 设置请求地址为上述回调地址
4. 添加事件: im.message.receive_v1
5. 进入「权限管理」，开通:
   - im:message
   - im:message:send_as_bot
   - im:chat:readonly

🎉 配置完成后，用户就可以在飞书中与机器人对话了!
`);

  // 优雅退出
  process.on("SIGINT", () => {
    logger.info("收到退出信号，正在关闭...");
    bot.stop();
    userSystem.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
