#!/usr/bin/env python3 -I
# Evaluator mutations: apply a textual change to one source file, run jest, record failures, ALWAYS restore with git checkout.
import subprocess, sys, re
ROOT = '/Users/jasanhernandez/Develop/fintech-wallet-g1'
MUT = [
 ('R7-1 M02 always "Continuar" even for origin=destination', 'mobile/App.tsx', "{destination && !choosingBeneficiary && (destinationIsSource\n          ? <Button title=\"Elegir otro destinatario\"", "{destination && !choosingBeneficiary && (false\n          ? <Button title=\"Elegir otro destinatario\""),
 ('R7-4 threshold hard-coded 500000n in review prediction', 'mobile/App.tsx', "BigInt(minor) >= BigInt(props.policy.otpThresholdMinor)", "BigInt(minor) >= 500000n"),
 ('R7-5 new code does not close the previous attempt first', 'mobile/App.tsx', "    if (previous) {\n      transferInFlight.current = true;", "    if (false as boolean && previous) {\n      transferInFlight.current = true;"),
 ('R7-8 recovery ignores the owning user', 'mobile/App.tsx', "if (attempt.userId && attempt.userId !== session.user.id) return;", ""),
 ('R7-8 curtain only on background (not inactive)', 'mobile/App.tsx', "if (next !== 'active') {\n        setHidden(true);", "if (next === 'background') {\n        setHidden(true);"),
 ('R7-7 429 daily limit treated as unverified', 'mobile/App.tsx', "(error.status === 429 && DAILY_LIMIT_PATTERN.test(error.message))", "false"),
 ('R7-3 estimate bar visible to screen readers', 'mobile/App.tsx', 'testID="estimate-bar" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"', 'testID="estimate-bar"'),
 ('H2 escapeHtml is identity', 'mobile/src/receipt.ts', "return String(value).replace(/[&<>\"'`]/g, (char) => HTML_ESCAPES[char]!);", "return String(value);"),
 ('H2 receipt for any status (not only completed)', 'mobile/src/receipt.ts', "if (!transfer || transfer.status !== 'completed') return null;", "if (!transfer) return null;"),
 ('H2 temp file not deleted after share', 'mobile/src/receiptShare.ts', "  } finally {\n    await removeTemporaryFile(uri);\n    track(null);\n  }", "  } finally {\n    track(null);\n  }"),
 ('H2 unmount does not delete the temp file', 'mobile/src/receiptShare.ts', "      void removeTemporaryFile(pending);\n    };", "    };"),
 ('H2 cancel treated as error', 'mobile/src/receiptShare.ts', "return name === 'AbortError' || /cancel|dismiss/i.test(`${String(code ?? '')} ${String(message ?? '')}`);", "return false;"),
 ('H2 double tap not ignored', 'mobile/src/receiptShare.ts', "if (!doc || lock.current) return;", "if (!doc) return;"),
 ('H2 sharing availability not checked', 'mobile/src/receiptShare.ts', "if (!available) return RECEIPT_MESSAGES.unavailable;", ""),
 ('H2 receipt copies the full CLABE of an own-account destination', 'mobile/src/receipt.ts', "destinationEnding: ending(destination.clabeMasked),", "destinationEnding: ('clabe' in destination ? String((destination as { clabe?: string }).clabe) : ending(destination.clabeMasked)),"),
 ('H2 receipt text carries the requestId', 'mobile/src/receipt.ts', "['Folio interno', doc.folio],", "['Folio interno', doc.folio], ['Solicitud', String((doc as unknown as { requestId?: string }).requestId ?? 'request-secret-id')],"),
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
