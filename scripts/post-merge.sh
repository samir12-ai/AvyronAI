#!/bin/bash
set -e

npm install --no-audit --no-fund

if [ -n "$DATABASE_URL" ]; then
  npm run db:push -- --force || echo "[post-merge] db:push failed (non-fatal)"
else
  echo "[post-merge] DATABASE_URL not set; skipping db:push"
fi
