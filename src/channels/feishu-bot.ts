/**
 * TAI-x402 飞书机器人
 * 
 * 让中国用户通过飞书直接使用 TAI 服务
 */

import http from "http";
import crypto from "crypto";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("feishu-bot");

export interface FeishuBotConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  port: number;
  onMessage: (message: FeishuMessage) => Promise<string>;
}

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";  // 私聊或群聊
  senderId: string;
  senderName: string;
  content: string;
  messageType: "text" | "image" | "audio";
  timestamp: number;
}

interface FeishuEvent {
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
  };
  event?: {
    sender?: {
      sender_id?: { open_id?: string; user_id?: string };
      sender_type?: string;
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      content?: string;
      message_type?: string;
      create_time?: string;
    };
  };
  challenge?: string;
  type?: string;
}

export class FeishuBot {
  private config: FeishuBotConfig;
  private accessToken: string = "";
  private tokenExpiry: number = 0;
  private server: http.Server | null = null;

  constructor(config: FeishuBotConfig) {
    this.config = config;
  }

  /**
   * 启动机器人服务
   */
  start(): void {
    this.server = http.createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(200);
        res.end("TAI-x402 飞书机器人运行中");
        return;
      }

      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      try {
        const event = JSON.parse(body) as FeishuEvent;
        
        // URL 验证（首次配置时飞书会发送）
        if (event.challenge) {
          logger.info("收到飞书 URL 验证请求");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ challenge: event.challenge }));
          return;
        }

        // 处理消息事件
        if (event.header?.event_type === "im.message.receive_v1") {
          await this.handleMessage(event);
        }

        res.writeHead(200);
        res.end("ok");
      } catch (error: any) {
        logger.error(`处理飞书事件失败: ${error.message}`);
        res.writeHead(500);
        res.end("error");
      }
    });

    this.server.listen(this.config.port, () => {
      logger.info(`飞书机器人启动，端口: ${this.config.port}`);
      logger.info(`请在飞书开放平台配置事件回调地址: http://YOUR_SERVER:${this.config.port}`);
    });
  }

  /**
   * 停止机器人服务
   */
  stop(): void {
    this.server?.close();
  }

  /**
   * 处理收到的消息
   */
  private async handleMessage(event: FeishuEvent): Promise<void> {
    const msgEvent = event.event;
    if (!msgEvent?.message || !msgEvent?.sender) return;

    const msg = msgEvent.message;
    const sender = msgEvent.sender;

    // 解析消息内容
    let content = "";
    if (msg.message_type === "text" && msg.content) {
      try {
        const parsed = JSON.parse(msg.content);
        content = parsed.text || "";
      } catch {
        content = msg.content;
      }
    }

    // 忽略空消息
    if (!content.trim()) return;

    // 构建消息对象
    const message: FeishuMessage = {
      messageId: msg.message_id || "",
      chatId: msg.chat_id || "",
      chatType: msg.chat_type === "p2p" ? "p2p" : "group",
      senderId: sender.sender_id?.open_id || "",
      senderName: "",  // 需要额外 API 获取
      content: content.trim(),
      messageType: msg.message_type as any || "text",
      timestamp: parseInt(msg.create_time || "0"),
    };

    logger.info(`收到消息: [${message.chatType}] ${message.content.slice(0, 50)}...`);

    // 调用处理函数获取回复
    try {
      const reply = await this.config.onMessage(message);
      if (reply) {
        await this.sendMessage(message.chatId, reply);
      }
    } catch (error: any) {
      logger.error(`处理消息失败: ${error.message}`);
      await this.sendMessage(message.chatId, "抱歉，处理消息时出错了，请稍后再试。");
    }
  }

  /**
   * 获取 access_token
   */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = await resp.json() as any;
    if (data.code !== 0) {
      throw new Error(`获取 access_token 失败: ${data.msg}`);
    }

    this.accessToken = data.tenant_access_token;
    this.tokenExpiry = Date.now() + (data.expire - 300) * 1000;  // 提前5分钟过期
    return this.accessToken;
  }

  /**
   * 发送消息
   */
  async sendMessage(chatId: string, content: string): Promise<void> {
    const token = await this.getAccessToken();

    // 支持富文本格式
    const msgContent = this.formatMessage(content);

    const resp = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: msgContent }),
      }),
    });

    const data = await resp.json() as any;
    if (data.code !== 0) {
      logger.error(`发送消息失败: ${data.msg}`);
    }
  }

  /**
   * 发送卡片消息（支持按钮等交互）
   */
  async sendCard(chatId: string, card: FeishuCard): Promise<void> {
    const token = await this.getAccessToken();

    const resp = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      }),
    });

    const data = await resp.json() as any;
    if (data.code !== 0) {
      logger.error(`发送卡片失败: ${data.msg}`);
    }
  }

  /**
   * 格式化消息内容
   */
  private formatMessage(content: string): string {
    // 可以在这里添加 emoji 转换等
    return content;
  }
}

