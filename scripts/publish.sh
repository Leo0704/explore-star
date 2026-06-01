#!/usr/bin/env bash
# 发布脚本
# 1. 运行测试
# 2. 编译 TypeScript
# 3. npm publish

set -e
cd "$(dirname "$0")/.."

VERSION=$(node -e "console.log(require('./package.json').version)")

echo "======================================"
echo "探星发布 v$VERSION"
echo "======================================"

# 1. 测试
echo ""
echo "[1/3] 运行测试..."
bash scripts/integration-test.sh

# 2. 编译
echo ""
echo "[2/3] TypeScript 编译..."
npx tsc

# 3. 发布
echo ""
echo "[3/3] npm publish..."
npm publish

echo ""
echo "======================================"
echo "✅ 发布完成 v$VERSION"
echo "======================================"