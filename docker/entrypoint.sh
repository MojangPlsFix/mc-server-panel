#!/bin/sh
# On the container's first start: writes a sandbox config (tmux control + fake server) and sets the
# password. Later starts (docker compose restart) keep the config, like a real install would.
set -eu

if [ ! -f "$MC_PANEL_CONFIG" ]; then
cat > "$MC_PANEL_CONFIG" <<EOF
{
  "listen": { "host": "0.0.0.0", "port": 8080 },
  "server": {
    "name": "${SERVER_NAME:-Sandbox Server}",
    "directory": "/srv/minecraft",
    "tmuxSession": "minecraft",
    "address": { "host": "127.0.0.1", "port": 25565 },
    "control": {
      "type": "tmux",
      "startCommand": "node /opt/fake-server/fake-server.mjs",
      "stopTimeoutSeconds": 20
    }
  }
}
EOF

MC_PANEL_PASSWORD="${PANEL_PASSWORD:-sandbox-password}" node /opt/panel/server.js set-password
fi

exec node /opt/panel/server.js
