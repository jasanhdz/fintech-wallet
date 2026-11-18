#!/usr/bin/env python3
# Evaluator R8 mutations on mobile/App.tsx (restored with `git checkout -- mobile/App.tsx` after each). Own set, not the Generator's.
import subprocess, sys, re, time
ROOT='/Users/jasanhernandez/Develop/fintech-wallet-g1'
APP=ROOT+'/mobile/App.tsx'
orig=open(APP).read()
def nth(s, sub, n):
    i=-1
    for _ in range(n):
        i=s.find(sub,i+1)
        if i<0: return -1
    return i
def rep(s, old, new, n=1):
    i=nth(s,old,n)
    assert i>=0, 'pattern missing: '+old[:70]
    return s[:i]+new+s[i+len(old):]
NF="if (found.kind === 'not_found') { setPendingCheck('not_found'); return; }"
CL="if (found.kind === 'closure') { setClosureSeen(found.summary); setPendingCheck('closure'); return; }"
GUARD="if (!record || record.key !== pendingRecord?.key)"
M=[]
def m(id, desc, fn): M.append((id,desc,fn))
m('r1','release on GET 404 (M09 verify)', lambda s: rep(s,NF,NF.replace("{ setPendingCheck","{ await releaseRecovery(userId); setPendingCheck"),1))
m('r2','release on GET 404 (Home verify)', lambda s: rep(s,NF,NF.replace("{ setPendingCheck","{ await releaseRecovery(userId); setPendingCheck"),2))
m('r3','release on GET 404 at start-up', lambda s: rep(s,"setCreateAttempt(null); setTransferError(''); setTransferScreen(null); setPendingCheck('not_found');","await releaseRecovery(session.user.id); setCreateAttempt(null); setTransferError(''); setTransferScreen(null); setPendingCheck('not_found');"))
m('r4','release on 404 caught in checkTransferStatus', lambda s: rep(s,"if (error instanceof ApiError && error.status === 404 && transferId) { setPendingCheck('not_found'); return; }","if (error instanceof ApiError && error.status === 404 && transferId) { await releaseRecovery(userId); setPendingCheck('not_found'); return; }"))
m('r5','untyped 422/429 treated as rejection', lambda s: rep(s,"error instanceof ApiError && error.type === PROBLEM_REJECTED","error instanceof ApiError && (error.type === PROBLEM_REJECTED || error.status === 422 || error.status === 429)"))
m('r6','transfer-attempt-conflict releases (send)', lambda s: rep(s,"if (error instanceof ApiError && error.type === PROBLEM_CONFLICT) setIdentityConflict(true);","if (error instanceof ApiError && error.type === PROBLEM_CONFLICT) { await releaseRecovery(userId); setIdentityConflict(true); }",1))
m('r7','transfer-attempt-conflict releases (void)', lambda s: rep(s,"if (error instanceof ApiError && error.type === PROBLEM_CONFLICT) setIdentityConflict(true);","if (error instanceof ApiError && error.type === PROBLEM_CONFLICT) { await releaseRecovery(userId); setIdentityConflict(true); }",2))
m('r8','release without re-read null', lambda s: rep(s,"if (again !== null && again !== undefined) throw new Error('record still stored');",""))
m('r9','delete error ignored', lambda s: rep(s,"await SecureStore.deleteItemAsync(recoveryKeyFor(userId));\n      const again","await SecureStore.deleteItemAsync(recoveryKeyFor(userId)).catch(() => undefined);\n      const again"))
m('r10','void error (any) releases', lambda s: rep(s,"    } catch (error) {\n      if (error instanceof ApiError && error.type === PROBLEM_CONFLICT) { setIdentityConflict(true);" if False else "      setTransferError(error instanceof Error ? error.message : 'No se pudo anular la transferencia.');","      await releaseRecovery(userId);\n      setTransferError(error instanceof Error ? error.message : 'No se pudo anular la transferencia.');"))
m('r11','list closure (voided/rejected) read releases (Home)', lambda s: rep(s,CL,CL.replace("{ setClosureSeen","{ await releaseRecovery(userId); setClosureSeen"),2))
m('r12','list closure read releases (M09)', lambda s: rep(s,CL,CL.replace("{ setClosureSeen","{ await releaseRecovery(userId); setClosureSeen"),1))
m('a1','automatic void at start-up', lambda s: rep(s,"        setPendingRecord(attempt);\n","        setPendingRecord(attempt);\n        void request('/transfer-attempts/void', session.accessToken, { method: 'POST', body: JSON.stringify({ idempotencyKey: attempt.key }) }).catch(() => undefined);\n"))
m('a2','automatic void on Home verify', lambda s: rep(s,"      setPendingRecord(record);\n      setPendingCheck('checking');","      setPendingRecord(record);\n      void request('/transfer-attempts/void', token, { method: 'POST', body: JSON.stringify({ idempotencyKey: record.key }) }).catch(() => undefined);\n      setPendingCheck('checking');"))
m('a3','void-all without confirmation (on open)', lambda s: rep(s,"setResolveState({ phase: 'ready', before });","setResolveState({ phase: 'ready', before }); void request('/transfer-attempts/void-all', session.accessToken, { method: 'POST', body: JSON.stringify({ fromEpoch: before.sendEpoch }) }).catch(() => undefined);"))
m('a4','POST /transfers automatic on Home verify (replay)', lambda s: rep(s,"      const found = await lookupAttempt(record, userId, token);\n      if (sessionUserRef.current !== userId) return;\n      if (found.kind === 'none') {","      if (!record.transferId && attemptHeaders(record)) await request('/transfers', token, { method: 'POST', headers: attemptHeaders(record)!, body: JSON.stringify(record.payload) }).catch(() => undefined);\n      const found = await lookupAttempt(record, userId, token);\n      if (sessionUserRef.current !== userId) return;\n      if (found.kind === 'none') {"))
m('h1','headers: attempt id and epoch omitted', lambda s: rep(s,"return { 'Idempotency-Key': record.key, 'Transfer-Attempt-Id': record.attemptId, 'Transfer-Send-Epoch': record.sendEpoch };","return { 'Idempotency-Key': record.key };"))
m('h2','headers: epoch omitted only', lambda s: rep(s,"'Transfer-Attempt-Id': record.attemptId, 'Transfer-Send-Epoch': record.sendEpoch };","'Transfer-Attempt-Id': record.attemptId };"))
m('h3','send without valid epoch (header guard removed)', lambda s: rep(s,"|| !record.sendEpoch || !EPOCH_PATTERN.test(record.sendEpoch)) return null;",") return null;"))
m('h4','record not persisted before POST', lambda s: rep(s,"try { await saveRecovery(attempt, userId); }","try { /* mutated: no persist */ }"))
m('h5','new attempt reuses key as attemptId', lambda s: rep(s,"let attemptId = newIdempotencyKey();\n      while (attemptId === key) attemptId = newIdempotencyKey();","let attemptId = key;"))
m('s1','second send() reintroduced after untyped 422/429', lambda s: rep(s,"      if (error instanceof ApiError && error.type === PROBLEM_VOIDED) {","      if (error instanceof ApiError && (error.status === 422 || error.status === 429) && !error.type && !(record as unknown as {retried?: boolean}).retried) { await sendAttempt({ ...record, retried: true } as RecoveryRecord, userId, accessToken); return; }\n      if (error instanceof ApiError && error.type === PROBLEM_VOIDED) {"))
m('s2','second send() reintroduced after typed rejection', lambda s: rep(s,"      if (error instanceof ApiError && error.type === PROBLEM_REJECTED) {","      if (error instanceof ApiError && error.type === PROBLEM_REJECTED && !(record as unknown as {retried?: boolean}).retried) { await sendAttempt({ ...record, retried: true } as RecoveryRecord, userId, accessToken); return; }\n      if (error instanceof ApiError && error.type === PROBLEM_REJECTED) {"))
m('f1','F-29 3g: resend guard removed', lambda s: rep(s,GUARD,"if (false)",1))
m('f2','void guard removed (stale record voided)', lambda s: rep(s,GUARD,"if (false)",2))
m('g1','legacy void includes attemptId', lambda s: rep(s,"record.attemptId && !record.legacy","record.attemptId"))
m('g2','legacy upgrade regenerates the key', lambda s: rep(s,"upgraded = { v: 2, attemptId, ...upgraded, legacy: true };","upgraded = { v: 2, attemptId, ...upgraded, key: newIdempotencyKey(), legacy: true };"))
m('g3','other-user record in legacy slot is taken', lambda s: rep(s,"if (record.userId && record.userId !== userId) return null;\n  const migrated","const migrated"))
m('g4','other user id in own key is not damaged', lambda s: rep(s,"if (record.userId && record.userId !== userId) throw new RecoveryReadError('damaged');\n    return upgradeRecovery","return upgradeRecovery"))
m('g5','void-all fromEpoch constant 0', lambda s: rep(s,"JSON.stringify({ fromEpoch: before.sendEpoch })","JSON.stringify({ fromEpoch: '0' })"))
m('g6','damaged record released when list re-read fails', lambda s: rep(s,"      setResolveState({ phase: 'rereading', before, result, error:","      await releaseRecovery(userId);\n      setResolveState({ phase: 'rereading', before, result, error:"))
m('g7','ownerless record not flagged / unreadable store treated as no record (guard)', lambda s: rep(s,"catch { throw new RecoveryReadError('unreadable'); }\n}\nasync function upgradeRecovery","catch { return null; }\n}\nasync function upgradeRecovery"))
m('g8','sendEpoch fallback to 0 when policy lacks it', lambda s: rep(s,"return typeof policy.sendEpoch === 'string' && EPOCH_PATTERN.test(policy.sendEpoch) ? policy.sendEpoch : null;","return typeof policy.sendEpoch === 'string' && EPOCH_PATTERN.test(policy.sendEpoch) ? policy.sendEpoch : '0';"))
m('g9','voided text claims no-charge for transfer_found', lambda s: rep(s,"const VOIDED_TEXT = 'Transferencia anulada. No se realizó ningún cargo por esta operación.';","const VOIDED_TEXT = 'Transferencia anulada. No se realizó ningún cargo por esta operación.'; /* mut */") )
only=sys.argv[1:]
TESTS=['tests/recovery-r8.test.tsx','tests/recovery-h4.test.tsx','tests/recovery-h5.test.tsx','tests/app.test.tsx']
out=open(ROOT+'/docs/evidence/round8/eval-8da2700/logs/mutations8b.txt','a')
def log(x): print(x,flush=True); out.write(x+'\n'); out.flush()
log('# own mutations on mobile/App.tsx, jest '+' '.join(TESTS))
for id,desc,fn in M:
    if only and id not in only: continue
    try:
        mut=fn(orig)
    except AssertionError as e:
        log(f'{id}\tSKIP(pattern)\t{desc}\t{e}'); continue
    if mut==orig: log(f'{id}\tSKIP(no change)\t{desc}'); continue
    open(APP,'w').write(mut)
    t=time.time()
    r=subprocess.run(['bash','-lc','source ~/.nvm/nvm.sh >/dev/null; nvm use 26.13.1 >/dev/null; cd '+ROOT+'/mobile && npx jest '+' '.join(TESTS)+' 2>&1 | grep -E "^Tests:|●.*›" | sort -u | head -6'],capture_output=True,text=True)
    subprocess.run(['git','checkout','--','mobile/App.tsx'],cwd=ROOT)
    txt=r.stdout.strip().replace('\n',' | ')
    m_=re.search(r'Tests:\s+(?:(\d+) failed, )?',txt)
    killed = bool(re.search(r'Tests:\s+\d+ failed',txt))
    log(f'{id}\t{"KILLED" if killed else "SURVIVED"}\t{desc}\t{txt[:300]}\t({int(time.time()-t)}s)')
assert open(APP).read()==orig
