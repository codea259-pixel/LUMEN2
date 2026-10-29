/* Checks every assessment the site can build, in a real browser: for each unit, every lesson's classwork and quiz and
   the unit test, plus a benchmark for each grade and subject. Each is built, rendered in all three views, scored with
   perfect answers (must get full marks) and turned into a PDF (no text may run off the page).
   Run after python3 tools/build.py:   node tools/validate-assess.cjs [folder to save the PDFs in]   */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), path = require('path'), OUT = process.argv[2];
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '..', 'app.html'));
  await p.waitForFunction(() => typeof AS !== 'undefined' && typeof PDFK !== 'undefined', null, { timeout: 30000 });
  const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'assessments.json'), 'utf8'));
  const r = await p.evaluate(async ({ bank, save }) => {
    AS.bank = bank; AS.vers = []; const probs = [], files = []; let n = 0, items = 0, overflow = 0; const D0 = PDFK.Doc;
    // passage titles in each grade and subject, so a question naming one can be checked against the test it lands in
    const UT = {}, titlesOf = c => { const T = new Set(), walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (typeof o.t === 'string' && typeof o.x === 'string') T.add(o.t.replace(/ \(.*\)$/, '')); Object.values(o).forEach(walk) } }; walk(c); return T };
    for (const c of Object.values(bank.cells)) { const T = titlesOf(c); c.units.forEach(u => UT[u.id] = T) }
    for (const v of bank.versions || []) for (const pk of Object.keys(v.parts)) { const uid = pk.split('|')[0], T = UT[uid] || (UT[uid] = new Set()); titlesOf(v.parts[pk]).forEach(t => T.add(t)) }
    const check = (label, a, u, titles = new Set()) => {
      n++; items += a.items.length;
      if (!a.items.length) probs.push(`${label}: no questions`);
      a.items.forEach((it, i) => { const k = a.key[i] || {};
        if (!it.q || !String(it.q).trim()) probs.push(`${label} #${i + 1}: empty question`);
        if (it.t === 'mc' && !(k.a >= 0 && k.a < it.ch.length)) probs.push(`${label} #${i + 1}: bad key`);
        if (it.t === 'mc' && new Set(it.ch).size !== it.ch.length) probs.push(`${label} #${i + 1}: repeated choices`);
        if (it.p != null && !a.passages[it.p]) probs.push(`${label} #${i + 1}: missing passage`);
        (String(it.q).match(/"[^"]+"/g) || []).map(m => m.slice(1, -1)).filter(t => titles.has(t) && !a.passages.some(P => P.t === t || P.t.startsWith(t + ' ('))).forEach(t => probs.push(`${label} #${i + 1}: asks about the passage "${t}", which this test does not include`));
        if (it.t === 'num' && !numOk(k, String(k.txt))) probs.push(`${label} #${i + 1}: key "${k.txt}" does not grade as correct`);
        ['input', 'key', 'result'].forEach(m => { try { qHtml(it, i, m, { key: k, ans: '1', mark: 0 }) } catch (e) { probs.push(`${label} #${i + 1}: render ${m} failed: ${e.message}`) } }) });
      try { itemsHtml(a.items, a.passages, 'key', i => ({ key: a.key[i] })) } catch (e) { probs.push(`${label}: list render failed ${e.message}`) }
      const ans = Object.fromEntries(a.items.map((it, i) => [i, it.t === 'mc' ? String(a.key[i].a) : it.t === 'num' ? String(a.key[i].txt) : 'x']));
      const pts = Object.fromEntries(a.items.map((it, i) => [i, PTS[it.t] || 1]).filter(([i]) => !AUTO(a.items[i].t)));
      const sc = scoreSub({ items: a.items, key: a.key, subs: [{ uid: 1, answers: ans }], grades: { 1: { pts } } }, 1);
      if (sc.score !== sc.max || sc.pend) probs.push(`${label}: perfect answers scored ${sc.score}/${sc.max}`);
      PDFK.Doc = () => { const d = D0(), t = d.text; d.text = (s, x, y, z, bb, col, al) => { const w = d.w(s, z, bb), x0 = al === 'r' ? x - w : al === 'c' ? x - w / 2 : x;
        if (x0 + w > d.W - 40 || x0 < 30 || y > d.H - 20 || y < 20) { overflow++; if (overflow < 20) probs.push(`${label}: text off page "${String(s).slice(0, 50)}"`) } return t(s, x, y, z, bb, col, al) }; return d };
      let bytes; try { bytes = aPdf(a, u) } catch (e) { probs.push(`${label}: pdf failed ${e.message}`) } finally { PDFK.Doc = D0 }
      if (bytes && save) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); files.push([label.replace(/[^\w-]+/g, '_') + '.pdf', btoa(s)]) } };
    for (const [key, c] of Object.entries(bank.cells)) {
      const [sub, g] = key.split('|');
      for (const u0 of c.units) {
        (u0.skills || []).forEach(k => { if (!SK[k]) probs.push(`${u0.id}: unknown skill ${k}`) });
        const u = unitById(u0.id);
        u0.lessons.forEach((L, li) => ['classwork', 'quiz'].forEach(kind => { try { check(`${u0.id} L${li + 1} ${kind}`, buildA(u0.id, kind, li), u, UT[u0.id]) } catch (e) { probs.push(`${u0.id} L${li + 1} ${kind}: build failed ${e.message}`) } }));
        try { check(`${u0.id} test`, buildA(u0.id, 'test', 0), u, UT[u0.id]) } catch (e) { probs.push(`${u0.id} test: build failed ${e.message}`) }
      }
      try { const nums = c.units.map((_, j) => j + 1).slice(0, 3), a = buildBench(sub, +g, 'Trimester 1', nums, 30); check(`${sub}-${g} benchmark`, a, unitMeta(a.unit), UT[c.units[0].id]) } catch (e) { probs.push(`${key} benchmark: build failed ${e.message}`) }
    }
    // question versions from tools/assess-src/versions (for example each trimester's new set)
    for (const v of bank.versions || []) for (const pk of Object.keys(v.parts)) {
      const [uid, part] = pk.split('|'), m = part.match(/^L(\d+):(quiz|practice)$/), kind = m ? (m[2] === 'quiz' ? 'quiz' : 'classwork') : 'test', li = m ? +m[1] - 1 : 0;
      const label = `version ${v.id} ${uid} ${part}`;
      try { const a = buildA(uid, kind, li, 'f:' + v.id); if (a.ver !== 'f:' + v.id) probs.push(`${label}: the site does not pick this version`); check(label, a, unitById(uid), UT[uid]) } catch (e) { probs.push(`${label}: build failed ${e.message}`) }
    }
    return { probs, files, n, items, overflow };
  }, { bank, save: !!OUT });
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); r.files.forEach(([f, b64]) => fs.writeFileSync(path.join(OUT, f), Buffer.from(b64, 'base64'))) }
  console.log(`built ${r.n} assessments (${r.items} questions), ${r.overflow} text overflows`);
  console.log(r.probs.length ? r.probs.slice(0, 80).join('\n') : 'no problems'); if (errs.length) console.log('page errors:', errs.slice(0, 10));
  process.exitCode = r.probs.length || errs.length ? 1 : 0; await b.close();
})();
