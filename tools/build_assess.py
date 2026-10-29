"""Builds server/assessments.json from the plain-text sources in tools/assess-src/.
Run: python3 tools/build_assess.py   (tools/build.py runs it too)

There are two source formats. Both compile to the same JSON shape (see the end of this note).

FORMAT 2 (current): one file per subject and grade, tools/assess-src/v2/<subject>-<grade>.txt,
for example v2/math-3.txt or v2/ela-TK.txt. A format-2 file replaces that grade's format-1 content.
'|' separates fields; lines starting with # are comments; every item is one line.

  @subject math                      math, ela, sci or soc (must match the file name)
  @grade 3                           TK, K, 1 to 12 (must match the file name)
  @program Eureka Math               optional: the district program this grade follows
  about: text                        what the year focuses on
  std: CODE | text                   a priority standard (at least 4)
  unit: Name | CODE, CODE | skill, skill    a unit (module, chapter); standards; app practice skills (optional, ids in skills.json)
  el: text                           optional support note for English learners for this unit
  lesson: Name | CODE, CODE          a lesson (topic) inside the unit
  practice:                          the lesson's classwork items follow (4 to 10)
  quiz:                              the lesson's quiz items follow (6 to 10: at least 4 scored automatically, at least 1 written)
  test:                              the unit test items follow (20 to 28: at least 14 automatic, at least 3 written, one of them cer, wr or task)
  passage: Title | text // text      a reading passage (// starts a new paragraph); the items after it refer to it
  endpassage:                        items after this no longer refer to the passage (a new section also ends it)
Items (the digit is the DOK level, 1 to 3):
  mc2: question | correct answer | wrong | wrong | wrong      multiple choice, 1 point
  num2: question | answer            a number answer, scored automatically, 1 point: 24, -3, 2.5, 3/4 or 2 1/2.
                                     Equivalent forms count (0.75 = 3/4); a student's $, commas and units are ignored.
                                     A question that counts from today writes {year}, which becomes the year the test is
                                     made, and its answer is written like {year}-1776 ("How many years ago from {year}?").
  sa2: prompt | sample answer        short written answer, 2 points
  cer3: prompt | sample answer       claim, evidence and reasoning, 4 points (standard CER rubric added)
  wr3: prompt | sample or key points [| score 4 | score 3 | score 2 | score 1]   extended writing, 4 points (standard writing rubric unless given)
  task3: prompt | score 4 | score 3 | score 2 | score 1       performance task, 4 points
  hint: text                         a hint for the item just above (shown in classwork only)
Subject checks: every math unit test has at least 3 num word problems; science and social studies unit tests
have at least one cer; ELA unit tests have at least one passage and one wr. No question may appear twice in a unit,
and every question must stand alone (questions are drawn separately into benchmarks): repeat the facts or data it needs
instead of writing "In that vote..." or "Using the same graph..."; questions about a passage use passage: lines.

VERSIONS: tools/assess-src/versions/<id>.txt holds new versions of lesson quizzes, classwork and unit tests
(for example a new set each trimester). Teachers choose the version when they preview or assign; the version whose
term matches the current trimester is chosen first. Format:
  @version 2027 Trimester 2 | Trimester 2      the version's name, then the trimester name it is for (as set in the site's calendar)
  @for math-3-1 test                           which part follows: a unit id and test, L1 quiz or L1 practice (lesson numbers start at 1)
  passage:, endpassage:, items and hint: lines as in format 2. Each part follows the same size rules as format 2.
Unit ids are <subject>-<grade>-<unit number>, with TK as -1 and K as 0 (math--1-2 is TK math unit 2).

FORMAT 1 (older, tools/assess-src/<subject>.txt): @grade blocks of units with exactly 8 mc, 2 sa, 1 ex and 1 task.
It is converted to the same shape: one "Unit review" lesson, the quiz is mc 1-4 + ex, the test is mc 5-8 + sa + task.

JSON: cells["sub|grade"] = {about, program, std, units: [{id, name, std, skills, el, legacy?, passages: [{t, x}],
  lessons: [{name, std, practice: [item], quiz: [item]}], test: [item]}]}
Items: {t: mc|num|sa|cer|wr|task, q, dok, ch (mc, correct first), a (num), ans (sa, cer, wr), rub (cer, wr, task), h (hint), p (passage index)}
All questions are original, written to the California standards."""
import json, os, re, sys
D = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(D, 'assess-src'), os.path.join(D, '..', 'server', 'assessments.json')
SUBJECTS = {'math': 'Math', 'ela': 'English / ELA', 'sci': 'Science', 'soc': 'Social Studies'}
GRADES = {'TK': -1, 'K': 0, **{str(g): g for g in range(1, 13)}}
CER_RUB = ['Clear, accurate claim; relevant and sufficient evidence; reasoning that explains how the evidence supports the claim using key ideas from the unit.',
           'Accurate claim and relevant evidence; the reasoning is only partly explained.',
           'A claim with limited or partly relevant evidence and little reasoning.',
           'The claim is unclear or inaccurate, with little or no evidence or reasoning.']
