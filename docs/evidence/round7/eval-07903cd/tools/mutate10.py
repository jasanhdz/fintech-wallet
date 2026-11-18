"""Evaluator pass 10 (code 07903cd): mutations of mobile/App.tsx written by the evaluator (not taken from the generator's list).
Each mutation must make at least one jest test fail. The file is always restored with `git checkout -- mobile/App.tsx`.
Usage (repo root, App.tsx unmodified):  python3 -I docs/evidence/round7/eval-07903cd/tools/mutate10.py > .../logs/mutations10.txt
ONLY=<substring> runs matching ones; DRY=1 only validates the anchors."""
import os, pathlib, subprocess, sys

ROOT = pathlib.Path.cwd()
APP = ROOT / 'mobile' / 'App.tsx'
M = []
def m(name, old, new): M.append((name, old, new))

# --- F-28 (the two the previous pass found alive), written as the defect itself
m('F28-1 guard of submitCreate fails OPEN when SecureStore is unreadable: catch { existing = null }',
  "      try { existing = await readOwnRecovery(userId); }\n      catch (error) {",
  "      try { existing = await readOwnRecovery(userId); }\n      catch { existing = null; }\n      if (existing === undefined) try { /* never */ } catch (error) {")
m('F28-2 requestNewCode forces replacesClosedAttempt=true', 'await submitCreate(payload, Boolean(previous));', 'await submitCreate(payload, true);')
# --- 1: unconfirmed 4xx
m('1a 409 "en curso" goes to M11 (variant 409 only)', "setTransferScreen(confirmed ? 'rejected' : 'status');",
  "setTransferScreen(confirmed || (error instanceof ApiError && error.status === 409) ? 'rejected' : 'status');")
m('1b 409 releases (deletes) the record', 'if (confirmed) await clearRecovery(userId).catch(() => undefined);',
  'if (confirmed || (error instanceof ApiError && error.status === 409)) await clearRecovery(userId).catch(() => undefined);')
m('1c any 429 (rate limit) counts as a confirmed business rejection',
  "(error.status === 429 && DAILY_LIMIT_PATTERN.test(error.message))", "(error.status === 429)")
m('1d 400 / 403 count as confirmed rejections', "return error.status === 422 ||", "return error.status === 422 || error.status === 400 || error.status === 403 ||")
m('1e 401 counts as confirmed rejection', "return error.status === 422 ||", "return error.status === 422 || error.status === 401 ||")
m('1f a transport error (no response) counts as rejected', "const confirmed = error instanceof ApiError && isBusinessRejection(error);\n      // M11 shows",
  "const confirmed = !(error instanceof ApiError) || isBusinessRejection(error);\n      // M11 shows")
m('1g M09 exit ("Ir al inicio") deletes the record', '  function leaveUncertainTransfer() {\n', '  function leaveUncertainTransfer() {\n    void clearRecovery(session?.user.id).catch(() => undefined);\n')
m('1h Home exit through resetTransfer deletes the record', '  function resetTransfer() {\n', '  function resetTransfer() {\n    void clearRecovery(session?.user.id).catch(() => undefined);\n')
# --- 2: checking never creates / never resolves by coincidence
m('2a M09 "Verificar" without id sends the create', "    if (!transferId) {\n      setPendingCheck('no_id');",
  "    if (!transferId) {\n      if (pendingRecord) void sendAttempt(pendingRecord, session.user.id, session.accessToken);\n      setPendingCheck('no_id');")
m('2b Home "Verificar" (tap) without id sends the create', "        if (byTap) { setPendingCheck('no_id');",
  "        if (byTap) { void sendAttempt(record, userId, token); setPendingCheck('no_id');")
m('2c Home shown / foreground / login (automatic) sends the create of an attempt without id', "      if (!record.transferId) {\n",
  "      if (!record.transferId) {\n        if (!byTap) void sendAttempt(record, userId, token);\n")
m('2d start-up replays the create of an attempt without id', "        if (!attempt.transferId) return;",
  "        if (!attempt.transferId) { void sendAttempt(attempt, session.user.id, session.accessToken); return; }")
