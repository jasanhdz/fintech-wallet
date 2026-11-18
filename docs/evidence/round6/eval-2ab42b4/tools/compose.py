import json,os,sys
from PIL import Image, ImageChops, ImageStat
SP=os.environ['EV_SP']
REF='/Users/jasanhernandez/Develop/fintech-wallet/design/mobile'
out=sys.argv[1]; os.makedirs(out,exist_ok=True)
m=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'mapping.json'))); rows=[]
for state,ref in m.items():
    f=f'{SP}/fid/{state}.png'
    if not os.path.exists(f): print('missing',state); continue
    r=Image.open(f'{REF}/{ref}/screen.png').convert('RGB'); a=Image.open(f).convert('RGB')
    r=r.resize((780,round(r.height*780/r.width)),Image.LANCZOS)
    if a.width!=780: a=a.resize((780,round(a.height*780/a.width)))
    H=max(r.height,a.height)
    R=Image.new('RGB',(780,H),'white'); R.paste(r,(0,0)); A=Image.new('RGB',(780,H),'white'); A.paste(a,(0,0))
    s=Image.new('RGB',(780*2+20,H),(136,136,136)); s.paste(R,(0,0)); s.paste(A,(800,0))
    s.save(f'{out}/{state}--lado-a-lado.jpg',quality=70)
    d=ImageChops.difference(R,A); d.save(f'{out}/{state}--diferencia.jpg',quality=75)
    mean=sum(ImageStat.Stat(d).mean)/3
    rows.append((state,ref,r.height,a.height,round(mean,2)))
for x in rows: print('| '.join(map(str,x)))
open(out+'/metrics.txt','w').write('state | ref | ref_h@780 | app_h@780 | mean abs diff (0-255)\n'+'\n'.join(' | '.join(map(str,x)) for x in rows))
