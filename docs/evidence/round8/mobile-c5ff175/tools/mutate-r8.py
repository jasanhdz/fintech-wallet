"""Round 8 G-B mutation check: each mutation of mobile/App.tsx must make jest fail. Restores with `git checkout`.
Usage (repo root, App.tsx committed and without local changes):
  python3 -I docs/evidence/round8/mobile-<sha>/tools/mutate-r8.py > docs/evidence/round8/mobile-<sha>/logs/mutations.txt
Optional: ONLY=<substring> runs the matching mutations only. A mutation is a list of (anchor, replacement) pairs; every
anchor must occur exactly once in App.tsx (otherwise the mutation is INVALID and counted as a survivor)."""
import os, pathlib, subprocess, sys

ROOT = pathlib.Path.cwd()
APP = ROOT / 'mobile' / 'App.tsx'
SEND = "{ method: 'POST', headers: { 'Idempotency-Key': %s.key, 'Transfer-Attempt-Id': %s.attemptId ?? '', 'Transfer-Send-Epoch': %s.sendEpoch ?? '0' }, body: JSON.stringify(%s.payload) }"
VOID = "{ method: 'POST', body: JSON.stringify({ idempotencyKey: %s.key }) }"
M = []
def mut(name, *pairs): M.append((name, list(pairs)))

# ---- R8-16 release rules (§R8.7) ----
mut('16a release on a GET 404 (Home)',
    ("      // F-26 (H5): a 404 keeps the record (no release); Home explains it and offers only safe actions.\n      if (found.kind === 'not_found') { setPendingCheck('not_found'); return; }",
     "      if (found.kind === 'not_found') { await releaseRecovery(userId); setPendingCheck('not_found'); return; }"))
mut('16b release on a GET 404 (M09 "Verificar")',
    ("      // F-26 (H5): a 404 keeps the record; M09 explains that a charge cannot be confirmed either way.\n      if (found.kind === 'not_found') { setPendingCheck('not_found'); return; }",
     "      if (found.kind === 'not_found') { await releaseRecovery(userId); setPendingCheck('not_found'); return; }"))
mut('16c release on a GET 404 (start-up)',
    ("          setCreateAttempt(null); setTransferError(''); setTransferScreen(null); setPendingCheck('not_found');",
     "          await releaseRecovery(session.user.id); setCreateAttempt(null); setTransferError(''); setTransferScreen(null); setPendingCheck('not_found');"))
mut('16d release on a 422 without type',
    ("      if (error instanceof ApiError && error.type === PROBLEM_REJECTED) {",
     "      if (error instanceof ApiError && (error.type === PROBLEM_REJECTED || error.status === 422)) {"))
mut('16e release on a 429 "límite diario" without type',
    ("      if (error instanceof ApiError && error.type === PROBLEM_REJECTED) {",
     "      if (error instanceof ApiError && (error.type === PROBLEM_REJECTED || (error.status === 429 && DAILY_LIMIT_PATTERN.test(error.message)))) {"))
mut('16f release on transfer-attempt-conflict',
    ("      if (error instanceof ApiError && error.type === PROBLEM_VOIDED) {",
     "      if (error instanceof ApiError && (error.type === PROBLEM_VOIDED || error.type === PROBLEM_CONFLICT)) {"))
mut('16g release on a 409 "en curso" (any 409)',
    ("      if (error instanceof ApiError && error.type === PROBLEM_VOIDED) {",
     "      if (error instanceof ApiError && (error.type === PROBLEM_VOIDED || error.status === 409)) {"))
mut('16h release without the re-read (delete only)',
    ("      const again = await SecureStore.getItemAsync(recoveryKeyFor(userId));\n      if (again !== null && again !== undefined) throw new Error('record still stored');\n", ""))
mut('16i release ignores a failing delete',
    ("      await SecureStore.deleteItemAsync(recoveryKeyFor(userId));\n      const again",
     "      await SecureStore.deleteItemAsync(recoveryKeyFor(userId)).catch(() => undefined);\n      const again"))
mut('16s Home re-read unblocks after a deletion that reported an error',
    ("        if (!deviceUpdateFailed) setPendingRecord(null);", "        setPendingRecord(null);"))
