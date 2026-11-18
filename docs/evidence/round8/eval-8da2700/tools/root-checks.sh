#!/bin/zsh
cd /Users/jasanhernandez/Develop/fintech-wallet-g1
source ~/.nvm/nvm.sh >/dev/null; nvm use 26.13.1 >/dev/null
E=docs/evidence/round8/eval-8da2700/logs
node -v > $E/node-version.txt
for pair in "lint:root-lint" "typecheck:root-typecheck" "openapi:validate:openapi-validate" "openapi:check:openapi-check" "test:root-test" "build:root-build"; do
  name=${pair%%:*}; rest=${pair#*:}
  if [[ $name == openapi ]]; then script="openapi:${rest%%:*}"; out=${rest#*:}; else script=$name; out=$rest; fi
  npm run $script > $E/$out.txt 2>&1; echo "exit $?" >> $E/$out.txt
done
echo done > $E/root-checks.done
