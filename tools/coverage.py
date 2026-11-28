"""Lesson coverage: every Learn skill should have at least 5 short, progressive lessons, so that a search for the skill
(or the skill's own page) offers more than one way in before adaptive practice. This counts, for each skill in
tools/assess-src/skills.json, the lessons that public/lessons.json links to it (its course units, the extra
knowledge-map links in tools/assess-src/links.json, and the Learn-only units in tools/lessons-src).

Run after python3 tools/build.py:
  python3 tools/coverage.py            summary and the skills below the target; exit 1 if any
  python3 tools/coverage.py --min 6    use another target
  python3 tools/coverage.py --all      list every skill with its lesson count"""
import json, os, sys
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MIN = int(sys.argv[sys.argv.index('--min') + 1]) if '--min' in sys.argv else 5
SK = json.load(open(os.path.join(R, 'tools', 'assess-src', 'skills.json'), encoding='utf-8'))
LJ = json.load(open(os.path.join(R, 'public', 'lessons.json'), encoding='utf-8'))
ids = {l['id'] for l in LJ['lessons']}
links = LJ.get('links', {})
rows = sorted(((len([i for i in links.get(k, []) if i in ids]), k, v) for k, v in SK.items()), key=lambda r: (r[0], r[2][0], r[2][1]))
low = [r for r in rows if r[0] < MIN]
for n, k, (sub, g, name) in (rows if '--all' in sys.argv else low):
    print(f'{n:3}  {k:12} {sub:4} grade {g:<3} {name}')
print(f'lesson coverage: {len(rows) - len(low)} of {len(rows)} Learn skills have at least {MIN} lessons'
      + (f'; {len(low)} below' if low else ''))
sys.exit(1 if low else 0)
