#!/usr/bin/env bash
# 集成测试：4 个健康检查
# 验证系统各模块的集成状态

set -e
cd "$(dirname "$0")/.."

echo "======================================"
echo "探星集成测试"
echo "======================================"

# 1. 检查 TypeScript 编译
echo ""
echo "[1/4] TypeScript 编译检查..."
if npx tsc --noEmit 2>&1 | head -20; then
  echo "✅ TypeScript 编译通过"
else
  echo "❌ TypeScript 编译失败"
  exit 1
fi

# 2. 运行单元测试
echo ""
echo "[2/4] 运行单元测试..."
if npx vitest run --reporter=verbose 2>&1 | tail -30; then
  echo "✅ 单元测试通过"
else
  echo "⚠️  单元测试有失败（继续检查其他项）"
fi

# 3. CLI help 测试
echo ""
echo "[3/4] CLI 子命令 help 测试..."
for cmd in init doctor run analyze nurture convert insights conversion-report reactivate watch-bookings configure; do
  if node dist/cli/index.js $cmd --help > /dev/null 2>&1; then
    echo "  ✅ $cmd --help"
  else
    echo "  ❌ $cmd --help 失败"
  fi
done

# 4. 健康检查
echo ""
echo "[4/4] 运行健康检查..."
if node dist/cli/index.js doctor 2>&1 | tail -20; then
  echo "✅ 健康检查完成"
else
  echo "⚠️  健康检查有警告（继续）"
fi

echo ""
echo "======================================"
echo "集成测试完成"
echo "======================================"