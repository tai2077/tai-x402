/**
 * TAI-x402 消息处理器
 * 
 * 处理用户消息，支持：
 * - 自然语言对话
 * - 快捷命令
 * - 交易操作
 */

import { UserSystem, PRICING } from "../user/user-system.js";
import { FeishuMessage, FeishuBot, CardTemplates } from "../channels/feishu-bot.js";
import { createMultiProviderClient, InferenceProviders } from "../inference/providers.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("message-handler");

export interface MessageHandlerConfig {
  userSystem: UserSystem;
  inference: ReturnType<typeof createMultiProviderClient>;
  bot: FeishuBot;
}

export class MessageHandler {
  private userSystem: UserSystem;
  private inference: ReturnType<typeof createMultiProviderClient>;
  private bot: FeishuBot;
  private conversationHistory: Map<string, Array<{ role: string; content: string }>> = new Map();

  constructor(config: MessageHandlerConfig) {
    this.userSystem = config.userSystem;
    this.inference = config.inference;
    this.bot = config.bot;
  }

  /**
   * 处理收到的消息
   */
  async handleMessage(message: FeishuMessage): Promise<string> {
    // 获取或创建用户
    const user = this.userSystem.getOrCreateUser("feishu", message.senderId, message.senderName);
    const content = message.content.trim();

    logger.info(`处理消息: 用户=${user.id}, 内容=${content.slice(0, 50)}`);

    // 检查是否是快捷命令
    const commandResult = await this.handleCommand(user.id, content);
    if (commandResult) {
      return commandResult;
    }

    // AI 对话
    return await this.handleChat(user.id, content, message.chatId);
  }

  /**
   * 处理快捷命令
   */
  private async handleCommand(userId: string, content: string): Promise<string | null> {
    const lowerContent = content.toLowerCase();

    // 帮助
    if (lowerContent === "帮助" || lowerContent === "help" || lowerContent === "?") {
      return this.getHelpText();
    }

    // 余额查询
    if (lowerContent === "余额" || lowerContent === "balance" || lowerContent === "钱包") {
      const balance = this.userSystem.getBalance(userId);
      const yuan = (balance / 100).toFixed(2);
      return `💰 当前余额: ${balance} 积分 (约 ¥${yuan})\n\n积分说明:\n• 1积分 = ¥0.01\n• AI对话消耗 1-5 积分/次\n• 新用户赠送 100 积分`;
    }

    // 交易记录
    if (lowerContent === "记录" || lowerContent === "history" || lowerContent === "账单") {
      const transactions = this.userSystem.getTransactions(userId, 10);
      if (transactions.length === 0) {
        return "暂无消费记录";
      }
      
      let text = "📋 最近消费记录:\n\n";
      for (const tx of transactions) {
        const sign = tx.amount >= 0 ? "+" : "";
        const time = tx.createdAt.slice(5, 16).replace("T", " ");
        text += `${time} | ${sign}${tx.amount} | ${tx.description}\n`;
      }
      return text;
    }

    // 充值引导
    if (lowerContent === "充值" || lowerContent === "recharge" || lowerContent === "买积分") {
      return `💰 积分充值\n\n请访问官网完成充值:\n🔗 https://tai-x402.example.com/recharge\n\n充值后积分将自动到账。`;
    }

    // 不是命令，返回 null 让 AI 处理
    return null;
  }

  /**
   * AI 对话
   */
  private async handleChat(userId: string, content: string, chatId: string): Promise<string> {
    // 检查余额
    const balance = this.userSystem.getBalance(userId);
    if (balance < PRICING.chat.short) {
      return "❌ 积分不足，无法进行对话。\n\n发送「帮助」查看如何获取积分。";
    }

    // 获取对话历史
    let history = this.conversationHistory.get(userId) || [];
    
    // 添加系统提示
    if (history.length === 0) {
      history.push({
        role: "system",
        content: `你是 TAI，一个友好的 AI 助手。你可以帮助用户：
- 回答各种问题
- 闲聊和陪伴
- 提供建议和帮助

保持回复简洁友好，使用中文。
注意：不要讨论加密货币、代币、交易等金融话题，如果用户问到，引导他们访问官网了解更多。`,
      });
    }

    // 添加用户消息
    history.push({ role: "user", content });

    try {
      // 调用 AI
      const response = await this.inference.chat(history as any);
      const reply = response.message.content || "抱歉，我没有理解你的意思。";

      // 添加 AI 回复到历史
      history.push({ role: "assistant", content: reply });

      // 保持历史长度
      if (history.length > 20) {
        history = [history[0], ...history.slice(-18)];
      }
      this.conversationHistory.set(userId, history);

      // 计算费用并扣除
      const fee = this.calculateChatFee(content, reply);
      this.userSystem.deduct(userId, fee, `AI对话`);

      return reply;
    } catch (error: any) {
      logger.error(`AI 对话失败: ${error.message}`);
      return "抱歉，AI 服务暂时不可用，请稍后再试。";
    }
  }

  /**
   * 计算对话费用
   */
  private calculateChatFee(input: string, output: string): number {
    const totalLength = input.length + output.length;
    if (totalLength < 200) return PRICING.chat.short;
    if (totalLength < 1000) return PRICING.chat.medium;
    return PRICING.chat.long;
  }

