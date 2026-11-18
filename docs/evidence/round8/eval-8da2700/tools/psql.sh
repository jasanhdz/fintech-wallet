#!/bin/zsh
# usage: psql.sh <role: runtime|migrator> [psql args...]   (wallet_test ONLY; refuses anything else)
role=$1; shift
envf=/Users/jasanhernandez/Develop/fintech-wallet/.env
case $role in
  runtime) key=TEST_DATABASE_URL;;
  migrator) key=TEST_MIGRATOR_DATABASE_URL;;
  *) echo bad role; exit 2;;
esac
url=$(grep -E "^$key=" $envf | head -1 | cut -d= -f2-)
user=$(echo "$url" | sed -E 's#^[a-z]+://([^:]+):.*#\1#')
pass=$(echo "$url" | sed -E 's#^[a-z]+://[^:]+:([^@]*)@.*#\1#')
db=$(echo "$url" | sed -E 's#.*/([^/?]+).*#\1#')
[ "$db" = "wallet_test" ] || { echo "refusing db $db"; exit 3; }
docker exec -i -e PGPASSWORD="$pass" fintech-wallet-postgres-1 psql -h localhost -U "$user" -d wallet_test -v ON_ERROR_STOP=0 "$@"
