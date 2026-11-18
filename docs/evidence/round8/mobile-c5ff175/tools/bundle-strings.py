"""Counts required / retired texts in exported bundles (UTF-8, \\uXXXX/\\xNN-escaped JS, or UTF-16LE as Hermes bytecode stores non-ASCII strings). Usage: python3 -I bundle-strings.py <file>..."""
import sys
TEXTS = [('retired', 'No la envíes de nuevo'), ('retired', 'No intentes enviar el dinero nuevamente'),
         ('retired', 'Podrás hacer otra transferencia cuando conozcamos su resultado'), ('retired', 'Verificar de nuevo'),
         ('required', 'Podrás hacer otra transferencia cuando esta quede resuelta.'), ('required', 'No hagas otra transferencia igual'),
         ('required', 'Transferencia anulada. No se realizó ningún cargo por esta operación.'),
         ('required', 'Si ya se aplicó, te mostraremos su resultado y no se cancelará el cargo. Si no se aplicó, quedará anulada y ya no podrá aplicarse aunque llegue después.'),
         ('required', 'también se detienen las transferencias aún no aplicadas enviadas desde otros dispositivos y se cancelan las pendientes de código'),
         ('required', 'Anular esta transferencia'), ('required', 'Resolver con el servidor'), ('required', 'Anular pendientes y desbloquear'),
         ('required', 'Transfer-Attempt-Id'), ('required', 'Transfer-Send-Epoch'), ('required', '/transfer-attempts/void-all')]
def forms(text):
    # literal UTF-8, \\uXXXX (lower/upper hex) and \\xNN (Metro/Hermes minifier output for Latin-1 characters)
    uni = ''.join(c if ord(c) < 128 else '\\u%04x' % ord(c) for c in text)
    uni_up = ''.join(c if ord(c) < 128 else '\\u%04X' % ord(c) for c in text)
    hexed = ''.join(c if ord(c) < 128 else ('\\x%02x' % ord(c) if ord(c) < 256 else '\\u%04x' % ord(c)) for c in text)
    return {text, uni, uni_up, hexed}
bad = 0
for path in sys.argv[1:]:
    raw = open(path, 'rb').read()
    print(path.split('/')[-1])
    for kind, text in TEXTS:
        n = sum(raw.count(f.encode('utf-8')) for f in forms(text)) + raw.count(text.encode('utf-16-le'))
        okay = (n == 0) if kind == 'retired' else (n > 0)
        bad += 0 if okay else 1
        print(f"  {'OK ' if okay else 'BAD'} {kind:8} {n:3}  {text}")
sys.exit(1 if bad else 0)
