/* Browser test of the Teacher page and assessments against a running server (npm start, owner "owner" / "ownerpass1234").
   Owner sets the trimester calendar; a teacher previews lessons and tests, prints a PDF, saves a private version with a
   reading passage, builds a benchmark and assigns work; students take it; the teacher scores and releases; students see
   scores. Also checks that students never receive answer keys or versions, and that private versions stay private. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const B = process.env.LUMEN_URL || 'http://localhost:3922';
const SH = process.env.SHOTS, errs = [], ok = s => console.log('✓', s), fail = m => { throw new Error(m); };
(async () => {
  const br = await chromium.launch();
  const mk = async () => { const ctx = await br.newContext({ acceptDownloads: true }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|status of (401|403|404|409)/.test(m.text())) errs.push('console: ' + m.text()) });
    p.on('dialog', d => d.accept()); return p };
  const shot = async (pg, n) => { if (SH) await pg.screenshot({ path: `${SH}/${n}.png`, fullPage: true }) };
  const call = (pg, method, url, body) => pg.evaluate(([m, u, b]) => fetch(u, { method: m, credentials: 'same-origin', headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ s: r.status, j: await r.json().catch(() => null) })), [method, url, body]);
  const signup = async (role, un) => { const p = await mk(); await p.goto(B + '/app#signup'); await p.waitForSelector('#af'); await p.selectOption('#ar', role);
    await p.fill('[name=username]', un); await p.fill('[name=display]', 'T ' + un.slice(-6)); if (role !== 'student') await p.fill('[name=email]', un + '@school.org'); await p.fill('[name=password]', 'teachpass1');
    await p.click('#af button'); await p.waitForSelector('#avatarBtn'); return p };
  const login = async (u, pw) => { const p = await mk(); await p.goto(B + '/app'); await p.fill('[name=username]', u); await p.fill('[name=password]', pw); await p.click('#af button'); await p.waitForSelector('#avatarBtn'); return p };
  const answerAll = async (pg) => { const n = await pg.$$eval('.items > li', l => l.length);
    for (let i = 0; i < n; i++) { const li = (await pg.$$('.items > li'))[i];
      if (await li.$('input[type=radio]')) await (await li.$$('input[type=radio]'))[0].check();
      else if (await li.$('input[type=text]')) await (await li.$('input[type=text]')).fill('12');
      else await (await li.$('textarea')).fill('Claim: my answer. Evidence: from the problem. Reasoning: because of the pattern.'); } return n };
  try {
    const id = Date.now().toString(36).slice(-5), today = new Date().toISOString().slice(0, 10);
    // Owner: trimester calendar with the current trimester starting today
    const ow = await login('owner', 'ownerpass1234');
    await ow.click('#tabs >> text=Teacher'); await ow.click('.tt >> text=Assessments'); await ow.waitForSelector('.termbar');
    await ow.click('text=Set trimester dates'); await ow.fill('#td0', '2020-08-15'); await ow.fill('#td1', today); await ow.click('text=Save calendar'); await ow.waitForSelector('text=Calendar saved.');
    ok('owner set the trimester calendar: ' + (await ow.textContent('.termbar span')).trim());

    const t = await signup('teacher', 'tch' + id);
    await t.click('#tabs >> text=Teacher'); await t.waitForSelector('.tt'); ok('Teacher page sections: ' + (await t.$$eval('.tt button', b => b.map(x => x.textContent))).join(', '));
    await t.fill('#cn', 'Room 3'); await t.selectOption('#cg', '3'); await t.click('text=Create class'); await t.waitForSelector('.cls');
    await t.fill('textarea[id^=sn]', 'Ava Stone\nBen Ruiz'); await t.click('text=Create student logins'); await t.waitForSelector('.creds');
    const creds = await t.$$eval('.creds tr', rs => rs.slice(1).map(r => [...r.cells].map(c => c.textContent))); ok('class with 2 student logins');

    await t.click('.tt >> text=Grade guides'); await t.waitForSelector('text=Priority standards'); await shot(t, 'guide');
    ok('grade guide units: ' + (await t.$$eval('ol > li > b', b => b.map(x => x.textContent))).slice(0, 3).join(' | '));

    // Assessments: lessons and unit test
    await t.click('.tt >> text=Assessments'); await t.waitForSelector('#u_math-3-1');
    ok('unit 1 shows ' + (await t.$$('#u_math-3-1 .lrow')).length + ' rows (lessons and unit test)');
    await t.click('#u_math-3-1 button:has-text("Lesson quiz")'); await t.waitForSelector('#u_math-3-1 .items');
    ok('lesson quiz preview: ' + (await t.textContent('#u_math-3-1 .qz .split .sol')));
    await t.click('#u_math-3-1 button:has-text("Classwork")'); await t.waitForSelector('#u_math-3-1 .items .sol:has-text("Hint")'); ok('classwork shows hints in the key');
    await t.click('#u_math-3-1 .lrow >> nth=-1 >> button:has-text("Unit test")'); await t.waitForSelector('#u_math-3-1 .items');
    const [dl] = await Promise.all([t.waitForEvent('download'), t.click('#u_math-3-1 button:has-text("Download PDF")')]);
    const pdf = require('fs').readFileSync(await dl.path()).toString('latin1'); if (!pdf.startsWith('%PDF') || !pdf.includes('Answer Key')) fail('PDF missing parts');
    ok(`unit test PDF ${dl.suggestedFilename()}: ${(pdf.match(/\/Type\/Page\//g) || []).length} pages`); await shot(t, 'teacher-preview');
    await t.fill('#am_math-3-1', '30'); await t.click('#u_math-3-1 button:has-text("Assign unit test")'); await t.waitForSelector('text=Unit test assigned');
    ok('unit test assigned with a 30-minute timer');

    // Copy and edit: a private version of lesson 1's quiz, with a reading passage, for the current trimester
    await t.click('#u_math-3-1 button:has-text("Lesson quiz")'); await t.waitForSelector('#u_math-3-1 .items');
    await t.click('#u_math-3-1 button:has-text("Copy and edit")'); await t.waitForSelector('.ed');
    await t.fill('#ed_name', 'Room 3 quiz A');
    await t.click('.ed button:has-text("Add a passage")'); await t.fill('.ed .edp input', 'The Bake Sale'); await t.fill('.ed .edp textarea', 'Rosa baked 4 trays of 6 muffins. // She sold all of them.');
    await t.click('.ed button:has-text("+ Number answer")');
    const items = await t.$$('.ed .edi'), last = items[items.length - 1];
    await (await last.$('textarea')).fill('How many muffins did Rosa bake?'); await (await last.$('input[placeholder^="Answer"]')).fill('24');
    await (await last.$('select[aria-label=Passage]')).selectOption('0');
    await (await (await t.$$('.ed .edi'))[0].$('textarea')).fill('EDITED: Which equation matches 5 groups of 3?');
    await t.click('.ed button:has-text("Save version")'); await t.waitForSelector('text=Version saved.'); await t.waitForSelector('#u_math-3-1 .psg');
    ok('saved a version with a passage: ' + (await t.$eval('#u_math-3-1 .qz select', s => s.selectedOptions[0].textContent)));
    await shot(t, 'version');
    await t.click('#u_math-3-1 button:has-text("Assign lesson quiz")'); await t.waitForSelector('text=Lesson quiz assigned'); ok('version assigned');

    // the version opens first for the current trimester after a reload
    await t.reload(); await t.waitForSelector('#avatarBtn'); await t.click('#tabs >> text=Teacher'); await t.click('.tt >> text=Assessments');
    await t.click('#u_math-3-1 button:has-text("Lesson quiz")'); await t.waitForSelector('#u_math-3-1 .items');
    const sel = await t.$eval('#u_math-3-1 .qz select', s => s.selectedOptions[0].textContent); if (!/Room 3 quiz A/.test(sel)) fail('current-trimester version not chosen first: ' + sel);
    ok('version for the current trimester opens first');

    // Benchmark
    await t.click('#bench button:has-text("Build benchmark")'); await t.waitForSelector('#bench .items');
    ok('benchmark built: ' + (await t.textContent('#bench .qz .split .sol')));
    await t.fill('#am_bench', '0'); await t.click('#bench button:has-text("Assign benchmark")'); await t.waitForSelector('text=Benchmark assigned'); ok('benchmark assigned');

    // A second teacher does not see the private version; the owner does
    const t2 = await signup('teacher', 'tcb' + id);
    const v2 = await call(t2, 'GET', '/api/assess/versions'); if (v2.s !== 200 || v2.j.versions.some(v => v.name === 'Room 3 quiz A')) fail('private version visible to another teacher');
    const vo = await call(ow, 'GET', '/api/assess/versions'); if (!vo.j.versions.some(v => v.name === 'Room 3 quiz A')) fail('owner cannot see the version');
    ok('private version: hidden from other teachers, visible to the owner');

    // Student
    const s = await login(creds[0][1], creds[0][2]);
    const bank = await call(s, 'GET', '/api/assess/bank'), sv = await call(s, 'GET', '/api/assess/versions');
    if (bank.s !== 403 || sv.s !== 403) fail(`student got bank ${bank.s} or versions ${sv.s}`); ok('students cannot load the bank or versions (403)');
    await s.click('#tabs >> text=My classes'); await s.waitForSelector('text=Benchmark');
    ok('student sees: ' + (await s.$$eval('.post .pill', p => p.map(x => x.textContent))).join(', '));
    const list = await call(s, 'GET', '/api/classes'); const cid = list.j.joined[0].id;
    if (JSON.stringify(list.j).match(/"(key|items)"/)) fail('questions or key leaked before start'); ok('class list has no questions or keys');
    await s.locator('.post > div', { hasText: 'Room 3 quiz A' }).locator('button:has-text("Start")').click(); await s.waitForSelector('.items');
    if (!await s.$('.psg')) fail('passage not shown to the student');
    ok('student sees the passage "' + (await s.textContent('.psg h4')) + '" in the quiz'); await shot(s, 'student-quiz');
    await answerAll(s); await s.fill('.items > li:last-child input[type=text]', '$24 muffins'); await s.click('button:has-text("Turn in")'); await s.waitForSelector('text=Your teacher will share your score');
    await s.locator('.post > div', { hasText: 'Unit test' }).locator('button:has-text("Start")').click(); await s.waitForSelector('#tmr'); await s.waitForFunction(() => /left/.test(document.getElementById('tmr').textContent));
    const tid = list.j.joined[0].tests.find(x => x.kind === 'test').id, st = await call(s, 'POST', `/api/tests/${cid}/${tid}/start`, {});
    if (JSON.stringify(st.j).match(/"(key|ans|txt|a)":/)) fail('start leaked a key'); ok('unit test running, timer ' + await s.textContent('#tmr') + ', no answers sent');
    await answerAll(s); await s.click('text=Save and finish later'); await s.waitForSelector('.post button:has-text("Continue")'); await s.click('.post button:has-text("Continue")'); await s.waitForSelector('.items');
    if (!await s.$$eval('textarea', a => a.every(x => x.value.length > 10))) fail('answers not kept'); await s.click('button:has-text("Turn in")'); await s.waitForSelector('text=Your teacher will share your score');
    ok('unit test saved, resumed and turned in');
    const again = await call(s, 'PUT', `/api/tests/${cid}/${tid}/answers`, { answers: { 0: '1' } }); if (again.s !== 409) fail('could change answers after turning in'); ok('cannot change answers after turning in (409)');
    const other = await call(s, 'PATCH', `/api/classes/${cid}/tests/${tid}`, { released: true }); if (other.s !== 403) fail('student could release'); ok('students cannot release tests (403)');

    // Teacher scores and releases the version quiz
    await t.click('.tt >> text=Gradebook'); await t.waitForSelector('.gb'); await shot(t, 'gradebook');
    ok('gradebook: ' + (await t.$$eval('.gb tr', r => r.slice(1).map(x => x.textContent.replace(/\s+/g, ' ').trim()))).join(' / '));
    await t.locator('.card', { hasText: 'Room 3 quiz A' }).last().locator('button:has-text("Score answers")').click(); await t.waitForSelector('select[id^=gp_]');
    for (const e of await t.$$('select[id^=gp_]')) { const o = await e.$$eval('option', x => x.map(y => y.value)); await e.selectOption(o[o.length - 1]); }
    await t.fill('input[id^=gc_]', 'Nice work on the bake sale problem.'); await t.click('button:has-text("Save scores")'); await t.waitForSelector('text=Scores saved');
    await t.locator('.card', { hasText: 'Room 3 quiz A' }).last().locator('button:has-text("Release scores")').click(); await t.waitForSelector('text=Scores released');
    ok('scored and released the quiz');
    await s.click('#tabs >> text=Learn'); await s.click('#tabs >> text=My classes'); await s.waitForSelector('text=Score:');
    ok('student sees ' + await s.textContent('.post b:has-text("Score")') + ' ("$24 muffins" counted as 24)');
    await s.click('text=See results'); await s.waitForSelector('text=Your teacher says'); await shot(s, 'student-results'); ok('results with comment');
  } catch (e) { console.log('FAIL', e.message); errs.push('fail'); }
  if (errs.length) { console.log('ERRORS:\n' + errs.join('\n')); process.exitCode = 1; } else console.log('all assessment checks passed');
  await br.close();
})();
