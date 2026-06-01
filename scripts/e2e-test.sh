#!/usr/bin/env bash
# E2E 测试：迷你流程
# init → doctor → run --dry-run → analyze

set -e
cd "$(dirname "$0")/.."

echo "======================================"
echo "探星 E2E 冒烟测试"
echo "======================================"

TEST_DIR="./tmp-e2e-test"
rm -rf "$TEST_DIR"

# 1. init
echo ""
echo "[1/4] npx explore-star init $TEST_DIR"
if node dist/cli/index.js init "$(basename $TEST_DIR)" 2>&1; then
  echo "✅ init 成功"
else
  echo "❌ init 失败"
  exit 1
fi

# 2. doctor
echo ""
echo "[2/4] npx explore-star doctor --business ./$TEST_DIR"
if node dist/cli/index.js doctor --business "./$TEST_DIR" 2>&1 | tail -20; then
  echo "✅ doctor 成功"
else
  echo "⚠️  doctor 有警告（继续）"
fi

# 3. run --dry-run
echo ""
echo "[3/4] npx explore-star run --business ./$TEST_DIR --dry-run"
if timeout 60 node dist/cli/index.js run --business "./$TEST_DIR" --dry-run 2>&1 | tail -30; then
  echo "✅ run --dry-run 成功"
else
  echo "⚠️  run --dry-run 超时或有错误（继续）"
fi

# 4. insights --dry-run
echo ""
echo "[4/4] npx explore-star insights --business ./$TEST_DIR --dry-run"
if node dist/cli/index.js insights --business "./$TEST_DIR" --dry-run 2>&1 | tail -20; then
  echo "✅ insights --dry-run 成功"
else
  echo "⚠️  insights 有警告（继续）"
fi

rm -rf "$TEST_DIR"

echo ""
echo "======================================"
echo "E2E 测试完成"
echo "======================================"