mut('16j block lifted in memory before the verified deletion (pre-R8 clearRecovery order)',
    ("  async function releaseRecovery(userId: string): Promise<boolean> {\n    try {",
     "  async function releaseRecovery(userId: string): Promise<boolean> {\n    if (sessionUserRef.current === userId) setPendingRecord(null);\n    try {"))
mut('16k void sent automatically at start-up (record without id)',
    ("        if (!attempt.transferId) return;",
     "        if (!attempt.transferId) { await request('/transfer-attempts/void', session.accessToken, " + VOID % 'attempt' + ").catch(() => undefined); return; }"))
mut('16l void sent automatically when Home is shown / foreground',
    ("      setPendingCheck('checking');\n      const found = await lookupAttempt(record, userId, token);",
     "      setPendingCheck('checking');\n      if (!byTap) await request('/transfer-attempts/void', token, " + VOID % 'record' + ").catch(() => undefined);\n      const found = await lookupAttempt(record, userId, token);"))
mut('16m "Anular" sends the void on the first tap (no confirmation screen)',
    ("    setCreateAttempt({ key: pendingRecord.key, payload: pendingRecord.payload });\n    setTransferScreen('void');",
     "    setCreateAttempt({ key: pendingRecord.key, payload: pendingRecord.payload });\n    setTransferScreen('void');\n    void confirmVoid();"))
mut('16n void-all sent without confirmation (as soon as "Resolver con el servidor" lists)',
    ("      setResolveState({ phase: 'ready', before });",
     "      setResolveState({ phase: 'ready', before });\n      await request('/transfer-attempts/void-all', session.accessToken, { method: 'POST', body: JSON.stringify({ fromEpoch: before.sendEpoch }) }).catch(() => undefined);"))
mut('16o void-all released without the list read after it',
    ("    try { after = await request<TransferAttemptPage>('/transfer-attempts?limit=20', session.accessToken); }",
     "    try { after = { items: [], nextCursor: null, sendEpoch: result.sendEpoch }; }"))
mut('16p void-all with a fromEpoch that is not the one listed',
    ("JSON.stringify({ fromEpoch: before.sendEpoch })", "JSON.stringify({ fromEpoch: '0' })"))
mut('16q a failed void (5xx / no answer / conflict) releases',
    ("      if (error instanceof ApiError && error.type === PROBLEM_CONFLICT) setIdentityConflict(true);\n      setTransferError(error instanceof Error ? error.message : 'No se pudo anular la transferencia.');",
     "      await releaseRecovery(userId);\n      setTransferError(error instanceof Error ? error.message : 'No se pudo anular la transferencia.');"))
mut('16r "Resolver con el servidor" releases after the first list (no void-all)',
    ("      setResolveState({ phase: 'ready', before });",
     "      setResolveState({ phase: 'ready', before }); await releaseRecovery(session.user.id);"))

# ---- R8-15 identity and send ----
mut('15a POST without Transfer-Attempt-Id',
    ("  return { 'Idempotency-Key': record.key, 'Transfer-Attempt-Id': record.attemptId, 'Transfer-Send-Epoch': record.sendEpoch };",
     "  return { 'Idempotency-Key': record.key, 'Transfer-Send-Epoch': record.sendEpoch };"))
mut('15b POST without Transfer-Send-Epoch',
    ("  return { 'Idempotency-Key': record.key, 'Transfer-Attempt-Id': record.attemptId, 'Transfer-Send-Epoch': record.sendEpoch };",
     "  return { 'Idempotency-Key': record.key, 'Transfer-Attempt-Id': record.attemptId };"))
mut('15c POST without Idempotency-Key',
    ("  return { 'Idempotency-Key': record.key, 'Transfer-Attempt-Id': record.attemptId, 'Transfer-Send-Epoch': record.sendEpoch };",
     "  return { 'Transfer-Attempt-Id': record.attemptId, 'Transfer-Send-Epoch': record.sendEpoch };"))
mut('15d sends without a sendEpoch in the policy (fail open, epoch "0")',
    ("    const sendEpoch = await currentSendEpoch(session.accessToken);\n    if (!sendEpoch) {",
     "    const sendEpoch = (await currentSendEpoch(session.accessToken)) ?? '0';\n    if (!sendEpoch) {"))
mut('15e the record is persisted AFTER the POST leaves',
    ("    try { await saveRecovery(attempt, userId); }",
     "    try { const later = attempt; void new Promise((resolve) => setTimeout(resolve, 30)).then(() => saveRecovery(later, userId)); }"))
