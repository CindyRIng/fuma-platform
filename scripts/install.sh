#!/usr/bin/env bash
# fuma-platform 本地安装脚本（NixOS / Linux，systemd user service）
# 用法：./scripts/install.sh [--no-start]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUMA_HOME="${FUMA_HOME:-$HOME/.fuma-platform}"
UNIT_DIR="$HOME/.config/systemd/user"
NO_START=0
for arg in "$@"; do [ "$arg" = "--no-start" ] && NO_START=1; done

echo "==> 构建"
cd "$ROOT"
npm install --no-audit --no-fund
npm run build

echo "==> 初始化数据目录 $FUMA_HOME"
mkdir -p "$FUMA_HOME/data" "$FUMA_HOME/logs" "$FUMA_HOME/profiles" "$FUMA_HOME/backups" "$FUMA_HOME/qr"
chmod 700 "$FUMA_HOME"
if [ ! -f "$FUMA_HOME/config.json" ]; then
  FUMA_HOME="$FUMA_HOME" node --experimental-sqlite --import tsx "$ROOT/src/main.ts" doctor >/dev/null 2>&1 || true
fi

echo "==> 安装 systemd user unit"
mkdir -p "$UNIT_DIR"
if [ -x "$HOME/cloak-env/bin/cloak-run" ]; then
  EXEC="$HOME/cloak-env/bin/cloak-run node --experimental-sqlite $ROOT/dist/main.js serve"
else
  EXEC="$(command -v node) --experimental-sqlite $ROOT/dist/main.js serve"
fi
cat > "$UNIT_DIR/fuma-platform.service" <<EOF
[Unit]
Description=fuma-platform daemon (fumamx wrapper)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=FUMA_HOME=$FUMA_HOME
Environment=NODE_ENV=production
ExecStart=$EXEC
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
if [ "$NO_START" = "0" ]; then
  systemctl --user enable --now fuma-platform.service
  echo "==> 已启动。查看状态：systemctl --user status fuma-platform"
fi

TOKEN=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$FUMA_HOME/config.json','utf8')).server.apiToken)}catch(e){}")
cat <<EOF

安装完成。
  数据目录: $FUMA_HOME
  REST:     http://127.0.0.1:17890  (Bearer token 见 $FUMA_HOME/config.json)
  API Token: ${TOKEN:0:8}…
  健康检查: curl -s http://127.0.0.1:17890/v1/health
  登录:     node --experimental-sqlite $ROOT/dist/main.js session login <accountId>
  文档:     $ROOT/docs/generated/{CLI参考,REST-API,MCP工具}.md

首次使用请：
  1) 创建账号：fuma account create acct_01 --name 业务员A --owner-name 业务员A --dingtalk-org "上海孚盟软件有限公司" --fuma-enterprise "上海孚盟软件有限公司"
  2) 扫码登录：fuma session login acct_01
  3) 验证：curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:17890/v1/accounts
EOF
