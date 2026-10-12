/* Browser test of the Teacher page and assessments against a running server (npm start).
   Teacher: Assessments (preview, PDF, assign a unit test), Grade guides; student: takes the timed test;
   teacher: Gradebook scoring, release; student: sees the score. Also checks students never receive answer keys. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const B = process.env.LUMEN_URL || 'http://localhost:3922';
const errs = [], ok = s => console.log('✓', s);
const fail = m => { throw new Error(m); };
const SH = process.env.SHOTS, shot = async (pg, n) => { if (SH) await pg.screenshot({ path: `${SH}/${n}.png`, fullPage: true }); };
(async () => {
  const br = await chromium.launch();
  const mk = async () => { const ctx = await br.newContext({ acceptDownloads: true }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|status of (401|403|409)/.test(m.text())) errs.push('console: ' + m.text()) });
    p.on('dialog', d => d.accept()); return p };
  const call = (pg, method, path, body) => pg.evaluate(([m, u, b]) => fetch(u, { method: m, credentials: 'same-origin', headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ s: r.status, j: await r.json().catch(() => null) })), [method, path, body]);
  try {
    const t = await mk(); await t.goto(B + '/app#signup'); await t.waitForSelector('#af');
    const un = 'teach' + Date.now().toString(36).slice(-5);
    await t.selectOption('#ar', 'teacher'); await t.fill('[name=username]', un); await t.fill('[name=display]', 'Mr ' + un.slice(-4)); await t.fill('[name=email]', un + '@school.org'); await t.fill('[name=password]', 'teachpass1');
    await t.click('#af button'); await t.waitForSelector('#avatarBtn'); ok('teacher signed up');
    await t.click('#tabs >> text=Teacher'); await t.waitForSelector('.tt'); ok('Teacher page sections: ' + (await t.$$eval('.tt button', b => b.map(x => x.textContent))).join(', '));
    await t.fill('#cn', 'Room 3'); await t.selectOption('#cg', '3'); await t.click('text=Create class'); await t.waitForSelector('.cls');
    await t.fill('textarea[id^=sn]', 'Ava Stone\nBen Ruiz'); await t.click('text=Create student logins'); await t.waitForSelector('.creds');
    const creds = await t.$$eval('.creds tr', rs => rs.slice(1).map(r => [...r.cells].map(c => c.textContent))); ok('class with 2 student logins');

    // Grade guides
    await t.click('.tt >> text=Grade guides'); await t.waitForSelector('text=Priority standards'); await shot(t, 'guide');
    ok('grade guide: ' + (await t.$$('.vs tr')).length + ' priority standards, units: ' + (await t.$$eval('ol > li > b', b => b.map(x => x.textContent))).join(' | '));

    // Assessments: preview a quiz and a unit test, download the PDF, assign the test
    await t.click('.tt >> text=Assessments'); await t.waitForSelector('[id^=u_]');
    await t.click('#u_math-3-1 button:has-text("Quiz")'); await t.waitForSelector('#u_math-3-1 .items');
    const qn = await t.$$('#u_math-3-1 .items > li'); ok('quiz preview: ' + qn.length + ' questions, header: ' + (await t.textContent('#u_math-3-1 .qz .split .sol')));
    await t.click('#u_math-3-1 button:has-text("Unit test")'); await t.waitForSelector('#u_math-3-1 .items');
    const [dl] = await Promise.all([t.waitForEvent('download'), t.click('#u_math-3-1 button:has-text("Download PDF")')]);
    if (SH) require('fs').copyFileSync(await dl.path(), SH + '/test.pdf'); await shot(t, 'teacher-preview');
    const pdf = require('fs').readFileSync(await dl.path()).toString('latin1');
    if (!pdf.startsWith('%PDF') || !pdf.includes('Answer Key') || !pdf.includes('Performance task rubric')) fail('PDF missing parts');
    ok(`PDF ${dl.suggestedFilename()}: ${pdf.length} bytes, ${(pdf.match(/\/Type\/Page\//g) || []).length} pages, with answer key and rubric`);
    await t.fill('#am_math-3-1', '30'); await t.click('#u_math-3-1 button:has-text("Assign unit test")'); await t.waitForFunction(() => !document.querySelector('#u_math-3-1 .items'));
    ok('unit test assigned to whole class with a 30-minute timer');

    // Student
    const s = await mk(); await s.goto(B + '/app'); await s.fill('[name=username]', creds[0][1]); await s.fill('[name=password]', creds[0][2]); await s.click('#af button'); await s.waitForSelector('#avatarBtn');
    const bank = await call(s, 'GET', '/api/assess/bank'); if (bank.s !== 403) fail('student got the bank: ' + bank.s); ok('student cannot load the answer bank (403)');
    await s.click('#tabs >> text=My classes'); await s.waitForSelector('text=Unit test'); ok('student sees: ' + (await s.textContent('.post .pill')) + ' · ' + (await s.textContent('.post .sol')).slice(0, 60));
    const list = await call(s, 'GET', '/api/classes'); const lt = list.j.joined[0].tests[0];
    if (lt.items || JSON.stringify(list.j).includes('"key"')) fail('questions or key leaked before start'); ok('class list has no questions or keys before starting');
    await s.click('.post button:has-text("Start")'); await s.waitForSelector('#tmr'); await s.waitForFunction(() => /left/.test(document.getElementById('tmr').textContent));
    await shot(s, 'student-test'); ok('test running, timer shows ' + await s.textContent('#tmr'));
    const st = await call(s, 'POST', `/api/tests/${list.j.joined[0].id}/${lt.id}/start`, {}); if (JSON.stringify(st.j).match(/"(key|ans|txt|a)":/)) fail('start leaked a key'); ok('start returns questions without answers');
    // answer: first choice of every multiple choice, "12" for numbers, text for written
    const n = await s.$$eval('.items > li', l => l.length);
    for (let i = 0; i < n; i++) { const li = (await s.$$('.items > li'))[i];
      if (await li.$('input[type=radio]')) await (await li.$$('input[type=radio]'))[0].check();
      else if (await li.$('input[type=text]')) await (await li.$('input[type=text]')).fill('12');
      else await (await li.$('textarea')).fill('I multiplied the rows by the plants in each row and checked with an estimate.'); }
    await s.click('text=Save and finish later'); await s.waitForSelector('.post button:has-text("Continue")'); ok('saved and left; button now says Continue');
    await s.click('.post button:has-text("Continue")'); await s.waitForSelector('.items');
    const kept = await s.$$eval('textarea', a => a.every(x => x.value.length > 10)); if (!kept) fail('answers not kept'); ok('answers kept after leaving');
    await s.click('button:has-text("Turn in")'); await s.waitForSelector('text=Your teacher will share your score'); ok('turned in');
    const again = await call(s, 'PUT', `/api/tests/${list.j.joined[0].id}/${lt.id}/answers`, { answers: { 0: '1' } }); if (again.s !== 409) fail('could change answers after turning in'); ok('cannot change answers after turning in (409)');

    // Another student can't release or change the test
    const o = await mk(); await o.goto(B + '/app'); await o.fill('[name=username]', creds[1][1]); await o.fill('[name=password]', creds[1][2]); await o.click('#af button'); await o.waitForSelector('#avatarBtn');
    const other = await call(o, 'PATCH', `/api/classes/${list.j.joined[0].id}/tests/${lt.id}`, { released: true }); if (other.s !== 403) fail('student could release: ' + other.s); ok('students cannot change or release tests (403)');

    // Teacher scores and releases
    await t.click('.tt >> text=Gradebook'); await t.waitForSelector('.gb');
    ok('gradebook row: ' + (await t.$$eval('.gb tr', r => r.slice(1).map(x => x.textContent.replace(/\s+/g, ' ').trim()))).join(' / '));
    await t.click('button:has-text("Score answers")'); await t.waitForSelector('select[id^=gp_]');
    const sels = await t.$$('select[id^=gp_]'); for (const e of sels) { const opts = await e.$$eval('option', o => o.map(x => x.value)); await e.selectOption(opts[opts.length - 2]); }
    await t.fill('input[id^=gc_]', 'Good strategy. Check your multiplication.'); await t.click('button:has-text("Save scores")'); await t.waitForSelector('text=Scores saved');
    await t.click('button:has-text("Release scores")'); await t.waitForSelector('text=Scores released');
    await shot(t, 'gradebook'); const score = (await t.textContent('.gb tr:nth-child(2)')).replace(/\s+/g, ' '); ok('scored written answers and released: ' + score);

    // Student sees score and results
    await s.click('#tabs >> text=Learn'); await s.click('#tabs >> text=My classes'); await s.waitForSelector('text=Score:');
    ok('student sees ' + await s.textContent('.post b:has-text("Score")')); await s.click('text=See results'); await s.waitForSelector('text=Your teacher says');
    await shot(s, 'student-results'); ok('results page: ' + (await s.$$('.items > li')).length + ' questions with points, comment shown');

    // Owner sets the adopted program; teacher sees it
    const ow = await mk(); await ow.goto(B + '/app'); await ow.fill('[name=username]', 'owner'); await ow.fill('[name=password]', 'ownerpass1234'); await ow.click('#af button'); await ow.waitForSelector('#avatarBtn');
    await ow.click('#tabs >> text=Teacher'); await ow.click('.tt >> text=Grade guides'); await ow.waitForSelector('#prog'); await ow.fill('#prog', 'Test Program, 2nd edition'); await ow.click('button:has-text("Save")'); await ow.waitForSelector('text=Saved.');
    await t.reload(); await t.waitForSelector('#avatarBtn'); await t.click('#tabs >> text=Teacher'); await t.click('.tt >> text=Grade guides'); await t.waitForSelector('text=Test Program, 2nd edition'); ok('owner set adopted program; teacher sees it');
  } catch (e) { console.log('FAIL', e.message); errs.push('fail'); }
  if (errs.length) { console.log('ERRORS:\n' + errs.join('\n')); process.exitCode = 1; } else console.log('all assessment checks passed');
  await br.close();
})();
