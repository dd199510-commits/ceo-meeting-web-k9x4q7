#!/bin/zsh
set -e

cd "$(dirname "$0")"

PORT="${PORT:-8765}"
URL="http://127.0.0.1:${PORT}/"

if ! command -v python3 >/dev/null 2>&1; then
  osascript -e 'display dialog "未找到 python3，无法启动本地网页版服务。请改用静态网站服务部署 dist 目录。" buttons {"好"} default button "好"'
  exit 1
fi

open "$URL"
python3 -m http.server "$PORT" --bind 127.0.0.1
