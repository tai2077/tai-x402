/**
 * TAI-x402 用户系统
 * 
 * 管理用户账户、积分、交易记录
 * 适配中国用户习惯，支持积分制
 */

import Database from "better-sqlite3";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("user-system");

export interface User {
  id: string;
  platform: "feishu" | "dingtalk" | "wechat";
  platformUserId: string;
  nickname: string;
  balance: number;  // 积分余额（1积分 = 0.01元）
  walletAddress?: string;  // 可选的链上钱包
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  userId: string;
  type: "deposit" | "withdraw" | "trade" | "reward" | "fee";
  amount: number;  // 正数增加，负数减少
  description: string;
  metadata?: string;  // JSON 格式的额外数据
  createdAt: string;
}

export class UserSystem {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        nickname TEXT DEFAULT '',
        balance INTEGER DEFAULT 0,
        wallet_address TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(platform, platform_user_id)
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
    `);
  }

  /**
   * 获取或创建用户
   */
  getOrCreateUser(platform: User["platform"], platformUserId: string, nickname?: string): User {
    const existing = this.db.prepare(`
      SELECT * FROM users WHERE platform = ? AND platform_user_id = ?
    `).get(platform, platformUserId) as any;

    if (existing) {
      return this.rowToUser(existing);
    }

    // 创建新用户，赠送初始积分
    const now = new Date().toISOString();
    const user: User = {
      id: ulid(),
      platform,
      platformUserId,
      nickname: nickname || "",
      balance: 100,  // 新用户赠送 100 积分（1元）
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO users (id, platform, platform_user_id, nickname, balance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, user.platform, user.platformUserId, user.nickname, user.balance, user.createdAt, user.updatedAt);

    // 记录赠送积分
    this.addTransaction(user.id, "reward", 100, "新用户注册奖励");

    logger.info(`新用户注册: ${user.id} (${platform})`);
    return user;
  }

  /**
   * 获取用户
   */
  getUser(userId: string): User | null {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
    return row ? this.rowToUser(row) : null;
  }

  /**
   * 获取用户余额
   */
  getBalance(userId: string): number {
    const row = this.db.prepare(`SELECT balance FROM users WHERE id = ?`).get(userId) as any;
    return row?.balance || 0;
  }

  /**
   * 修改余额（内部使用）
   */
  private updateBalance(userId: string, delta: number): boolean {
    const result = this.db.prepare(`
      UPDATE users 
      SET balance = balance + ?, updated_at = ?
      WHERE id = ? AND balance + ? >= 0
    `).run(delta, new Date().toISOString(), userId, delta);

    return result.changes > 0;
  }

  /**
   * 充值
   */
  deposit(userId: string, amount: number, description: string = "充值"): boolean {
    if (amount <= 0) return false;

    const success = this.updateBalance(userId, amount);
    if (success) {
      this.addTransaction(userId, "deposit", amount, description);
      logger.info(`用户 ${userId} 充值 ${amount} 积分`);
    }
    return success;
  }

  /**
   * 扣费
   */
  deduct(userId: string, amount: number, description: string = "消费"): boolean {
    if (amount <= 0) return false;

    const success = this.updateBalance(userId, -amount);
    if (success) {
      this.addTransaction(userId, "fee", -amount, description);
      logger.info(`用户 ${userId} 扣费 ${amount} 积分`);
    }
    return success;
  }

  /**
   * 交易（买卖代币）
   */
  trade(userId: string, amount: number, description: string, metadata?: object): boolean {
    const success = this.updateBalance(userId, amount);
    if (success) {
      this.addTransaction(userId, "trade", amount, description, metadata ? JSON.stringify(metadata) : undefined);
      logger.info(`用户 ${userId} 交易 ${amount > 0 ? "+" : ""}${amount} 积分`);
    }
    return success;
  }

  /**
   * 添加交易记录
   */
  private addTransaction(
    userId: string, 
    type: Transaction["type"], 
    amount: number, 
    description: string,
    metadata?: string
  ): void {
    this.db.prepare(`
      INSERT INTO transactions (id, user_id, type, amount, description, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ulid(), userId, type, amount, description, metadata || null, new Date().toISOString());
  }

  /**
   * 获取交易记录
   */
  getTransactions(userId: string, limit: number = 20): Transaction[] {
    const rows = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(userId, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      amount: row.amount,
      description: row.description,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }

  /**
   * 绑定链上钱包
   */
  bindWallet(userId: string, walletAddress: string): boolean {
    const result = this.db.prepare(`
      UPDATE users SET wallet_address = ?, updated_at = ? WHERE id = ?
    `).run(walletAddress, new Date().toISOString(), userId);
    return result.changes > 0;
  }

  private rowToUser(row: any): User {
    return {
      id: row.id,
      platform: row.platform,
      platformUserId: row.platform_user_id,
      nickname: row.nickname,
      balance: row.balance,
      walletAddress: row.wallet_address,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  close(): void {
    this.db.close();
  }
}

/**
 * 积分价格说明
 * 
 * 1 积分 = 0.01 元人民币
 * 100 积分 = 1 元
 * 
 * 定价参考：
 * - AI 对话：1-5 积分/次（根据长度）
 * - 行情查询：免费
 * - 交易手续费：交易额的 0.1%
 */
export const PRICING = {
  // AI 对话费用（积分）
  chat: {
    short: 1,   // 短对话 (<100字)
    medium: 3,  // 中等对话 (100-500字)
    long: 5,    // 长对话 (>500字)
  },
  // 交易手续费率
  tradeFeeRate: 0.001,  // 0.1%
  // 最低交易手续费
  minTradeFee: 1,
  // 新用户奖励
  newUserReward: 100,
};