mut('15f identity equal to the key',
    ("      let attemptId = newIdempotencyKey();\n      while (attemptId === key) attemptId = newIdempotencyKey();\n      attempt =",
     "      const attemptId = key;\n      attempt ="))
mut('15g "Verificar" without id POSTs the stored attempt',
    ("      if (!item) return { kind: 'none', record: current };",
     "      if (!item) { await request('/transfers', accessToken, " + SEND % ('current', 'current', 'current', 'current') + ").catch(() => undefined); return { kind: 'none', record: current }; }"))
mut('15h "Verificar" without id reads nothing (no GET /transfer-attempts)',
    ("      const page = await request<TransferAttemptPage>(`/transfer-attempts?attemptId=${encodeURIComponent(current.attemptId)}&limit=1`, accessToken);",
     "      const page: TransferAttemptPage = { items: [], nextCursor: null, sendEpoch: '0' };"))
mut('15i resend re-captures the epoch from the policy instead of the stored one',
    ("    if (!record.sendEpoch) {\n      const sendEpoch = await currentSendEpoch(session.accessToken, true);",
     "    if (record.sendEpoch || !record.sendEpoch) {\n      const sendEpoch = await currentSendEpoch(session.accessToken, true);"))

# ---- R8-17 old / ownerless / damaged / unreadable records ----
mut('17a legacy upgrade changes the key',
    ("    upgraded = { v: 2, attemptId, ...upgraded, legacy: true };",
     "    upgraded = { v: 2, attemptId, ...upgraded, key: `${upgraded.key}-v2`, legacy: true };"))
mut('17b legacy upgrade not persisted (identity changes on every read)',
    ("  if (upgraded === record && stored) return record;\n  try { await SecureStore.setItemAsync(recoveryKeyFor(userId), JSON.stringify(upgraded)); }\n  catch { throw new RecoveryReadError('unreadable'); }\n  return upgraded;",
     "  return upgraded;"))
mut('17c legacy record voided with its never-sent identity',
    ("...(record.attemptId && !record.legacy ? { attemptId: record.attemptId } : {})",
     "...(record.attemptId ? { attemptId: record.attemptId } : {})"))
mut('17d legacy resend without persisting the epoch first',
    ("        try { await saveRecovery(record, userId); persisted = true; } catch { persisted = false; }",
     "        persisted = true;"))
mut('17e ownerless record not marked (no explanation)',
    ("  if (!upgraded.userId) upgraded = { ...upgraded, userId, ownerAssumed: true };",
     "  if (!upgraded.userId) upgraded = { ...upgraded, userId };"))
mut('17f another user\'s id under this user\'s key is used as is',
    ("    if (record.userId && record.userId !== userId) throw new RecoveryReadError('damaged');\n    return upgradeRecovery(record, userId, true);",
     "    return upgradeRecovery({ ...record, userId }, userId, true);"))
mut('17g "Reintentar lectura" deletes the damaged record',
    ("onRetryRead={() => { setRecoveryReady(false); }}",
     "onRetryRead={() => { void SecureStore.deleteItemAsync(recoveryKeyFor(session.user.id)).catch(() => undefined); setRecoveryReady(false); }}"))
mut('17h unreadable SecureStore treated as "no record"',
    ("  try { return await SecureStore.getItemAsync(key); } catch { throw new RecoveryReadError('unreadable'); }",
     "  try { return await SecureStore.getItemAsync(key); } catch { return null; }"))
mut('17i a damaged record releases its block when the problem is cleared without void-all',
    ("    const released = await releaseRecovery(userId);\n    if (released) { setRecoveryProblem(null); setIdentityConflict(false); }",
     "    const released = await releaseRecovery(userId) || true;\n    if (released) { setRecoveryProblem(null); setIdentityConflict(false); setPendingRecord(null); }"))
mut('17j "Verificar de nuevo" back after a GET 404 on M09',
    ("{notFound || props.identityConflict ? null : <Button title=\"Verificar estado de la transferencia\"",
     "{props.identityConflict ? null : <Button title={notFound ? 'Verificar de nuevo' : 'Verificar estado de la transferencia'}"))
mut('17k "Verificar de nuevo" back after a GET 404 on Home',
    ("{notFound || identityConflict ? null : <Button title={awaitingCode ?",
     "{identityConflict ? null : <Button title={notFound ? 'Verificar de nuevo' : awaitingCode ?"))
