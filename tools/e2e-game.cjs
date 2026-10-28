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
    if (!(await a.isVisible('#tabs >> text=Arcade'))) fail('no Arcade tab for students');
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
    await a.click('#tabs >> text=Arcade'); await a.waitForSelector('.tiles');
    const tiles = await a.$$eval('.tile', t => t.map(x => x.querySelector('.tname').textContent + (x.classList.contains('soon') ? ' (soon)' : '')));
    if (tiles.length !== 7 || tiles[0] !== 'Spell Quest' || tiles[1] !== 'Dungeon Dash' || tiles[2] !== 'Snake Arena' || tiles.some(x => x.includes('(soon)'))) fail('arcade tiles wrong: ' + tiles.join(', '));
    const p0 = await a.evaluate(() => DAY().play); await a.evaluate(() => realmTick(5)); if (await a.evaluate(() => DAY().play) !== p0) fail('play time ticked on the hub');
    await a.click('.hubhero .livehero'); if (!(await a.evaluate(() => document.querySelector('.hubhero .livehero').classList.contains('wave')))) fail('hero did not wave when tapped');
    ok('Arcade hub: ' + tiles.join(', ') + '; browsing the hub uses no play time; the hero waves when tapped');
    await a.click('.tile:has-text("Spell Quest")'); await a.waitForSelector('.worldmap');
    const left0 = await a.evaluate(() => playLeft()); if (left0 < 60 || left0 > 20 * 60) fail('play time left is wrong: ' + left0);
    await a.click('#landpanel .mon >> nth=0 >> button'); await a.waitForSelector('.qpanel .bq');
    for (let i = 0; i < 12 && await a.evaluate(() => BT && BT.phase !== 'won'); i++) {
      await a.waitForFunction(() => BT && BT.phase === 'ask');
      if (await a.evaluate(() => !!BT.q.choices)) await a.click(`.bchoices button >> nth=${await a.evaluate(() => BT.q.a[0])}`);
      else { await a.fill('#bans', await a.evaluate(() => fmtA(BT.q))); await a.click('.bans button') }
      await a.waitForTimeout(1300) }
    await a.waitForSelector('text=You befriended'); const w = await a.evaluate(() => ({ won: LS('meadow').won, bw: GM.bw, bat: DAY().bat }));
    if (!w.won[0] || w.bw !== 1) fail('battle win not recorded: ' + JSON.stringify(w)); await shot(a, 'g-won');
    ok('won a battle in Sunny Meadow by answering questions; first-win gems added');
    await a.click('text=Battle again'); await a.waitForSelector('.qpanel .bq');
    if (await a.evaluate(() => !!BT.q.choices)) await a.click(`.bchoices button >> nth=${await a.evaluate(() => (BT.q.a[0] + 1) % BT.q.choices.length)}`);
    else { await a.fill('#bans', '987654'); await a.click('.bans button') }
    await a.waitForSelector('#bnext'); const miss = await a.textContent('#bfbx'); if (!/The answer is/.test(miss)) fail('a miss does not show the answer');
    ok('a wrong answer shows the right answer and how to solve it');
    await a.waitForFunction(() => document.querySelector('.fighter.me .live').classList.contains('oops'), null, { timeout: 2000 }).catch(() => fail('hero did not react to a miss'));
    await a.evaluate(() => { DAY().play = playAllowed(); realmTick(0) }); await a.click('#bnext'); await a.waitForSelector('text=Play time is over for today');
    ok('when play time runs out the battle ends: ' + (await a.textContent('.endcard p')).trim().slice(0, 70));
    await a.click('.endcard >> text=Back to the map'); if (!(await a.isVisible('text=Rest your eyes, hero!'))) fail('map does not show the time-up note');
    const blocked = await a.evaluate(() => { startBattle('meadow', 0); return BT === null || BT.phase !== 'ask' }); if (!blocked) fail('a battle started with no play time left');
    await a.evaluate(() => { DAY().study += 600 }); const more = await a.evaluate(() => playLeft()); if (more !== 300) fail('10 minutes of learning should earn 5 minutes, got ' + more);
    ok('10 more minutes of learning earned 5 more minutes of play');

    // A first boss win always drops gear, saved to the hero's closet
    const gd = await a.evaluate(() => { DAY().play = 0; const st = LS('meadow'); st.won = [1, 1, 1]; st.boss = 0; startBattle('meadow', 3); BT.mhp = 1; const own = GM.own.length; castAns(BT.q.choices ? BT.q.a[0] : fmtA(BT.q)); return own });
    await a.waitForSelector('.drop'); const dr = await a.evaluate(() => ({ id: BT.drop, own: GM.own.length, rar: document.querySelector('.drop .rar').textContent }));
    if (!dr.id || dr.own !== gd + 1) fail('no gear drop on a first boss win: ' + JSON.stringify(dr));
    await a.click('.drop button'); if (!(await a.evaluate(id => Object.values(GM.eq).includes(id), dr.id))) fail('could not wear the gear');
    ok(`first boss win dropped ${dr.rar.replace('!', '')}: ${dr.id}, worn with one tap`); await shot(a, 'g-drop');
    // The other four Arcade games
    const answerQM = async (pg, right) => { await pg.waitForFunction(() => QM && QM.phase === 'ask'); const ch = await pg.evaluate(() => QM.q.choices ? QM.q.choices.length : 0), a0 = await pg.evaluate(() => QM.q.a[0]);
      if (ch) await pg.click(`#qmodal .bchoices button >> nth=${right ? a0 : (a0 + 1) % ch}`); else { await pg.fill('#qmin', right ? await pg.evaluate(() => fmtA(QM.q)) : '987654'); await pg.click('#qmodal .bans button') } };
    await a.evaluate(() => { BT = null; DAY().play = 0; toHub() }); await a.waitForSelector('.tiles');
    const soon = await a.$$eval('.tile.soon', t => t.length); if (soon) fail(soon + ' games still say coming soon');
    // Pet Pals: food from learning, hatching, the question of the day, and no play time
    await a.click('.tile:has-text("Pet Pals")'); await a.waitForSelector('.eggpick');
    const food0 = await a.evaluate(() => { const D = DAY(); return { food: PET().food, want: Math.floor(D.ok / 10) + D.mis + Math.min(3, D.les) + 2 * D.cw } });
    if (food0.food !== food0.want) fail('pet food does not match the learning done today: ' + JSON.stringify(food0));
    await a.click('.eggpick[data-kind=dragon]'); await a.waitForSelector('#palbtn');
    const pp0 = await a.evaluate(() => DAY().play); await a.evaluate(() => realmTick(5)); if (await a.evaluate(() => DAY().play) !== pp0) fail('Pet Pals used play time');
    await a.evaluate(() => { PET().food += 2; rerealm() }); await a.click('text=Feed a snack'); await a.click('text=Feed a snack');
    await a.waitForSelector('text=Sparky hatched!'); if (await a.evaluate(() => pstage(PET().g)) !== 1) fail('the pet did not hatch after 2 snacks');
    const tr0 = await a.evaluate(() => PET().treat); await a.click('#petq'); await answerQM(a, true); await a.waitForFunction(() => !QM);
    if (await a.evaluate(() => PET().treat) !== tr0 + 1 || !(await a.isDisabled('#petq'))) fail('the question of the day did not give one treat');
    if (!(await a.evaluate(() => heroCard().includes('palmini')))) fail('the pet does not visit the Learn page');
    ok(`Pet Pals: ${food0.food} snacks from today's learning, Sparky hatched after 2 snacks, the question of the day gave a treat, the pet shows on the Learn page; no play time used`); await shot(a, 'g-pet');
    // Turbo Trivia Kart: three different lane answers, the right one included
    const kc = await a.evaluate(() => { const bad = [], v = s => s.includes('/') ? s.split('/')[0] / s.split('/')[1] : +s; let n = 0;
      for (const sub of Object.keys(SUBN)) { GM.rsub = sub; for (let i = 0; i < 60; i++) { const x = rquestion(); if (!x) break; const c = kartChoices(x.q); if (!c) continue; n++;
        const right = x.q.choices ? c.L[c.cor] === x.q.choices[x.q.a[0]] : Math.abs(v(c.L[c.cor]) - x.q.a[0] / x.q.a[1]) < 1e-9; if (c.L.length !== 3 || new Set(c.L).size !== 3 || !right) bad.push(x.q.q + ' -> ' + c.L.join('|')) } }
      GM.rsub = 'math'; return { n, bad } });
    if (kc.bad.length || kc.n < 100) fail('kart lanes wrong: ' + JSON.stringify(kc).slice(0, 300));
    await a.evaluate(() => toHub()); await a.click('.tile:has-text("Turbo Trivia Kart")'); await a.click('text=Start race'); await a.waitForSelector('#kgate span');
    const kg0 = await a.evaluate(() => GEMS()), kp0 = await a.evaluate(() => DAY().play); await a.evaluate(() => realmTick(5)); if (await a.evaluate(() => DAY().play) !== kp0 + 5) fail('a race did not use play time');
    for (let i = 0; i < 10; i++) { await a.waitForFunction(() => KT && KT.ph === 'go', null, { timeout: 8000 }); const c = await a.evaluate(() => KT.cor), want = i === 4 ? (c + 1) % 3 : c;
      if (i % 2) await a.keyboard.press(String(want + 1)); else await a.click(`.klanes button >> nth=${want}`);
      await a.evaluate(() => { KT.gs -= KT.win }); await a.waitForFunction(() => KT.ph !== 'go');
      if (i === 4 && !/Bump! It was/.test(await a.textContent('#kfb'))) fail('a wrong lane does not show the answer') }
    await a.waitForSelector('text=Gold medal!'); const kr = await a.evaluate(g => ({ gems: GEMS() - g, best: (ARS('kart').bt || {}).sun, ok: KT.ok, n: KT.n, next: ktOpen(1), last: ktOpen(3) }), kg0);
    if (kr.ok !== 9 || kr.n !== 10 || kr.gems !== 6 || kr.best == null || !kr.next || kr.last || !(await a.isVisible('text=New track unlocked: Candy Canyon'))) fail('race result wrong: ' + JSON.stringify(kr));
    ok(`Turbo Trivia Kart: ${kc.n} questions all made 3 different lanes with the right answer; 9 of 10 gates right (taps and number keys) won gold and 6 gems (3 for gold, 3 for a first best time) and unlocked Candy Canyon (12 gates); a wrong lane shows the answer; racing uses play time`); await shot(a, 'g-kart');
    // Goblin Gate: build with a right answer, the field pauses during questions, upgrades need answers in a row
    await a.evaluate(() => toHub()); await a.click('.tile:has-text("Goblin Gate")'); await a.click('text=Start defending'); await a.waitForSelector('#gp0');
    await a.click('#gp0'); await a.click('.tpick button:has-text("Laser tower")'); await answerQM(a, true); await a.waitForFunction(() => !QM && GT.tw[0] && GT.tw[0].lv === 1);
    await a.click('#gwave'); await a.waitForFunction(() => GT.gobs.length > 0 && GT.gobs[0].d > 20); await a.click('#gp1'); await a.waitForSelector('.tpick');
    const gd0 = await a.evaluate(() => GT.gobs.map(g => g.d.toFixed(2)).join()); await a.waitForTimeout(700); const gd1 = await a.evaluate(() => GT.gobs.map(g => g.d.toFixed(2)).join());
    if (gd0 !== gd1) fail('goblins kept moving while a question menu was open'); await a.click('#qmodal >> text=Not now'); await a.waitForFunction(() => !QM && !GT.paused);
    await a.click('#gp0'); await a.click('text=Start the upgrade'); await answerQM(a, true); await answerQM(a, false); await a.waitForSelector('#qmok'); await a.click('#qmok'); await a.waitForFunction(() => !QM);
    if (await a.evaluate(() => GT.tw[0].lv) !== 1) fail('an upgrade went through after a miss');
    const gg0 = await a.evaluate(() => GEMS()); await a.evaluate(() => { GT.tw = GT.tw.map((t, i) => ({ t: ['laser', 'frost', 'bubble'][i % 3], lv: 3, cd: 0 })); for (let i = 0; i < 6000 && ['build', 'wave'].includes(GT.ph); i++) { if (GT.ph === 'build') gateWave(); gateStep(.05) } });
    await a.waitForSelector('text=The castle is safe!'); const gr = await a.evaluate(g => ({ gems: GEMS() - g, stars: GT.stars, best: (ARS('gate').st || {}).meadow, forest: gmOpen(1), snow: gmOpen(2) }), gg0);
    if (gr.gems !== [0, 3, 5, 8][gr.stars] || gr.best !== gr.stars || !gr.forest || gr.snow || !(await a.isVisible('text=New map unlocked: Forest Trail'))) fail('castle reward wrong: ' + JSON.stringify(gr));
    ok(`Goblin Gate: a right answer built a laser tower, goblins froze while a menu was open, a miss stopped the upgrade, 4 waves of Meadow Path defended for ${gr.stars} stars and ${gr.gems} gems, unlocking Forest Trail (6 waves)`); await shot(a, 'g-gate');
    // Block Builder: side-by-side and stacked blocks that make 10 clear
    await a.evaluate(() => toHub()); await a.click('.tile:has-text("Block Builder")'); await a.click('.accs >> text=Make 10'); await a.click('text=Start building'); await a.waitForSelector('.bcell.cur');
    await a.evaluate(() => { BB.g[8][0] = 4; BB.cur = { v: 6, c: 3, r: 0 }; bbPaint() }); await a.keyboard.press('ArrowLeft'); await a.keyboard.press('ArrowLeft'); await a.keyboard.press(' ');
    const bb1 = await a.evaluate(() => ({ clears: BB.clears, row: BB.g[8].join(), feed: BB.feed[0] }));
    if (bb1.clears !== 1 || bb1.row !== '0,0,0,0,0,0' || bb1.feed !== '4 + 6 = 10') fail('side-by-side clear wrong: ' + JSON.stringify(bb1));
    await a.evaluate(() => { BB.g[8][5] = 2; BB.cur = { v: 8, c: 5, r: 0 }; bbPaint() }); await a.click('.bcell >> nth=5');
    if (await a.evaluate(() => BB.clears) !== 2) fail('a stacked 2 + 8 did not clear (tapping the block\'s own column should drop it)');
    const lv = await a.evaluate(() => { BB.clears = 4; BB.g[8][0] = 9; BB.cur = { v: 1, c: 1, r: 8 }; bbDrop(); return { lv: BB.lv, feed: BB.feed[0] } });
    if (lv.lv !== 2 || !/Level 2/.test(lv.feed)) fail('5 clears did not reach level 2: ' + JSON.stringify(lv));
    const bg0 = await a.evaluate(() => GEMS()); await a.evaluate(() => { for (let r = 0; r < 9; r++) for (let c = 0; c < 6; c++) BB.g[r][c] = r === 0 && c === 2 ? 0 : 1; BB.clears = 8; BB.cur = { v: 1, c: 2, r: 0 }; bbDrop() });
    await a.waitForSelector('text=Tower full!'); const bgem = await a.evaluate(g => GEMS() - g, bg0); if (bgem !== 2) fail('Block Builder paid ' + bgem + ' gems for 9 clears');
    ok('Block Builder: 4 + 6 side by side and 2 + 8 stacked both cleared, the 5th clear reached level 2, and a full tower ends the round with 2 gems for 9 clears'); await shot(a, 'g-blocks');
    // Dungeon Dash: move, recharge magic with answers, level up, dodge, take the stairs
    await a.evaluate(() => toHub()); await a.click('.tile:has-text("Dungeon Dash")'); await a.waitForSelector('.ddhero');
    const heroes = await a.$$eval('.ddhero > b', b => b.map(x => x.textContent)); if (heroes.length !== 4 || !(await a.isVisible('#dddash'))) fail('hero select or upgrade dashboard missing: ' + heroes.join(', '));
    await a.evaluate(() => { ARS('dash').gold = 100; rerealm() }); await a.click('#dddash [data-up=hp]'); await a.click('#dddash [data-up=hp]');
    const bought = await a.evaluate(() => ({ gold: ARS('dash').gold, hp: dLv('thromar', 'hp') })); if (bought.gold !== 40 || bought.hp !== 2) fail('upgrade dashboard purchase wrong: ' + JSON.stringify(bought));
    if (!(await a.isDisabled('#dddash [data-up=hp]'))) fail('an upgrade was buyable without enough coins');
    await a.click('.ddhero[data-hero=vespera]'); await a.click('text=Enter the dungeon as Vespera'); await a.waitForSelector('#ddcv');
    const vh = await a.evaluate(() => ({ hero: DD.hero, max: DD.h.max })); if (vh.hero !== 'vespera' || vh.max !== 4) fail('Vespera did not start with 4 hearts: ' + JSON.stringify(vh));
    const sp = await a.evaluate(() => { const r = {}, H = DD.h, put = (k, dx, dy) => { DD.mons = []; ddSpawn(k); const m = DD.mons[0]; m.x = H.x + dx; m.y = H.y + dy; m.cd = 99; return m };
      DD.ch = 40; let m = put('imp', 200, 0); H.sp = 0; ddSpecial(); r.blink = [Math.round(Math.hypot(H.x - m.x, H.y - m.y)), H.stealth > 0, m.hp < m.max];
      DD.hero = 'thromar'; DD.mons = []; H.sp = 0; H.stealth = 0; ddSpecial(); m = put('slime', 0, 0); m.hp = 50; m.max = 50; ddStep(.016); r.ward = [m.hp < 50, m.stun > DD.t];
      DD.hero = 'aegis'; DD.mons = []; H.sp = 0; m = put('slime', 220, 0); m.cd = 99; ddSpecial(); const w = DD.walls[0]; DD.mons = []; DD.foes = [{ k: 'fire', x: w.x + w.nx * 40, y: w.y + w.ny * 40, vx: -w.nx * 300, vy: -w.ny * 300, r: 9, b: 3, life: 5 }]; for (let i = 0; i < 10; i++) ddStep(.016); r.shield = DD.foes.length === 0 && H.hp === H.max;
      DD.hero = 'malakor'; DD.walls = []; DD.zones = []; H.sp = 0; H.hp = 2; ddSpecial(); for (let i = 0; i < 40; i++) ddStep(.025); r.mist = H.hp;
      DD.hero = 'vespera'; DD.mons = []; DD.foes = []; DD.zones = []; H.hp = H.max; H.inv = 0; H.stealth = 0; return r });
    if (!(sp.blink[0] < 80 && sp.blink[1] && sp.blink[2]) || !sp.ward[0] || !sp.ward[1] || !sp.shield || sp.mist < 3) fail('special moves wrong: ' + JSON.stringify(sp));
    ok('Dungeon Dash heroes: 4 to choose from; the upgrade dashboard sold 2 heart levels for 60 coins and blocked a third without coins; Vespera started with 4 hearts; Blink Strike, Rune Ward, Energy Shield and Healing Mist all worked: ' + JSON.stringify(sp));
    await a.evaluate(() => { stopGames(); ARS('dash').hero = 'thromar'; rerealm() }); await a.click('text=Enter the dungeon as Thromar'); await a.waitForSelector('#ddcv');
    if (await a.evaluate(() => DD.h.max) !== 9) fail('Thromar\'s 2 heart upgrades did not apply');
    const dp0 = await a.evaluate(() => DAY().play); await a.evaluate(() => realmTick(5)); if (await a.evaluate(() => DAY().play) !== dp0 + 5) fail('a dungeon run did not use play time');
    await a.keyboard.press('p'); const pz = await a.evaluate(() => { const d = DAY().play; realmTick(5); return [DD.ph, DAY().play - d] }); await a.keyboard.press('p');
    if (pz[0] !== 'pause' || pz[1] !== 0 || await a.evaluate(() => DD.ph) !== 'run') fail('pausing did not stop the play-time clock: ' + pz.join(' '));
    const dx0 = await a.evaluate(() => DD.h.x); await a.keyboard.down('ArrowLeft'); await a.waitForTimeout(450); await a.keyboard.up('ArrowLeft'); const dx1 = await a.evaluate(() => DD.h.x);
    if (!(dx1 < dx0 - 30)) fail(`the hero did not move left with the arrow key: ${dx0} -> ${dx1}`);
    await a.evaluate(() => { DD.ch = 0; DD.low = .01 }); await answerQM(a, true); await a.waitForFunction(() => !QM && !DD.asking); const ch1 = await a.evaluate(() => DD.ch); if (ch1 < 15) fail('a right answer gave only ' + ch1 + ' charges');
    await a.evaluate(() => { DD.ch = 0; ddRecharge() }); for (let i = 0; i < 3; i++) { await answerQM(a, false); await a.waitForSelector('#qmok'); await a.click('#qmok') }
    await a.waitForFunction(() => !QM && !DD.asking); const ch2 = await a.evaluate(() => ({ ch: DD.ch, streak: DD.streak })); if (ch2.ch !== 6 || ch2.streak !== 0) fail('3 misses should lend 6 charges: ' + JSON.stringify(ch2));
    await a.evaluate(() => { DD.force = 'phoenix'; DD.jw = DD.need }); await answerQM(a, true); await a.waitForSelector('#ddeq'); const rt = await a.textContent('#ddrt'); const luck = await a.isVisible('.ddluck'); await a.click('#ddeq'); await a.waitForFunction(() => !QM && !DD.asking);
    const up1 = await a.evaluate(() => ({ gear: DD.gear.join(), fx: DD.fx.phoenix, lvl: DD.lvl, found: !!(ARS('dash').found || {}).phoenix })); if (!/LEGENDARY/.test(rt) || !luck || up1.gear !== 'phoenix' || up1.fx !== 1 || up1.lvl !== 2 || !up1.found) fail('the level-up gear roll went wrong: ' + rt + ' ' + JSON.stringify(up1));
    const rev = await a.evaluate(() => { const H = DD.h; H.hp = 1; H.inv = 0; ddHurt(); return { hp: H.hp, max: H.max, fx: DD.fx.phoenix, ph: DD.ph } }); if (rev.hp !== rev.max || rev.fx !== 2 || rev.ph !== 'run') fail('the Phoenix Feather did not revive the hero: ' + JSON.stringify(rev));
    const dist = await a.evaluate(() => { const Z = DD, P0 = { ...Z.pity }, c = [0, 0, 0, 0]; for (let i = 0; i < 4000; i++) { Z.pity = { n: 0, m: 0 }; c[ddRollPick(false).r]++ } Z.pity = P0; return c.map(x => x / 40) });
    if (!(dist[0] > dist[1] && dist[1] > dist[2] && dist[2] > dist[3] && dist[3] > 1 && dist[3] < 7)) fail('gear rarities are off: ' + dist.join('% / ') + '%');
    const hp = await a.evaluate(() => { const H = DD.h; H.inv = 0; const h0 = H.hp; DD.foes.push({ k: 'fire', x: H.x, y: H.y, vx: 0, vy: 0, r: 9, b: 3, life: 5 }, { k: 'missile', x: H.x + 2, y: H.y, vx: 1, vy: 0, r: 8, life: 5 }); ddStep(.016); return [h0, H.hp] });
    if (hp[1] !== hp[0] - 1) fail('a fireball and a missile together should cost exactly one heart: ' + hp.join(' -> '));
    await a.evaluate(() => { DD.wave = 5; DD.gated = 0; DD.left = 0; DD.mons = []; DD.waveDone = 1; DD.between = .01 }); await a.waitForFunction(() => QM && QM.phase === 'ask');
    if (!/Stairs to floor 2/.test(await a.textContent('#qmt'))) fail('wave 5 did not lead to the stairs question'); await answerQM(a, true); await a.waitForFunction(() => !QM && !DD.asking);
    const fl = await a.evaluate(() => ({ floor: DD.floor, wave: DD.wave })); if (fl.floor !== 1 || fl.wave !== 6) fail('the stairs did not lead to floor 2, wave 6: ' + JSON.stringify(fl));
    const dg0 = await a.evaluate(() => GEMS()); await a.evaluate(() => { DD.cleared = 5; DD.h.hp = 1; DD.h.inv = 0; ddHurt() }); await a.waitForSelector('text=Your hero needs a rest!');
    const dres = await a.evaluate(g => ({ gems: GEMS() - g, best: ARS('dash').wave, gold: ARS('dash').gold }), dg0); if (dres.gems !== 5 || dres.best !== 6 || dres.gold !== 40) fail('run result wrong (upgrade coins must come from studying, not the run): ' + JSON.stringify(dres));
    ok(`Dungeon Dash: P pauses the game and the play-time clock, the arrow keys move the hero, a right answer recharges 15+ bolts, 3 misses still lend 6, a first-try level-up rolls luckier gear (forced Legendary Phoenix Feather, which then revived the hero), rarities fall from Common to Legendary (${dist.map(x => x.toFixed(1)).join('/')}%), a fireball plus a missile cost one heart, wave 5 opens the stairs to floor 2 with a question, and the run paid 1 gem per wave cleared without adding upgrade coins`); await shot(a, 'g-dash');
    // Upgrade coins are earned by studying
    const sc = await a.evaluate(() => { const S = ARS('dash'), g0 = S.gold || 0, D = DAY(); D.ok += 5; gameCheck(); const g1 = S.gold; D.mis++; D.cw++; gameCheck(); const g2 = S.gold; const l0 = D.les; D.les = Math.max(D.les, 3) + 4; gameCheck(); const g3 = S.gold; return { a: g1 - g0, b: g2 - g1, c: g3 - g2, l0 } });
    if (sc.a !== 5 || sc.b !== 30 || sc.c !== 5 * Math.max(0, 3 - Math.min(3, sc.l0))) fail('study coins wrong: ' + JSON.stringify(sc));
    await a.evaluate(() => { stopGames(); rerealm() }); await a.waitForSelector('.ddnewc'); if (!/studying earned/.test(await a.textContent('.ddnewc')) || !(await a.isVisible('.ddearn'))) fail('the dashboard does not show study coins or how to earn them');
    ok('Upgrade coins come from studying: 5 right practice answers gave 5 coins, a mission plus classwork gave 30, lessons count up to 3 a day, and the upgrade dashboard shows what was earned and how to earn more');
    // Snake Arena: answer orbs, a second chance, and gems at the end of a round
    await a.evaluate(() => toHub()); await a.click('.tile:has-text("Snake Arena")'); await a.waitForSelector('text=Start a round');
    await a.waitForFunction(() => SNDEMO && SNDEMO.g.snakes.length > 5); await a.click('.snset button:text-is("Easy")'); await a.click('.snset button:text-is("10")');
    await a.click('text=Start a round'); await a.waitForSelector('#snhud span');
    const sn0 = await a.evaluate(() => ({ run: AR.run, bots: SNZ.g.bots.length, diff: SNZ.g.difficulty, demo: !!SNDEMO })); if (!sn0.run || sn0.bots !== 10 || sn0.diff !== 'easy' || sn0.demo) fail('snake round did not start right: ' + JSON.stringify(sn0));
    await a.waitForFunction(() => SNZ.q && SNZ.orbs.length === 3, null, { timeout: 8000 });
    const snR = await a.evaluate(() => { const Z = SNZ, p = Z.g.player, o = Z.orbs[Z.q.cor], m = p.mass; p.x = o.x; p.y = o.y; return m });
    await a.waitForFunction(() => SNZ.ok === 1); const snR1 = await a.evaluate(() => ({ m: SNZ.g.player.mass, sh: SNZ.g.player.shield }));
    if (!(snR1.m >= snR + 29 && snR1.sh > 4)) fail('a right answer orb should grow the snake by 30 and shield it: ' + JSON.stringify({ snR, snR1 }));
    await a.waitForFunction(() => SNZ.q && SNZ.orbs.length === 3, null, { timeout: 8000 });
    const snW = await a.evaluate(() => { const Z = SNZ, p = Z.g.player, o = Z.orbs[(Z.q.cor + 1) % 3], m = p.mass; p.x = o.x; p.y = o.y; return m });
    await a.waitForFunction(() => SNZ.n === 2); const snW1 = await a.evaluate(() => SNZ.g.player.mass); if (!(snW1 < snW)) fail('a wrong answer orb should shrink the snake');
    await a.keyboard.press('p'); const snT = await a.evaluate(() => [SNZ.g.time, AR.paused]); await a.waitForTimeout(300); if (snT[0] !== await a.evaluate(() => SNZ.g.time) || !snT[1]) fail('pausing Snake Arena did not stop the game'); await a.keyboard.press('p');
    await a.evaluate(() => { const s = SNZ.g.player; s.shield = 0; s.x = 2995; s.y = 0 }); await a.waitForFunction(() => QM && QM.phase === 'ask');
    if (!/Second chance/.test(await a.textContent('#qmt'))) fail('no second-chance question after a knock-out'); await answerQM(a, true);
    await a.waitForFunction(() => !QM && SNZ.ph === 'run'); const snB = await a.evaluate(() => ({ m: SNZ.g.player.mass, lost: SNZ.lost, sh: SNZ.g.player.shield })); if (Math.abs(snB.m - Math.max(20, snB.lost / 2)) > 1 || !(snB.sh > 0)) fail('second chance should bring back half the length with a shield: ' + JSON.stringify(snB));
    const sng0 = await a.evaluate(() => GEMS()); await a.evaluate(() => { const s = SNZ.g.player; s.shield = 0; s.x = 2995; s.y = 0 }); await a.waitForSelector('text=Round over!');
    const snEnd = await a.evaluate(g => ({ gems: GEMS() - g, S: ARS('snake'), run: AR.run }), sng0); if (snEnd.gems !== 1 || snEnd.S.rounds !== 1 || snEnd.S.right !== 1 || !snEnd.S.best || snEnd.run) fail('Snake Arena round end wrong: ' + JSON.stringify(snEnd));
    ok('Snake Arena: easy bots, a right answer orb grew the snake and gave a star shield, a wrong one shrank it, P paused, a knock-out offered a second chance that brought back half the length, and the round paid 1 gem per right answer'); await shot(a, 'g-snake');

    // Out of play time: the action games stop at the start screen; the pet can still be visited
    await a.evaluate(() => { DAY().play = playAllowed(); toHub() }); if (!(await a.isVisible('.tile:has-text("Pet Pals") >> text=Visit'))) fail('Pet Pals is not open when play time is over');
    await a.click('.tile:has-text("Turbo Trivia Kart")'); if (!(await a.isDisabled('text=Start race'))) fail('a race can start with no play time left');
    ok('out of play time, races and rounds cannot start, but Pet Pals is still open');
    await a.evaluate(() => { BT = null; DAY().play = playAllowed() });

    // Next Level (the second Arcade tab): it works with no play time left and uses none
    await a.evaluate(() => toHub()); await a.click('.arctabs button.next'); await a.waitForSelector('.nl .nltiles');
    const nlT = await a.$$eval('.nltile .nlname', b => b.map(x => x.textContent).join(', ')); if (nlT !== 'Skill Tree, Cipher, Equation Code, Market Sim, Crossroads, Lab Bench') fail('Next Level tiles: ' + nlT);
    if (await a.evaluate(() => GM.arc) !== 'next') fail('the Next Level tab was not remembered');
    const nlPlay = await a.evaluate(() => DAY().play);
    await a.click('.nltile:has-text("Cipher")'); await a.waitForSelector('.pzgrid');
    await a.keyboard.type('zzxqv'); await a.keyboard.press('Enter'); await a.waitForFunction(() => /Not in the word list/.test($('pzmsg').textContent));
    for (let i = 0; i < 5; i++) await a.keyboard.press('Backspace');
    const cw = await a.evaluate(() => cipherOf()[1]), cx0 = await a.evaluate(() => XP()); await a.keyboard.type(cw); await a.keyboard.press('Enter'); await a.waitForSelector('.pzend');
    const cst = await a.evaluate(x => ({ w: NL().st.c.w, xp: XP() - x, d: document.querySelector('.pzend').textContent }), cx0);
    if (cst.w !== 1 || cst.xp < 15 || !cst.d.toUpperCase().includes(cw.toUpperCase())) fail('Cipher win not recorded: ' + JSON.stringify(cst));
    await a.evaluate(() => nlOpen('eqcode')); await a.waitForSelector('.pzgrid'); await a.keyboard.type('12+35=48'); await a.keyboard.press('Enter');
    await a.waitForFunction(() => /isn't true/.test($('pzmsg').textContent)); for (let i = 0; i < 8; i++) await a.keyboard.press('Backspace');
    const [eqT, eqP] = await a.evaluate(() => [eqOf(), eqProblem(eqOf())]); if (eqT.length !== 8 || eqP) fail('bad equation of the day: ' + eqT + ' ' + eqP);
    await a.keyboard.type(eqT); await a.keyboard.press('Enter'); await a.waitForSelector('.pzend'); if (await a.evaluate(() => NL().st.e.w) !== 1) fail('Equation Code win not recorded');
    await a.evaluate(() => nlOpen('market')); await a.click('text=Start investing'); await a.waitForSelector('.mka');
    await a.fill('#mkqLEAF', '10'); await a.click('.mka:has-text("GreenLeaf") button:text-is("Buy")');
    const mk1 = await a.evaluate(() => ({ cash: MK().cash, hold: MK().hold.LEAF })); if (mk1.hold !== 10 || Math.abs(mk1.cash - (10000 - 300 - 2)) > .001) fail('buying shares went wrong: ' + JSON.stringify(mk1));
    const lg0 = await a.evaluate(() => GEMS()); await a.click('text=Next month ▶'); await a.waitForSelector('.mknews h3');
    const loop = await a.evaluate(g => ({ streak: NL().streak, gems: GEMS() - g }), lg0); if (loop.streak !== 1 || loop.gems !== 5) fail('daily loop reward wrong: ' + JSON.stringify(loop));
    await a.click('text=Next month ▶'); await a.click('text=Next month ▶'); await a.click('text=Take the question'); await answerQM(a, true);
    await a.waitForSelector('.mkrep:has-text("Research report")');
    while (!(await a.$('text=Year complete'))) await a.click('text=Next month ▶');
    const mkEnd = await a.evaluate(() => ({ runs: NL().st.mk.runs, got: NL().got, play: DAY().play })); if (mkEnd.runs !== 1 || !mkEnd.got.includes('investor')) fail('Market Sim year end wrong: ' + JSON.stringify(mkEnd));
    if (mkEnd.play !== nlPlay) fail('Next Level used play time');
    ok('Next Level: its own Arcade tab, remembered; Cipher rejects words not in the word list and records a win; Equation Code rejects a false equation and solves today\'s; Market Sim buys shares with a $2 fee, the daily loop paid +5 gems with a 1-day streak, the Research Desk showed next month\'s headline after a right answer, and a full year earned the Investor title, all with no play time left'); await shot(a, 'g-next');
    // Skill Tree: skill points from mastery, perks, a goal path, and reaching the goal
    await a.evaluate(() => { window.__S0 = JSON.parse(JSON.stringify(S)) });
    const tk = await a.evaluate(() => { const ks = ORDER.filter(k => SK[k].sub === 'math' && !SK[k].pre.length).slice(0, 3); ks.forEach((k, i) => Object.assign(S[k], { att: 8, p: .92, mastered: i === 0 })); GM.calm = true; return ks });
    await a.evaluate(() => nlOpen('path')); await a.waitForSelector('.pttier'); const sp0 = await a.evaluate(() => ptSP()); if (sp0.earned !== 4 || sp0.left !== 4) fail('skill points wrong: ' + JSON.stringify(sp0));
    await a.click('.perk:has-text("Aurora")'); await a.click('.perk:has-text("Hex")'); const pk = await a.evaluate(() => ({ p: NL().perk, sp: ptSP().left })); if (pk.p.banner !== 'aurora' || pk.p.frame !== 'hex' || pk.sp !== 1) fail('perks wrong: ' + JSON.stringify(pk));
    await a.click('text=Buy for 2 points'); if (await a.evaluate(() => NL().freeze || 0)) fail('a streak freeze was bought without enough points');
    const gk = await a.evaluate(() => ORDER.find(k => SK[k].sub === 'math' && SK[k].pre.length && level(k) < 3)); await a.evaluate(k => { PTSEL = k; rerealm() }, gk); await a.click('text=Set as goal');
    const gpath = await a.evaluate(() => ({ goal: NL().goal, route: ptRoute(NL().goal).size, shown: document.querySelectorAll('.ptn.route').length })); if (gpath.goal !== gk || gpath.route < 1 || gpath.shown < 1) fail('goal path wrong: ' + JSON.stringify(gpath));
    await a.evaluate(() => toHub()); if (!/Next on your path/.test(await a.textContent('.nl'))) fail('the hub does not show the next step on the goal path');
    await a.evaluate(k => Object.assign(S[k], { att: 8, p: .92 }), gk); await a.evaluate(() => rerealm()); await a.waitForFunction(() => (NL().goalsDone || 0) === 1 && !NL().goal && NL().got.includes('pathfinder'));
    ok('Skill Tree: 3 Proficient skills (one Mastered) gave 4 skill points, a banner and a frame were bought and worn, a streak freeze was refused without points, a goal lit its path on the tree and the hub, and reaching it earned Pathfinder');
    // Crossroads: the historical path in Thirteen Days, then a choice that ends in war
    await a.evaluate(() => nlOpen('xr')); await a.click('.xrcard:has-text("Thirteen Days") >> text=Begin');
    for (let i = 0; i < 5; i++) { await a.waitForSelector('.xropt'); const j = await a.evaluate(() => { const Z = NL().xr; return XR.find(x => x.id === Z.id).steps[Z.i].o.findIndex(o => o.h) }); await a.click(`.xropt >> nth=${j}`); await a.waitForSelector('.xrnote'); await a.click('.nlbtn:has-text("→")') }
    await a.waitForSelector('text=Historian\'s eye'); const xe = await a.evaluate(() => ({ t: document.querySelector('#xrtop h2').textContent, hist: NL().xr.hist, got: NL().got }));
    if (!/peaceful solution/.test(xe.t) || xe.hist !== 5 || !xe.got.includes('strategist') || !xe.got.includes('steady')) fail('Crossroads ending wrong: ' + JSON.stringify(xe));
    await a.click('text=Try different choices'); await a.click('.xropt >> nth=0'); await a.click('.nlbtn:has-text("→")'); await a.click('.xropt >> nth=0'); await a.click('text=See what happened');
    if (!/turns into war/.test(await a.textContent('#xrtop h2'))) fail('bombing then invading did not end in war');
    ok('Crossroads: Thirteen Days with history\'s choices ended in "A peaceful solution" with a Historian\'s eye of 5 of 5 (Strategist and Steady Hand titles); bombing and then invading ended the story in war');
    // Lab Bench: a fair test, a conclusion that must match the data, and titrations
    await a.evaluate(() => nlOpen('lab')); await a.waitForSelector('#pjcv'); await a.click('.nlchip:text-is("45°")');
    for (const [n, ang] of [15, 30, 45, 60, 75].entries()) { await a.evaluate(x => { PJ.a = x; PJ.v = 20; PJ.g = 'earth' }, ang); await a.click('text=🚀 Launch'); await a.waitForFunction(c => LB().p.trials.length === c, n + 1) }
    const r45 = await a.evaluate(() => LB().p.trials.find(t => t.a === 45).R); if (Math.abs(r45 - 400 / 9.8) > .01) fail('projectile range at 45° should be v²/g: ' + r45);
    await a.click('.lbopt .nlchip >> nth=0'); await a.click('text=Check my conclusion'); if (await a.evaluate(() => LB().p.done)) fail('a wrong claim was accepted');
    await a.click('.lbopt .nlchip >> nth=1'); const e45 = await a.evaluate(() => LB().p.trials.findIndex(t => t.a === 45)); await a.click(`.nlchip:has-text("#${e45 + 1}:")`); await a.click('.lbopt >> nth=1 >> .nlchip >> nth=0'); await a.click('text=Check my conclusion');
    if (!(await a.evaluate(() => LB().p.done && NL().got.includes('physicist')))) fail('the Projectile Lab conclusion was not accepted');
    await a.click('text=Titration Lab'); await a.waitForSelector('.ttmeter'); await a.evaluate(() => { const T = LB().t; T.vb = 24.9; T.pts.push([24.9, +ttPH(T.ca, 24.9).toFixed(2)]); rerealm() });
    const ph249 = await a.evaluate(() => ttPH(.1, 24.9)); await a.click('button:text-is("+1 drop")'); await a.click('button:text-is("+1 drop")'); await a.click('text=Mark endpoint');
    const tt = await a.evaluate(() => ({ end: LB().t.end, stars: LB().t.stars, ph: ttPH(.1, 25.1) })); if (tt.end !== 25 || tt.stars !== 3 || Math.abs(ph249 - 3.7) > .02 || Math.abs(tt.ph - 10.3) > .02) fail('titration wrong: ' + JSON.stringify({ ph249, ...tt }));
    await a.click('text=Unknown acid'); await a.evaluate(() => { const T = LB().t, v = Math.round(T.ca * 250 * 100) / 100; T.vb = v; T.pts.push([v, +ttPH(T.ca, v).toFixed(2)]); rerealm() }); await a.click('text=Mark endpoint');
    await a.fill('#ttans', '0.5'); await a.click('#ttans ~ button:text-is("Check")'); if (await a.evaluate(() => LB().t.solved)) fail('a wrong concentration was accepted');
    await a.evaluate(() => { $('ttans').value = (0.1 * LB().t.end / 25).toFixed(4) }); await a.click('#ttans ~ button:text-is("Check")'); if (!(await a.evaluate(() => LB().t.solved && NL().got.includes('chemist')))) fail('the unknown acid was not solved');
    await a.evaluate(() => { GM.calm = false; for (const k of Object.keys(window.__S0)) S[k] = window.__S0[k] }); if (await a.evaluate(() => DAY().play) !== nlPlay) fail('Next Level phase 2 used play time');
    ok('Lab Bench: 5 angles at 20 m/s gave v²/g at 45°, a wrong claim was rejected and the right claim, evidence and reasoning earned Physicist; titration pH is 3.70 at 24.90 mL and 10.30 at 25.10 mL, a 25.00 mL endpoint scored 3 stars, and the unknown acid was solved with M1V1 = M2V2 (Chemist)'); await shot(a, 'g-lab');
    await a.evaluate(() => { GM.arc = 'young'; toHub() });

    // Classwork turned in: XP and gems once
    await a.click('#tabs >> text=My classes'); await a.waitForSelector('button:text-is("Start")');
    await a.click('button:text-is("Start")'); await a.waitForSelector('.items');
    const n = await a.$$eval('.items > li', l => l.length);
    for (let i = 0; i < n; i++) { const li = (await a.$$('.items > li'))[i];
      if (await li.$('input[type=radio]')) await (await li.$$('input[type=radio]'))[0].check(); else if (await li.$('input[type=text]')) await (await li.$('input[type=text]')).fill('12'); else await (await li.$('textarea')).fill('my answer') }
    const before = await a.evaluate(() => ({ xp: XP(), gems: GEMS(), cw: DAY().cw, food: PET().food, tre: GM.tre.length }));
    await a.click('button:has-text("Turn in")'); await a.waitForSelector('text=Nice work');
    const after = await a.evaluate(() => ({ xp: XP(), gems: GEMS(), cw: DAY().cw, done: GM.done.length, food: PET().food, tre: GM.tre.length }));
    // Turning in work can also complete a treasure (10 gems each), counted separately
    if (after.xp - before.xp !== 30 || after.gems - before.gems - 10 * (after.tre - before.tre) !== 5 || after.cw !== before.cw + 1 || after.food - before.food !== 2) fail('classwork reward wrong: ' + JSON.stringify([before, after]));
    ok('turning in classwork gave +30 XP, +5 gems and 2 pet snacks'); await save(a);

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
    // Membership: the Owner offers it with Stripe payment links, kids see it only after a grown-up check, the Owner switches it on
    await ow.evaluate(() => reload('owner')); await ow.waitForSelector('text=⭐ Membership'); await ow.click('text=⭐ Membership'); await ow.waitForSelector('#mln');
    await ow.check('#mon'); await ow.fill('#mpr', '$4.99 a month'); await ow.fill('#mln', 'https://buy.stripe.com/test_M1'); await ow.fill('#mypr', '$39.99 a year'); await ow.fill('#myln', 'https://buy.stripe.com/test_Y1'); await ow.fill('#mct', 'help@school.org');
    await ow.click('text=Save offer'); await ow.waitForSelector('text=Membership offer saved.');
    const bad = await call(ow, 'PUT', '/api/owner/settings', { member: { on: true, link: 'javascript:alert(1)' } }); const bady = await call(ow, 'PUT', '/api/owner/settings', { member: { on: true, link: 'https://buy.stripe.com/x', ylink: 'http://evil.example/' } });
    if (bad.s !== 400 || bady.s !== 400) fail('a non-https payment link was accepted');
    ok('owner offers a monthly plan ($4.99 a month) and an annual plan ($39.99 a year) with Stripe payment links (non-https links refused)');
    await a.reload(); await a.waitForSelector('#avatarBtn'); await a.evaluate(() => { DAY().play = playAllowed() }); await a.click('#tabs >> text=Arcade');
    await a.waitForSelector('text=Rest your eyes, hero!'); await a.click('text=⭐ Membership (for grown-ups)'); await a.waitForSelector('#gatein');
    if (await a.isVisible('a.paybtn')) fail('a learner saw the price before the grown-up check');
    await a.fill('#gatein', '1'); await a.click('.gate button'); await a.waitForSelector('text=Not quite. Please ask a grown-up.');
    await a.fill('#gatein', String(await a.evaluate(() => MGATE.a * MGATE.b))); await a.click('.gate button'); await a.waitForSelector('a.paybtn');
    const pay = await a.evaluate(() => ({ plans: [...document.querySelectorAll('.mplan')].map(p => [p.dataset.plan, p.querySelector('a.paybtn').href, p.querySelector('a.paybtn').textContent, p.textContent.includes('Best value')]), ref: $('mref').value, page: $('views').textContent }));
    const [pm, py] = pay.plans, u0 = creds[0][1]; if (pay.plans.length !== 2 || pm[0] !== 'month' || pm[1] !== 'https://buy.stripe.com/test_M1?client_reference_id=' + u0 || py[0] !== 'year' || py[1] !== 'https://buy.stripe.com/test_Y1?client_reference_id=' + u0
      || !/Pay with card/.test(pm[2] + py[2]) || pm[3] || !py[3] || pay.ref !== u0 || !pay.page.includes('$4.99 a month') || !pay.page.includes('$39.99 a year') || !pay.page.includes('one month or one year')) fail('offer page wrong: ' + JSON.stringify(pay).slice(0, 500));
    ok('out of play time, a learner sees "ask a grown-up"; after the grown-up check: Monthly and Annual (best value) plans, each paying with card through Stripe with their username as the reference');
    await a.fill('#mref', 'not ok!'); const badRef = await a.evaluate(() => [$('mref').getAttribute('aria-invalid'), $('mrefmsg').textContent, document.querySelector('a.paybtn').href]);
    await a.fill('#mref', ''); await a.click('.mplan[data-plan=month] a.paybtn'); const stopped = await a.textContent("#mrefmsg");
    if (badRef[0] !== 'true' || !badRef[1] || badRef[2] !== 'https://buy.stripe.com/test_M1' || !/username or a class code first/.test(stopped) || a.context().pages().length !== 1) fail('reference check wrong: ' + JSON.stringify([badRef, stopped]));
    ok('a bad or empty username stops the pay button with a message instead of sending it to Stripe');
    await t.reload(); await t.waitForSelector('#avatarBtn'); await t.click('#tabs >> text=Teacher'); await t.waitForSelector('.cls'); await t.evaluate(() => go('member')); await t.waitForSelector('a.paybtn');
    const tref = await t.evaluate(() => [ST.classes[0].code, $('mref').value, document.querySelector('a.paybtn').href, $('views').textContent]);
    if (tref[1] !== tref[0] || !tref[2].endsWith('client_reference_id=' + tref[0]) || !tref[3].includes(tref[0])) fail('teacher offer does not use the class code: ' + JSON.stringify(tref.slice(0, 3)));
    const one = await t.evaluate(() => { BOOT.settings.member = { ...BOOT.settings.member, link: '' }; showTab('member'); return [...document.querySelectorAll('.mplan')].map(p => p.dataset.plan + (p.textContent.includes('Best value') ? '+best' : '')) });
    if (one.join() !== 'year') fail('with only an annual link the page showed ' + one.join());
    ok('teachers see the offer right away, already set to their class code; with only one plan\'s link, only that plan shows');
    const code = await t.evaluate(() => ST.classes[0].code);
    await ow.fill('#mwho', creds[0][1]); await ow.selectOption('#mlen', '3'); await ow.click('button:text-is("Switch on")'); await ow.waitForSelector('text=Membership on for');
    await ow.waitForSelector(`td:has-text("${creds[0][1]}")`); ok('owner switched on 3 months for ' + creds[0][1]);
    await a.reload(); await a.waitForSelector('#avatarBtn'); await a.evaluate(() => { DAY().play = playAllowed() + 999 }); await a.click('#tabs >> text=Arcade'); await a.waitForSelector('text=⭐ Unlimited play');
    await a.click('.tile:has-text("Spell Quest")'); await a.waitForSelector('.worldmap'); await a.click('#landpanel .mon >> nth=0 >> button'); await a.waitForSelector('.qpanel .bq'); ok('member plays with no time limit: ' + (await a.textContent('#ptime')).trim());
    await ow.fill('#mwho', code); await ow.selectOption('#mlen', '12'); await ow.click('button:text-is("Switch on")'); await ow.waitForSelector('text=Membership on for the class');
    await b.reload(); await b.waitForSelector('#avatarBtn'); if (!(await b.evaluate(() => isMember()))) fail('class membership did not reach a student'); ok('class code ' + code + ' switched on for a year: every student in the class is a member');
    await ow.click(`tr:has-text("${creds[0][1]}") >> text=End now`); await ow.waitForSelector('text=Membership ended.');
    await ow.click(`tr:has-text("${code}") >> text=End now`); await ow.waitForSelector('text=Membership ended.');
    await a.reload(); await a.waitForSelector('#avatarBtn'); if (await a.evaluate(() => isMember())) fail('membership did not end'); ok('owner ended both memberships; the daily limit is back');
    const sm = await call(a, 'POST', '/api/owner/members', { who: creds[0][1], until: Date.now() + 9e9 }), tm2 = await call(t, 'POST', '/api/owner/members', { who: code, until: Date.now() + 9e9 }), sl = await call(a, 'GET', '/api/owner/members');
    if (sm.s !== 403 || tm2.s !== 403 || sl.s !== 403) fail(`students or teachers could switch on membership: ${sm.s} ${tm2.s} ${sl.s}`);
    ok('students and teachers get 403 when they try to switch on membership');
    // Teachers play without a time limit
    await t.click('#tabs >> text=Arcade'); await t.waitForSelector('text=No time limit (preview)'); ok('teachers can try the game with no time limit');
  } catch (e) { console.log('FAIL', e.message); errs.push(e.message) }
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'all game checks passed'); await br.close(); process.exit(errs.length ? 1 : 0);
})();