m('2e a matching charge in Movimientos (amount+concept+reference) resolves and releases the attempt without id',
  "      if (!record.transferId) {\n",
  "      if (!record.transferId) {\n        { const page = await request<{ items: Movement[] }>(`/accounts/${encodeURIComponent(record.payload.sourceAccountId)}/movements?limit=20`, token); const hit = page.items.find((mv) => mv.type === 'debit' && mv.amountMinor === record.payload.amountMinor && mv.concept === record.payload.concept && mv.reference === record.payload.reference); if (hit) { await clearRecovery(userId); setPendingRecord(null); return; } }\n")
m('2f M09 "Verificar" resolves an attempt without id from a matching charge', "    if (!transferId) {\n      setPendingCheck('no_id');",
  "    if (!transferId) {\n      if (pendingRecord) { const page = await request<{ items: Movement[] }>(`/accounts/${encodeURIComponent(pendingRecord.payload.sourceAccountId)}/movements?limit=20`, session.accessToken).catch(() => ({ items: [] as Movement[] })); if (page.items.some((mv) => mv.type === 'debit' && mv.amountMinor === pendingRecord.payload.amountMinor && mv.concept === pendingRecord.payload.concept)) { await clearRecovery(session.user.id); setTransferScreen(null); return; } }\n      setPendingCheck('no_id');")
# --- 3: explicit resend, same key and payload
m('3a resend uses a new Idempotency-Key', '    try { await sendAttempt(record, userId, session.accessToken, true); }',
  '    try { await sendAttempt({ ...record, key: newIdempotencyKey() }, userId, session.accessToken, true); }')
m('3b resend sends a payload rebuilt from the form instead of the stored bytes', '    try { await sendAttempt(record, userId, session.accessToken, true); }',
  '    try { await sendAttempt({ ...record, payload: transferPayload ?? { ...record.payload, concept: `${record.payload.concept} ` } }, userId, session.accessToken, true); }')
m('3c "Reenviar" on Home sends at the first tap (no review, no consent screen)', "onResend={() => openResend('home')}", "onResend={() => { openResend('home'); void resendSameTransfer(); }}")
m('3d "Reenviar" on M09 sends at the first tap', "onResend={() => openResend('status')}", "onResend={() => { openResend('status'); void resendSameTransfer(); }}")
m('3e the consent (timestamp, via, otp) is not stored with the attempt', "consent: { confirmedAt: new Date().toISOString(), via: replacesClosedAttempt ? 'new_code' : 'confirm', otp: 'unknown' }, display }", "display }")
m('3f a resend answered 422/429 is final at the first answer (no same-key re-confirmation)', "        if (!(resend && error instanceof ApiError && isBusinessRejection(error))) throw error;", "        throw error;")
m('3g the resend ignores the stored record changing meanwhile (sends without re-reading the store)', "    if (!record || record.key !== pendingRecord?.key) {", "    if (false) {")
# --- 4: 404 / corrupt / unreadable
m('4a Home read answering 404 releases the record', "      setPendingCheck(record?.transferId && error instanceof ApiError && error.status === 404 ? 'not_found' : 'failed');",
  "      if (record?.transferId && error instanceof ApiError && error.status === 404) { await clearRecovery(userId); return; }\n      setPendingCheck('failed');")
m('4b start-up read answering 404 releases the record', "          setCreateAttempt(null); setTransferError(''); setTransferScreen(null); setPendingCheck('not_found');",
  "          await clearRecovery(session.user.id); setCreateAttempt(null); setTransferError(''); setTransferScreen(null);")
m('4c M09 "Verificar" answered 404 releases the record', "      if (error instanceof ApiError && error.status === 404) { setPendingCheck('not_found'); return; }",
  "      if (error instanceof ApiError && error.status === 404) { await clearRecovery(session.user.id); setTransferScreen(null); return; }")
