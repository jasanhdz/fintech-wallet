#!/bin/zsh
# usage: export-web.sh OUTDIR API_PORT   (exports mobile for web against our API, patches the SecureStore shim in the COPY only)
out=$1; apiport=$2
source ~/.nvm/nvm.sh >/dev/null; nvm use 26.13.1 >/dev/null
cd /Users/jasanhernandez/Develop/fintech-wallet-g1/mobile
EXPO_PUBLIC_API_URL=http://127.0.0.1:$apiport/v1 CI=1 npx expo export --platform web --output-dir $out
python3 -I /Users/jasanhernandez/Develop/fintech-wallet-g1/docs/evidence/round6/71bd7e5/tools/patch.py $out
