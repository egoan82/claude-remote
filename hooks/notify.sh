#!/usr/bin/env bash
# Hook de Claude Code (Notification / Stop): reenvía el evento a claude-remote para
# mandar un push al celular. Si el servidor no está corriendo, no hace nada.
# Nunca bloquea a Claude: timeout corto y siempre sale con 0.
PORT="${CLAUDE_REMOTE_PORT:-7681}"
curl -s -m 3 -X POST "http://127.0.0.1:${PORT}/api/hook" \
  -H 'content-type: application/json' \
  -H "x-tmux-pane: ${TMUX_PANE:-}" \
  --data-binary @- >/dev/null 2>&1 || true
exit 0
