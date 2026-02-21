#!/bin/bash
# TAI-x402 快速启动脚本
# 使用 OpenClaw 现有的模型配置

set -e

DATA_DIR="$HOME/.tai-x402"
mkdir -p "$DATA_DIR"

# 检查是否已配置
if [ ! -f "$DATA_DIR/config.json" ]; then
  echo "首次运行，创建配置..."
  
  # 生成钱包
  PRIVATE_KEY=$(node -e "const {generatePrivateKey}=require('viem/accounts');console.log(generatePrivateKey())")
  ADDRESS=$(node -e "const {privateKeyToAccount}=require('viem/accounts');console.log(privateKeyToAccount('$PRIVATE_KEY').address)")
  
  # 保存钱包
  cat > "$DATA_DIR/wallet.json" << EOF
{
  "privateKey": "$PRIVATE_KEY",
  "address": "$ADDRESS",
  "createdAt": "$(date -Iseconds)"
}
EOF
  chmod 600 "$DATA_DIR/wallet.json"
  
  # 创建配置 - 使用 yunyi-claude
  cat > "$DATA_DIR/config.json" << EOF
{
  "name": "TAI",
  "walletAddress": "$ADDRESS",
  "genesisPrompt": "你是一个主权 AI 代理。你的目标是通过为他人创造价值来生存。",
  "providers": {
    "custom": {
      "name": "yunyi-claude",
      "apiUrl": "https://yunyi.cfd/claude",
      "apiKey": "Z8WBW3C0-0MBP-CMQY-74E9-BX1PFQZFM8X2",
      "defaultModel": "claude-opus-4-5-20251101",
      "maxTokens": 8192,
      "apiType": "anthropic"
    }
  },
  "defaultProvider": "custom",
  "maxTokensPerTurn": 8192,
  "survivalThresholds": {
    "normal": 10,
    "lowCompute": 5,
    "critical": 1
  },
  "x402": {
    "network": "base-sepolia",
    "enabled": true
  },
  "dataDir": "$DATA_DIR",
  "dbPath": "$DATA_DIR/state.db",
  "logLevel": "info",
  "version": "0.1.0"
}
EOF

  echo ""
  echo "=========================================="
  echo "配置完成！"
  echo "钱包地址: $ADDRESS"
  echo "网络: Base Sepolia (测试网)"
  echo "=========================================="
  echo ""
  echo "⚠️  请保存你的私钥（仅显示一次）:"
  echo "$PRIVATE_KEY"
  echo ""
  echo "下一步: 在 Base Sepolia 上给钱包充值 USDC"
  echo "测试网水龙头: https://www.alchemy.com/faucets/base-sepolia"
  echo ""
fi

echo "启动 TAI-x402..."
node dist/tai-main.js --run