  /**
   * 获取代币价格
   */
  private async getTokenPrice(token: string): Promise<string> {
    try {
      // 使用 CoinGecko API（免费）
      const idMap: Record<string, string> = {
        BTC: "bitcoin",
        ETH: "ethereum",
        USDT: "tether",
        USDC: "usd-coin",
        BNB: "binancecoin",
        SOL: "solana",
        DOGE: "dogecoin",
      };

      const coinId = idMap[token];
      if (!coinId) {
        return `❌ 暂不支持 ${token}，支持的代币: ${Object.keys(idMap).join(", ")}`;
      }

      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd,cny&include_24hr_change=true`
      );
      const data = await resp.json() as any;
      const info = data[coinId];

      if (!info) {
        return `❌ 获取 ${token} 价格失败`;
      }

      const change = info.usd_24h_change?.toFixed(2) || "0";
      const changeEmoji = parseFloat(change) >= 0 ? "📈" : "📉";

      return `${changeEmoji} ${token} 实时行情\n\n` +
        `💵 美元: $${info.usd.toLocaleString()}\n` +
        `💴 人民币: ¥${info.cny.toLocaleString()}\n` +
        `📊 24h涨跌: ${change}%`;
    } catch (error: any) {
      logger.error(`获取价格失败: ${error.message}`);
      return "❌ 获取行情失败，请稍后再试";
    }
  }

  /**
   * 处理买入
   */
  private async handleBuy(userId: string, token: string, amount: number): Promise<string> {
    if (amount <= 0) {
      return "❌ 买入数量必须大于 0";
    }

    // 获取价格
    const price = await this.getTokenPriceUsd(token);
    if (!price) {
      return `❌ 暂不支持交易 ${token}`;
    }

    // 计算费用（积分）
    const totalUsd = amount * price;
    const totalPoints = Math.ceil(totalUsd * 100);  // 1 USD = 100 积分（简化）
    const fee = Math.max(Math.ceil(totalPoints * PRICING.tradeFeeRate), PRICING.minTradeFee);
    const totalCost = totalPoints + fee;

    // 检查余额
    const balance = this.userSystem.getBalance(userId);
    if (balance < totalCost) {
      return `❌ 积分不足\n\n` +
        `买入 ${amount} ${token} 需要:\n` +
        `• 本金: ${totalPoints} 积分\n` +
        `• 手续费: ${fee} 积分\n` +
        `• 总计: ${totalCost} 积分\n\n` +
        `当前余额: ${balance} 积分`;
    }

    // 执行交易（这里是模拟，实际需要接入交易所或链上）
    const success = this.userSystem.trade(userId, -totalCost, `买入 ${amount} ${token}`, {
      action: "buy",
      token,
      amount,
      price,
      fee,
    });

    if (success) {
      return `✅ 买入成功!\n\n` +
        `• 买入: ${amount} ${token}\n` +
        `• 单价: $${price.toFixed(4)}\n` +
        `• 花费: ${totalPoints} 积分\n` +
        `• 手续费: ${fee} 积分\n` +
        `• 剩余: ${balance - totalCost} 积分`;
    } else {
      return "❌ 交易失败，请稍后再试";
    }
  }

  /**
   * 处理卖出
   */
  private async handleSell(userId: string, token: string, amount: number): Promise<string> {
    if (amount <= 0) {
      return "❌ 卖出数量必须大于 0";
    }

    // 获取价格
    const price = await this.getTokenPriceUsd(token);
    if (!price) {
      return `❌ 暂不支持交易 ${token}`;
    }

    // 计算收益（积分）
    const totalUsd = amount * price;
    const totalPoints = Math.floor(totalUsd * 100);
    const fee = Math.max(Math.ceil(totalPoints * PRICING.tradeFeeRate), PRICING.minTradeFee);
    const netPoints = totalPoints - fee;

    // 执行交易
    const success = this.userSystem.trade(userId, netPoints, `卖出 ${amount} ${token}`, {
      action: "sell",
      token,
      amount,
      price,
      fee,
    });

    if (success) {
      const newBalance = this.userSystem.getBalance(userId);
      return `✅ 卖出成功!\n\n` +
        `• 卖出: ${amount} ${token}\n` +
        `• 单价: $${price.toFixed(4)}\n` +
        `• 收入: ${totalPoints} 积分\n` +
        `• 手续费: ${fee} 积分\n` +
        `• 实得: ${netPoints} 积分\n` +
        `• 余额: ${newBalance} 积分`;
    } else {
      return "❌ 交易失败，请稍后再试";
    }
  }

  /**
   * 获取代币美元价格
   */
  private async getTokenPriceUsd(token: string): Promise<number | null> {
    try {
      const idMap: Record<string, string> = {
        BTC: "bitcoin",
        ETH: "ethereum",
        SOL: "solana",
        BNB: "binancecoin",
        DOGE: "dogecoin",
      };

      const coinId = idMap[token];
      if (!coinId) return null;

      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
      );
      const data = await resp.json() as any;
      return data[coinId]?.usd || null;
    } catch {
      return null;
    }
  }

  /**
   * 帮助文本
   */
  private getHelpText(): string {
    return `🤖 TAI 助手 - 使用指南

📝 快捷命令:
• 余额 - 查看积分余额
• 记录 - 查看消费记录
• 充值 - 获取充值链接

💬 自然对话:
直接发消息跟我聊天，我会尽力帮助你！

💰 积分说明:
• 新用户赠送 100 积分
• 1 积分 = ¥0.01
• AI 对话消耗 1-5 积分/次

🌐 更多功能:
访问官网解锁完整服务`;
  }
}
