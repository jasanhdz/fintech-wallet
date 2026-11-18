"""Round 7 H5 mutation check: each mutation of mobile/App.tsx must make jest fail. Restores with `git checkout`.
Usage (repo root, App.tsx without local changes): python3 -I docs/evidence/round7/h5-<sha>/tools/mutate-h5.py > .../logs/mutations.txt
Optional: ONLY=<substring> runs the matching mutations only."""
import os, pathlib, subprocess, sys

ROOT = pathlib.Path.cwd()
APP = ROOT / 'mobile' / 'App.tsx'
POST_SAME = "{ method: 'POST', headers: { 'Idempotency-Key': %s.key }, body: JSON.stringify(%s.payload) }"
MUTATIONS = [
    # F-28 (kept from H4, written as the defects the evaluator described)
    ('F-28.1 guard fails OPEN when SecureStore cannot be read: catch { existing = null }',
     "      try { existing = await readOwnRecovery(userId); }\n      catch (error) {",
     "      try { existing = await readOwnRecovery(userId); }\n      catch { existing = null; }\n      if (existing === undefined) try { /* never */ } catch (error) {"),
    ('F-28.2 requestNewCode always passes replacesClosedAttempt=true',
     'await submitCreate(payload, Boolean(previous));', 'await submitCreate(payload, true);'),
    # 1 (F-21) unconfirmed 4xx
    ('1a unconfirmed 4xx (409/401/403/400/429) goes to M11',
     "setTransferScreen(confirmed ? 'rejected' : 'status');",
     "setTransferScreen(confirmed || (error instanceof ApiError && error.status < 500) ? 'rejected' : 'status');"),
    ('1b unconfirmed 4xx deletes the record',
     'if (confirmed) await clearRecovery(userId).catch(() => undefined);',
     'if (confirmed || error instanceof ApiError) await clearRecovery(userId).catch(() => undefined);'),
    ('1c an M09 exit ("Ir al inicio") deletes the record',
     '  function leaveUncertainTransfer() {\n',
     '  function leaveUncertainTransfer() {\n    void clearRecovery(session?.user.id).catch(() => undefined);\n'),
    # 2 verifying never creates
    ('2a M09 "Verificar" POSTs the create when there is no id',
     "    if (!transferId) {\n      setPendingCheck('no_id');",
     "    if (!transferId) {\n      if (pendingRecord) await request('/transfers', session.accessToken, " + POST_SAME % ('pendingRecord', 'pendingRecord') + ").catch(() => undefined);\n      setPendingCheck('no_id');"),
    ('2b Home "Verificar" (tap) POSTs the create when there is no id',
     "        if (byTap) { setPendingCheck('no_id');",
     "        if (byTap) { await request('/transfers', token, " + POST_SAME % ('record', 'record') + ").catch(() => undefined); setPendingCheck('no_id');"),
    ('2c start-up/sign-in replays the create to recover the demo code of an attempt waiting for it',
     "        if (result.status === 'awaiting_confirmation') { setDemoOnlyCode(''); setCodeNotStored(true); }",
     "        if (result.status === 'awaiting_confirmation') { const replay = await request<Transfer & { demoOnlyCode?: string }>('/transfers', session.accessToken, " + POST_SAME % ('attempt', 'attempt') + "); setDemoOnlyCode(replay.demoOnlyCode ?? ''); }"),
    ('6a M09 "Verificar" resolves an attempt without id from a matching charge in Movimientos (amount/concept/reference)',
     "    if (!transferId) {\n      setPendingCheck('no_id');",
     "    if (!transferId) {\n      if (pendingRecord) { const page = await request<{ items: Movement[] }>(`/accounts/${encodeURIComponent(pendingRecord.payload.sourceAccountId)}/movements?limit=20`, session.accessToken).catch(() => ({ items: [] as Movement[] })); const hit = page.items.find((item) => item.transferId && item.amountMinor === pendingRecord.payload.amountMinor && item.concept === pendingRecord.payload.concept && item.reference === pendingRecord.payload.reference); if (hit) { const found = await request<Transfer>(`/transfers/${hit.transferId}`, session.accessToken); setTransfer(found); await clearRecovery(session.user.id); setTransferScreen(screenForStatus(found.status)); return; } }\n      setPendingCheck('no_id');"),
    ('6b Home resolves an attempt without id from a matching charge in Movimientos',
     '      if (!record.transferId) {\n',
     '      if (!record.transferId) {\n        { const rec = record; const page = await request<{ items: Movement[] }>(`/accounts/${encodeURIComponent(rec.payload.sourceAccountId)}/movements?limit=20`, token).catch(() => ({ items: [] as Movement[] })); const hit = page.items.find((item) => item.transferId && item.amountMinor === rec.payload.amountMinor && item.concept === rec.payload.concept && item.reference === rec.payload.reference); if (hit) { const found = await request<Transfer>(`/transfers/${hit.transferId}`, token); setTransfer(found); await clearRecovery(userId); setTransferScreen(screenForStatus(found.status)); return; } }\n'),
    # 3 explicit, same-key resend
    ('3a resend uses a NEW Idempotency-Key',
     '    try { await sendAttempt(record, userId, session.accessToken, true); }',
     '    try { await sendAttempt({ ...record, key: newIdempotencyKey() }, userId, session.accessToken, true); }'),
    ('3b resend sends a rebuilt (re-captured) payload',
     '    try { await sendAttempt(record, userId, session.accessToken, true); }',
     '    try { await sendAttempt({ ...record, payload: { amountMinor: record.payload.amountMinor, ...record.payload } }, userId, session.accessToken, true); }'),
    ('3c "Reenviar" sends on the first tap (no review / confirmation)',
     "onResend={() => openResend('home')}", "onResend={() => { openResend('home'); void resendSameTransfer(); }}"),
    ('3d consent not stored with the attempt',
     "consent: { confirmedAt: new Date().toISOString(), via: replacesClosedAttempt ? 'new_code' : 'confirm', otp: 'unknown' }, display }",
     'display }'),
    ('3e code authorization not recorded in the consent',
     "pendingRecord.consent && pendingRecord.consent.otp !== 'authorized'", "pendingRecord.consent && false"),
    ('3f a resend\'s 422/429 is taken as final without re-confirming with the same key',
     '        if (!(resend && error instanceof ApiError && isBusinessRejection(error))) throw error;',
     '        throw error;'),
    # 4 (F-26) no release without a confirmed final result, no discard
    ('4a start-up GET 404 releases the record',
     "          setCreateAttempt(null); setTransferError(''); setTransferScreen(null); setPendingCheck('not_found');",
     "          await clearRecovery(session.user.id); setPendingRecord(null); setCreateAttempt(null); setTransferError(''); setTransferScreen(null);"),
    ('4b Home GET 404 releases the record',
     "      setPendingCheck(record?.transferId && error instanceof ApiError && error.status === 404 ? 'not_found' : 'failed');",
     "      if (record?.transferId && error instanceof ApiError && error.status === 404) { await clearRecovery(userId); return; }\n      setPendingCheck('failed');"),
    ('4c M09 GET 404 releases the record',
     "      if (error instanceof ApiError && error.status === 404) { setPendingCheck('not_found'); return; }",
     "      if (error instanceof ApiError && error.status === 404) { await clearRecovery(session.user.id); setTransferScreen(null); return; }"),
    ('4d a 404 of the create releases the record (old createProvesNotApplied)',
     'const confirmed = error instanceof ApiError && isBusinessRejection(error);',
     'const confirmed = error instanceof ApiError && (isBusinessRejection(error) || error.status === 404);'),
    ('4e "Descartar este intento" button is back on the notice',
     '    {awaitingCode ? null : movements}\n',
     '    {awaitingCode ? null : movements}\n    <Button title="Descartar este intento" variant="secondary" onPress={onMovements}/>\n'),
    ('4f "Reintentar lectura" deletes the damaged record',
     'onRetryRead={() => { setRecoveryReady(false); }}',
     'onRetryRead={() => { void SecureStore.deleteItemAsync(recoveryKeyFor(session.user.id)).catch(() => undefined); setRecoveryReady(false); }}'),
    ('4g unreadable SecureStore treated as "no record" (Home fails open)',
     "  try { return await SecureStore.getItemAsync(key); } catch { throw new RecoveryReadError('unreadable'); }",
     '  try { return await SecureStore.getItemAsync(key); } catch { return null; }'),
    ('4h business rejection at confirm releases without a confirmed cancel',
     "if (closed && (closed.status === 'cancelled' || closed.status === 'expired')) await clearRecovery(session.user.id)",
     'if (closed || true) await clearRecovery(session.user.id)'),
    # 5 (F-27) nothing automatic
    ('5a Home shown / foreground replays the create of an attempt without id',
     '      if (!record.transferId) {\n',
     "      if (!record.transferId) {\n        if (!byTap) await request('/transfers', token, " + POST_SAME % ('record', 'record') + ").catch(() => undefined);\n"),
    ('5b start-up / sign-in replays the create of an attempt without id',
     '        if (!attempt.transferId) return;',
     "        if (!attempt.transferId) { await request('/transfers', session.accessToken, " + POST_SAME % ('attempt', 'attempt') + ").catch(() => undefined); return; }"),
]

