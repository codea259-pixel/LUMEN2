const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const B = process.env.LUMEN_URL || 'http://localhost:3922';
const errs = [];
(async () => {
  const br = await chromium.launch();
  const mk = async () => { const ctx = await br.newContext(); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push('console: ' + m.text()) });
    p.on('dialog', d => d.accept()); return p };
  const step = (s) => console.log('✓', s);
  const menu = async (pg, label) => { await pg.click('#avatarBtn'); await pg.click(`#pmenu button:has-text("${label}")`); };

  // Landing page links to the app
  let p = await mk(); await p.goto(B + '/'); await p.click('nav a.btn'); await p.waitForSelector('#af'); step('landing → sign-in page');

  // Teacher signs up
  await p.click('#sw'); await p.selectOption('#ar', 'teacher');
  await p.fill('[name=username]', 'msalvarez'); await p.fill('[name=display]', 'Ms Alvarez'); await p.fill('[name=email]', 'a@school.org'); await p.fill('[name=password]', 'teachpass1');
  await p.click('#af button'); await p.waitForSelector('#avatarBtn'); step('teacher signed up: ' + (await p.textContent('.hello h1')).trim());
  await p.click('#tabs >> text=Teacher'); await p.fill('#cn', 'Room 5'); await p.click('text=Create class'); await p.waitForSelector('.cls');
  const code = (await p.textContent('.cls .split span b')).trim(); step('class created, code ' + code);
  await p.fill('textarea[id^=sn]', 'Maya Lopez\nJaylen Ford'); await p.click('text=Create student logins'); await p.waitForSelector('.creds');
  const creds = await p.$$eval('.creds tr', rs => rs.slice(1).map(r => [...r.cells].map(c => c.textContent)));
  step('student logins: ' + JSON.stringify(creds));
  await p.selectOption('select[id^=as]', { index: 0 }); const asg = await p.$eval('select[id^=as]', s => s.selectedOptions[0].textContent); await p.click('.cls button:has-text("Assign")'); await p.waitForTimeout(500);
  step('assigned ' + asg);

  // Student signs in with teacher-made login and practices
  const s = await mk(); await s.goto(B + '/app'); await s.fill('[name=username]', creds[0][1]); await s.fill('[name=password]', creds[0][2]); await s.click('#af button');
  await s.waitForSelector('#avatarBtn'); step('student signed in');
  await s.click('#tabs >> text=My classes'); await s.waitForSelector('text=Room 5'); step('student sees class + assignment: ' + (await s.textContent('#views h4')));
  await s.click('#views .card.post .row button'); await s.waitForSelector('.info');
  const skill = await s.textContent('#panel h2'); await s.click('.info button.go');
  let answered = 0;
  for (let i = 0; i < 12; i++) {
    await s.waitForSelector('#ans, .mc');
    const right = i % 2 === 0; const a = await s.evaluate(() => cur.q.a);
    if (await s.$('.mc')) { await s.click(`.mc .opt >> nth=${right ? a[0] : (a[0] + 1) % 4}`); } else { await s.fill('#ans', right ? (a[1] == 1 ? '' + a[0] : a[0] + '/' + a[1]) : '9999'); }
    await s.click('#panel button:has-text("Check")'); answered++;
    if (await s.$('#panel button:has-text("Check")')) { if (await s.$('.mc')) await s.click('.mc .opt >> nth=1'); else await s.fill('#ans', '2'); await s.click('#panel button:has-text("Check")'); }
    const nx = await s.$('#panel button:has-text("Next")'); if (nx) await nx.click();
    if (await s.$('text=Practice again')) await s.click('text=Practice again');
  }
  step(`student answered ${answered} questions on "${skill}"`);
  await s.waitForTimeout(1800);
  const st = await s.evaluate(() => fetch('/api/state').then(r => r.json()));
  const att = Object.values(st.S).reduce((a, x) => a + (x.att || 0), 0); step(`server saved progress: ${att} attempts, gems ${st.gems}, days ${st.days}`);
  await s.reload(); await s.waitForSelector('#avatarBtn'); const att2 = await s.evaluate(() => ORDER.reduce((a, k) => a + S[k].att, 0)); step('progress survives reload: ' + att2);

  // Badge from server
  await menu(s, 'Certificates'); await s.fill('#fn', 'Maya Lopez'); await s.click('#views button:has-text("Save")');
  const claimBtn = await s.$('.badges button:has-text("Claim")'); if (claimBtn) { await claimBtn.click(); await s.waitForSelector('.cert'); }
  const cid = await s.$eval('.cert b', b => b.textContent).catch(() => null); step('badge issued: ' + cid);
  if (cid) { const v = await (await fetch(B + '/c/' + cid)).text(); step('public verify page: ' + (/Verified/.test(v) ? 'valid' : 'MISSING')); }

  // Community post
  await s.click('#tabs >> text=Community'); await s.fill('#pt', 'How do I add fractions?'); await s.fill('#pb', 'I keep adding the bottoms too.'); await s.click('#views button:has-text("Post")');
  await s.waitForSelector('text=How do I add fractions?'); step('student posted a question');

  // Teacher sees progress
  await p.reload(); await p.waitForSelector('#avatarBtn'); await p.click('#tabs >> text=Teacher'); await p.waitForSelector('.cls table');
  const row = await p.$$eval('.cls table tr', rs => rs.slice(1).map(r => r.innerText.replace(/\s+/g, ' ').slice(0, 90)));
  step('teacher table: ' + JSON.stringify(row));

  // Owner
  const o = await mk(); await o.goto(B + '/app'); await o.fill('[name=username]', 'owner'); await o.fill('[name=password]', 'ownerpass1234'); await o.click('#af button');
  await o.waitForSelector('#avatarBtn'); await menu(o, 'Owner console'); await o.waitForSelector('.vs'); step('owner sees users: ' + (await o.$$('.vs tr')).length + ' rows');
  await o.click('button:has-text("Verify teacher")'); await o.waitForSelector('text=Unverify'); step('owner verified teacher');
  await menu(o, 'Impact'); await o.waitForSelector('.stats'); step('impact: ' + (await o.textContent('.stats')).replace(/\s+/g, ' '));
  await o.click('#tabs >> text=Learn'); await o.waitForSelector('#map .node', { state: 'attached' }); step('map nodes: ' + (await o.$$('#map .node')).length);

  // Owner can't be self-promoted; wrong password rejected
  const bad = await mk(); await bad.goto(B + '/app'); await bad.fill('[name=username]', 'owner'); await bad.fill('[name=password]', 'nope'); await bad.click('#af button');
  await bad.waitForFunction(() => document.getElementById('ae').textContent); step('bad login: ' + await bad.textContent('#ae'));

  await br.close();
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no browser errors');
})().catch(async e => { console.error('FAIL', e.message); console.log(errs.join('\n')); process.exit(1) });
