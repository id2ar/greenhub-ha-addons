#!/usr/bin/with-contenv bash
set -e

CONFIG_PATH="/data/options.json"
if [ ! -f "$CONFIG_PATH" ]; then
  echo "options.json not found at $CONFIG_PATH"
  exit 1
fi

# Leer options.json sin jq (usar node)
export GREENHUB_WEBHOOK_URL=$(node -p "require('$CONFIG_PATH').greenhub_webhook_url")
export HMAC_SECRET=$(node -p "require('$CONFIG_PATH').hmac_secret")
export SITE_CODE=$(node -p "require('$CONFIG_PATH').site_code || 'et_centre'")
export BATCH_INTERVAL_SEC=$(node -p "require('$CONFIG_PATH').batch_interval_sec || 5")
export MAX_BATCH_SIZE=$(node -p "require('$CONFIG_PATH').max_batch_size || 100")

# allowlist: array -> coma-separado
export ENTITY_ALLOWLIST=$(node -p "(require('$CONFIG_PATH').entity_allowlist || []).join(',')")

node /app/src/index.js
