/* Content audit: looks for mistakes in everything learners see, in a real browser, without a server.
     node tools/audit.cjs                  check everything, print a report, exit 1 if anything is wrong
     node tools/audit.cjs --spell          also list words not in an English word list (needs: npm i --no-save an-array-of-english-words@2.0.0)
     node tools/audit.cjs --json out.json  also save the findings as JSON
     node tools/audit.cjs --sample math 6  print 3 practice questions with answers for every math skill in grade 6 (for reading)
   Run python3 tools/build.py first. The test bank's structure, grading and PDFs are checked by tools/validate-assess.cjs;
   the review checklist for meaning (right keys, facts, wording) is tools/assess-src/REVIEW.md. The content-auditor agent
   (.claude/agents/content-auditor.md) runs both, then reads the content itself.

   What this checks mechanically:
   - Practice questions: every skill's generator, many times at each difficulty. No crashes or broken text (undefined, NaN,
     {placeholders}), choices are distinct and the key is in range, typed answers grade as correct (and decimal answers too
     when the question asks for a decimal), hints and worked steps are there, and the same question never has two answers.
   - Skills: names, lesson text, grades and prerequisites that exist.
   - Arcade answer choices (Kart lanes, Snake Arena orbs): three distinct options that include the right one.
   - Next Level: Cipher words are real 5-letter words whose definitions don't give them away; a year of daily equations
     are true; each Crossroads decision has exactly one historical choice and valid meters; Market Sim questions and news;
     the lab physics and chemistry.
   - Test bank (server/assessments.json): no broken text, no empty fields, no item repeated within a lesson or test. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), arg = n => process.argv.includes('--' + n), argv = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null };

(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(ROOT, 'app.html'));
  await p.waitForFunction(() => typeof G !== 'undefined' && typeof ORDER !== 'undefined' && typeof CIPHER !== 'undefined' && typeof XR !== 'undefined', null, { timeout: 30000 });
  const words5 = fs.readFileSync(path.join(ROOT, 'public', 'words5.txt'), 'utf8').split('\n').filter(l => l && l[0] !== '#');
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'assessments.json'), 'utf8'));

  // --sample <subject> [grade]: print practice questions with their answers, for a person or the agent to read
  const si = process.argv.indexOf('--sample');
  if (si > 0) {
    const sub = process.argv[si + 1], gr = process.argv[si + 2];
    const rows = await p.evaluate(({ sub, gr }) => ORDER.filter(k => SK[k].sub === sub && (gr == null || String(ST.gr[k]) === gr)).map(k => {
      const plain = h => String(h ?? '').replace(/<li>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return { k, n: SK[k].n, g: ST.gr[k], qs: [1, 2, 3].map(d => { const q = G[k](d); return { q: plain(q.q), a: q.choices ? q.choices[q.a[0]] : fmtA(q), ch: q.choices ? q.choices.map(String) : null, s: plain(q.s) } }) } }), { sub, gr });
    for (const r of rows) { console.log(`\n## ${r.k} · ${r.n} · grade ${r.g}`); r.qs.forEach((q, i) => console.log(`  ${i + 1}. ${q.q}\n     answer: ${q.a}${q.ch ? `   (choices: ${q.ch.join(' | ')})` : ''}\n     steps: ${q.s.slice(0, 200)}`)) }
    await b.close(); return;
  }
  const res = await p.evaluate(({ words5, bank }) => {
    const out = [], seen = new Set(), texts = [];
    const add = (area, where, msg) => { const key = area + where + msg; if (!seen.has(key)) { seen.add(key); out.push({ area, where, msg }) } };
    // Leftovers from code: undefined, NaN, [object ...], {placeholders}, ${...}. "undefined" is a real math answer
    // for slopes, limits and division by zero, so it only counts outside those topics.
    const CODE = /NaN|\[object|\{[a-z]{1,8}\}|\$\{|undefined\w|\wundefined/, MATHUNDEF = /slope|limit|zero|vertical|asymptote|divid|division|tangent/i;
    const BROKENT = (s, ctx = '') => CODE.test(s) || (/\bundefined\b/.test(s) && !MATHUNDEF.test(ctx + ' ' + s));
    const BROKEN = { test: s => BROKENT(String(s)) };
    const plain = h => String(h ?? '').replace(/<li>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const decOf = ([n, d]) => { let x = d; for (const f of [2, 5]) while (x % f === 0) x /= f; return x === 1 ? String(+(n / d).toFixed(6)) : null };

    /* Skills and their practice questions */
    for (const k of ORDER) {
      const s = SK[k], W = `${k} (${s.n || '?'})`;
      if (!s.n) add('skills', k, 'no name');
      if (!plain(s.c)) add('skills', W, 'no lesson text');
      if (BROKEN.test(s.c || '')) add('skills', W, 'broken lesson text: ' + plain(s.c).slice(0, 90));
      (s.pre || []).forEach(q => { if (!SK[q]) add('skills', W, 'prerequisite does not exist: ' + q) });
      if (ST.gr[k] == null) add('skills', W, 'no grade');
      texts.push(s.n, plain(s.c));
      if (!G[k]) { add('practice', W, 'no question generator'); continue }
      const answers = new Map();
      for (let d = 1; d <= 3; d++) for (let i = 0; i < 40; i++) {
        let q; try { q = G[k](d) } catch (e) { add('practice', W, `generator crashed at level ${d}: ${e.message}`); break }
        const t = plain(q.q);
        if (!t) { add('practice', W, 'empty question'); continue }
        if (BROKEN.test(q.q)) add('practice', W, 'broken question text: ' + t.slice(0, 90));
        if (!q.h || q.h.length < 3 || q.h.some(x => !plain(x))) add('practice', W, 'fewer than 3 hints');
        if (!plain(q.s)) add('practice', W, 'no worked steps');
        let right;
        if (q.choices) {
          const ch = q.choices.map(String);
          if (new Set(ch.map(c => c.trim().toLowerCase())).size !== ch.length) add('practice', W, `repeated choices in "${t.slice(0, 60)}": ${ch.join(' | ')}`);
          if (ch.some(c => !c.trim() || BROKEN.test(c))) add('practice', W, `empty or broken choice in "${t.slice(0, 60)}"`);
          if (!(q.a[0] >= 0 && q.a[0] < ch.length)) { add('practice', W, `key out of range in "${t.slice(0, 60)}"`); continue }
          right = ch[q.a[0]];
        } else {
          const f = fmtA(q), u = parse(f);
          if (!u || !eq(u, q.a)) add('practice', W, `answer ${f} does not grade as correct in "${t.slice(0, 60)}"`);
          if (/decimal/i.test(t)) { const dec = decOf(q.a); if (dec && !(parse(dec) && eq(parse(dec), q.a))) add('practice', W, `decimal answer ${dec} is not accepted in "${t.slice(0, 60)}"`) }
          if (!Number.isFinite(q.a[0] / q.a[1])) add('practice', W, `answer is not a number in "${t.slice(0, 60)}"`);
          right = f;
          // Arcade lanes and orbs built from this question
          try { const c = kartChoices(q); if (new Set(c.L).size !== c.L.length || c.L.length < 2 || !(c.cor >= 0) || !c.L.some((x, j) => j === c.cor)) add('arcade', W, `bad answer choices ${c.L.join(' | ')} for "${t.slice(0, 50)}"`) } catch (e) { add('arcade', W, 'answer choices crashed: ' + e.message) }
        }
        if (q.choices) try { const c = kartChoices(q); if (c.L[c.cor] !== right || new Set(c.L).size !== c.L.length) add('arcade', W, `arcade choices lost the right answer for "${t.slice(0, 50)}"`) } catch (e) { add('arcade', W, 'answer choices crashed: ' + e.message) }
        const set = answers.get(t) || new Set(); set.add(String(right).trim().toLowerCase()); answers.set(t, set);
        texts.push(t, ...(q.choices || []).map(String), ...(q.h || []).map(plain), plain(q.s));
      }
      for (const [t, set] of answers) if (set.size > 1 && !/\d/.test(t)) add('practice', W, `the same question has different answers (${[...set].join(' / ')}): "${t.slice(0, 70)}"`);
    }

    /* Next Level */
    const W5 = new Set(words5);
    CIPHER.forEach(([s, w, d]) => { const where = `Cipher "${w}"`;
      if (w.length !== 5 || !/^[a-z]+$/.test(w)) add('next level', where, 'not a 5-letter word');
      if (!W5.has(w)) add('next level', where, 'not in the guess word list, so it could never be guessed');
      if (!SUBN[s]) add('next level', where, 'unknown subject ' + s);
      const stem = w.replace(/(es|s)$/, '');
      if (new RegExp('\\b' + stem, 'i').test(d)) add('next level', where, 'the definition gives the word away: ' + d);
      texts.push(d) });
    if (new Set(CIPHER.map(c => c[1])).size !== CIPHER.length) add('next level', 'Cipher', 'a word is listed twice');
    { const d = new Date(); for (let i = 0; i < 730; i++) { const s = dstr(d), e = eqOf(s); if (e.length !== 8 || eqProblem(e)) add('next level', 'Equation Code ' + s, 'bad equation ' + e); d.setDate(d.getDate() + 1) } }
    XR.forEach(s => { const ms = s.meters.map(m => m[0]);
      s.steps.forEach((st, i) => { const where = `Crossroads "${s.t}" decision ${i + 1}`;
        const h = st.o.filter(o => o.h).length; if (h !== 1) add('next level', where, `${h} choices are marked as what really happened (should be 1)`);
        st.o.forEach(o => Object.keys(o.fx || {}).forEach(k => { if (!ms.includes(k)) add('next level', where, 'unknown meter ' + k) }));
        if (!st.n || !st.x) add('next level', where, 'missing text');
        texts.push(st.h, st.x, st.n, ...st.o.flatMap(o => [o.t, o.c])) });
      (s.fail || []).forEach(f => { if (!ms.includes(f[0])) add('next level', `Crossroads "${s.t}"`, 'ending uses unknown meter ' + f[0]) });
      texts.push(s.wrap) });
    MKQ.forEach(([q, ch, a, s], i) => { const where = `Market Sim question ${i + 1}`;
      if (new Set(ch).size !== ch.length) add('next level', where, 'repeated choices');
      if (!(a >= 0 && a < ch.length)) add('next level', where, 'key out of range');
      if (!s) add('next level', where, 'no explanation'); texts.push(q, ...ch, s) });
    const secs = new Set([...MKA.map(a => a.sec), 'all']);
    MKEV.forEach(e => { Object.keys(e.e).forEach(k => { if (!secs.has(k)) add('next level', `Market Sim news "${e.h}"`, 'unknown sector ' + k) }); texts.push(e.h, e.x) });
    { const c = pjCalc(45, 20, 9.8); if (Math.abs(c.R - 400 / 9.8) > 1e-6) add('next level', 'Projectile Lab', 'range at 45° is not v²/g') }
    if (Math.abs(ttPH(.1, 25) - 7) > 1e-9 || Math.abs(ttPH(.1, 24.9) - 3.6990) > .001) add('next level', 'Titration Lab', 'pH values are wrong');

    /* Test bank: text problems and repeats (structure and grading are validate-assess.cjs's job) */
    const META = new Set(['id', 'skills', 'std', 't', 'dok']);
    const strs = (o, f) => { if (typeof o === 'string') f(o); else if (Array.isArray(o)) o.forEach(x => strs(x, f)); else if (o && typeof o === 'object') Object.entries(o).forEach(([k, x]) => { if (!META.has(k)) strs(x, f) }) };
    for (const [cell, c] of Object.entries(bank.cells)) for (const u of c.units) {
      strs(u, x => texts.push(x));
      const allItems = [...u.lessons.flatMap(L => [...(L.practice || []), ...(L.quiz || [])]), ...(u.test || [])];
      allItems.forEach(it => strs(it, x => { if (BROKENT(x, it.q || '')) add('test bank', `${cell} ${u.id}`, `broken text in "${plain(it.q).slice(0, 50)}": ${x.slice(0, 60)}`) }));
      strs(u.passages || [], x => { if (BROKENT(x)) add('test bank', `${cell} ${u.id}`, 'broken passage text: ' + x.slice(0, 80)) });
      const groups = [...u.lessons.flatMap((L, i) => [[`lesson ${i + 1} practice`, L.practice], [`lesson ${i + 1} quiz`, L.quiz]]), ['unit test', u.test]];
      for (const [name, items] of groups) { const qs = (items || []).map(it => plain(it.q).toLowerCase());
        qs.forEach((q, i) => { if (!q) add('test bank', `${u.id} ${name}`, `item ${i + 1} has no question`); else if (qs.indexOf(q) !== i) add('test bank', `${u.id} ${name}`, `item ${i + 1} repeats item ${qs.indexOf(q) + 1}: "${q.slice(0, 60)}"`) });
        (items || []).forEach((it, i) => { if (it.t === 'mc' && (it.ch || []).some(c => !String(c).trim())) add('test bank', `${u.id} ${name}`, `item ${i + 1} has an empty choice`) }) }
    }
    return { out, texts, skills: ORDER.length };
  }, { words5, bank });

  // Optional spelling pass over every collected text
  let spell = null;
  if (arg('spell')) {
    let list; try { list = require('an-array-of-english-words') } catch (e) { try { list = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'an-array-of-english-words')) } catch (e2) { list = null } }
    if (!list) console.log('Spelling skipped: run  npm i --no-save an-array-of-english-words@2.0.0  first.');
    else { const W = new Set(list), count = new Map();
      for (const t of res.texts) for (const m of String(t).matchAll(/(?<![\w'])[A-Za-z][a-z']{2,}(?![\w'])/g)) { const w = m[0]; if (/^[A-Z]/.test(w) || w.includes("'")) continue; const l = w.toLowerCase(); if (W.has(l) || W.has(l.replace(/(s|es|ed|ing|ly)$/, ''))) continue; count.set(l, (count.get(l) || 0) + 1) }
      spell = [...count].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])) }
  }

  const by = {}; for (const f of res.out) (by[f.area] = by[f.area] || []).push(f);
  console.log(`Content audit: ${res.skills} skills (120 practice questions each), Next Level, arcade choices and the test bank.\n`);
  for (const [area, fs_] of Object.entries(by)) { console.log(`${area.toUpperCase()} (${fs_.length})`); fs_.slice(0, 200).forEach(f => console.log(`  - ${f.where}: ${f.msg}`)); if (fs_.length > 200) console.log(`  ... and ${fs_.length - 200} more`); console.log('') }
  if (spell) { console.log(`WORDS NOT IN THE WORD LIST (${spell.length}; rarest first, many are names or subject terms)`); console.log('  ' + spell.slice(0, 300).map(([w, n]) => `${w}${n > 1 ? '×' + n : ''}`).join(', ')); console.log('') }
  if (errs.length) console.log('PAGE ERRORS\n  - ' + errs.join('\n  - ') + '\n');
  const out = argv('json'); if (out) fs.writeFileSync(out, JSON.stringify({ findings: res.out, spelling: spell, pageErrors: errs }, null, 1));
  console.log(res.out.length || errs.length ? `${res.out.length} problem(s) found` : 'no problems found');
  await b.close(); process.exit(res.out.length || errs.length ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(2) });
