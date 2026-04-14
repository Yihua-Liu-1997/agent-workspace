#!/bin/bash
# tg-send.sh — 通过 Telegram Bot API 发送消息
# 用法: tg-send.sh <chat_id> <message>
#       echo "message" | tg-send.sh <chat_id>
#       tg-send.sh <chat_id> --file <filepath>
# 替代原来的 openclaw message send --channel telegram --target <id>

set -e

# 从 hermes .env 读取 token
HERMES_ENV="$HOME/.hermes/.env"
if [ -f "$HERMES_ENV" ]; then
  BOT_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$HERMES_ENV" | cut -d= -f2)
fi

if [ -z "$BOT_TOKEN" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not found in $HERMES_ENV" >&2
  exit 1
fi

CHAT_ID="${1:-5740650457}"
shift 2>/dev/null || true

# 读取消息内容
if [ "$1" = "--file" ] && [ -n "$2" ]; then
  MESSAGE=$(cat "$2")
elif [ -n "$1" ]; then
  MESSAGE="$*"
else
  # 从 stdin 读取
  MESSAGE=$(cat)
fi

if [ -z "$MESSAGE" ]; then
  echo "Error: No message to send" >&2
  exit 1
fi

# Telegram 限制 4096 字符，自动分段
MAX_LEN=4000

send_chunk() {
  local text="$1"
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" \
    --data-urlencode "text=${text}" \
    -d "parse_mode=Markdown" \
    -o /dev/null -w "%{http_code}"
}

if [ ${#MESSAGE} -le $MAX_LEN ]; then
  HTTP_CODE=$(send_chunk "$MESSAGE")
  if [ "$HTTP_CODE" != "200" ]; then
    # 重试不带 parse_mode（Markdown 格式错误时）
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      -d "chat_id=${CHAT_ID}" \
      --data-urlencode "text=${MESSAGE}" \
      -o /dev/null
  fi
else
  # 按行分段
  CHUNK=""
  while IFS= read -r line; do
    if [ $(( ${#CHUNK} + ${#line} + 1 )) -gt $MAX_LEN ]; then
      if [ -n "$CHUNK" ]; then
        send_chunk "$CHUNK" >/dev/null
        sleep 1
      fi
      CHUNK="$line"
    else
      CHUNK="${CHUNK}${CHUNK:+
}${line}"
    fi
  done <<< "$MESSAGE"
  if [ -n "$CHUNK" ]; then
    send_chunk "$CHUNK" >/dev/null
  fi
fi
