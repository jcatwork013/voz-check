#!/usr/bin/env bash
# Gỡ sạch VozCheck: containers + volume + route nginx. Thêm --all để xoá luôn image.
set -euo pipefail
cd "$(dirname "$0")"

echo "→ docker compose down (xoá volume data)…"
docker compose down -v || true

NGINX_CONF=/home/ubuntu/nginx-central/conf.d/voz-check.conf
if [ -f "$NGINX_CONF" ]; then
  echo "→ gỡ route nginx…"
  rm -f "$NGINX_CONF"
  docker exec central-nginx nginx -s reload 2>/dev/null || true
fi

if [ "${1:-}" = "--all" ]; then
  echo "→ xoá image…"
  docker rmi voz-check-api:latest voz-check-web:latest 2>/dev/null || true
fi

echo "✓ done."
