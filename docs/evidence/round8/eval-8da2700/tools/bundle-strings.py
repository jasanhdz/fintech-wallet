import glob,re,sys
S=sys.argv[1]
def norm(b):
    s=b.decode('utf-8','replace')
    s=re.sub(r'\\u([0-9a-fA-F]{4})',lambda m:chr(int(m.group(1),16)),s)
    s=re.sub(r'\\x([0-9a-fA-F]{2})',lambda m:chr(int(m.group(1),16)),s)
    return s
bad=["No la envíes de nuevo","No intentes enviar el dinero nuevamente","Podrás hacer otra transferencia cuando conozcamos su resultado","Verificar de nuevo"]
good=["No hagas otra transferencia igual","Podrás hacer otra transferencia cuando esta quede resuelta.","Si ya se aplicó, te mostraremos su resultado y no se cancelará el cargo. Si no se aplicó, quedará anulada y ya no podrá aplicarse aunque llegue después.","Transferencia anulada. No se realizó ningún cargo por esta operación.","también se detienen las transferencias aún no aplicadas enviadas desde otros dispositivos"]
for name,pat in [("web",S+"/webdist/_expo/static/js/web/index-*.js"),("ios",S+"/iosdist/_expo/static/js/ios/entry-*")]:
    for f in glob.glob(pat):
        s=norm(open(f,'rb').read()); print(name,f.split('/')[-1][:24],len(s))
        for t in bad: print("  absent  ->",s.count(t),t)
        for t in good: print("  present ->",s.count(t),t[:60])
