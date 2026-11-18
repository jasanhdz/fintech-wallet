#!/usr/bin/env python3 -I
# Evaluator mutations: apply a textual change to one source file, run jest, record failures, ALWAYS restore with git checkout.
import subprocess, sys, re
ROOT = '/Users/jasanhernandez/Develop/fintech-wallet-g1'
MUT = [
 ('F21 guard of the new key removed (submitCreate does not read the record)', 'mobile/App.tsx', "if (existing) { transferInFlight.current = false; holdForPendingAttempt(existing); return; }", ""),
 ('F21 guard fails OPEN when SecureStore cannot be read', 'mobile/App.tsx', "catch { transferInFlight.current = false; setTransferError(PENDING_UNVERIFIABLE_MESSAGE); return; }", "catch { existing = null; }"),
 ('F21 Home keeps destination card + Continuar while a record exists', 'mobile/App.tsx', "{pendingRecord ? null : destination ? <View style={styles.destinationCard}>", "{destination ? <View style={styles.destinationCard}>"),
 ('F21 Home keeps Continuar action while a record exists', 'mobile/App.tsx', "{!pendingRecord && destination && !choosingBeneficiary && (destinationIsSource", "{destination && !choosingBeneficiary && (destinationIsSource"),
 ('F21 Home does not auto-resolve the pending attempt', 'mobile/App.tsx', "    void resolvePendingFromHome();\n    // Runs when Home", "    // Runs when Home"),
 ('F21 foreground does not re-check (auth/me .then tick removed)', 'mobile/App.tsx', "request<User>('/auth/me', token).then(() => setHomeCheckTick((tick) => tick + 1)).catch(", "request<User>('/auth/me', token).catch("),
 ('F21 record not saved before the POST', 'mobile/App.tsx', "      try { await saveRecovery(attempt, userId); }\n      catch {", "      try { /* mutated: nothing saved */ }\n      catch {"),
 ('F21 leaving M08 with an unconfirmed cancel drops the record', 'mobile/App.tsx', "if (!closed || !isTerminalStatus(closed.status)) { leaveUncertainTransfer(); return; }", "if (!closed || !isTerminalStatus(closed.status)) { await clearRecovery(session.user.id); leaveUncertainTransfer(); return; }"),
 ('F21 new code bypasses the guard even with no previous attempt', 'mobile/App.tsx', "await submitCreate(false, payload, Boolean(previous));", "await submitCreate(false, payload, true);"),
 ('F22 logout deletes the own record', 'mobile/App.tsx', "      sessionUserRef.current = null;\n      try { await SecureStore.deleteItemAsync(REFRESH_KEY); }", "      { const uid = sessionUserRef.current; if (uid) { try { await SecureStore.deleteItemAsync(recoveryKeyFor(uid)); } catch { /* mutated */ } } }\n      sessionUserRef.current = null;\n      try { await SecureStore.deleteItemAsync(REFRESH_KEY); }"),
 ('F22 logout deletes the legacy single slot', 'mobile/App.tsx', "      sessionUserRef.current = null;\n      try { await SecureStore.deleteItemAsync(REFRESH_KEY); }", "      try { await SecureStore.deleteItemAsync(LEGACY_RECOVERY_KEY); } catch { /* mutated */ }\n      sessionUserRef.current = null;\n      try { await SecureStore.deleteItemAsync(REFRESH_KEY); }"),
 ('F22 one shared slot for every user', 'mobile/App.tsx', "function recoveryKeyFor(userId: string): string { return `${LEGACY_RECOVERY_KEY}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`; }", "function recoveryKeyFor(userId: string): string { void userId; return LEGACY_RECOVERY_KEY; }"),
 ('F22 legacy record of another user is taken over', 'mobile/App.tsx', "if (record.userId && record.userId !== userId) return null;", ""),
 ('F22 own-key record read without comparing the owner id (userId ignored on key)', 'mobile/App.tsx', "  if (own) return JSON.parse(own) as RecoveryRecord;\n  const legacy", "  if (own) return JSON.parse(own) as RecoveryRecord;\n  if (!own) { const any = await SecureStore.getItemAsync(LEGACY_RECOVERY_KEY); if (any) return JSON.parse(any) as RecoveryRecord; }\n  const legacy"),
 ('F24 digit filter removed (value only sliced)', 'mobile/App.tsx', "onChangeText={(value) => props.setOtp(value.replace(/\\D/g, '').slice(0, 6))}", "onChangeText={(value) => props.setOtp(value.slice(0, 6))}"),
 ('F24 maxLength={6} back on the control', 'mobile/App.tsx', 'textContentType="oneTimeCode" editable={!otpBlocked && !props.verifying}', 'textContentType="oneTimeCode" maxLength={6} editable={!otpBlocked && !props.verifying}'),
 ('F25 header avatar fixed 32 px again', 'mobile/App.tsx', "headerAvatar: { minWidth: 32, minHeight: 32, paddingHorizontal: 4, borderRadius: 999,", "headerAvatar: { width: 32, height: 32, borderRadius: 16,"),
 ('F25 home avatar fixed 32 px again', 'mobile/App.tsx', "avatar: { minWidth: 32, minHeight: 32, paddingHorizontal: 4, borderRadius: 999,", "avatar: { width: 32, height: 32, borderRadius: 16,"),
 ('F25 beneficiary avatar fixed 44 px again', 'mobile/App.tsx', "beneficiaryAvatar: { minWidth: 44, minHeight: 44, paddingHorizontal: 4, borderRadius: 999,", "beneficiaryAvatar: { width: 44, height: 44, borderRadius: 22,"),
]
only = sys.argv[1:]
def jest():
    r = subprocess.run(['npx', 'jest', '--runInBand'], cwd=ROOT + '/mobile', capture_output=True, text=True)
    out = r.stdout + r.stderr
    m = re.search(r'Tests:\s+(.*)', out)
    fails = re.findall(r'●\s+(.*?)\n', out)
    return (m.group(1) if m else 'no summary'), sorted(set(f for f in fails if '›' in f))[:8]
for name, f, a, b in MUT:
    if only and not any(o in name for o in only): continue
    p = f'{ROOT}/{f}'; s = open(p).read()
    if s.count(a) != 1: print(f'SKIP {name}: pattern count {s.count(a)}'); continue
    try:
        open(p, 'w').write(s.replace(a, b))
        summ, fails = jest()
        print(f'MUTATION {name} [{f}] -> {summ}')
        for x in fails: print('    FAIL', x[:170])
    finally:
        subprocess.run(['git', 'checkout', '--', f], cwd=ROOT, check=True)
print('restored; git status:', subprocess.run(['git', 'status', '--short', '--', 'mobile'], cwd=ROOT, capture_output=True, text=True).stdout.strip() or 'clean')
