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
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(() => { window.NO_FREE_DAY = true }); const p = await ctx.newPage();
    await ctx.route('**/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.FIREBASE_CONFIG={apiKey:'demo-key',authDomain:'localhost',projectId:'demo-bose'};window.FIREBASE_EMULATOR=true;${google ? 'window.FIREBASE_TEST_GOOGLE=' + JSON.stringify(google) + ';' : ''}` }));
    await ctx.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(SDK, path.basename(new URL(r.request().url()).pathname))) }));
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p;
  };
  const signup = async (p, role, user, display, email) => {
    await p.goto(B + 'app.html#signup'); await p.waitForSelector('#af'); await p.selectOption('#ar', role);
    await p.fill('[name=username]', user); await p.fill('[name=display]', display); if (email) await p.fill('[name=email]', email); if (role === 'student') await p.check('[name=age][value="13plus"]');
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

  // 5b. Assessments: teacher assigns a Grade 3 math quiz; the student takes it; rules keep keys and scores safe
  await t.click('.tt >> text=Assessments'); await t.waitForSelector('.gsel select'); await t.selectOption('.gsel select >> nth=0', '3'); await t.waitForSelector('#u_math-3-1');
  await t.click('#u_math-3-1 button:has-text("Lesson quiz")'); await t.waitForSelector('#u_math-3-1 .items');
  await t.click('#u_math-3-1 button:has-text("Copy and edit")'); await t.waitForSelector('.ed'); await t.fill('#ed_name', 'Firebase version');
  await (await (await t.$$('.ed .edi'))[0].$('textarea')).fill('EDITED in Firebase: which equation matches 5 groups of 3?');
  await t.click('.ed button:has-text("Save version")'); await t.waitForSelector('text=Version saved.', { timeout: 15000 }); ok('teacher saved a question version (Firebase)');
  await t.fill('#am_math-3-1', '0'); await t.click('#u_math-3-1 button:has-text("Assign lesson quiz")'); await t.waitForSelector('text=Lesson quiz assigned', { timeout: 15000 }); ok('version quiz assigned (Firebase)');
  await s.click('#tabs >> text=Learn'); await s.click('#tabs >> text=My classes'); await s.waitForSelector('.post button:has-text("Start")', { timeout: 15000 }); await s.click('.post button:has-text("Start")'); await s.waitForSelector('.items');
  const nq = await s.$$eval('.items > li', l => l.length);
  for (let i = 0; i < nq; i++) { const li = (await s.$$('.items > li'))[i];
    if (await li.$('input[type=radio]')) await (await li.$$('input[type=radio]'))[0].check(); else if (await li.$('input[type=text]')) await (await li.$('input[type=text]')).fill('7'); else await (await li.$('textarea')).fill('Because 5 x 7 = 35 and one more 7 is 42.'); }
  await s.click('button:has-text("Turn in")'); await s.waitForSelector('text=Your teacher will share your score', { timeout: 15000 }); ok('student took and turned in the quiz (Firebase)');
  const qa = await s.evaluate(async () => { const db = firebase.app().firestore(), uid = FBM.uid(), out = {};
    const cs = await db.collection('classes').where('members', 'array-contains', uid).get(), c = cs.docs[0], ts = await c.ref.collection('tests').get(), tr = ts.docs[0].ref;
    const tryIt = async (k, fn) => { try { await fn(); out[k] = 'ALLOWED' } catch (e) { out[k] = 'blocked' } };
    await tryIt('read the answer key', async () => { const d = await tr.collection('key').doc('k').get(); if (!d.exists) throw 0 });
    await tryIt('give self a score', () => tr.collection('subs').doc(uid).update({ result: '{"score":99,"max":9}' }));
    await tryIt('change answers after turning in', () => tr.collection('subs').doc(uid).update({ answers: '{}' }));
    await tryIt('un-submit', () => tr.collection('subs').doc(uid).update({ submitted: 0 }));
    await tryIt('release scores', () => tr.update({ released: true }));
    await tryIt('read all answers', () => tr.collection('subs').get());
    await tryIt('read teachers\' versions', async () => { const q = await db.collection('qvers').where('shared', '==', true).get(); const q2 = await db.collection('qvers').get(); if (q.empty && q2.empty) throw 0 });
    await tryIt('write a version', () => db.collection('qvers').add({ ownerId: uid, json: '{}', shared: true }));
    return out; }).catch(e => ({ error: e.message }));
  ok('student attacks on assessments: ' + JSON.stringify(qa)); if (Object.values(qa).some(v => v !== 'blocked')) errs.push('assessment rule allowed an attack');
  await t.click('.tt >> text=Gradebook'); await t.waitForSelector('.gb', { timeout: 15000 }); await t.click('button:has-text("Score answers")'); await t.waitForSelector('select[id^=gp_]');
  for (const e of await t.$$('select[id^=gp_]')) await e.selectOption('2'); await t.click('button:has-text("Save scores")'); await t.waitForSelector('text=Scores saved', { timeout: 15000 });
  await t.click('button:has-text("Release scores")'); await t.waitForSelector('text=Scores released', { timeout: 15000 }); await t.waitForFunction(() => /\d+\/\d+/.test(document.querySelector('.gb tr:nth-child(2)').textContent), null, { timeout: 15000 }); ok('teacher scored and released: ' + (await t.textContent('.gb tr:nth-child(2)')).replace(/\s+/g, ' '));
  await s.click('#tabs >> text=Learn'); await s.click('#tabs >> text=My classes'); await s.waitForSelector('text=Score:', { timeout: 15000 }); ok('student sees ' + await s.textContent('.post b:has-text("Score")'));

  // 5c. Game: play-time settings, teams, bonus gems, the weekly leaderboard; rules keep rows and gifts safe
  await o.evaluate(() => api('PUT', '/api/owner/settings', { game: { base: 4, per: 5, max: 25 } }));
  await s.reload(); await s.waitForSelector('#avatarBtn', { timeout: 20000 });
  if ((await s.evaluate(() => api('GET', '/api/settings'))).game.base !== 4) errs.push('play time setting not saved (Firebase)'); else ok('owner play time saved (Firebase)');
  await s.evaluate(async () => { addXP(120, 'test'); clearTimeout(_syncT); _syncT = null; await api('PUT', '/api/state', stateBody()) });
  await t.click('.tt >> text=Classes'); await t.waitForSelector('.gblock', { timeout: 15000 }); await t.selectOption('[id^=tn]', '2'); await t.click('text=Make teams'); await t.waitForSelector('.race', { timeout: 15000 });
  const sid0 = await t.evaluate(() => ST.classes[0].students[0].uid); await t.selectOption('[id^=awt]', String(sid0)); await t.selectOption('[id^=awg]', '5'); await t.click('text=Give gems'); await t.waitForSelector('text=Gave 5 gems', { timeout: 15000 });
  ok('teacher made teams and gave 5 bonus gems (Firebase): ' + JSON.stringify(await t.$$eval('.gblock table tr', r => r.slice(1).map(x => x.innerText.replace(/\s+/g, ' ').slice(0, 50)))));
  const g0 = await s.evaluate(() => GEMS()); await s.click('#tabs >> text=Learn'); await s.click('#tabs >> text=My classes'); await s.waitForSelector('.lb', { timeout: 15000 });
  await s.waitForFunction(g => GEMS() === g + 5, g0, { timeout: 15000 }); ok('student collected the bonus gems once and sees: ' + (await s.$$eval('.lb li', l => l.map(x => x.innerText.replace(/\s+/g, ' ')).join(' | '))));
  // Classroom mode: the teacher's Arcade settings reach the student; a student can't change them
  { const cid = await t.evaluate(() => ST.classes[0].id); await t.evaluate(id => api('PATCH', `/api/classes/${id}/game`, { arc: { off: false, mins: 5, games: ['kart', 'blocks', 'Bad Id!'], sub: 'math' } }), cid);
    const sarc = await s.evaluate(async () => (await api('GET', '/api/classes')).joined[0].game.arc);
    if (!sarc || sarc.mins !== 5 || sarc.games.join() !== 'kart,blocks,badid' || sarc.sub !== 'math') errs.push('class Arcade settings did not reach the student (Firebase): ' + JSON.stringify(sarc)); else ok('teacher Arcade settings reached the student, cleaned (Firebase): ' + JSON.stringify(sarc));
    const tryArc = await s.evaluate(async () => { const db = firebase.app().firestore(), uid = FBM.uid(), c = (await db.collection('classes').where('members', 'array-contains', uid).get()).docs[0]; try { await c.ref.update({ 'game.arc': { off: false, mins: 120 } }); return 'ALLOWED' } catch (e) { return 'blocked' } });
    if (tryArc !== 'blocked') errs.push('a student changed the class Arcade settings (Firebase)'); else ok('a student cannot change the class Arcade settings (Firebase)');
    await t.evaluate(id => api('PATCH', `/api/classes/${id}/game`, { arc: null }), cid) }
  const ga = await s.evaluate(async () => { const db = firebase.app().firestore(), uid = FBM.uid(), out = {};
    const cs = await db.collection('classes').where('members', 'array-contains', uid).get(), c = cs.docs[0], other = c.data().members.find(u => u !== uid);
    const tryIt = async (k, fn) => { try { await fn(); out[k] = 'ALLOWED' } catch (e) { out[k] = 'blocked' } };
    const mine = (await c.ref.collection('board').doc(uid).get()).data(); out['own board row saved'] = mine && mine.xp >= 120 ? 'yes' : 'NO';
    await tryIt('write a classmate\'s board row', () => c.ref.collection('board').doc(other).set({ n: 'x', xp: 1, w: '', wx: 99999, hero: '{}', ts: 1 }));
    await tryIt('add extra fields to own row', () => c.ref.collection('board').doc(uid).set({ ...mine, admin: true }));
    await tryIt('give self gems', () => c.ref.collection('awards').add({ uid, gems: 20, reason: 'me', ts: 1, claimed: false }));
    const aw = await c.ref.collection('awards').where('uid', '==', uid).get(), a = aw.docs[0];
    await tryIt('claim a gift twice', () => a.ref.update({ claimed: true }));
    await tryIt('change a gift\'s gems', () => a.ref.update({ gems: 20 }));
    await tryIt('read a classmate\'s gifts', async () => { const q = await c.ref.collection('awards').where('uid', '==', other).get(); if (q.empty) throw 0 });
    await tryIt('change the class game settings', () => c.ref.update({ game: { board: false } }));
    return out; }).catch(e => ({ error: e.message }));
  ok('student attacks on the game: ' + JSON.stringify(ga)); if (ga['own board row saved'] !== 'yes' || Object.entries(ga).some(([k, v]) => k !== 'own board row saved' && v !== 'blocked')) errs.push('game rule allowed an attack or the board row was not saved');

  // 5d. Membership: only the Owner switches it on (by username or class code); students and teachers cannot grant it
  const sUser = creds[0][1], cCode = code;
  const plans = await o.evaluate(async () => { await api('PUT', '/api/owner/settings', { member: { on: true, price: '$4.99 a month', link: 'https://buy.stripe.com/test_M1', yprice: '$39.99 a year', ylink: 'https://buy.stripe.com/test_Y1' } });
    let bad = 'saved'; try { await api('PUT', '/api/owner/settings', { member: { on: true, link: 'https://buy.stripe.com/x', ylink: 'http://evil.example/' } }) } catch (e) { bad = 'refused' }
    const m = (await api('GET', '/api/settings')).member; return { m: [m.price, m.link, m.yprice, m.ylink].join(' | '), bad } });
  ok('monthly and annual plans saved (Firebase): ' + JSON.stringify(plans)); if (plans.bad !== 'refused' || !plans.m.endsWith('$39.99 a year | https://buy.stripe.com/test_Y1')) errs.push('membership plans not saved right (Firebase)');
  const mo = await o.evaluate(async ([u, c]) => { const a = await api('POST', '/api/owner/members', { who: u, until: Date.now() + 864e5 * 30 }); const b = await api('POST', '/api/owner/members', { who: c, until: Date.now() + 864e5 * 365 }); const l = await api('GET', '/api/owner/members'); return [a.kind, b.kind, l.users.length, l.classes.length] }, [sUser, cCode]);
  await s.reload(); await s.waitForSelector('#avatarBtn', { timeout: 20000 }); const sm = await s.evaluate(() => isMember());
  ok('owner switched on membership for an account and a class (Firebase): ' + JSON.stringify(mo) + ', student is a member: ' + sm); if (!sm || mo[0] !== 'account' || mo[1] !== 'class') errs.push('membership did not switch on (Firebase)');
  const ma = await s.evaluate(async () => { const db = firebase.app().firestore(), uid = FBM.uid(), out = {}; const tryIt = async (k, fn) => { try { await fn(); out[k] = 'ALLOWED' } catch (e) { out[k] = 'blocked' } };
    await tryIt('student gives self membership', () => db.collection('users').doc(uid).update({ memberUntil: 4102444800000 }));
    await tryIt('student lists members', () => api('GET', '/api/owner/members')); return out });
  const mt = await t.evaluate(async () => { const db = firebase.app().firestore(), out = {}; const tryIt = async (k, fn) => { try { await fn(); out[k] = 'ALLOWED' } catch (e) { out[k] = 'blocked' } };
    const cs = await db.collection('classes').where('teacherId', '==', FBM.uid()).get();
    await tryIt('teacher gives their class membership', () => cs.docs[0].ref.update({ memberUntil: 4102444800000 }));
    await tryIt('teacher creates a member class', () => db.collection('classes').add({ teacherId: FBM.uid(), members: [], memberUntil: 4102444800000, name: 'x' })); return out });
  ok('membership attacks: ' + JSON.stringify({ ...ma, ...mt })); if (Object.values({ ...ma, ...mt }).some(v => v !== 'blocked')) errs.push('membership rule allowed an attack');
  await o.evaluate(async ([u, c]) => { await api('POST', '/api/owner/members', { who: u, until: 0 }); await api('POST', '/api/owner/members', { who: c, until: 0 }) }, [sUser, cCode]);

  // 6. A 13+ learner joins by code, posts; the other student votes
  const l = await page(); await signup(l, 'student', 'priya16', 'Priya'); await l.click('#tabs >> text=My classes'); await l.fill('#jc', code); await l.click('#views button:has-text("Join")'); await l.waitForSelector('text=Room 5', { timeout: 15000 }).catch(async e => { throw new Error('join failed, toast: ' + await l.textContent('#toast')) }); ok('learner joined by code');
  await l.click('#tabs >> text=Community'); await l.fill('#pt', 'How do I add fractions?'); await l.fill('#pb', 'I keep adding the bottoms too.'); await l.click('#views button:has-text("Post")');
  await l.waitForSelector('text=How do I add fractions?', { timeout: 15000 }); ok('learner posted');
  await s.click('#tabs >> text=Community'); await s.waitForSelector('text=How do I add fractions?', { timeout: 15000 }); await s.click('.card.post button[aria-label=Upvote]'); await s.waitForSelector('.card.post button[aria-label=Upvote].on', { timeout: 10000 }); ok('student upvoted');

  // 6b. A learner under 13 signs up: we email the parent a link, and progress stays on the device until the parent says yes
  const OOB = 'http://localhost:9099/emulator/v1/projects/demo-bose/oobCodes';
  const linkFor = async email => { const r = await (await fetch(OOB)).json(), c = (r.oobCodes || []).filter(x => x.email === email && x.requestType === 'EMAIL_SIGNIN').pop(); if (!c) throw new Error('no email link for ' + email);
    const cont = new URL(c.oobLink).searchParams.get('continueUrl'); return cont + (cont.includes('?') ? '&' : '?') + 'mode=signIn&oobCode=' + c.oobCode + '&apiKey=demo-key' };
  const kidSignup = async (un, parent) => { const p = await page(); await p.goto(B + 'app.html#signup'); await p.waitForSelector('#af'); await p.selectOption('#ar', 'student');
    await p.fill('[name=username]', un); await p.fill('[name=display]', un[0].toUpperCase() + un.slice(1)); await p.fill('[name=password]', 'password123'); await p.check('[name=age][value=under13]');
    if (parent) { await p.fill('[name=parentEmail]', parent); await p.click('#af button'); await p.waitForSelector('#cban', { timeout: 20000 }) } return p };
  const db = (p, fn, arg) => p.evaluate(fn, arg);
  const k = await kidSignup('maya7'); await k.click('#af button');
  ok('under-13 without a parent email: ' + (await k.evaluate(() => document.querySelector('[name=parentEmail]').validity.valueMissing ? 'blocked by the form' : 'not blocked')) + '; tick box shown: ' + !!(await k.$('[name=parentOk]')));
  await k.fill('[name=parentEmail]', 'Parent@Example.com'); await k.click('#af button'); await k.waitForSelector('#cban', { timeout: 20000 }); ok('under-13 signed up and waits: ' + (await k.textContent('#cban')).replace(/\s+/g, ' ').slice(0, 90));
  const kid = await k.evaluate(() => FBM.uid());
  await k.evaluate(() => { S[ORDER[0]] = { att: 6, ok: 5, p: .85 }; SYNC() }); await k.waitForFunction(u => !!localStorage.getItem('lumen_wait_' + u), kid, { timeout: 15000 });
  ok('progress kept on the device only: account ' + await db(k, async () => (await firebase.app().firestore().collection('state').doc(FBM.uid()).get()).data().json) + ', device ' + await k.evaluate(u => !!localStorage.getItem('lumen_wait_' + u), kid));
  ok('learner writing their own permission: ' + await db(k, async () => { try { await firebase.app().firestore().collection('consents').doc(FBM.uid()).set({ decision: 'yes', parentUid: FBM.uid(), parentEmail: 'x@x.com', at: 1 }); return 'ALLOWED' } catch (e) { return 'blocked' } }));
  ok('learner saving progress straight to the database: ' + await db(k, async () => { try { await firebase.app().firestore().collection('state').doc(FBM.uid()).set({ json: '{"S":{"x":1}}' }, { merge: true }); return 'ALLOWED' } catch (e) { return 'blocked' } }));
  ok('certificate before the parent says yes: ' + await db(k, async () => { try { await FBM.api('POST', '/api/certs/claim', { key: 'x', full: 'Maya L' }); return 'ALLOWED' } catch (e) { return e.message } }));
  ok('under-13 sees read-only Community: ' + await (async () => { await k.click('#tabs >> text=Community'); await k.waitForSelector('text=Reading only for now', { timeout: 15000 }); return (await k.$$('input[id^=pr]')).length + ' reply boxes' })());
  ok('under-13 posting straight to the database: ' + await k.evaluate(async () => { try { await firebase.app().firestore().collection('posts').add({ authorId: FBM.uid(), authorName: 'x', title: 'hello there', body: 'hello there everyone', hidden: false, pinned: false, locked: false, votes: [], reports: [], ts: 1 }); return 'ALLOWED' } catch (e) { return 'blocked' } }));

  // The parent opens the emailed link on another device
  const pp = await page(); await pp.goto(await linkFor('parent@example.com')); await pp.waitForSelector('#pf', { timeout: 20000 }); ok('link on another device asks for the email: ' + (await pp.textContent('#pf p')).slice(0, 60));
  await pp.fill('#pf [name=email]', 'someone@else.com'); await pp.click('#pf button'); await pp.waitForFunction(() => (document.getElementById('pe') || {}).textContent, null, { timeout: 15000 }); ok('wrong email: ' + await pp.textContent('#pe'));
  await pp.fill('#pf [name=email]', 'parent@example.com'); await pp.click('#pf button'); await pp.waitForSelector('button[data-act=yes]', { timeout: 20000 }); ok('parent reads the notice: ' + await pp.textContent('#views .card h3'));
  const [dl] = await Promise.all([pp.waitForEvent('download'), pp.click('button[data-act=export]')]); const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  ok(`parent downloads the data: ${exp.account.username}, parent email ${exp.contact.parentEmail}`);
  await pp.click('button[data-act=yes]'); await pp.waitForFunction(() => /Thank you/.test((document.getElementById('pm') || {}).textContent || ''), null, { timeout: 20000 }); ok('parent said yes: ' + await pp.textContent('#pm'));
  await k.reload(); await k.waitForSelector('#avatarBtn', { timeout: 20000 }); await k.waitForTimeout(1000);
  ok('learner no longer waits: banner ' + !!(await k.$('#cban')) + ', device progress moved to the account: ' + await db(k, async () => Object.keys(JSON.parse((await firebase.app().firestore().collection('state').doc(FBM.uid()).get()).data().json).S || {}).length + ' skill'));
  await pp.goto(B + 'app.html?parent=me'); await pp.waitForSelector('button[data-act=export]', { timeout: 20000 }); ok('parent page: ' + (await pp.textContent('#views .card p')).replace(/\s+/g, ' ').trim().slice(0, 80));

  // Another parent can't answer for this child or see them
  const op = await page(); await op.goto(B + 'app.html?parent=me'); await op.waitForSelector('#pf'); await op.fill('#pf [name=email]', 'other@example.com'); await op.click('#pf button'); await op.waitForSelector('text=Check your email', { timeout: 15000 });
  await op.goto(await linkFor('other@example.com')); await op.waitForSelector('text=No learner has given this email', { timeout: 20000 }); ok('another parent sees no children');
  ok('another parent answering for this child: ' + await db(op, async u => { try { await firebase.app().firestore().collection('consents').doc(u).set({ decision: 'yes', parentUid: FBM.uid(), parentEmail: 'other@example.com', at: 1 }); return 'ALLOWED' } catch (e) { return 'blocked' } }, kid));
  ok("another parent reading the child's progress: " + await db(op, async u => { try { await firebase.app().firestore().collection('state').doc(u).get(); return 'ALLOWED' } catch (e) { return 'blocked' } }, kid));
  ok("learner changing the parent email after a yes: " + await db(k, async () => { try { await firebase.app().firestore().collection('private').doc(FBM.uid()).update({ parentEmail: 'other@example.com' }); return 'ALLOWED' } catch (e) { return 'blocked' } }));

  // A parent says no: the account and its data are deleted
  const k2 = await kidSignup('leo8', 'parent2@example.com'); const p2 = await page(); await p2.goto(await linkFor('parent2@example.com')); await p2.waitForSelector('#pf'); await p2.fill('#pf [name=email]', 'parent2@example.com'); await p2.click('#pf button');
  await p2.waitForSelector('button[data-act=del]', { timeout: 20000 }); await p2.click('button[data-act=del]'); await p2.waitForFunction(() => /deleted/.test((document.getElementById('pm') || {}).textContent || ''), null, { timeout: 20000 }); ok('parent said no: ' + await p2.textContent('#pm'));
  await login(k2, 'leo8', 'password123'); await k2.waitForFunction(() => (document.getElementById('ae') || {}).textContent, null, { timeout: 20000 }); ok('that learner signing in: ' + await k2.textContent('#ae'));

  // Requests nobody answers within 14 days: the parent email is removed, and the learner can send a new one
  const k3 = await kidSignup('zoe9', 'parent3@example.com'), z = await k3.evaluate(() => FBM.uid());
  await db(o, async u => firebase.app().firestore().collection('private').doc(u).update({ requested: 1 }), z);
  ok('owner removes unanswered requests: ' + JSON.stringify(await o.evaluate(() => FBM.api('POST', '/api/owner/expire-consents', {}))) + ', parent email kept: ' + await db(o, async u => !!(await firebase.app().firestore().collection('private').doc(u).get()).data().parentEmail, z));
  ok('owner deletes under-13 accounts unused for two years: ' + JSON.stringify(await o.evaluate(() => FBM.api('POST', '/api/owner/delete-inactive', {}))) + ', active learner kept: ' + await db(o, async u => (await firebase.app().firestore().collection('users').doc(u).get()).exists, z));
  await k3.reload(); await k3.waitForSelector('#cbe', { timeout: 20000 }); await k3.fill('#cbe', 'parent3@example.com'); await k3.click('#cban button'); await k3.waitForFunction(() => /Waiting/.test(document.getElementById('cban').textContent), null, { timeout: 15000 }); ok('learner asks again: ' + (await k3.textContent('#cban')).replace(/\s+/g, ' ').slice(0, 60));

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

  // 11. Authors delete their own posts (California's law for minors), and anyone can delete their account
  await l.click('#tabs >> text=Community'); await l.waitForSelector('.card.post:has-text("How do I add fractions?") button:has-text("Delete")', { timeout: 15000 });
  await l.click('.card.post:has-text("How do I add fractions?") button:has-text("Delete")'); await l.waitForSelector('text=How do I add fractions?', { state: 'detached', timeout: 15000 }); ok('learner deleted their own post');
  await menu(l, 'Settings'); await l.waitForSelector('#mydata'); const [d2] = await Promise.all([l.waitForEvent('download'), l.click('#mydata button:has-text("Download my data")')]);
  ok('learner downloads their data: ' + JSON.parse(fs.readFileSync(await d2.path(), 'utf8')).account.username);
  await l.click('#mydata summary'); await l.fill('#dl1', 'DELETE'); await l.fill('#dl2', 'wrong-password'); await l.click('#mydata button:has-text("Delete my account forever")'); await l.waitForFunction(() => document.getElementById('dle').textContent, null, { timeout: 15000 }); ok('wrong password: ' + await l.textContent('#dle'));
  await l.fill('#dl2', 'password123'); await l.click('#mydata button:has-text("Delete my account forever")'); await l.waitForSelector('#af', { timeout: 20000 }); ok('account deleted: ' + await l.textContent('#ae'));
  ok('its data left in the database: ' + await o.evaluate(async () => { const db = firebase.app().firestore(), u = await db.collection('users').where('username', '==', 'priya16').get(); return u.size + ' profiles' }));
  await login(l, 'priya16', 'password123'); await l.waitForFunction(() => (document.getElementById('ae') || {}).textContent, null, { timeout: 15000 }); ok('signing in again: ' + await l.textContent('#ae'));

  await b.close(); srv.close();
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
})().catch(e => { console.error('FAIL', e.message); console.log(errs.join('\n')); process.exit(1) });
