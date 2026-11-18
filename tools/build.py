"""Builds public/app.html: the prototype (base.html) plus the server connection (bridge.html) and the design layer (ui.html).
Run: python3 tools/build.py"""
import sys
import os
D=os.path.dirname(os.path.abspath(__file__))
src, out = os.path.join(D,'base.html'), os.path.join(D,'..','public','app.html')
layers = [os.path.join(D,f) for f in ('firebase.html','bridge.html','ui.html','features.html','video.html','vendor-qrcode.html','printables.html','assess.html','game.html','realm.html','member.html','arcade.html','games.html','agcore.html','agkart.html','agblocks.html','agate.html','agpets.html','agspell.html','agbuild.html','agworld.html','agocean.html','agmansion.html','agisland.html','dungeon.html','snake.html','next.html','nlpath.html','nlhist.html','nllab.html','compete.html','privacy.html','agclass.html')]
import re
# Snake Arena's engine lives in snake-arena/src as JavaScript modules (it also runs on its own page and in Node).
# For the app, the modules are joined in dependency order inside one function scope, in place of /*@SNAKE_ENGINE@*/.
SNAKE_SRC = os.path.join(D, '..', 'snake-arena', 'src')
SNAKE_ORDER = ('math', 'config', 'spatial', 'food', 'snake', 'collision', 'ai/personalities', 'ai/perception', 'ai/steering', 'ai/brain', 'ai/wander', 'bot', 'game', 'render/renderer')
def snake_engine():
    parts = []
    for m in SNAKE_ORDER:
        js = open(os.path.join(SNAKE_SRC, m + '.js'), encoding='utf-8').read()
        js = '\n'.join(l for l in js.split('\n') if not l.startswith('import '))
        parts.append(f'/* snake-arena/src/{m}.js */\n' + re.sub(r'^export ', '', js, flags=re.M))
    return "const SnakeArena=(()=>{'use strict';\n" + '\n'.join(parts) + '\nreturn {Game,Renderer,PERSONALITIES,KINDS,WORLD,SNAKE,DIFFICULTY,bodyAt};\n})();'
def layer(f):
    t = open(f, encoding='utf-8').read()
    return t.replace('/*@SNAKE_ENGINE@*/', snake_engine()) if '/*@SNAKE_ENGINE@*/' in t else t
import subprocess
subprocess.run([sys.executable, os.path.join(D, 'build_assess.py')], check=True)  # server/assessments.json
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
rep("const link=c=>location.href.split('#')[0]+'#cert='+btoa(unescape(encodeURIComponent(JSON.stringify([c.id,c.name,c.course,c.date]))));", "const link=c=>BOOT.fb?location.href.split('#')[0]+'#verify='+c.id:location.origin+'/c/'+c.id;")
# Main scripts run only after the signed-in user's data has loaded
rep('concept.</title>', 'concept.</title>\n<script src="firebase-config.js"></script>')
rep('<script>\nconst rnd=', '<script type="text/x-lumen">\nconst rnd=')
rep('<script>\n/* ===== Grades, teacher tools', '<script type="text/x-lumen">\n/* ===== Grades, teacher tools')
rep("const can=t=>", "let can=t=>")
rep("const isMod=()=>ST.role==='owner'||ST.role==='teacher',who=()=>ST.me.name;", "let isMod=()=>ST.role==='owner'||ST.role==='teacher',who=()=>ST.me.name;")
rep('</body>', ''.join(layer(f) + '\n' for f in layers) + '</body>')
# Two layers declaring the same top-level function: the later one silently replaces the earlier one. Stop the build.
def _top_names(text):
    # names declared at the top level: function X(, and every name in const/let/var A=..,B=.. (commas at bracket depth 0)
    for m in re.finditer(r'^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(', text, re.M):
        yield m.group(1)
    for m in re.finditer(r'^(?:const|let|var) ', text, re.M):
        i, depth, n, name_next = m.end(), 0, len(text), True
        while i < n:
            ch = text[i]
            if name_next:
                k = re.match(r'\s*([A-Za-z_$][\w$]*)\s*=(?!=)', text[i:])
                if k: yield k.group(1); i += k.end(); name_next = False; continue
                name_next = False
            if ch in '\'"`':
                q = ch; i += 1
                while i < n and text[i] != q:
                    if text[i] == '\\': i += 1
                    elif q == '`' and text.startswith('${', i):
                        d = 1; i += 2
                        while i < n and d:
                            d += {'{': 1, '}': -1}.get(text[i], 0); i += 1
                        continue
                    i += 1
            elif ch in '([{': depth += 1
            elif ch in ')]}': depth -= 1
            elif depth == 0 and ch == ',': name_next = True
            elif depth == 0 and ch in ';\n': break
            i += 1
_seen = {}
for f in [src] + layers:
    body = open(f, encoding='utf-8').read()
    for nm in set(_top_names(body)):
        if nm in _seen and _seen[nm] != f:
            sys.exit(f'build stopped: {nm} is declared at the top level in both {os.path.basename(_seen[nm])} and {os.path.basename(f)}')
        _seen[nm] = f
open(out, 'w', encoding='utf-8').write(h)
# GitHub Pages serves the repo root without the server, so keep copies there (the app runs in demo mode)
root = os.path.join(D, '..')
open(os.path.join(root, 'app.html'), 'w', encoding='utf-8').write(h)
open(os.path.join(root, 'index.html'), 'w', encoding='utf-8').write(open(os.path.join(root, 'public', 'index.html'), encoding='utf-8').read())
open(os.path.join(root, '.nojekyll'), 'w').close()
# Next Level's Cipher checks guesses against this word list (fetched only when the puzzle opens)
for _img in ('arcade-map.jpg', 'hero-map.jpg'):
    open(os.path.join(root, _img), 'wb').write(open(os.path.join(root, 'public', _img), 'rb').read())
open(os.path.join(root, 'words5.txt'), 'w', encoding='utf-8').write(open(os.path.join(root, 'public', 'words5.txt'), encoding='utf-8').read())
# Privacy policy and terms: the contact details live in tools/legal/legal.json; blanks show as highlighted gaps
import datetime, json, html as _html
L = json.load(open(os.path.join(D, 'legal', 'legal.json'), encoding='utf-8'))
css = open(os.path.join(D, 'legal', 'legal.css'), encoding='utf-8').read()
missing = [k for k in ('operator', 'email', 'address', 'phone') if not str(L.get(k, '')).strip()]
val = lambda k, what: _html.escape(str(L[k]).strip()) if str(L.get(k, '')).strip() else f'<mark class="todo">[{what} to be added]</mark>'
for name in ('privacy.html', 'terms.html'):
    t = open(os.path.join(D, 'legal', name), encoding='utf-8').read()
    for k, v in {'CSS': css, 'OPERATOR': val('operator', 'name'), 'EMAIL': val('email', 'email'), 'ADDRESS': val('address', 'mailing address'),
                 'PHONE': val('phone', 'phone number'), 'UPDATED': _html.escape(L.get('updated', '')), 'YEAR': str(datetime.date.today().year)}.items():
        t = t.replace('{{' + k + '}}', v)
    if '{{' in t: sys.exit(f'{name}: unknown placeholder {t[t.index("{{"):t.index("{{")+20]}')
    for d in (os.path.join(root, 'public'), root): open(os.path.join(d, name), 'w', encoding='utf-8').write(t)
if missing: print('legal pages: still to fill in tools/legal/legal.json:', ', '.join(missing))
print('ok', len(h))
