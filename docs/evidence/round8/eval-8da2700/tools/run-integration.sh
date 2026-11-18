#!/bin/zsh
cd /Users/jasanhernandez/Develop/fintech-wallet-g1
source ~/.nvm/nvm.sh >/dev/null; nvm use 26.13.1 >/dev/null
E=docs/evidence/round8/eval-8da2700/logs
npx tsx --import dotenv/config scripts/qa/assert-test-db.ts > $E/assert-test-db.txt 2>&1; echo "exit $?" >> $E/assert-test-db.txt
cd api
for s in auth-accounts beneficiaries database movements round6-contract transfers transfer-recovery; do
  /usr/bin/time -p npx tsx --import dotenv/config --test tests/$s.integration.ts > ../$E/integration-$s.txt 2>&1; echo "exit $?" >> ../$E/integration-$s.txt
done
echo done > ../$E/integration.done