m('4d a 404 of the POST (create) counts as a confirmed rejection', "return error.status === 422 ||", "return error.status === 422 || error.status === 404 ||")
m('4e "Descartar este intento" button is back', '    {awaitingCode ? null : movements}\n', '    {awaitingCode ? null : movements}\n    <Button title="Descartar este intento" variant="secondary" onPress={() => { void clearRecovery(record.userId); }}/>\n')
m('4f a corrupt record is treated as "no record" (releases the lock)', "  try { value = JSON.parse(raw); } catch { throw new RecoveryReadError('damaged'); }",
  "  try { value = JSON.parse(raw); } catch { return null as unknown as RecoveryRecord; }")
m('4g a corrupt record surfaces the raw parser message', "  try { value = JSON.parse(raw); } catch { throw new RecoveryReadError('damaged'); }",
  "  try { value = JSON.parse(raw); } catch (parseError) { throw parseError; }")
m('4h unreadable SecureStore is treated as "no record"', "  try { return await SecureStore.getItemAsync(key); } catch { throw new RecoveryReadError('unreadable'); }",
  "  try { return await SecureStore.getItemAsync(key); } catch { return null; }")
m('4i the not-found text claims nothing was charged', "const NOT_FOUND_TEXT = 'El servidor no encuentra esta operación. No podemos confirmar si se realizó un cargo: revisa Movimientos y tu saldo.';",
  "const NOT_FOUND_TEXT = 'El servidor no encuentra esta operación. No se realizó ningún cargo; puedes volver a intentarlo.';")
m('4j "Reintentar lectura" of a damaged record deletes it', 'onRetryRead={() => { setRecoveryReady(false); }}', 'onRetryRead={() => { void SecureStore.deleteItemAsync(recoveryKeyFor(session.user.id)).catch(() => undefined); setRecoveryReady(false); }}')
# --- misc financial guards
m('5a the guard of submitCreate does not stop a new attempt when a record exists', "      if (existing) { transferInFlight.current = false; holdForPendingAttempt(existing); return; }", "      if (existing) { /* mutated: proceed */ }")
m('5b leaving M08 without a confirmed close still deletes the record', "      if (!closed || !isTerminalStatus(closed.status)) { leaveUncertainTransfer(); return; }", "      if (!closed || !isTerminalStatus(closed.status)) { await clearRecovery(session.user.id).catch(() => undefined); resetTransfer(); return; }")
m('5c the record is shared by all users (F-22 regression)', "function recoveryKeyFor(userId: string): string { return `${LEGACY_RECOVERY_KEY}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`; }", "function recoveryKeyFor(userId: string): string { return LEGACY_RECOVERY_KEY; }")

def run_jest():
    p = subprocess.run(['npx', 'jest', '--maxWorkers=3', 'tests/app.test.tsx', 'tests/recovery-h4.test.tsx', 'tests/recovery-h5.test.tsx'], cwd=ROOT / 'mobile', capture_output=True, text=True)
    out = p.stdout + p.stderr
    summ = [l for l in out.splitlines() if l.startswith('Tests:')]
    failing = [l.strip() for l in out.splitlines() if l.strip().startswith('●') and '›' in l]
    return p.returncode, (summ[-1] if summ else 'no summary'), failing

only = os.environ.get('ONLY'); orig = APP.read_text(); surv = 0
sel = [x for x in M if not only or only in x[0]]
for name, old, new in sel:
    if orig.count(old) != 1:
        print(f'INVALID {name}: anchor found {orig.count(old)} times', flush=True); surv += 1; continue
    if os.environ.get('DRY'): print('ok anchor', name); continue
    APP.write_text(orig.replace(old, new))
    try: code, summ, failing = run_jest()
    finally: subprocess.run(['git', 'checkout', '--', 'mobile/App.tsx'], cwd=ROOT, check=True)
    killed = code != 0; surv += 0 if killed else 1
    print(f"{'KILLED  ' if killed else 'SURVIVED'} {name} :: {summ}", flush=True)
    for l in failing[:4]: print('     ', l, flush=True)
assert APP.read_text() == orig
print(f'survivors/invalid: {surv} of {len(sel)}'); sys.exit(1 if surv else 0)