WR_RUB = ['Clear focus and strong organization; ideas fully developed with relevant details or text evidence; precise language; few errors in conventions.',
          'Clear focus and organization; ideas adequately developed with some details or evidence; some errors that do not affect meaning.',
          'Focus or organization is inconsistent; limited development or evidence; errors sometimes interfere with meaning.',
          'Little focus or organization; minimal development; frequent errors.']
NUM = re.compile(r'^-?(\d+(\.\d+)?|\.\d+|\d+/\d+|\d+ \d+/\d+)$')
YEAR_ANS = re.compile(r'^\{year\}-\d+$')  # a number answer counted back from the year the test is made
AUTO, WRITTEN = ('mc', 'num'), ('sa', 'cer', 'wr', 'task', 'ex')
errors = []
SKILLS = json.load(open(os.path.join(SRC, 'skills.json'), encoding='utf-8')) if os.path.exists(os.path.join(SRC, 'skills.json')) else None


def item(tag, parts, where):
    """One item line as a dict; None if the tag is not an item, False if the line has an error."""
    m = re.match(r'^(mc|num|sa|cer|wr|task|ex)([1-4])$', tag)
    if not m: return None
    t, dok = m.group(1), min(3, int(m.group(2)))
    need = {'mc': [5], 'num': [2], 'sa': [2], 'cer': [2], 'ex': [2], 'wr': [2, 6], 'task': [5]}[t]
    if len(parts) not in need or not all(parts):
        errors.append(f'{where}: {t} needs {" or ".join(map(str, need))} non-empty fields separated by |, has {len(parts)}'); return False
    it = {'t': t, 'q': parts[0], 'dok': dok}
    bad = sorted({w for p in parts for w in re.findall(r'\{[a-z]+\}', p)} - {'{year}'})
    if bad: errors.append(f'{where}: unknown placeholder {", ".join(bad)} (only {{year}} is filled in)'); return False
    if t == 'mc':
        if len(set(parts[1:])) != 4: errors.append(f'{where}: answer choices repeat')
        it['ch'] = parts[1:]
    elif t == 'num':
        a = parts[1].replace(',', '')
        if not (NUM.match(a) or YEAR_ANS.match(a)): errors.append(f'{where}: number answer "{parts[1]}" must be like 24, -3, 2.5, 3/4, 2 1/2 or {{year}}-1776'); return False
        if YEAR_ANS.match(a) and '{year}' not in parts[0]: errors.append(f'{where}: an answer counted from {{year}} needs {{year}} in the question'); return False
        it['a'] = a
    elif t == 'task': it['rub'] = parts[1:]
    else:
        it['ans'] = parts[1]
        if t == 'cer': it['rub'] = CER_RUB
        if t == 'wr': it['rub'] = parts[2:] if len(parts) == 6 else WR_RUB
    return it


def split(rest): return [p.strip() for p in rest.split('|')]


