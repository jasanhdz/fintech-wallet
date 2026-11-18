"""Round 7 H4 mutation check: each mutation of mobile/App.tsx must make jest fail. Restores with `git checkout`.
Usage (repo root): python3 -I docs/evidence/round7/h4-<sha>/tools/mutate-h4.py > .../logs/mutations.txt"""
import pathlib, subprocess, sys

ROOT = pathlib.Path.cwd()
APP = ROOT / 'mobile' / 'App.tsx'
MUTATIONS = [
    ('F-28.1 guard fails OPEN when SecureStore cannot be read',
     'try { existing = await readOwnRecovery(userId); }', 'try { existing = await readOwnRecovery(userId).catch(() => null); }'),
    ('F-28.2 requestNewCode always passes replacesClosedAttempt=true',
     'await submitCreate(false, payload, Boolean(previous));', 'await submitCreate(false, payload, true);'),
    ('F-26a GET releases on ANY error (500/network/401/409)',
     'function readProvesAttemptAbsent(error: unknown): boolean { return error instanceof ApiError && error.status === 404; }',
     'function readProvesAttemptAbsent(error: unknown): boolean { return error instanceof Error; }'),
    ('F-26a GET 404 never releases',
     'function readProvesAttemptAbsent(error: unknown): boolean { return error instanceof ApiError && error.status === 404; }',
     'function readProvesAttemptAbsent(error: unknown): boolean { return Boolean(error) && false; }'),
    ('F-26a replay 409/400 treated as definitive',
     '(error.status === 404 || isBusinessRejection(error))', '(error.status === 404 || error.status === 409 || error.status === 400 || isBusinessRejection(error))'),
    ('F-26c discard also deletes the legacy slot (may be another user\'s)',
     'try { await SecureStore.deleteItemAsync(recoveryKeyFor(userId)); }',
     'try { await SecureStore.deleteItemAsync(recoveryKeyFor(userId)); await SecureStore.deleteItemAsync(LEGACY_RECOVERY_KEY); }'),
    ('F-26c discard without confirmation dialog',
     "onDiscard={() => { setDiscardError(''); setDiscardOpen(true); }}", "onDiscard={() => { setDiscardError(''); void discardPendingAttempt(); }}"),
    ('F-26d discard reports success although the store failed',
     '      setDiscardError(DISCARD_FAILED_MESSAGE);', '      setPendingRecord(null); setRecoveryProblem(null); setHomeNote(DISCARDED_NOTE);'),
    ('F-26c discard offered even when the server confirmed "awaiting code"',
     "const canDiscard = pendingCheck !== 'checking' && (", "const canDiscard = true || pendingCheck !== 'checking' && ("),
    ('F-26b damaged record shown as raw error on M09',
     '        if (error instanceof RecoveryReadError) {\n          // F-26 (b)/(d)', '        if (error instanceof RecoveryReadError && false) {\n          // F-26 (b)/(d)'),
    ('F-21 unverified 4xx on retry goes to M11',
     "setTransferScreen(confirmed || (unverified4xx && !retry) ? 'rejected' : 'status');", "setTransferScreen(confirmed || unverified4xx ? 'rejected' : 'status');"),
    ('F-21 M11 exits always release the record',
     "if (!(transferScreen === 'rejected' && rejectionUnverified)) void clearRecovery", 'void clearRecovery'),
    ('F-27 Home replays the create of an attempt without id',
     'if (!record.transferId) { setPendingRecord(record); return; }',
     "if (!record.transferId) { setPendingRecord(record); await request('/transfers', token, { method: 'POST', headers: { 'Idempotency-Key': record.key }, body: JSON.stringify(record.payload) }).catch(() => undefined); return; }"),
    ('F-27 start-up/sign-in replays without a tap',
     'if (!attempt.transferId && !byTap) return;', 'if (!attempt.transferId && !byTap && false) return;'),
]

def run_jest():
    proc = subprocess.run(['npx', 'jest', '--runInBand', 'tests/app.test.tsx', 'tests/recovery-h4.test.tsx'], cwd=ROOT / 'mobile', capture_output=True, text=True)
    out = proc.stdout + proc.stderr
    summary = [line for line in out.splitlines() if line.startswith('Tests:')]
    failing = [line.strip() for line in out.splitlines() if line.strip().startswith('●') and '›' in line]
    return proc.returncode, (summary[-1] if summary else 'no summary'), failing

original = APP.read_text()
survivors = 0
for name, old, new in MUTATIONS:
    if original.count(old) != 1:
        print(f'INVALID {name}: anchor found {original.count(old)} times'); survivors += 1; continue
    APP.write_text(original.replace(old, new))
    try:
        code, summary, failing = run_jest()
    finally:
        subprocess.run(['git', 'checkout', '--', 'mobile/App.tsx'], cwd=ROOT, check=True)
    killed = code != 0
    survivors += 0 if killed else 1
    print(f"{'KILLED ' if killed else 'SURVIVED'} {name} :: {summary}")
    for line in failing[:6]: print(f'    {line}')
assert APP.read_text() == original
print(f'survivors: {survivors} of {len(MUTATIONS)}')
sys.exit(1 if survivors else 0)
