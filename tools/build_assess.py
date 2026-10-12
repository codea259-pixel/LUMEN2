"""Builds server/assessments.json from the plain-text sources in tools/assess-src/.
Run: python3 tools/build_assess.py   (tools/build.py runs it too)

Source format, one item per line ('|' separates fields, lines starting with # are comments):
  @subject math                     subject id (math, ela, sci, soc)
  @el TK-2 | text                   English learner support for grades TK to 2
  @iep TK-2 | text                  IEP / 504 support for grades TK to 2
  @grade 3                          starts a grade (TK, K, 1 to 12)
  about: text                       what the year focuses on
  std: CODE | text                  a priority standard
  unit: Name | CODE, CODE | skill, skill   a unit, its standards and the app's practice skills (optional)
  mc1: question | correct | wrong | wrong | wrong   multiple choice, the digit is the DOK level (1 to 3)
  sa2: prompt | sample proficient answer            short answer (2 points)
  ex2: prompt | sample proficient answer            the quiz's written "explain" question (2 points)
  task3: prompt | score 4 | score 3 | score 2 | score 1   performance task and its 4-point rubric
  el: text                          a support note for this unit only
Each unit needs 8 mc, 2 sa, 1 ex and 1 task. Questions are original, written to the California standards."""
import json, os, re, sys
D = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(D, 'assess-src'), os.path.join(D, '..', 'server', 'assessments.json')
SUBJECTS = {'math': 'Math', 'ela': 'English / ELA', 'sci': 'Science', 'soc': 'Social Studies'}
GRADES = {'TK': -1, 'K': 0, **{str(g): g for g in range(1, 13)}}
errors = []


def build():
    cells, supports = {}, {}
    for sub in SUBJECTS:
        f = os.path.join(SRC, sub + '.txt')
        if not os.path.exists(f):
            continue
        supports[sub] = {'el': [], 'iep': []}
        cell = unit = None
        for n, raw in enumerate(open(f, encoding='utf-8'), 1):
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            where = f'{sub}.txt:{n}'
            m = re.match(r'^(@\w+|\w+):?\s*(.*)$', line)
            tag, rest = m.group(1), m.group(2).strip()
            parts = [p.strip() for p in rest.split('|')]
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
                cell = cells[key] = {'about': '', 'std': [], 'units': []}; unit = None
            elif cell is None:
                errors.append(f'{where}: {tag} before @grade')
            elif tag == 'about':
                cell['about'] = rest
            elif tag == 'std':
                if len(parts) != 2: errors.append(f'{where}: std needs CODE | text'); continue
                cell['std'].append(parts)
            elif tag == 'unit':
                g = key.split('|')[1]
                unit = {'id': f'{sub}-{g}-{len(cell["units"]) + 1}', 'name': parts[0],
                        'std': [s.strip() for s in parts[1].split(',')] if len(parts) > 1 and parts[1] else [],
                        'skills': [s.strip() for s in parts[2].split(',')] if len(parts) > 2 and parts[2] else [],
                        'mc': [], 'sa': [], 'ex': None, 'task': None, 'el': ''}
                cell['units'].append(unit)
            elif unit is None:
                errors.append(f'{where}: {tag} before unit')
            elif re.match(r'^mc[123]$', tag):
                if len(parts) != 5 or not all(parts): errors.append(f'{where}: mc needs question | correct | 3 wrong answers'); continue
                if len(set(p.lower() for p in parts[1:])) != 4: errors.append(f'{where}: answer choices repeat')
                unit['mc'].append({'q': parts[0], 'ch': parts[1:], 'dok': int(tag[2])})
            elif re.match(r'^sa[123]$', tag):
                if len(parts) != 2 or not all(parts): errors.append(f'{where}: sa needs prompt | sample answer'); continue
                unit['sa'].append({'q': parts[0], 'ans': parts[1], 'dok': int(tag[2])})
            elif re.match(r'^ex[123]$', tag):
                if len(parts) != 2 or not all(parts): errors.append(f'{where}: ex needs prompt | sample answer'); continue
                unit['ex'] = {'q': parts[0], 'ans': parts[1], 'dok': int(tag[2])}
            elif re.match(r'^task[1234]$', tag):
                if len(parts) != 5 or not all(parts): errors.append(f'{where}: task needs prompt | 4 rubric levels'); continue
                unit['task'] = {'q': parts[0], 'rub': parts[1:], 'dok': min(3, int(tag[4]))}
            elif tag == 'el':
                unit['el'] = rest
            else:
                errors.append(f'{where}: unknown line type {tag}')
    def latin1(x, where):
        bad = sorted(set(ch for ch in x if ord(ch) > 255))
        if bad: errors.append(f'{where}: PDFs cannot print {"".join(bad)!r}; use plain characters')
    for key, c in cells.items():
        latin1(json.dumps(c, ensure_ascii=False), key)
        if not c['about']: errors.append(f'{key}: missing about')
        if len(c['std']) < 3: errors.append(f'{key}: needs at least 3 priority standards')
        if len(c['units']) < 3: errors.append(f'{key}: needs at least 3 units')
        for u in c['units']:
            if len(u['mc']) != 8 or len(u['sa']) != 2 or not u['ex'] or not u['task']:
                errors.append(f'{key} {u["name"]}: has {len(u["mc"])} mc, {len(u["sa"])} sa, ex={bool(u["ex"])}, task={bool(u["task"])}')
    return {'version': 1, 'subjects': SUBJECTS, 'supports': supports, 'cells': cells}


if __name__ == '__main__':
    data = build()
    if errors:
        print('\n'.join(errors)); sys.exit(1)
    open(OUT, 'w', encoding='utf-8').write(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    units = sum(len(c['units']) for c in data['cells'].values())
    print(f'assessments ok: {len(data["cells"])} grade-subjects, {units} units, {units * 12} items')
