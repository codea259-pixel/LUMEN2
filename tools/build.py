"""Builds public/app.html: the prototype (base.html) plus the server connection (bridge.html) and the design layer (ui.html).
Run: python3 tools/build.py"""
import sys
import os
D=os.path.dirname(os.path.abspath(__file__))
src, out = os.path.join(D,'base.html'), os.path.join(D,'..','public','app.html')
layers = [os.path.join(D,f) for f in ('bridge.html','ui.html')]
h = open(src, encoding='utf-8').read()
def rep(old, new, count=1):
    global h
    n = h.count(old)
    if n != count: sys.exit(f'expected {count} of {old[:60]!r}, found {n}')
    h = h.replace(old, new)
# Lite mode flag lives in its own key now (account data stays on the server)
rep('localStorage.getItem("lumen2")||"{}").lite', 'localStorage.getItem("lumen_lite")||"0")')
# Load and save progress through the server instead of this browser
rep("try{const t=localStorage.getItem('lumen1');if(t)S=Object.assign(S,JSON.parse(t))}catch(e){}", "if(BOOT.state.S)S=Object.assign(S,BOOT.state.S);")
rep("const save=()=>{try{localStorage.setItem('lumen1',JSON.stringify(S))}catch(e){}};", "const save=()=>SYNC();")
rep("let ST=D0;try{const t=JSON.parse(localStorage.getItem('lumen2')||'null');if(t)ST={...D0,...t}}catch(e){}", "let ST={...D0,...(BOOT.state.prefs||{}),days:BOOT.state.days||[],secs:BOOT.state.secs||0};Object.assign(ST.gr,BOOT.settings.gr||{});ST.flags=BOOT.settings.flags||ST.flags;ST.retDays=BOOT.settings.retDays;ST.imp=BOOT.settings.impact;ST.role=BOOT.role;")
rep("const sv=()=>{try{localStorage.setItem('lumen2',JSON.stringify(ST))}catch(e){}};", "const sv=()=>SYNC();")
# Certificate links point at the server's public verification page
rep("const link=c=>location.href.split('#')[0]+'#cert='+btoa(unescape(encodeURIComponent(JSON.stringify([c.id,c.name,c.course,c.date]))));", "const link=c=>location.origin+'/c/'+c.id;")
# Main scripts run only after the signed-in user's data has loaded
rep('<script>\nconst rnd=', '<script type="text/x-lumen">\nconst rnd=')
rep('<script>\n/* ===== Grades, teacher tools', '<script type="text/x-lumen">\n/* ===== Grades, teacher tools')
rep("const can=t=>", "let can=t=>")
rep("const isMod=()=>ST.role==='owner'||ST.role==='teacher',who=()=>ST.me.name;", "let isMod=()=>ST.role==='owner'||ST.role==='teacher',who=()=>ST.me.name;")
rep('</body>', ''.join(open(f, encoding='utf-8').read() + '\n' for f in layers) + '</body>')
open(out, 'w', encoding='utf-8').write(h)
# GitHub Pages serves the repo root without the server, so keep copies there (the app runs in demo mode)
root = os.path.join(D, '..')
open(os.path.join(root, 'app.html'), 'w', encoding='utf-8').write(h)
open(os.path.join(root, 'index.html'), 'w', encoding='utf-8').write(open(os.path.join(root, 'public', 'index.html'), encoding='utf-8').read())
open(os.path.join(root, '.nojekyll'), 'w').close()
print('ok', len(h))
