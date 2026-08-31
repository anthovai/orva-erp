#!/bin/sh
set -euo pipefail

export CACHE_STRATEGY="${CACHE_STRATEGY:-redis}"
export CACHE_REDIS_URL="${CACHE_REDIS_URL:-${REDIS_URL:-}}"
export QUEUE_STRATEGY="${QUEUE_STRATEGY:-async}"
export NEXT_PUBLIC_QUEUE_STRATEGY="${NEXT_PUBLIC_QUEUE_STRATEGY:-async}"

# Railway always fronts the app with exactly one edge proxy, and it appends the
# real client IP as the LAST X-Forwarded-For entry — so depth 1 reads the true
# caller even when the client sent a forged header of its own. Without this the
# per-IP rate limits (public document PDFs, directory lookups) see no IP at all
# and silently enforce nothing. Raise it only if you put another proxy in front
# (e.g. Cloudflare would make it 2); overshooting trusts a spoofable entry.
export RATE_LIMIT_TRUST_PROXY_DEPTH="${RATE_LIMIT_TRUST_PROXY_DEPTH:-1}"

# A memory limiter is per-process: it would multiply every cap by the instance
# count and reset on each redeploy. Redis is already this deployment's cache
# backend, so share it when it is configured.
if [ -n "${REDIS_URL:-}" ]; then
  export RATE_LIMIT_STRATEGY="${RATE_LIMIT_STRATEGY:-redis}"
fi

sh ./docker/scripts/init-or-migrate.sh

if [ ! -d ".mercato/generated" ]; then
  yarn generate
fi

exec yarn start
