"""Learn-only lessons: short practice lessons for skills that have no test-bank unit (computer science, financial
literacy, Spanish, and college-level core topics). They join the lesson library (public/lessons.json) next to the
course lessons, so a search for any skill finds a full set of progressive lessons. They have no quizzes or unit tests.
Run: python3 tools/build_lessons.py   (tools/build.py runs it too, through lesson_units())

Sources: tools/lessons-src/<subject>-<anything>.txt, for example lessons-src/cs-1.txt. '|' separates fields;
lines starting with # are comments; every item is one line. Items use the same lines as the test bank
(see tools/build_assess.py and tools/assess-src/WRITING.md): mc, num, sa with a DOK digit, and hint: lines.

  @subject cs                        cs, fin, es, math, ela, sci or soc
  unit: Name | grade | skill, skill  a unit: its name; grade TK, K, 1 to 12 or 13 (college); the Learn skills it
                                     teaches (ids in tools/assess-src/skills.json; at least one, same subject unless
                                     it is a cross-link such as g13ci in a financial literacy unit)
  lesson: Name                       a lesson inside the unit (5 to 8 lessons a unit, easiest first)
  mc1: question | correct | wrong | wrong | wrong      multiple choice (the correct answer comes first; the app shuffles)
  num1: question | answer            a number answer: 24, -3, 2.5, 3/4 or 2 1/2
  sa2: prompt | sample answer        a short written answer the learner compares with the sample
  hint: text                         a hint for the item just above: guide thinking, never give the answer away

Each lesson has 5 or 6 items (4 to 8 allowed), at least 3 of them mc or num, and most with a hint.
No question may appear twice in a unit, and each question must make sense on its own.
Plain characters only (Latin-1, so Spanish accents are fine): no curly quotes or long dashes, no '|' inside text."""
import json, os, re, sys
D = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, D)
sys.dont_write_bytecode = True
import build_assess as BA  # noqa: E402  (shares the item parser and its error list)

SRC = os.path.join(D, 'lessons-src')
SUBJECTS = ('cs', 'fin', 'es', 'math', 'ela', 'sci', 'soc')
GRADES = {**BA.GRADES, '13': 13}
SKILLS = json.load(open(os.path.join(D, 'assess-src', 'skills.json'), encoding='utf-8'))


def lesson_units():
    """All Learn-only units, as {id, s, g, name, skills, lessons: [{name, practice}]}. Problems go to BA.errors."""
    units, counts = [], {}
    if not os.path.isdir(SRC): return units
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith('.txt'): continue
        m = re.match(r'^(%s)-[a-z0-9-]+\.txt$' % '|'.join(SUBJECTS), fn)
        if not m: BA.errors.append(f'lessons-src/{fn}: name files like cs-1.txt or fin-basics.txt'); continue
        sub, head, unit, lesson, last = m.group(1), None, None, None, None
        for n, raw in enumerate(open(os.path.join(SRC, fn), encoding='utf-8'), 1):
            line = raw.strip()
            if not line or line.startswith('#'): continue
            where = f'lessons-src/{fn}:{n}'
            mm = re.match(r'^(@\w+|\w+):?\s*(.*)$', line)
            if not mm: BA.errors.append(f'{where}: cannot read this line'); continue
            tag, rest = mm.group(1), mm.group(2).strip()
            parts = BA.split(rest)
            if tag == '@subject': head = rest
            elif tag == 'unit':
                if len(parts) != 3 or not parts[0] or parts[1] not in GRADES:
                    BA.errors.append(f'{where}: write unit: Name | grade (TK, K, 1 to 13) | skill, skill'); unit = None; continue
                g = GRADES[parts[1]]; counts[(sub, g)] = counts.get((sub, g), 0) + 1
                unit = {'id': f'{sub}-{g}-x{counts[(sub, g)]}', 's': sub, 'g': g, 'name': parts[0],
                        'skills': [s.strip() for s in parts[2].split(',') if s.strip()], 'lessons': [], '_where': where}
                if not unit['skills']: BA.errors.append(f'{where}: a unit needs at least one Learn skill')
                for k in unit['skills']:
                    if k not in SKILLS: BA.errors.append(f'{where}: unknown Learn skill {k} (see assess-src/skills.json)')
                units.append(unit); lesson = last = None
            elif unit is None: BA.errors.append(f'{where}: {tag} before a valid unit: line')
            elif tag == 'lesson':
                if not parts[0]: BA.errors.append(f'{where}: lesson needs a name')
                lesson = {'name': parts[0], 'practice': []}; unit['lessons'].append(lesson); last = None
            elif tag == 'hint':
                if not last: BA.errors.append(f'{where}: hint must follow an item'); continue
                last['h'] = rest
            else:
                it = BA.item(tag, parts, where)
                if it is None: BA.errors.append(f'{where}: unknown line type {tag}'); continue
                if it is False: continue
                if it['t'] not in ('mc', 'num', 'sa'): BA.errors.append(f'{where}: Learn lessons use mc, num and sa items'); continue
                if lesson is None: BA.errors.append(f'{where}: items must follow a lesson: line'); continue
                lesson['practice'].append(it); last = it
        if head != sub: BA.errors.append(f'lessons-src/{fn}: @subject must be {sub}, to match the file name')
    for u in units:
        w = f'{u.pop("_where")} {u["name"]}'
        if not 5 <= len(u['lessons']) <= 8: BA.errors.append(f'{w}: needs 5 to 8 lessons, has {len(u["lessons"])}')
        seen = set()
        for li, l in enumerate(u['lessons'], 1):
            p = l['practice']
            if not 4 <= len(p) <= 8: BA.errors.append(f'{w} lesson {li}: needs 4 to 8 items, has {len(p)}')
            if sum(i['t'] in ('mc', 'num') for i in p) < 3: BA.errors.append(f'{w} lesson {li}: needs at least 3 mc or num items')
            if sum('h' in i for i in p) * 2 < len(p): BA.errors.append(f'{w} lesson {li}: most items need a hint')
            for i in p:
                BA.alone(w, i)
                k = re.sub(r'\W+', ' ', i['q'].lower()).strip()
                if k in seen: BA.errors.append(f'{w}: question appears twice: {i["q"][:70]}')
                seen.add(k)
                if u['s'] == 'cs' and re.search(r';\s*(if|for|while|def|class|with|try)\b[^;]*:', i['q']) or u['s'] == 'cs' and re.search(r':\s*\S[^:]*\belse\s*:', i['q']):
                    BA.errors.append(f'{w}: this one-line code is not valid Python (if, for, def or else cannot follow ; or another statement on one line); describe the steps in words: {i["q"][:60]}')
                if i['t'] == 'mc' and i.get('h') and i['ch'][0].lower() in i['h'].lower() and len(i['ch'][0]) > 3:
                    BA.errors.append(f'{w}: this hint gives the answer away: {i["q"][:60]}')
        bad = sorted(set(ch for ch in json.dumps(u, ensure_ascii=False) if ord(ch) > 255))
        if bad: BA.errors.append(f'{w}: use plain characters, not {"".join(bad)!r}')
    return units


if __name__ == '__main__':
    us = lesson_units()
    if BA.errors:
        print('\n'.join(BA.errors[:200])); print(f'{len(BA.errors)} problem(s)'); sys.exit(1)
    print(f'learn lessons ok: {len(us)} units, {sum(len(u["lessons"]) for u in us)} lessons, '
          f'{sum(len(l["practice"]) for u in us for l in u["lessons"])} items')
