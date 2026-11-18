import sys,re
from html.parser import HTMLParser
VOID={'img','input','br','hr','meta','link'}
class P(HTMLParser):
    def __init__(s): super().__init__(); s.d=0; s.skip=0; s.out=[]; s.inbody=False
    def handle_starttag(s,t,a):
        if t=='body': s.inbody=True
        if not s.inbody: return
        if t in('script','style','svg'): s.skip+=1; return
        if s.skip: return
        a=dict(a); c=a.get('class','')
        extra=' '.join(f'{k}="{v}"' for k,v in a.items() if k in('placeholder','value','type'))
        s.out.append('  '*s.d+f'<{t} {c} {extra}'.rstrip()+'>')
        if t not in VOID: s.d+=1
    def handle_endtag(s,t):
        if not s.inbody: return
        if t in('script','style','svg'): s.skip-=1; return
        if s.skip: return
        if t not in VOID: s.d-=1
    def handle_data(s,d):
        if s.skip or not s.inbody: return
        d=re.sub(r'\s+',' ',d).strip()
        if d: s.out.append('  '*s.d+'"'+d+'"')
p=P(); p.feed(open(sys.argv[1]).read()); print('\n'.join(p.out))
