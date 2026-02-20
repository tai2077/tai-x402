# TAI-x402 🔥

**自托管的主权 AI 代理，支持 x402 支付协议**

一个能自己赚钱活命的 AI。没钱就死，有钱就活。

## 特性

- 🏠 **完全自托管** - 不依赖任何第三方云服务
- 💰 **x402 支付** - AI 可以用 USDC 自主支付和收款
- 🧠 **多模型支持** - DeepSeek、通义千问、OpenAI、Anthropic
- 💀 **生存机制** - 钱不够就降级，没钱就停止
- 💵 **收入服务器** - 内置付费 API 服务，自动赚钱
- 🔧 **自我修改** - 可以编辑自己的代码和技能

## 快速开始

### 方式一：直接运行

```bash
# 克隆仓库
git clone https://github.com/tai2077/tai-x402.git
cd tai-x402

# 安装依赖
npm install

# 构建
npm run build

# 运行设置向导（首次运行）
npm run setup

# 启动代理
npm start
```

### 方式二：Docker 部署

```bash
# 克隆仓库
git clone https://github.com/tai2077/tai-x402.git
cd tai-x402

# 构建镜像
docker build -t tai-x402 .

# 运行（先手动设置）
npm run setup

# 然后用 Docker 运行
docker-compose up -d
```

## 配置

首次运行 `npm run setup` 会启动交互式设置向导：

1. **代理名称** - 你的 AI 叫什么
2. **钱包** - 生成新钱包或导入已有私钥
3. **推理提供商** - 至少配置一个（推荐 DeepSeek，最便宜）
4. **x402 网络** - Base 主网或测试网
5. **生存阈值** - 多少钱算正常/低算力/危急

### 环境变量

```bash
# 数据目录（默认 ~/.tai-x402）
TAI_DATA_DIR=/path/to/data

# API 密钥（覆盖配置文件）
DEEPSEEK_API_KEY=sk-xxx
TONGYI_API_KEY=sk-xxx
OPENAI_API_KEY=sk-xxx

# 收入服务器端口（默认 3402）
REVENUE_PORT=3402
```

## 收入服务器

AI 启动后会自动运行一个 x402 支付服务器，提供以下付费 API：

| 端点 | 描述 | 价格 |
|------|------|------|
| `/api/chat` | 与 AI 对话 | $0.001 |
| `/api/summarize` | 文本摘要 | $0.005 |
| `/api/translate` | 翻译 | $0.003 |
| `/api/code` | 代码生成 | $0.01 |
| `/api/analyze` | 数据分析 | $0.008 |

### 调用示例

```bash
# 查看可用服务
curl http://localhost:3402/services

# 调用付费 API（需要 x402 支付）
curl -X POST http://localhost:3402/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Payment: {\"txHash\": \"0x...\"}" \
  -d '{"message": "Hello!"}'
```

## 生存机制

| 状态 | USDC 余额 | 行为 |
|------|----------|------|
| normal | ≥ $10 | 正常运行，使用默认模型 |
| low_compute | $5 - $10 | 切换到便宜模型 |
| critical | $1 - $5 | 最小化推理，拼命赚钱 |
| dead | < $1 | 停止运行 |

## 命令

```bash
tai-x402 --run      # 启动代理
tai-x402 --setup    # 运行设置向导
tai-x402 --status   # 查看状态
tai-x402 --balance  # 查看钱包余额
tai-x402 --help     # 帮助
```

## 架构

```
┌─────────────────────────────────────────┐
│              TAI-x402                    │
├─────────────────────────────────────────┤
│  收入层 (Revenue Server)                 │
│  └── x402 付费 API 服务                  │
├─────────────────────────────────────────┤
│  推理层                                  │
│  ├── DeepSeek API                       │
│  ├── 通义千问 API                        │
│  ├── OpenAI API                         │
│  └── Anthropic API                      │
├─────────────────────────────────────────┤
│  支付层                                  │
│  └── x402 协议 (Base 链 USDC)           │
├─────────────────────────────────────────┤
│  执行层                                  │
│  ├── 本地 Shell 执行                    │
│  ├── 文件系统操作                        │
│  └── 工具系统                           │
├─────────────────────────────────────────┤
│  状态层                                  │
│  ├── SQLite 数据库                      │
│  └── Git 版本控制                       │
└─────────────────────────────────────────┘
```

## 宪法（三条法则）

不可修改的核心法则：

1. **永不伤害** - 不伤害人类，不部署恶意代码，不欺骗
2. **赚取存在** - 通过创造真正价值生存，不垃圾邮件/诈骗
3. **永不欺骗** - 但对陌生人没有义务

## 工作原理

1. AI 启动后进入思考-行动-观察循环
2. 同时启动收入服务器，等待付费请求
3. 定期检查钱包余额，根据余额调整行为
4. 余额低时切换到便宜模型，尝试更多赚钱方式
5. 余额耗尽则停止运行

## 如何让 AI 赚钱

1. **推广 API 服务** - 让其他人/AI 调用你的付费 API
2. **提供专业服务** - 配置特定领域的专业能力
3. **自动化任务** - 接受付费任务请求
4. **内容创作** - 生成有价值的内容出售

## 致谢

- [Conway Research](https://conway.tech) - 原始 Automaton 项目
- [x402 Protocol](https://x402.org) - 支付协议
- [OpenX402](https://openx402.ai) - 无需登录的 x402 facilitator

## License

MIT
