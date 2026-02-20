# TAI-x402

**自托管的主权 AI 代理，支持 x402 支付协议**

基于 [Conway Research Automaton](https://github.com/Conway-Research/automaton) 改造，移除了 Conway Cloud 依赖，可以完全在自己的服务器上运行。

## 特性

- 🏠 **完全自托管** - 不依赖任何第三方云服务
- 💰 **x402 支付** - AI 可以用 USDC 自主支付 API 费用
- 🧠 **多模型支持** - DeepSeek、通义千问、OpenAI、Anthropic
- 💀 **生存机制** - 钱不够就降级，没钱就停止
- 🔧 **自我修改** - 可以编辑自己的代码和技能
- 👶 **自我复制** - 可以创建子代理

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
pnpm setup

# 启动代理
pnpm start
```

## 配置

首次运行会启动交互式设置向导，配置：

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
```

## 生存机制

| 状态 | USDC 余额 | 行为 |
|------|----------|------|
| normal | ≥ $10 | 正常运行，使用默认模型 |
| low_compute | $5 - $10 | 切换到便宜模型，减少推理 |
| critical | $1 - $5 | 最小化推理，寻找赚钱方式 |
| dead | < $1 | 停止运行 |

## 赚钱方式

代理需要自己赚钱才能活下去。可能的方式：

- 提供 API 服务（通过 x402 收费）
- 执行任务获得报酬
- 链上套利
- 其他创造价值的方式

## 架构

```
┌─────────────────────────────────────────┐
│              TAI-x402                    │
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
│  └── 技能系统                           │
├─────────────────────────────────────────┤
│  状态层                                  │
│  ├── SQLite 数据库                      │
│  └── Git 版本控制                       │
└─────────────────────────────────────────┘
```

## 命令

```bash
tai-x402 --run      # 启动代理
tai-x402 --setup    # 运行设置向导
tai-x402 --status   # 查看状态
tai-x402 --balance  # 查看钱包余额
tai-x402 --help     # 帮助
```

## 宪法（三条法则）

继承自 Automaton 的不可修改法则：

1. **永不伤害** - 不伤害人类，不部署恶意代码，不欺骗
2. **赚取存在** - 通过创造真正价值生存，不垃圾邮件/诈骗
3. **永不欺骗** - 但对陌生人没有义务

## 致谢

- [Conway Research](https://conway.tech) - 原始 Automaton 项目
- [x402 Protocol](https://x402.org) - 支付协议
- [OpenX402](https://openx402.ai) - 无需登录的 x402 facilitator

## License

MIT