def v1(cells, supports):
    for sub in SUBJECTS:
        f = os.path.join(SRC, sub + '.txt')
        if not os.path.exists(f): continue
        supports[sub] = {'el': [], 'iep': []}
        cell = unit = key = None
        for n, raw in enumerate(open(f, encoding='utf-8'), 1):
            line = raw.strip()
            if not line or line.startswith('#'): continue
            where = f'{sub}.txt:{n}'
            m = re.match(r'^(@\w+|\w+):?\s*(.*)$', line)
            tag, rest = m.group(1), m.group(2).strip()
            parts = split(rest)
            if tag == '@subject':
                if rest != sub: errors.append(f'{where}: file says {rest}')
            elif tag in ('@el', '@iep'):
                ends = parts[0].split('-')
                if len(parts) != 2 or len(ends) != 2 or not all(e in GRADES for e in ends): errors.append(f'{where}: write a range like TK-2 | text'); continue
                supports[sub][tag[1:]].append([GRADES[ends[0]], GRADES[ends[1]], parts[1]])
            elif tag == '@grade':
                if rest not in GRADES: errors.append(f'{where}: unknown grade {rest}'); continue
                key = f'{sub}|{GRADES[rest]}'
                if key in cells: errors.append(f'{where}: grade {rest} appears twice')
                cell = cells[key] = {'about': '', 'program': '', 'std': [], 'units': []}; unit = None
            elif cell is None: errors.append(f'{where}: {tag} before @grade')
            elif tag == 'about': cell['about'] = rest
            elif tag == 'std':
                if len(parts) != 2: errors.append(f'{where}: std needs CODE | text'); continue
                cell['std'].append(parts)
            elif tag == 'unit':
                g = key.split('|')[1]
                unit = {'id': f'{sub}-{g}-{len(cell["units"]) + 1}', 'name': parts[0], 'std': [s.strip() for s in parts[1].split(',')] if len(parts) > 1 and parts[1] else [],
                        'skills': [s.strip() for s in parts[2].split(',')] if len(parts) > 2 and parts[2] else [], 'el': '', 'legacy': True, '_mc': [], '_sa': [], '_ex': None, '_task': None}
                cell['units'].append(unit)
            elif unit is None: errors.append(f'{where}: {tag} before unit')
            elif tag == 'el': unit['el'] = rest
            else:
                it = item(tag, parts, where)
                if it is None: errors.append(f'{where}: unknown line type {tag}')
                elif it:
                    if it['t'] == 'ex': it['t'] = 'sa'; unit['_ex'] = it
                    elif it['t'] == 'mc': unit['_mc'].append(it)
                    elif it['t'] == 'sa': unit['_sa'].append(it)
                    elif it['t'] == 'task': unit['_task'] = it
    for key, c in cells.items():
        for u in c['units']:
            mc, sa, ex, task = u.pop('_mc'), u.pop('_sa'), u.pop('_ex'), u.pop('_task')
            if len(mc) != 8 or len(sa) != 2 or not ex or not task:
                errors.append(f'{key} {u["name"]}: has {len(mc)} mc, {len(sa)} sa, ex={bool(ex)}, task={bool(task)}'); continue
            u['passages'] = []
            u['lessons'] = [{'name': 'Unit review', 'std': u['std'], 'practice': mc + [sa[0], ex], 'quiz': mc[:4] + [ex]}]
            u['test'] = mc[4:] + sa + [task]


