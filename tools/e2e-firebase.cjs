/* Browser test of Firebase mode against the local Firebase emulators.
   The emulator must load firestore.rules with PASTE_OWNER_GMAIL replaced by owner@gmail.com, for example:
     sed s/PASTE_OWNER_GMAIL/owner@gmail.com/ firestore.rules > test.rules   (and point firebase.json at test.rules)
     npx firebase emulators:exec --project demo-bose "node tools/e2e-firebase.cjs"
   Needs firebase-tools, playwright and the firebase npm package; FIREBASE_SDK_DIR points at node_modules/firebase. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..'), SDK = process.env.FIREBASE_SDK_DIR;
const PORT = 8079, B = `http://localhost:${PORT}/LUMEN2/`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const srv = http.createServer((q, r) => { // plain static host, like GitHub Pages
  const u = decodeURIComponent(q.url.split('?')[0]); if (!u.startsWith('/LUMEN2/')) { r.writeHead(404); return r.end() }
  let f = path.join(ROOT, u.slice(8) || 'index.html'); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('nf') }
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
}).listen(PORT);
const errs = [], ok = s => console.log('✓', s);

(async () => {
  const b = await chromium.launch();
  const page = async (google) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }), p = await ctx.newPage();
    await ctx.route('**/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.FIREBASE_CONFIG={apiKey:'demo-key',authDomain:'localhost',projectId:'demo-bose'};window.FIREBASE_EMULATOR=true;${google ? 'window.FIREBASE_TEST_GOOGLE=' + JSON.stringify(google) + ';' : ''}` }));
    await ctx.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, path.basename(new URL(r.request().url()).pathname))) }));
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p;
  };
  const signup = async (p, role, user, display, email) => {
    await p.goto(B + 'app.html#signup'); await p.waitForSelector('#af'); await p.selectOption('#ar', role);
    await p.fill('[name=username]', user); await p.fill('[name=display]', display); if (email) await p.fill('[name=email]', email);
    await p.fill('[name=password]', 'password123');
    await p.click('#af button'); await p.waitForSelector('#avatarBtn', { timeout: 20000 });
  };
  const login = async (p, user, pw) => { await p.goto(B + 'app.html'); await p.waitForSelector('#af'); await p.fill('[name=username]', user); await p.fill('[name=password]', pw); await p.click('#af button'); };
  const menu = async (p, label) => { await p.click('#avatarBtn'); await p.click(`#pmenu button:has-text("${label}")`); };

  // 1. Owner signs in with Google (the Gmail named in the rules) and finishes setup
  const googleIn = async (p, display) => { await p.goto(B + 'app.html'); await p.waitForSelector('#gsi'); await p.click('#gsi'); await p.waitForSelector('#ar', { timeout: 20000 });
    await p.selectOption('#ar', 'teacher'); await p.fill('[name=display]', display); await p.click('#af button'); await p.waitForSelector('#avatarBtn', { timeout: 20000 }) };
  const o = await page({ sub: 'owner-google-1', email: 'owner@gmail.com', email_verified: true }); await googleIn(o, 'Gourab'); ok('owner signed in with Google');
  const ownerId = await o.evaluate(() => FBM.uid());
  await o.click('#avatarBtn');
  ok('owner menu: ' + (await o.textContent('#pmenu')).replace(/\s+/g, ' ').slice(0, 120)); await o.keyboard.press('Escape');
  const x = await page({ sub: 'other-google-2', email: 'someone.else@gmail.com', email_verified: true }); await googleIn(x, 'Other');
  ok('a different Google account is ' + (await x.evaluate(() => BOOT.role)) + ', owner console visible: ' + !!(await x.$('#pmenu button:has-text("Owner console")')));

  // 2. Teacher: class, student logins, assignment
  const t = await page(); await signup(t, 'teacher', 'msalvarez', 'Ms Alvarez', 'a@school.org');
  await t.click('#tabs >> text=Teacher'); await t.fill('#cn', 'Room 5'); await t.click('text=Create class'); await t.waitForSelector('.cls', { timeout: 15000 });
  const code = (await t.textContent('.cls .split span b')).trim(); ok('class created, code ' + code);
  await t.fill('textarea[id^=sn]', 'Maya Lopez\nJaylen Ford'); await t.click('text=Create student logins'); await t.waitForSelector('.creds', { timeout: 20000 });
  const creds = await t.$$eval('.creds tr', rs => rs.slice(1).map(r => [...r.cells].map(c => c.textContent))); ok('student logins: ' + JSON.stringify(creds));
  ok('teacher still signed in as: ' + (await t.evaluate(() => FBM.uid())).slice(0, 6) + '… (' + (await t.evaluate(() => ME.display)) + ')');
  await t.selectOption('select[id^=as]', { index: 0 }); await t.click('.cls button:has-text("Assign")'); await t.waitForTimeout(1500); ok('assigned');

  // 3. Student made by the teacher: sees assignment, practices, progress saves
  const s = await page(); await login(s, creds[0][1], creds[0][2]); await s.waitForSelector('#avatarBtn', { timeout: 20000 }); ok('student signed in');
  await s.click('#tabs >> text=My classes'); await s.waitForSelector('text=Room 5', { timeout: 15000 }); ok('student sees: ' + (await s.textContent('#views h4')));
  await s.click('#views .card.post .row button'); await s.waitForSelector('.info'); await s.click('.info button.go');
  for (let i = 0, sets = 0; i < 40 && sets < 2; i++) {
    if (await s.$('.celebrate')) { sets++; if (sets < 2) await s.click('#panel button:has-text("Practice again")'); continue }
    if (await s.evaluate(() => cur.done)) { await s.click('#panel button:has-text("Next")'); continue }
    if (await s.$('.mc')) { const a = await s.evaluate(() => cur.q.a[0]); await s.click(`.mc .opt >> nth=${a}`) } else await s.fill('#ans', await s.evaluate(() => cur.q.a[1] == 1 ? '' + cur.q.a[0] : cur.q.a[0] + '/' + cur.q.a[1]));
    await s.click('#panel button:has-text("Check")');
  }
  await s.waitForTimeout(4500); await s.reload(); await s.waitForSelector('#avatarBtn');
  ok('progress after reload: ' + await s.evaluate(() => ORDER.reduce((a, k) => a + S[k].att, 0)) + ' answers, ' + await s.evaluate(() => BOOT.state.xp) + ' XP');

  // 4. Security: the student tries things the rules must block
  const attacks = await s.evaluate(async () => {
    const db = firebase.app().firestore(), uid = FBM.uid(), out = {};
    const tryIt = async (k, fn) => { try { await fn(); out[k] = 'ALLOWED' } catch (e) { out[k] = 'blocked' } };
    await tryIt('make self teacher', () => db.collection('users').doc(uid).update({ role: 'teacher' }));
    await tryIt('verify self', () => db.collection('users').doc(uid).update({ verified: true }));
    await tryIt('claim the site', () => db.collection('config').doc('site').set({ ownerUid: uid }, { merge: true }));
    await tryIt('read all users', () => db.collection('users').get());
    await tryIt('read owner progress', async () => { const d = await db.collection('state').doc(window.__OWNER).get(); if (!d.exists) throw 0 });
    await tryIt('fake a post by someone else', () => db.collection('posts').add({ authorId: 'x', authorName: 'x', title: 'hello there', body: 'hello there everyone', hidden: false, pinned: false, locked: false, votes: [], reports: [], ts: 1 }));
    await tryIt('pin a post', async () => { const q = await db.collection('posts').where('hidden', '==', false).limit(1).get(); if (q.empty) throw 0; await q.docs[0].ref.update({ pinned: true }) });
    return out;
  }).catch(e => ({ error: e.message }));
  await s.evaluate(id => { window.__OWNER = id }, ownerId);
  const a2 = await s.evaluate(async () => { const db = firebase.app().firestore(); try { const d = await db.collection('state').doc(window.__OWNER).get(); return d.exists ? 'ALLOWED' : 'blocked' } catch (e) { return 'blocked' } });
  attacks['read owner progress'] = a2; ok('student attacks: ' + JSON.stringify(attacks));

  // 5. Teacher sees the progress
  await t.reload(); await t.waitForSelector('#avatarBtn'); await t.click('#tabs >> text=Teacher'); await t.waitForSelector('.cls table', { timeout: 15000 });
  ok('teacher table: ' + JSON.stringify(await t.$$eval('.cls table tr', rs => rs.slice(1).map(r => r.innerText.replace(/\s+/g, ' ').replace(/ PK K 1 2 3 4 5 6 7 8 9 10 11 12 College/, '').slice(0, 60)))));

  // 6. A 13+ learner joins by code, posts; the other student votes
  const l = await page(); await signup(l, 'student', 'priya16', 'Priya'); await l.click('#tabs >> text=My classes'); await l.fill('#jc', code); await l.click('#views button:has-text("Join")'); await l.waitForSelector('text=Room 5', { timeout: 15000 }).catch(async e => { throw new Error('join failed, toast: ' + await l.textContent('#toast')) }); ok('learner joined by code');
  await l.click('#tabs >> text=Community'); await l.fill('#pt', 'How do I add fractions?'); await l.fill('#pb', 'I keep adding the bottoms too.'); await l.click('#views button:has-text("Post")');
  await l.waitForSelector('text=How do I add fractions?', { timeout: 15000 }); ok('learner posted');
  await s.click('#tabs >> text=Community'); await s.waitForSelector('text=How do I add fractions?', { timeout: 15000 }); await s.click('.card.post button[aria-label=Upvote]'); await s.waitForSelector('.card.post button[aria-label=Upvote].on', { timeout: 10000 }); ok('student upvoted');

  // 6b. A learner under 13 signs up with a parent's permission: progress saves, Community is read-only
  const k = await page(); await k.goto(B + 'app.html#signup'); await k.waitForSelector('#af'); await k.selectOption('#ar', 'student');
  await k.fill('[name=username]', 'maya7'); await k.fill('[name=display]', 'Maya7'); await k.fill('[name=password]', 'password123'); await k.check('[name=age][value=under13]');
  await k.click('#af button'); ok('under-13 without parent details: ' + (await k.evaluate(() => document.querySelector('[name=parentEmail]').validity.valueMissing ? 'blocked by the form' : 'not blocked')));
  await k.fill('[name=parentEmail]', 'parent@example.com'); await k.check('[name=parentOk]'); await k.click('#af button'); await k.waitForSelector('#avatarBtn', { timeout: 20000 }); ok('under-13 learner signed up with parent permission');
  await k.click('#tabs >> text=Community'); await k.waitForSelector('text=Reading only for now', { timeout: 15000 }); ok('under-13 sees read-only Community, reply boxes: ' + (await k.$$('input[id^=pr]')).length);
  ok('under-13 posting straight to the database: ' + await k.evaluate(async () => { try { await firebase.app().firestore().collection('posts').add({ authorId: FBM.uid(), authorName: 'x', title: 'hello there', body: 'hello there everyone', hidden: false, pinned: false, locked: false, votes: [], reports: [], ts: 1 }); return 'ALLOWED' } catch (e) { return 'blocked' } }));

  // 7. Owner console: verify the teacher, lock an account
  await menu(o, 'Owner console'); await o.waitForSelector('.vs', { timeout: 15000 }); ok('owner sees ' + ((await o.$$('.vs tr')).length - 1) + ' users');
  await o.click('tr:has-text("Ms Alvarez") button:has-text("Verify teacher")'); await o.waitForSelector('tr:has-text("Ms Alvarez") >> text=Unverify', { timeout: 10000 }); ok('owner verified the teacher');
  await o.click('tr:has-text("Jaylen") button:has-text("Lock")'); await o.waitForSelector('tr:has-text("Jaylen") >> text=Unlock', { timeout: 10000 });
  const j = await page(); await login(j, creds[1][1], creds[1][2]); await j.waitForFunction(() => document.getElementById('ae') && document.getElementById('ae').textContent, null, { timeout: 15000 }); ok('locked student: ' + await j.textContent('#ae'));

  // 8. Verified teacher can moderate
  await t.reload(); await t.waitForSelector('#avatarBtn'); await t.click('#tabs >> text=Community'); await t.waitForSelector('text=How do I add fractions?', { timeout: 15000 }); await t.click('.card.post button:has-text("Pin")'); await t.waitForSelector('.card.post button:has-text("Unpin")', { timeout: 10000 }); ok('verified teacher pinned the post');

  // 9. Badge and public verification
  await menu(s, 'Certificates'); await s.fill('#fn', 'Maya Lopez'); await s.click('#views button:has-text("Save")'); const cl = await s.$('.badges button:has-text("Claim")');
  if (cl) { await cl.click(); await s.waitForSelector('.cert', { timeout: 15000 }) } const cid = await s.$eval('.cert b', x => x.textContent).catch(() => null); ok('badge issued: ' + cid);
  const v = await page(); await v.goto(B + 'app.html#verify=' + cid); await v.waitForSelector('.auth .card', { timeout: 15000 }); ok('public verify page: ' + (await v.textContent('.auth .card')).replace(/\s+/g, ' ').slice(0, 90));

  // 10. Wrong password
  const w = await page(); await login(w, 'gourab', 'nope-nope'); await w.waitForFunction(() => document.getElementById('ae').textContent, null, { timeout: 15000 }); ok('bad login: ' + await w.textContent('#ae'));

  await b.close(); srv.close();
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
})().catch(e => { console.error('FAIL', e.message); console.log(errs.join('\n')); process.exit(1) });
