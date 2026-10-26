/* Browser test of the game features against a running server (npm start, owner "owner" / "ownerpass1234").
   The Owner sets the daily play time; a teacher makes teams, sets a prize, assigns classwork and gives bonus gems;
   students earn XP and gems by learning, level up, finish quests, buy and wear items, battle in Lumi's Realm until
   play time runs out, turn in classwork for a reward, collect bonus gems and see the weekly leaderboard and team race.
   Also checks that students cannot change class settings, give gems, or claim gems twice or for someone else. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const B = process.env.LUMEN_URL || 'http://localhost:3922';
const SH = process.env.SHOTS, errs = [], ok = s => console.log('✓', s), fail = m => { throw new Error(m); };
(async () => {
  const br = await chromium.launch();
  const mk = async (w = 1280) => { const ctx = await br.newContext({ viewport: { width: w, height: 900 } }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|status of (400|401|403|404|409)/.test(m.text())) errs.push('console: ' + m.text()) });
    p.on('dialog', d => d.accept()); return p };
  const shot = async (pg, n) => { if (SH) await pg.screenshot({ path: `${SH}/${n}.png`, fullPage: true }) };
  const call = (pg, method, url, body) => pg.evaluate(([m, u, b]) => fetch(u, { method: m, credentials: 'same-origin', headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ s: r.status, j: await r.json().catch(() => null) })), [method, url, body]);
  const login = async (u, pw, w) => { const p = await mk(w); await p.goto(B + '/app'); await p.fill('[name=username]', u); await p.fill('[name=password]', pw); await p.click('#af button'); await p.waitForSelector('#avatarBtn'); return p };
  const signup = async (role, un) => { const p = await mk(); await p.goto(B + '/app#signup'); await p.waitForSelector('#af'); await p.selectOption('#ar', role);
    await p.fill('[name=username]', un); await p.fill('[name=display]', 'T ' + un.slice(-6)); if (role !== 'student') await p.fill('[name=email]', un + '@school.org'); await p.fill('[name=password]', 'teachpass1');
    await p.click('#af button'); await p.waitForSelector('#avatarBtn'); return p };
  const save = pg => pg.evaluate(async () => { clearTimeout(_syncT); _syncT = null; await api('PUT', '/api/state', stateBody()) });
  /* answer one practice question through the real practice screen */
  const practiceOne = async (pg, right) => pg.evaluate(r => { if (!cur || cur.done || view !== 'practice') startPractice(recommend(), 'practice'); const q = cur.q;
    const v = q.choices ? String(r ? q.a[0] : (q.a[0] + 1) % q.choices.length) : r ? (q.a[1] === 1 ? String(q.a[0]) : q.a[0] + '/' + q.a[1]) : '987654';
    $('ans').value = v; submit(); if (cur.done) nextQ(); return true }, right);
  try {
    const id = Date.now().toString(36).slice(-5);
    // Owner: play time settings and the game flags
    const ow = await login('owner', 'ownerpass1234');
    await ow.click('#avatarBtn'); await ow.click('#pmenu >> text=Owner console'); await ow.click('text=Feature flags'); await ow.waitForSelector('#gsb');
    const flags = await ow.textContent('#views'); if (!/Game mode/.test(flags) || !/Class leaderboards/.test(flags)) fail('game flags missing from the Owner console');
    await ow.fill('#gsb', '3'); await ow.fill('#gsp', '5'); await ow.fill('#gsm', '20'); await ow.click('text=Save play time'); await ow.waitForSelector('text=Play time saved.');
    const set = (await call(ow, 'GET', '/api/settings')).j.game; if (set.base !== 3 || set.per !== 5 || set.max !== 20) fail('play time not saved: ' + JSON.stringify(set));
    ok('owner set play time: 3 free minutes, 5 per 10 minutes learned, at most 20');

    // Teacher: class, students, classwork
    const t = await signup('teacher', 'gtc' + id);
    await t.click('#tabs >> text=Teacher'); await t.fill('#cn', 'Dragon Class'); await t.selectOption('#cg', '3'); await t.click('text=Create class'); await t.waitForSelector('.cls');
    await t.fill('textarea[id^=sn]', 'Ava Stone\nBen Ruiz\nCy Park'); await t.click('text=Create student logins'); await t.waitForSelector('.creds');
    const creds = await t.$$eval('.creds tr', rs => rs.slice(1).map(r => [...r.cells].map(c => c.textContent)));
    const cid = await t.evaluate(() => ST.classes[0].id);
    if (!(await t.textContent('.cls')).includes('Game and competitions')) fail('no game section in the class card');
    await t.evaluate(async cid => { await LOAD.teacher(); const a = buildA('math-3-1', 'classwork', 0); await api('POST', `/api/classes/${cid}/tests`, { kind: a.kind, title: a.title, unit: a.unit, items: a.items, key: a.key, passages: a.passages, skills: a.skills, minutes: 0, target: 'all' }) }, cid);
    ok('teacher class "Dragon Class" with 3 students and classwork');

    // Student A learns: XP, gems, quests, level
    const a = await login(creds[0][1], creds[0][2]);
    if (!(await a.isVisible('#tabs >> text=Play'))) fail('no Play tab for students');
    if (!(await a.isVisible('.herostrip'))) fail('no hero card and quests on the Learn page');
    for (let i = 0; i < 12; i++) await practiceOne(a, true);
    const g1 = await a.evaluate(() => ({ xp: XP(), gems: GEMS(), ge: GM.game_ge ?? GM.ge, ok: DAY().ok, wk: WEEK().xp, lv: LVL() }));
    if (g1.ok < 12 || g1.gems < 12 || g1.xp < 120 || g1.wk !== g1.xp || g1.ge < g1.gems) fail('learning rewards wrong: ' + JSON.stringify(g1));
    ok(`12 correct answers: ${g1.xp} XP (all this week), ${g1.gems} gems, level ${g1.lv}`);
    await a.evaluate(() => { const D = DAY(); Object.assign(D, { ok: 15, best: 5, study: 600, mis: 1, les: 2, cw: 1, bat: 2 }); gameCheck() });
    const q = await a.evaluate(() => ({ list: dailyQuests(), done: DAY().q, chest: DAY().chest, gems: GEMS() }));
    if (q.done.length !== 3 || !q.chest) fail('daily quests not completed: ' + JSON.stringify(q));
    ok(`daily quests finished (${q.list.join(', ')}) and the treasure chest opened`);
    await a.evaluate(() => addXP(300, 'test'));
    if (await a.evaluate(() => LVL()) < 3) fail('no level up'); await a.waitForSelector('.gt.big'); ok('level up celebrated: ' + (await a.textContent('.gt li')).trim());
    await shot(a, 'g-home');

    // Shop: buy and wear a hat
    await a.evaluate(() => { ST.ht = 'shop'; go('hero') }); await a.waitForSelector('.shopgrid');
    const g0 = await a.evaluate(() => ({ gems: GEMS(), ge: GM.ge })); await a.click('.shopit:has-text("Wizard hat") button'); await a.waitForSelector('.shopit:has-text("Wizard hat") >> text=Take off');
    const g2 = await a.evaluate(() => ({ gems: GEMS(), ge: GM.ge, hat: GM.eq.hat, own: GM.own.includes('h_wiz') })), spent = g0.gems + (g2.ge - g0.ge) - g2.gems;
    if (spent !== 40 || g2.hat !== 'h_wiz' || !g2.own) fail('buying failed: ' + JSON.stringify({ g0, g2, spent }));
    if (!(await a.innerHTML('#avatarBtn')).includes('#3554B8')) fail('header avatar does not show the hat');
    ok(`bought the Wizard hat: 40 gems spent, gems earned meanwhile ${g2.ge - g0.ge} (treasure and weekly quest); the header avatar wears it`);
    const lockBtn = await a.$('.shopit:has-text("Golden crown") button'); if (!(await lockBtn.isDisabled())) fail('level-locked item can be bought');
    ok('Golden crown is locked until level 12'); await shot(a, 'g-shop');

    // Lumi's Realm: battle with real questions until the monster is beaten
    await a.click('#tabs >> text=Play'); await a.waitForSelector('.worldmap');
    const left0 = await a.evaluate(() => playLeft()); if (left0 < 60 || left0 > 20 * 60) fail('play time left is wrong: ' + left0);
    await a.click('#landpanel .mon >> nth=0 >> button'); await a.waitForSelector('.qpanel .bq');
    for (let i = 0; i < 12 && await a.evaluate(() => BT && BT.phase !== 'won'); i++) {
      await a.waitForFunction(() => BT && BT.phase === 'ask');
      if (await a.evaluate(() => !!BT.q.choices)) await a.click(`.bchoices button >> nth=${await a.evaluate(() => BT.q.a[0])}`);
      else { await a.fill('#bans', await a.evaluate(() => fmtA(BT.q))); await a.click('.bans button') }
      await a.waitForTimeout(1300) }
    await a.waitForSelector('text=You beat'); const w = await a.evaluate(() => ({ won: LS('meadow').won, bw: GM.bw, bat: DAY().bat }));
    if (!w.won[0] || w.bw !== 1) fail('battle win not recorded: ' + JSON.stringify(w)); await shot(a, 'g-won');
    ok('won a battle in Sunny Meadow by answering questions; first-win gems added');
    await a.click('text=Battle again'); await a.waitForSelector('.qpanel .bq');
    if (await a.evaluate(() => !!BT.q.choices)) await a.click(`.bchoices button >> nth=${await a.evaluate(() => (BT.q.a[0] + 1) % BT.q.choices.length)}`);
    else { await a.fill('#bans', '987654'); await a.click('.bans button') }
    await a.waitForSelector('#bnext'); const miss = await a.textContent('#bfbx'); if (!/The answer is/.test(miss)) fail('a miss does not show the answer');
    ok('a wrong answer shows the right answer and how to solve it');
    await a.evaluate(() => { DAY().play = playAllowed(); realmTick(0) }); await a.click('#bnext'); await a.waitForSelector('text=Play time is over for today');
    ok('when play time runs out the battle ends: ' + (await a.textContent('.endcard p')).trim().slice(0, 70));
    await a.click('.endcard >> text=Back to the map'); if (!(await a.isVisible('text=Play time is over for today'))) fail('map does not show the time-up note');
    const blocked = await a.evaluate(() => { startBattle('meadow', 0); return BT === null || BT.phase !== 'ask' }); if (!blocked) fail('a battle started with no play time left');
    await a.evaluate(() => { DAY().study += 600 }); const more = await a.evaluate(() => playLeft()); if (more !== 300) fail('10 minutes of learning should earn 5 minutes, got ' + more);
    ok('10 more minutes of learning earned 5 more minutes of play');

    // Classwork turned in: XP and gems once
    await a.click('#tabs >> text=My classes'); await a.waitForSelector('button:text-is("Start")');
    await a.click('button:text-is("Start")'); await a.waitForSelector('.items');
    const n = await a.$$eval('.items > li', l => l.length);
    for (let i = 0; i < n; i++) { const li = (await a.$$('.items > li'))[i];
      if (await li.$('input[type=radio]')) await (await li.$$('input[type=radio]'))[0].check(); else if (await li.$('input[type=text]')) await (await li.$('input[type=text]')).fill('12'); else await (await li.$('textarea')).fill('my answer') }
    const before = await a.evaluate(() => ({ xp: XP(), gems: GEMS(), cw: DAY().cw }));
    await a.click('button:has-text("Turn in")'); await a.waitForSelector('text=Nice work');
    const after = await a.evaluate(() => ({ xp: XP(), gems: GEMS(), cw: DAY().cw, done: GM.done.length }));
    if (after.xp - before.xp !== 30 || after.gems - before.gems !== 5 || after.cw !== before.cw + 1) fail('classwork reward wrong: ' + JSON.stringify([before, after]));
    ok('turning in classwork gave +30 XP and +5 gems'); await save(a);

    // Student B learns a little
    const b = await login(creds[1][1], creds[1][2], 390);
    for (let i = 0; i < 4; i++) await practiceOne(b, true); await save(b);

    // Teacher: teams, prize, leaderboard and bonus gems
    await t.evaluate(() => reload('teacher')); await t.waitForSelector('.gblock');
    const tb = await t.$$eval('.gblock table tr', r => r.slice(1).map(x => [...x.cells].map(c => c.textContent)));
    if (tb[0][1] !== creds[0][0] || +tb[0][3] < 400) fail('teacher leaderboard wrong: ' + JSON.stringify(tb));
    ok('teacher sees the weekly ranking: ' + tb.map(r => `${r[1]} ${r[3]} XP (${r[2]})`).join(', '));
    await t.selectOption('[id^=tn]', '2'); await t.click('text=Make teams'); await t.waitForSelector('.race');
    const tm = await t.evaluate(() => ST.classes[0].game); if (tm.teams.join() !== 'Dragons,Griffins' || Object.keys(tm.tm).length !== 3) fail('teams wrong: ' + JSON.stringify(tm));
    const ua = await t.evaluate(() => ST.classes[0].students[0].uid), ub = await t.evaluate(() => ST.classes[0].students[1].uid);
    await t.selectOption(`select[aria-label="Team for ${creds[0][0]}"]`, '0'); await t.waitForSelector('.race'); await t.selectOption(`select[aria-label="Team for ${creds[1][0]}"]`, '1'); await t.waitForSelector('.race');
    await t.fill('[id^=pz]', 'Extra recess'); await t.click('text=Save prize'); await t.waitForSelector('text=Extra recess');
    ok('made 2 teams (Dragons, Griffins), moved students, set the prize');
    await t.selectOption('[id^=awt]', String(ua)); await t.selectOption('[id^=awg]', '5'); await t.selectOption('[id^=awr]', 'Kindness'); await t.click('text=Give gems'); await t.waitForSelector('text=Gave 5 gems to 1 student');
    await t.selectOption('[id^=awt]', 't:0'); await t.selectOption('[id^=awg]', '2'); await t.click('text=Give gems'); await t.waitForSelector('text=/Gave 2 gems to \\d+ students?/');
    ok('gave Ava 5 gems for kindness and team Dragons 2 gems'); await shot(t, 'g-teacher');

    // Student A: collects the bonus gems once, sees the board and the team race
    const ga = await a.evaluate(() => GEMS());
    await a.click('#tabs >> text=My classes'); await a.waitForSelector('.lb'); await a.waitForFunction(g => GEMS() === g + 7, ga);
    const card = await a.textContent('#views'); if (!/Your teacher gave you 5/.test(await a.textContent('#gtoast'))) fail('no bonus gem message');
    if (!/Dragon Class: this week/.test(card) || !/Dragons/.test(card) || !/Extra recess/.test(card)) fail('leaderboard or race missing');
    const lb = await a.$$eval('.lb li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim())); if (!/\(you\)/.test(lb[0])) fail('Ava should lead: ' + lb.join(' | '));
    ok('Ava got 7 bonus gems once; leaderboard: ' + lb.join(' | ')); await shot(a, 'g-board');
    const again = await a.evaluate(async () => { const r = await api('GET', '/api/awards'); return r.awards.length }); if (again) fail('awards can be collected again');
    // Student B (phone) sees the same board
    await b.click('#bnav >> text=My classes'); await b.waitForSelector('.lb'); const lbb = await b.$$eval('.lb li', l => l.length); if (lbb !== 3) fail('student B board has ' + lbb + ' rows');
    ok('a classmate sees the board too (3 rows, phone size)'); await shot(b, 'g-board-phone');

    // Security
    const pg = await call(a, 'PATCH', `/api/classes/${cid}/game`, { board: false }), aw = await call(a, 'POST', `/api/classes/${cid}/awards`, { to: 'all', gems: 20, reason: 'me' });
    if (pg.s !== 403 || aw.s !== 403) fail(`students changed class settings or gave gems: ${pg.s} ${aw.s}`);
    await t.selectOption('[id^=awt]', String(ub)); await t.click('text=Give gems'); await t.waitForSelector('text=Gave');
    const bAw = (await call(b, 'GET', '/api/awards')).j.awards; const steal = await call(a, 'POST', '/api/awards/claim', { ids: bAw.map(x => x.id) });
    if (steal.j.claimed.length) fail('a student claimed someone else\'s gems');
    const mine = await call(b, 'POST', '/api/awards/claim', { ids: bAw.map(x => x.id) }), twice = await call(b, 'POST', '/api/awards/claim', { ids: bAw.map(x => x.id) });
    if (mine.j.claimed.length !== 1 || twice.j.claimed.length) fail('claiming once/twice wrong');
    const big = await call(t, 'POST', `/api/classes/${cid}/awards`, { to: 'all', gems: 500, reason: 'x' }); if (big.s !== 400) fail('teacher gave 500 gems');
    ok('students get 403 for class settings and giving gems; nobody claims others\' gems or claims twice; at most 20 gems at a time');

    // Leaderboard off
    await t.click('.gblock input[type=checkbox]'); await t.waitForSelector('.gblock input[type=checkbox]:not(:checked)');
    const off = await a.evaluate(async () => (await api('GET', '/api/classes')).joined[0].board); if (off !== null) fail('board still shown when turned off');
    ok('teacher turned the leaderboard off; students no longer get it');
    // Membership: the Owner offers it with a PayPal link, kids see it only after a grown-up check, the Owner switches it on
    await ow.evaluate(() => reload('owner')); await ow.waitForSelector('text=⭐ Membership'); await ow.click('text=⭐ Membership'); await ow.waitForSelector('#mln');
    await ow.check('#mon'); await ow.fill('#mpr', '$4.99 a month'); await ow.fill('#mln', 'https://www.paypal.com/ncp/payment/TEST123'); await ow.fill('#mct', 'help@school.org');
    await ow.click('text=Save offer'); await ow.waitForSelector('text=Membership offer saved.');
    const bad = await call(ow, 'PUT', '/api/owner/settings', { member: { on: true, link: 'javascript:alert(1)' } }); if (bad.s !== 400) fail('a non-https payment link was accepted');
    ok('owner offers membership at $4.99 a month with a PayPal link (non-https links refused)');
    await a.reload(); await a.waitForSelector('#avatarBtn'); await a.evaluate(() => { DAY().play = playAllowed() }); await a.click('#tabs >> text=Play');
    await a.waitForSelector('text=Play time is over for today'); await a.click('text=⭐ Membership (for grown-ups)'); await a.waitForSelector('#gatein');
    if (await a.isVisible('a.paybtn')) fail('a learner saw the price before the grown-up check');
    await a.fill('#gatein', '1'); await a.click('.gate button'); await a.waitForSelector('text=Not quite. Please ask a grown-up.');
    await a.fill('#gatein', String(await a.evaluate(() => MGATE.a * MGATE.b))); await a.click('.gate button'); await a.waitForSelector('a.paybtn');
    const pay = await a.evaluate(() => ({ href: document.querySelector('a.paybtn').href, text: document.querySelector('a.paybtn').textContent, page: $('views').textContent }));
    if (!/Pay with PayPal/.test(pay.text) || pay.href !== 'https://www.paypal.com/ncp/payment/TEST123' || !pay.page.includes(creds[0][1]) || !pay.page.includes('$4.99 a month')) fail('offer page wrong: ' + JSON.stringify(pay).slice(0, 300));
    ok('out of play time, a learner sees "ask a grown-up"; after the grown-up check: price, Pay with PayPal, and their username for the note');
    await t.reload(); await t.waitForSelector('#avatarBtn'); await t.click('#tabs >> text=Teacher'); await t.waitForSelector('.cls'); await t.evaluate(() => go('member')); await t.waitForSelector('a.paybtn'); if (!(await t.textContent('#views')).includes(await t.evaluate(() => ST.classes[0].code))) fail('teacher does not see class codes');
    ok('teachers see the offer right away, with their class codes');
    const code = await t.evaluate(() => ST.classes[0].code);
    await ow.fill('#mwho', creds[0][1]); await ow.selectOption('#mlen', '3'); await ow.click('text=Switch on'); await ow.waitForSelector('text=Membership on for');
    await ow.waitForSelector(`td:has-text("${creds[0][1]}")`); ok('owner switched on 3 months for ' + creds[0][1]);
    await a.reload(); await a.waitForSelector('#avatarBtn'); await a.evaluate(() => { DAY().play = playAllowed() + 999 }); await a.click('#tabs >> text=Play'); await a.waitForSelector('text=⭐ Member: unlimited play');
    await a.click('#landpanel .mon >> nth=0 >> button'); await a.waitForSelector('.qpanel .bq'); ok('member plays with no time limit: ' + (await a.textContent('#ptime')).trim());
    await ow.fill('#mwho', code); await ow.selectOption('#mlen', '12'); await ow.click('text=Switch on'); await ow.waitForSelector('text=Membership on for the class');
    await b.reload(); await b.waitForSelector('#avatarBtn'); if (!(await b.evaluate(() => isMember()))) fail('class membership did not reach a student'); ok('class code ' + code + ' switched on for a year: every student in the class is a member');
    await ow.click(`tr:has-text("${creds[0][1]}") >> text=End now`); await ow.waitForSelector('text=Membership ended.');
    await ow.click(`tr:has-text("${code}") >> text=End now`); await ow.waitForSelector('text=Membership ended.');
    await a.reload(); await a.waitForSelector('#avatarBtn'); if (await a.evaluate(() => isMember())) fail('membership did not end'); ok('owner ended both memberships; the daily limit is back');
    const sm = await call(a, 'POST', '/api/owner/members', { who: creds[0][1], until: Date.now() + 9e9 }), tm2 = await call(t, 'POST', '/api/owner/members', { who: code, until: Date.now() + 9e9 }), sl = await call(a, 'GET', '/api/owner/members');
    if (sm.s !== 403 || tm2.s !== 403 || sl.s !== 403) fail(`students or teachers could switch on membership: ${sm.s} ${tm2.s} ${sl.s}`);
    ok('students and teachers get 403 when they try to switch on membership');
    // Teachers play without a time limit
    await t.click('#tabs >> text=Play'); await t.waitForSelector('text=No time limit (preview)'); ok('teachers can try the game with no time limit');
  } catch (e) { console.log('FAIL', e.message); errs.push(e.message) }
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'all game checks passed'); await br.close(); process.exit(errs.length ? 1 : 0);
})();