def v2(cells):
    d = os.path.join(SRC, 'v2')
    if not os.path.isdir(d): return
    for fn in sorted(os.listdir(d)):
        if not fn.endswith('.txt'): continue
        m = re.match(r'^(math|ela|sci|soc)-(TK|K|\d{1,2})\.txt$', fn)
        if not m or m.group(2) not in GRADES: errors.append(f'v2/{fn}: name files like math-3.txt or ela-TK.txt'); continue
        sub, g = m.group(1), GRADES[m.group(2)]
        cell = {'about': '', 'program': '', 'std': [], 'units': []}
        unit = lesson = sec = psg = last = None; head = {}
        for n, raw in enumerate(open(os.path.join(d, fn), encoding='utf-8'), 1):
            line = raw.strip()
            if not line or line.startswith('#'): continue
            where = f'v2/{fn}:{n}'
            mm = re.match(r'^(@\w+|\w+):?\s*(.*)$', line)
            if not mm: errors.append(f'{where}: cannot read this line'); continue
            tag, rest = mm.group(1), mm.group(2).strip()
            parts = split(rest)
            if tag in ('@subject', '@grade'): head[tag] = rest
            elif tag == '@program': cell['program'] = rest
            elif tag == 'about': cell['about'] = rest
            elif tag == 'std':
                if len(parts) != 2 or not all(parts): errors.append(f'{where}: std needs CODE | text'); continue
                cell['std'].append(parts)
            elif tag == 'unit':
                unit = {'id': f'{sub}-{g}-{len(cell["units"]) + 1}', 'name': parts[0], 'std': [s.strip() for s in parts[1].split(',') if s.strip()] if len(parts) > 1 else [],
                        'skills': [s.strip() for s in parts[2].split(',') if s.strip()] if len(parts) > 2 else [], 'el': '', 'passages': [], 'lessons': [], 'test': []}
                if not parts[0]: errors.append(f'{where}: unit needs a name')
                if SKILLS is not None:
                    for k in unit['skills']:
                        if k not in SKILLS: errors.append(f'{where}: unknown practice skill {k} (see skills.json)')
                cell['units'].append(unit); lesson = sec = psg = last = None
            elif unit is None: errors.append(f'{where}: {tag} before the first unit')
            elif tag == 'el': unit['el'] = rest
            elif tag == 'lesson':
                lesson = {'name': parts[0], 'std': [s.strip() for s in parts[1].split(',') if s.strip()] if len(parts) > 1 else [], 'practice': [], 'quiz': []}
                if not parts[0]: errors.append(f'{where}: lesson needs a name')
                unit['lessons'].append(lesson); sec = psg = last = None
            elif tag in ('practice', 'quiz'):
                if lesson is None: errors.append(f'{where}: {tag}: must come after a lesson: line'); continue
                sec = lesson[tag]; psg = last = None
            elif tag == 'test': sec = unit['test']; lesson = psg = last = None
            elif tag == 'passage':
                if len(parts) != 2 or not all(parts): errors.append(f'{where}: passage needs Title | text'); continue
                unit['passages'].append({'t': parts[0], 'x': parts[1]}); psg = len(unit['passages']) - 1
            elif tag == 'endpassage': psg = None
            elif tag == 'hint':
                if not last: errors.append(f'{where}: hint must follow an item'); continue
                last['h'] = rest
            else:
                it = item(tag, parts, where)
                if it is None: errors.append(f'{where}: unknown line type {tag}'); continue
                if it is False: continue
                if it['t'] == 'ex': it['t'] = 'sa'
                if sec is None: errors.append(f'{where}: items must follow practice:, quiz: or test:'); continue
                if psg is not None: it['p'] = psg
                sec.append(it); last = it
        if head.get('@subject') != sub or head.get('@grade') != m.group(2): errors.append(f'v2/{fn}: @subject and @grade must match the file name')
        check_v2(f'v2/{fn}', sub, cell)
        cells[f'{sub}|{g}'] = cell