def run_jest():
    proc = subprocess.run(['npx', 'jest', '--maxWorkers=3', 'tests/app.test.tsx', 'tests/recovery-h4.test.tsx', 'tests/recovery-h5.test.tsx'], cwd=ROOT / 'mobile', capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    summary = [line for line in out.splitlines() if line.startswith('Tests:')]
    failing = [line.strip() for line in out.splitlines() if line.strip().startswith('●') and '›' in line]
    return proc.returncode, (summary[-1] if summary else 'no summary'), failing

only = os.environ.get('ONLY')
original = APP.read_text()
survivors = 0
selected = [m for m in MUTATIONS if not only or only in m[0]]
for name, old, new in selected:
    if original.count(old) != 1:
        print(f'INVALID {name}: anchor found {original.count(old)} times', flush=True); survivors += 1; continue
    APP.write_text(original.replace(old, new))
    try:
        code, summary, failing = run_jest()
    finally:
        subprocess.run(['git', 'checkout', '--', 'mobile/App.tsx'], cwd=ROOT, check=True)
    killed = code != 0
    survivors += 0 if killed else 1
    print(f"{'KILLED ' if killed else 'SURVIVED'} {name} :: {summary}", flush=True)
    for line in failing[:6]: print(f'    {line}', flush=True)
assert APP.read_text() == original
print(f'survivors: {survivors} of {len(selected)}')
sys.exit(1 if survivors else 0)
