#!/usr/bin/with-contenv bash
set -e

export GREENHUB_WEBHOOK_URL="${GREENHUB_WEBHOOK_URL:-${greenhub_webhook_url}}"
export HMAC_SECRET="${HMAC_SECRET:-${hmac_secret}}"
export SITE_CODE="${SITE_CODE:-${site_code}}"
export BATCH_INTERVAL_SEC="${BATCH_INTERVAL_SEC:-${batch_interval_sec}}"
export MAX_BATCH_SIZE="${MAX_BATCH_SIZE:-${max_batch_size}}"

# entity_allowlist in HA add-on options arrives as JSON sometimes; accept comma string too
if [ -n "${entity_allowlist}" ]; then
  # If it's JSON array, convert to comma list
  if echo "${entity_allowlist}" | grep -q '^\['; then
    export ENTITY_ALLOWLIST=$(echo "${entity_allowlist}" | tr -d '[]"' | tr ',' ',')
  else
    export ENTITY_ALLOWLIST="${entity_allowlist}"
  fi
fi

node /app/src/index.js