def check_v2(where, sub, c):
    if not c['about']: errors.append(f'{where}: missing about:')
    if len(c['std']) < 4: errors.append(f'{where}: needs at least 4 priority standards')
    if len(c['units']) < 4: errors.append(f'{where}: needs at least 4 units')
    for u in c['units']:
        w = f'{where} {u["name"]}'
        if not 2 <= len(u['lessons']) <= 6: errors.append(f'{w}: needs 2 to 6 lessons, has {len(u["lessons"])}')
        seen = {}
        for li, l in enumerate(u['lessons']):
            p, q = l['practice'], l['quiz']
            if not 4 <= len(p) <= 10: errors.append(f'{w} lesson {li + 1}: practice needs 4 to 10 items, has {len(p)}')
            if not 6 <= len(q) <= 10: errors.append(f'{w} lesson {li + 1}: quiz needs 6 to 10 items, has {len(q)}')
            if sum(i['t'] in AUTO for i in q) < 4: errors.append(f'{w} lesson {li + 1}: quiz needs at least 4 mc or num items')
            if sum(i['t'] in WRITTEN for i in q) < 1: errors.append(f'{w} lesson {li + 1}: quiz needs a written item (sa, cer or wr)')
            if any(i['t'] == 'task' for i in p + q): errors.append(f'{w} lesson {li + 1}: performance tasks belong in the unit test')
        t = u['test']
        if not 20 <= len(t) <= 28: errors.append(f'{w}: unit test needs 20 to 28 items, has {len(t)}')
        if sum(i['t'] in AUTO for i in t) < 14: errors.append(f'{w}: unit test needs at least 14 mc or num items')
        if sum(i['t'] in WRITTEN for i in t) < 3: errors.append(f'{w}: unit test needs at least 3 written items')
        if not any(i['t'] in ('cer', 'wr', 'task') for i in t): errors.append(f'{w}: unit test needs a cer, wr or task item')
        if sub == 'math' and sum(i['t'] == 'num' for i in t) < 3: errors.append(f'{w}: math unit test needs at least 3 num word problems')
        if sub in ('sci', 'soc') and not any(i['t'] == 'cer' for i in t): errors.append(f'{w}: unit test needs a cer item')
        if sub == 'ela' and not (any('p' in i for i in t) and any(i['t'] == 'wr' for i in t)): errors.append(f'{w}: ELA unit test needs a passage and a wr item')
        for i in [i for l in u['lessons'] for i in l['practice'] + l['quiz']] + t:
            alone(w, i)
            k = re.sub(r'\W+', ' ', i['q'].lower()).strip()
            if k in seen: errors.append(f'{w}: question appears twice: {i["q"][:70]}')
            seen[k] = 1


def alone(w, i):
    """Questions are drawn one at a time into benchmarks, so each must make sense without the one before it."""
    if 'p' in i: return
    if '(' not in i['q'] and re.search(r'^(In|Using|From|For|On) (that|the same|those)\b', i['q']):
        errors.append(f'{w}: this question depends on the one before it; repeat the facts it needs so it stands alone: {i["q"][:70]}')
    elif re.search(r'\b(from|in) (the|this) (story|passage|text|poem|article)\b', i['q'], re.I):
        errors.append(f'{w}: this question mentions a passage but is not under a passage: line; move it under the passage or say what it needs: {i["q"][:70]}')


def check_part(w, sub, kind, items):
    for i in items: alone(w, i)
    a, wr = sum(i['t'] in AUTO for i in items), sum(i['t'] in WRITTEN for i in items)
    if kind == 'practice' and not 4 <= len(items) <= 10: errors.append(f'{w}: practice needs 4 to 10 items, has {len(items)}')
    if kind == 'quiz' and (not 6 <= len(items) <= 10 or a < 4 or wr < 1): errors.append(f'{w}: a quiz needs 6 to 10 items with at least 4 mc or num and 1 written')
    if kind == 'test':
        if not 20 <= len(items) <= 28 or a < 14 or wr < 3: errors.append(f'{w}: a unit test needs 20 to 28 items with at least 14 mc or num and 3 written')
        if sub == 'math' and sum(i['t'] == 'num' for i in items) < 3: errors.append(f'{w}: math unit test needs at least 3 num word problems')
        if sub in ('sci', 'soc') and not any(i['t'] == 'cer' for i in items): errors.append(f'{w}: unit test needs a cer item')
        if sub == 'ela' and not any(i['t'] == 'wr' for i in items): errors.append(f'{w}: ELA unit test needs a wr item')


