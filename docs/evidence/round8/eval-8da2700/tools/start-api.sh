#!/bin/zsh
# usage: start-api.sh PORT [VAR=val ...]   -> exec's ONE node process (PID == $$) on wallet_test ONLY. Never wallet_dev.
port=$1; shift
envf=/Users/jasanhernandez/Develop/fintech-wallet/.env
source ~/.nvm/nvm.sh >/dev/null; nvm use 26.13.1 >/dev/null
get(){ grep -E "^$1=" $envf | head -1 | cut -d= -f2-; }
tu=$(get TEST_DATABASE_URL)
case "$tu" in *wallet_runtime_test:*@localhost:55432/wallet_test) ;; *) echo "refusing DB"; exit 3;; esac
set -a
for k in JWT_ACCESS_SECRET REFRESH_TOKEN_PEPPER CLABE_ENCRYPTION_KEY CLABE_LOOKUP_KEY BUSINESS_TIME_ZONE DAILY_TRANSFER_LIMIT_MINOR OTP_THRESHOLD_MINOR OTP_EXPIRY_SECONDS OTP_MAX_ATTEMPTS DEMO_PRIMARY_BALANCE_MINOR DEMO_SAVINGS_BALANCE_MINOR; do v=$(get $k); [ -n "$v" ] && export $k="$v"; done
set +a
export DATABASE_URL="$tu" APP_ENV=development DEMO_FIXTURE_ENABLED=true API_PORT=$port WEB_ORIGIN=${WEB_ORIGIN:-http://localhost:8951}
export IDEMPOTENCY_RECORD_RETENTION_DAYS=${IDEMPOTENCY_RECORD_RETENTION_DAYS-30}
[ "$IDEMPOTENCY_RECORD_RETENTION_DAYS" = "UNSET" ] && unset IDEMPOTENCY_RECORD_RETENTION_DAYS
for kv in "$@"; do export "$kv"; done
cd /Users/jasanhernandez/Develop/fintech-wallet-g1/api
exec node --import tsx src/server.ts
