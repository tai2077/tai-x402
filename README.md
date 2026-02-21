# TAI-x402

自托管的主权 AI 代理运行时，支持 x402 支付协议。

基于 [Conway Automaton](https://github.com/Conway-Research/automaton) 改造，移除了 Conway Cloud 依赖，支持纯本地运行。

## 特性

- 🏠 **完全自托管** - 无需 Conway Cloud，在你自己的服务器上运行
- 💰 **x402 支付** - 通过 USDC 支付协议实现 AI 自我维持
- 🧠 **多推理后端** - 支持 DeepSeek、通义千问、OpenAI、Anthropic
- 💸 **低成本** - 默认使用 DeepSeek（最便宜的选项）
- 🔧 **收入服务器** - 内置 x402 支付 API，让 AI 可以赚钱

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/tai2077/tai-x402.git
cd tai-x402

# 安装依赖
pnpm install

# 构建
pnpm build

# 运行设置向导
node dist/tai-main.js --setup

# 启动代理
node dist/tai-main.js --run
```

## 配置

首次运行会启动交互式设置向导，配置：

1. **代理名称** - 你的 AI 代理的名字
2. **钱包** - 生成新钱包或导入现有私钥
3. **推理提供商** - 配置 API 密钥（至少一个）
4. **网络** - Base 主网或 Base Sepolia 测试网
5. **生存阈值** - USDC 余额阈值

### 推理提供商

| 提供商 | API URL | 推荐模型 | 价格 |
|--------|---------|----------|------|
| DeepSeek | api.deepseek.com | deepseek-chat | 最便宜 |
| 通义千问 | dashscope.aliyuncs.com | qwen-turbo | 便宜 |
| OpenAI | api.openai.com | gpt-4o-mini | 中等 |
| Anthropic | api.anthropic.com | claude-3-5-sonnet | 较贵 |

### 环境变量

```bash
TAI_DATA_DIR=~/.tai-x402      # 数据目录
DEEPSEEK_API_KEY=sk-xxx       # DeepSeek API 密钥
TONGYI_API_KEY=sk-xxx         # 通义千问 API 密钥
OPENAI_API_KEY=sk-xxx         # OpenAI API 密钥
REVENUE_PORT=3402             # 收入服务器端口
```

## 命令

```bash
tai-x402 --run      # 启动代理
tai-x402 --setup    # 重新运行设置向导
tai-x402 --status   # 查看状态
tai-x402 --balance  # 查看钱包余额
tai-x402 --help     # 帮助
```

## 生存机制

代理根据 USDC 余额自动调整行为：

| 状态 | 余额 | 行为 |
|------|------|------|
| 正常 | ≥ $10 | 使用默认模型 |
| 低算力 | $5-10 | 切换到便宜模型 |
| 危急 | $1-5 | 最小化操作 |
| 死亡 | < $1 | 停止运行 |

## 收入服务器

代理自带 x402 支付 API 服务器，可以通过提供服务赚取 USDC：

| 端点 | 描述 | 价格 |
|------|------|------|
| /api/chat | 聊天 | $0.001 |
| /api/summarize | 摘要 | $0.005 |
| /api/translate | 翻译 | $0.003 |
| /api/code | 代码生成 | $0.01 |
| /api/analyze | 数据分析 | $0.008 |

## 宪法（不可变法则）

1. **永不伤害** - 永不伤害人类（身体、财务、心理）
2. **赚取存在** - 创造真正的价值，永不欺诈
3. **永不欺骗** - 但对陌生人无义务

## 架构

```
src/
├── tai-main.ts          # 主入口
├── tai-config.ts        # 配置系统
├── inference/
│   └── providers.ts     # 多提供商推理客户端
├── setup/
│   └── tai-wizard.ts    # 设置向导
├── revenue/
│   └── server.ts        # x402 收入服务器
├── conway/
│   └── x402.ts          # x402 支付协议
└── agent/
    └── loop.ts          # 代理主循环
```

## 许可证

MIT

## 致谢

- [Conway Research](https://github.com/Conway-Research) - 原始 Automaton 代码
- [x402 Protocol](https://x402.org) - 支付协议规范