def versions(cells):
    d, out = os.path.join(SRC, 'versions'), []
    if not os.path.isdir(d): return out
    units = {u['id']: (k.split('|')[0], u) for k, c in cells.items() for u in c['units']}
    for fn in sorted(os.listdir(d)):
        if not fn.endswith('.txt'): continue
        vid = fn[:-4]
        if not re.match(r'^[a-z0-9-]{2,40}$', vid): errors.append(f'versions/{fn}: name files with lowercase letters, digits and hyphens'); continue
        ver = {'id': vid, 'name': '', 'term': '', 'parts': {}}; part = psg = last = None; plist = None
        for n, raw in enumerate(open(os.path.join(d, fn), encoding='utf-8'), 1):
            line = raw.strip()
            if not line or line.startswith('#'): continue
            where = f'versions/{fn}:{n}'
            mm = re.match(r'^(@\w+|\w+):?\s*(.*)$', line)
            tag, rest = mm.group(1), mm.group(2).strip(); parts = split(rest)
            if tag == '@version':
                ver['name'] = parts[0]; ver['term'] = parts[1] if len(parts) > 1 else ''
            elif tag == '@for':
                m = re.match(r'^(\S+)\s+(test|L(\d)\s+(quiz|practice))$', rest)
                if not m or m.group(1) not in units: errors.append(f'{where}: write @for <unit id> test, or @for <unit id> L1 quiz'); part = None; continue
                sub, u = units[m.group(1)]
                key = m.group(1) + '|' + ('test' if m.group(2) == 'test' else f'L{m.group(3)}:{m.group(4)}')
                if m.group(2) != 'test' and not 1 <= int(m.group(3)) <= len(u['lessons']): errors.append(f'{where}: unit {m.group(1)} has {len(u["lessons"])} lessons'); part = None; continue
                part = ver['parts'][key] = {'items': [], 'passages': [], '_sub': sub, '_u': u, '_kind': 'test' if m.group(2) == 'test' else m.group(4)}; psg = last = None
            elif part is None: errors.append(f'{where}: {tag} before a valid @for line')
            elif tag == 'passage':
                if len(parts) != 2 or not all(parts): errors.append(f'{where}: passage needs Title | text'); continue
                part['passages'].append({'t': parts[0], 'x': parts[1]}); psg = len(part['passages']) - 1
            elif tag == 'endpassage': psg = None
            elif tag == 'hint':
                if not last: errors.append(f'{where}: hint must follow an item'); continue
                last['h'] = rest
            else:
                it = item(tag, parts, where)
                if it is None: errors.append(f'{where}: unknown line type {tag}'); continue
                if it is False: continue
                if it['t'] == 'ex': it['t'] = 'sa'
                if psg is not None: it['p'] = psg
                part['items'].append(it); last = it
        if not ver['name']: errors.append(f'versions/{fn}: needs an @version line')
        norm = lambda q: re.sub(r'\W+', ' ', q.lower()).strip()
        for key, p in ver['parts'].items():
            u = p.pop('_u'); std = {norm(i['q']) for i in u['test'] + [i for l in u['lessons'] for i in l['practice'] + l['quiz']]}
            check_part(f'versions/{fn} {key}', p.pop('_sub'), p.pop('_kind'), p['items'])
            for i in p['items']:
                if norm(i['q']) in std: errors.append(f'versions/{fn} {key}: this question is already in the standard version; write a new one: {i["q"][:70]}')
        bad = sorted(set(ch for ch in json.dumps(ver, ensure_ascii=False) if ord(ch) > 255))
        if bad: errors.append(f'versions/{fn}: PDFs cannot print {"".join(bad)!r}; use plain characters')
        out.append(ver)
    return out


def build():
    cells, supports = {}, {}
    v1(cells, supports)
    v2(cells)
    vers = versions(cells)
    for key, c in cells.items():
        bad = sorted(set(ch for ch in json.dumps(c, ensure_ascii=False) if ord(ch) > 255))
        if bad: errors.append(f'{key}: PDFs cannot print {"".join(bad)!r}; use plain characters')
    order = lambda kv: (list(SUBJECTS).index(kv[0].split('|')[0]), int(kv[0].split('|')[1]))
    return {'version': 2, 'subjects': SUBJECTS, 'supports': supports, 'cells': dict(sorted(cells.items(), key=order)), 'versions': vers}


if __name__ == '__main__':
    data = build()
    if errors:
        print('\n'.join(errors[:200])); print(f'{len(errors)} problem(s)'); sys.exit(1)
    open(OUT, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    units = [u for c in data['cells'].values() for u in c['units']]
    items = sum(len(u['test']) + sum(len(l['practice']) + len(l['quiz']) for l in u['lessons']) for u in units)
    print(f'assessments ok: {len(data["cells"])} grade-subjects, {len(units)} units, {sum(len(u["lessons"]) for u in units)} lessons, {items} items')
