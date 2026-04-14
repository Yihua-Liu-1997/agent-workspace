#!/bin/bash
# AlphaXiv 每日热门论文推送脚本
# 每天 9:00 运行

set -e

WORKSPACE="/home/useradmin/agent_workspace"
SCRIPT="$WORKSPACE/scripts/alphaxiv-hot.js"
DATA_DIR="$WORKSPACE/data"
REPORT_FILE="$DATA_DIR/alphaxiv-daily.md"

echo "🚀 开始执行 AlphaXiv 每日推送..."
echo "📅 $(date '+%Y-%m-%d %H:%M:%S')"

# 确保目录存在
mkdir -p "$DATA_DIR"

# 运行抓取脚本
cd "$WORKSPACE"
node "$SCRIPT" > /tmp/alphaxiv-output.txt 2>&1

if [ $? -eq 0 ]; then
    echo "✅ 抓取成功"
    
    # 读取报告内容
    if [ -f "$REPORT_FILE" ]; then
        REPORT=$(cat "$REPORT_FILE")
        echo "📄 报告内容:"
        echo "$REPORT"
    else
        echo "⚠️ 报告文件不存在，使用 stdout 输出"
        REPORT=$(cat /tmp/alphaxiv-output.txt | sed -n '/🔥/,/_数据来源/p')
    fi
else
    echo "❌ 抓取失败"
    cat /tmp/alphaxiv-output.txt
    exit 1
fi

# 清理临时文件
rm -f /tmp/alphaxiv-output.txt

echo ""
echo "✨ 完成！"
