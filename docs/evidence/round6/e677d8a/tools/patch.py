import sys,glob
# Web-only test shim: expo-secure-store has no web backend; route its three calls to window.__ss (localStorage) in the
# exported copy only. Never applied to app source or native builds.
for f in glob.glob(sys.argv[1]+'/_expo/static/js/web/index-*.js'):
    s=open(f).read()
    for a,b in [('await n.default.deleteValueWithKeyAsync(e,t)','await window.__ss.del(e,t)'),('await n.default.getValueWithKeyAsync(e,t)','await window.__ss.get(e,t)'),('await n.default.setValueWithKeyAsync(t,e,u)','await window.__ss.set(t,e,u)')]:
        assert s.count(a)==1,a; s=s.replace(a,b)
    open(f,'w').write(s); print('patched',f)