/**
 * 飞书卡片消息结构
 */
export interface FeishuCard {
  config?: {
    wide_screen_mode?: boolean;
  };
  header?: {
    title: {
      tag: "plain_text";
      content: string;
    };
    template?: "blue" | "green" | "red" | "orange" | "purple";
  };
  elements: FeishuCardElement[];
}

export type FeishuCardElement = 
  | { tag: "div"; text: { tag: "plain_text" | "lark_md"; content: string } }
  | { tag: "action"; actions: FeishuCardAction[] }
  | { tag: "hr" }
  | { tag: "note"; elements: Array<{ tag: "plain_text"; content: string }> };

export interface FeishuCardAction {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type: "primary" | "default" | "danger";
  value?: Record<string, string>;
}

/**
 * 创建常用卡片模板
 */
export const CardTemplates = {
  /**
   * 余额查询卡片
   */
  balance(balance: number, address: string): FeishuCard {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "💰 钱包余额" },
        template: "blue",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**余额**: ${balance.toFixed(2)} USDC\n**地址**: \`${address.slice(0, 10)}...${address.slice(-8)}\``,
          },
        },
        { tag: "hr" },
        {
          tag: "action",
          actions: [
            { tag: "button", text: { tag: "plain_text", content: "充值" }, type: "primary", value: { action: "deposit" } },
            { tag: "button", text: { tag: "plain_text", content: "提现" }, type: "default", value: { action: "withdraw" } },
          ],
        },
      ],
    };
  },

  /**
   * 交易确认卡片
   */
  confirmTrade(action: "buy" | "sell", token: string, amount: number, price: number): FeishuCard {
    const total = amount * price;
    const actionText = action === "buy" ? "买入" : "卖出";
    const color = action === "buy" ? "green" : "red";
    
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: `📊 确认${actionText}` },
        template: color as any,
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**${actionText}**: ${amount} ${token}\n**单价**: $${price.toFixed(4)}\n**总计**: $${total.toFixed(2)} USDC`,
          },
        },
        { tag: "hr" },
        {
          tag: "action",
          actions: [
            { tag: "button", text: { tag: "plain_text", content: `确认${actionText}` }, type: "primary", value: { action: "confirm_trade", token, amount: String(amount) } },
            { tag: "button", text: { tag: "plain_text", content: "取消" }, type: "default", value: { action: "cancel" } },
          ],
        },
      ],
    };
  },

  /**
   * 帮助菜单卡片
   */
  help(): FeishuCard {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "🤖 TAI 助手" },
        template: "purple",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**可用命令**:
• 余额 - 查看钱包余额
• 行情 BTC - 查看代币价格
• 买 0.1 ETH - 买入代币
• 卖 100 USDT - 卖出代币
• 帮助 - 显示此菜单

或者直接用自然语言跟我对话！`,
          },
        },
        { tag: "hr" },
        {
          tag: "action",
          actions: [
            { tag: "button", text: { tag: "plain_text", content: "查余额" }, type: "default", value: { action: "balance" } },
            { tag: "button", text: { tag: "plain_text", content: "看行情" }, type: "default", value: { action: "market" } },
          ],
        },
      ],
    };
  },
};