mut('17l no "Anular esta transferencia" after a GET 404',
    ("  const canVoid = unknownServerState;", "  const canVoid = unknownServerState && pendingCheck !== 'not_found';"))

# ---- R8-18 F-29 ----
mut('3g (F-29) resendSameTransfer does not compare the stored record at the tap',
    ("    if (!record || record.key !== pendingRecord?.key) { transferInFlight.current = false; holdForPendingAttempt(record); if (!record) setPendingRecord(null); return; }\n    setTransferBusy(true); setTransferError('');\n    // §R8.8",
     "    if (false) { transferInFlight.current = false; holdForPendingAttempt(record); if (!record) setPendingRecord(null); return; }\n    setTransferBusy(true); setTransferError('');\n    // §R8.8"))

# ---- R8-19 one tap = one POST ----
mut('19a the second send() of the same tap is back (422/429 re-sent once)',
    ("      const result = await request<Transfer & { demoOnlyCode?: string }>('/transfers', accessToken, { method: 'POST', headers, body: JSON.stringify(record.payload) });",
     "      const send = () => request<Transfer & { demoOnlyCode?: string }>('/transfers', accessToken, { method: 'POST', headers, body: JSON.stringify(record.payload) });\n      let result: Transfer & { demoOnlyCode?: string };\n      try { result = await send(); } catch (error) { if (!(error instanceof ApiError && (error.status === 422 || error.status === 429))) throw error; result = await send(); }"))

# ---- R8-20 F-30 ----
mut('20a "No intentes enviar el dinero nuevamente" back on M09',
    ("<Text style={styles.warningTitle}>No hagas otra transferencia igual</Text>",
     "<Text style={styles.warningTitle}>No intentes enviar el dinero nuevamente</Text>"))
mut('20b "Podrás hacer otra transferencia cuando conozcamos su resultado" back on Home',
    ("Podrás hacer otra transferencia cuando esta quede resuelta.';",
     "Podrás hacer otra transferencia cuando conozcamos su resultado.';"))
mut('20c consent box flush against the main button (0 px)',
    ("resendConsent: { marginBottom: 16 }", "resendConsent: { marginBottom: 0 }"))
mut('20d mandatory void confirmation text missing',
    ("<Text style={styles.rejectedReason}>{VOID_CONFIRM_TEXT}</Text>", "<Text style={styles.rejectedReason}>¿Anular?</Text>"))
mut('20e mandatory "Resolver con el servidor" text missing',
    ("{state.phase === 'done' ? null : <Text style={styles.rejectedReason}>{RESOLVE_TEXT}</Text>}", "{null}"))
mut('20f "voided" answer shown without the mandatory text',
    ("      const text = outcome.resolution === 'voided' ? VOIDED_TEXT", "      const text = outcome.resolution === 'voided' ? 'Listo.'"))

def run_jest():
    proc = subprocess.run(['npx', 'jest', '--maxWorkers=3', 'tests/app.test.tsx', 'tests/recovery-h4.test.tsx', 'tests/recovery-h5.test.tsx', 'tests/recovery-r8.test.tsx'], cwd=ROOT / 'mobile', capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    summary = [line for line in out.splitlines() if line.startswith('Tests:')]
    failing = [line.strip() for line in out.splitlines() if line.strip().startswith('●') and '›' in line]
    return proc.returncode, (summary[-1] if summary else 'no summary'), failing

only = os.environ.get('ONLY')
original = APP.read_text()
# Baseline: the unmutated code must pass with the same command, otherwise a "kill" would mean nothing.
code, summary, failing = run_jest()
print(f'BASELINE {"PASS" if code == 0 else "FAIL"} :: {summary}', flush=True)
if code != 0:
    for line in failing[:10]: print(f'    {line}', flush=True)
    sys.exit(2)
survivors = 0
selected = [m for m in M if not only or only in m[0]]
for name, pairs in selected:
    mutated = original
    bad = [old for old, _ in pairs if original.count(old) != 1]
    if bad:
        print(f'INVALID {name}: anchor count {[original.count(old) for old in bad]}', flush=True); survivors += 1; continue
    for old, new in pairs: mutated = mutated.replace(old, new)
    APP.write_text(mutated)
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
