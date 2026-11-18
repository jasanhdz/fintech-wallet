#!/bin/zsh
# H6 verification for code 312e0c7: root checks, API integration suites ONE AT A TIME on wallet_test, mobile jest.
cd /Users/jasanhernandez/Develop/fintech-wallet-g1
source ~/.nvm/nvm.sh >/dev/null; nvm use 26.13.1 >/dev/null
E=docs/evidence/round8/h6-312e0c7/logs
for step in lint typecheck test build openapi:check; do
  npm run $step > $E/root-$step.txt 2>&1; echo "exit $?" >> $E/root-$step.txt
done
npx tsx --import dotenv/config scripts/qa/assert-test-db.ts > $E/assert-test-db.txt 2>&1; echo "exit $?" >> $E/assert-test-db.txt
cd api
for s in auth-accounts beneficiaries database movements round6-contract transfers transfer-recovery; do
  /usr/bin/time -p npx tsx --import dotenv/config --test tests/$s.integration.ts > ../$E/integration-$s.txt 2>&1; echo "exit $?" >> ../$E/integration-$s.txt
done
cd ../mobile
npx jest > ../$E/mobile-jest.txt 2>&1; echo "exit $?" >> ../$E/mobile-jest.txt
echo done > ../$E/run-all.done
