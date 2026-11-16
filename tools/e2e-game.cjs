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
  const mk = async (w = 1280) => { const ctx = await br.newContext({ viewport: { width: w, height: 900 } }); await ctx.addInitScript(() => { window.NO_FREE_DAY = true }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|status of (400|401|403|404|409)/.test(m.text())) errs.push('console: ' + m.text()) });
    p.on('dialog', d => d.accept()); return p };
  const shot = async (pg, n) => { if (SH) await pg.screenshot({ path: `${SH}/${n}.png`, fullPage: true }) };
  const call = (pg, method, url, body) => pg.evaluate(([m, u, b]) => fetch(u, { method: m, credentials: 'same-origin', headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ s: r.status, j: await r.json().catch(() => null) })), [method, url, body]);
  const login = async (u, pw, w) => { const p = await mk(w); await p.goto(B + '/app'); await p.fill('[name=username]', u); await p.fill('[name=password]', pw); await p.click('#af button'); await p.waitForSelector('#avatarBtn'); return p };
  const signup = async (role, un) => { const p = await mk(); await p.goto(B + '/app#signup'); await p.waitForSelector('#af'); await p.selectOption('#ar', role);
    await p.fill('[name=username]', un); await p.fill('[name=display]', 'T ' + un.slice(-6)); if (role !== 'student') await p.fill('[name=email]', un + '@school.org'); else await p.check('[name=age][value="13plus"]'); await p.fill('[name=password]', 'teachpass1');
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
    if (tiles.length !== 10 || !tiles.includes('Ocean Explorer') || !tiles.includes('Mystery Mansion') || !tiles.includes('Island Architect') || tiles[0] !== 'Spell Quest' || tiles[1] !== 'Dungeon Dash' || tiles[2] !== 'Snake Arena' || tiles.some(x => x.includes('(soon)'))) fail('arcade tiles wrong: ' + tiles.join(', '));
    const p0 = await a.evaluate(() => DAY().play); await a.evaluate(() => realmTick(5)); if (await a.evaluate(() => DAY().play) !== p0) fail('play time ticked on the hub');
    await a.click('.hubhero .livehero'); if (!(await a.evaluate(() => document.querySelector('.hubhero .livehero').classList.contains('wave')))) fail('hero did not wave when tapped');
    ok('Arcade hub: ' + tiles.join(', ') + '; browsing the hub uses no play time; the hero waves when tapped');
    // The world map and the daily arcade quests
    const wm = await a.evaluate(() => ({ btn: [...document.querySelectorAll('.wmap button.wmloc')].map(b => b.getAttribute('aria-label').split(',')[0]), soon: document.querySelectorAll('.wmap .wmloc.soon').length, games: GAMES.map(g => g.n) }));
    if (wm.games.some(n => !wm.btn.includes(n))) fail('a game is missing from the map: ' + JSON.stringify(wm));
    await a.click('.wmap button.wmloc:has-text("Snake Arena")'); await a.waitForFunction(() => AR.mode === 'snake'); await a.evaluate(() => toHub()); await a.waitForSelector('.aqcard');
    const aq = await a.evaluate(() => { const D = DAY(); D.aql = ['bbc', 'games3', 'gok']; D.aqd = []; D.aqc = 0; D.aqk = {}; D.ag = { snake: 1 }; const g0 = GEMS(), gok0 = D.gok || 0;
      bbresult({ clears: 9, mode: 'endless', lv: 1, score: 10, maxc: 1, eqs: 0, goal: 0, got: 0 }, 'over'); const afterBB = D.aqd.slice(); const g1 = GEMS();
      D.gok = gok0 + 10; aqCheck(); D.ag.kart = 1; aqCheck(); const two = D.aqd.length; D.ag.blocks = 1; aqCheck(); return { afterBB, two, all: D.aqd.slice(), chest: D.aqc, quest: GEMS() - g1 } });
    if (aq.afterBB.join() !== 'bbc' || aq.two !== 2 || aq.all.length !== 3 || aq.chest !== 1 || aq.quest !== 2 * 4 + 8) fail('arcade quests went wrong: ' + JSON.stringify(aq));
    await a.evaluate(() => { const D = DAY(); delete D.aql; D.aqd = []; D.aqc = 0; D.aqk = {}; D.ag = {}; rerealm() });
    ok(`World map: all ${wm.btn.length} games are places on the map (${wm.soon} coming soon) and a place opens its game; arcade quests: clearing 9 groups finished "Clear 8 groups", then 10 right answers and 3 different games, each +4 💎, and all three opened the arcade chest (+8 💎)`);
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
    // Pet Pals: personality, memories, the two mini-games and evolution
    await a.waitForSelector('.perslist'); await a.click('.perslist button:has-text("Curious")'); await a.waitForSelector('.pal.pers-curious');
    if (!(await a.textContent('#palsay')).trim()) fail('the pet does not talk');
    const mk = await a.evaluate(() => PET().mem.map(m => m.k)); for (const k of ['snack', 'hatch', 'question', 'pers']) if (!mk.includes(k)) fail(`the memory book is missing "${k}": ` + mk);
    if ((await a.$$('.pmem li')).length !== Math.min(8, mk.length)) fail('the memory book does not show the latest memories');
    await a.click('.pgames button:has-text("Sort It")'); await a.waitForFunction(() => AG.on('petsort') && AG.cur.phase === 'play');
    const srt = await a.evaluate(() => { const Z = AG.cur.st, b = [...document.querySelectorAll('.psort button')].map(x => x.textContent); return { b, a: Z.set.a, bb: Z.set.b, n: Z.items.length, mix: Z.items.filter(i => i[1]).length } });
    if (!srt.b[0].includes(srt.a[0]) || !srt.b[1].includes(srt.bb[0])) fail('the basket buttons do not name the groups: ' + JSON.stringify(srt));
    if (srt.n !== 12 || srt.mix !== 6) fail('a Sort It! round is not 6 cards of each group');
    const badSets = await a.evaluate(() => PSORT.filter(s => new Set([...s.a[1], ...s.b[1]].map(String)).size !== s.a[1].length + s.b[1].length || s.a[1].length < 6 || s.b[1].length < 6).map(s => s.n));
    if (badSets.length) fail("Sort It! sets with a card in both groups or too few cards: " + badSets);
    const pl0 = await a.evaluate(() => DAY().play); await a.evaluate(() => realmTick(5)); if (await a.evaluate(() => DAY().play) <= pl0) fail('a pet mini-game did not use play time');
    await a.keyboard.press('p'); if (!(await a.evaluate(() => AG.paused()))) fail('P did not pause Sort It!'); await a.keyboard.press('ArrowLeft'); if (await a.evaluate(() => AG.cur.st.i) !== 0) fail('a card was sorted while paused'); await a.keyboard.press('p');
    for (let i = 0; i < 12; i++) { const r = await a.evaluate(() => AG.cur.st.items[AG.cur.st.i][1]); await a.keyboard.press((i === 0 ? !r : r) ? 'ArrowRight' : 'ArrowLeft'); await a.waitForFunction(() => !AG.on('petsort') || !AG.cur.st.fly) }
    await a.waitForSelector('.endcard'); if (!(await a.textContent('.endcard h3')).includes('11 of 12')) fail('Sort It! did not count 11 of 12 right');
    await a.click('text=Back to Sparky'); await a.click('.pgames button:has-text("Star Catch")'); await a.waitForFunction(() => AG.on('petstars') && AG.cur.phase === 'play');
    await a.keyboard.down('ArrowRight'); await a.waitForTimeout(600); await a.keyboard.up('ArrowRight'); if (await a.evaluate(() => AG.cur.st.x) <= 320) fail('the pet did not move right in Star Catch');
    await a.evaluate(() => { AG.cur.st.caught = 60; AG.cur.st.left = .01 }); await a.waitForSelector('.endcard');
    const gs = await a.evaluate(() => PET().gsn.n); if (gs > 2) fail('mini-games gave more than 2 snacks today: ' + gs);
    if (!(await a.evaluate(() => AG.got('petstars', 's50') && AG.got('petsort', 'first')))) fail('the pet mini-game achievements did not unlock');
    await a.click('text=Back to Sparky'); await a.evaluate(() => { PET().g = 20; rerealm() }); await a.waitForSelector('.pevo');
    const ev = await a.evaluate(() => [...document.querySelectorAll('.pevo button')].map((b, i) => b.disabled === !Object.values(PEVO)[i].ok()));
    if (ev.length !== 3 || ev.includes(false)) fail('the evolution choices are not locked by learning progress');
    ok(`Pet Pals: a Curious personality, ${mk.length} memories, Sort It! (${srt.a[0]} / ${srt.bb[0]}) scored 11 of 12 and paused, Star Catch moved and ended, ${gs} game snacks (cap 2), evolutions locked by progress`); await shot(a, 'g-pet2');
    // Pet Pals exploring: places open with growth, three trips a day, finds, the mystery spot, a full set makes a home backdrop
    await a.waitForSelector('.pxlist'); const pxl = await a.$$eval('.pxlist button', b => b.map(x => x.disabled)); if (pxl.join() !== 'false,false,false,false,true') fail('places did not open by growth: ' + pxl);
    const pxPlay = await a.evaluate(() => DAY().play); await a.click('.pxlist button:has-text("Enchanted Forest")'); await a.waitForSelector('.pxscene');
    for (const i of [0, 1, 2]) await a.click(`.pxspot >> nth=${i}`);
    await a.click('.pxspot >> nth=3'); await a.waitForFunction(() => QM && QM.phase === 'ask'); { const c = await a.evaluate(() => QM.q.choices ? QM.q.choices.length : 0), r = await a.evaluate(() => QM.q.a[0]);
      if (c) await a.click(`#qmodal .bchoices button >> nth=${(r + 1) % c}`); else { await a.fill('#qmin', '987654'); await a.click('#qmodal .bans button') } await a.click('#qmok'); await a.waitForFunction(() => !QM) }
    const px1 = await a.evaluate(() => ({ f: PET().x.forest, t: pxTrips(), shut: PX.spots[3] }));
    if (px1.f.slice(0, 4).reduce((s, v) => s + (v ? 1 : 0), 0) < 1 || px1.f.slice(4).some(Boolean) || px1.shut !== '🔒' || px1.t !== 2) fail('an exploring trip went wrong: ' + JSON.stringify(px1));
    if (await a.evaluate(() => DAY().play) !== pxPlay) fail('exploring used play time');
    await a.click('text=Head home'); await a.evaluate(() => { PET().x.forest = [1, 1, 1, 1, 1, 0]; rerealm() }); await a.click('.pxlist button:has-text("Enchanted Forest")'); await a.click('.pxspot >> nth=3');
    await a.waitForFunction(() => QM && QM.phase === 'ask'); { const c = await a.evaluate(() => QM.q.choices ? QM.q.choices.length : 0), r = await a.evaluate(() => QM.q.a[0]);
      if (c) await a.click(`#qmodal .bchoices button >> nth=${r}`); else { await a.fill('#qmin', await a.evaluate(() => fmtA(QM.q))); await a.click('#qmodal .bans button') } await a.waitForFunction(() => !QM) }
    if (!(await a.textContent('.pxfind')).includes('whole set')) fail('finishing a set did not say so');
    await a.click('text=Head home'); await a.click('.accs button:has-text("Enchanted Forest")'); if (!(await a.$('.palstage.bd-forest'))) fail('the forest backdrop did not show');
    await a.evaluate(() => { PET().xt.n = 3; rerealm() }); if ((await a.$$eval('.pxlist button', b => b.filter(x => !x.disabled).length)) !== 0) fail('a fourth trip was allowed');
    ok('Pet Pals exploring: places open with growth, a trip found things and the mystery spot stayed shut after a miss, a full set unlocked the forest backdrop, 3 trips a day, no play time used'); await shot(a, 'g-pet3');
    // Spell Quest, the pixel adventure: maps, walking, a battle, befriending, the gate, the boss, music and the journal
    const sqMaps = await a.evaluate(() => { const bad = [];
      for (const [land, rows] of Object.entries(SQMAPS)) { if (rows.length !== 14 || rows.some(r => r.length !== 22)) { bad.push(land + ': size'); continue }
        const M = ['#'.repeat(24), ...rows.map(r => '#' + r + '#'), '#'.repeat(24)]; const cnt = c => M.join('').split(c).length - 1; for (const c of 'SRNTCGB') if (cnt(c) !== 1) bad.push(`${land}: ${c} x${cnt(c)}`);
        const reach = open => { const seen = new Set(), q = []; M.forEach((r, y) => { const x = r.indexOf('S'); if (x >= 0) { q.push([x, y]); seen.add(y * 24 + x) } });
          while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy, ch = M[Y] && M[Y][X]; if (ch && ('.,=*SR'.includes(ch) || (open && ch === 'G')) && !seen.has(Y * 24 + X)) { seen.add(Y * 24 + X); q.push([X, Y]) } } } return seen };
        const near = (seen, c) => M.some((r, y) => [...r].some((ch, x) => ch === c && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((y + dy) * 24 + x + dx))));
        const shut = reach(false), open = reach(true); for (const c of 'NTCG') if (!near(shut, c)) bad.push(`${land}: can't reach ${c}`);
        if (near(shut, 'B') || !near(open, 'B')) bad.push(`${land}: the boss is not behind the gate`);
        M.forEach((r, y) => [...r].forEach((ch, x) => { if ((ch === ',' || ch === 'R') && !open.has(y * 24 + x)) bad.push(`${land}: ${ch} at ${x},${y} unreachable`) })) } return bad });
    if (sqMaps.length) fail('Spell Quest maps: ' + sqMaps.join('; '));
    const sqSpr = await a.evaluate(() => Object.values(MONS).flat().filter(m => { const d = sqMon(m, 32).getContext('2d').getImageData(0, 0, 32, 32).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n < 150 }).map(m => m[0]));
    if (sqSpr.length) fail('creatures that do not draw: ' + sqSpr);
    await a.evaluate(() => { DAY().play = 0; GM.sq = null; GM.lands.meadow = { won: [0, 0, 0], boss: 0, wins: 0 }; AR.mode = 'spell'; rerealm() }); await a.waitForSelector('.sqgo');
    await a.click('.sqgo button:has-text("Explore")'); await a.waitForFunction(() => AG.on('sq') && AG.cur.phase === 'play' && AG.cur.st.mode === 'talk');
    await a.keyboard.press('Space'); await a.keyboard.press('Space'); if (await a.evaluate(() => AG.cur.st.mode) !== 'walk') fail('the welcome talk did not close');
    await a.keyboard.down('ArrowDown'); await a.waitForTimeout(420); await a.keyboard.up('ArrowDown'); await a.waitForTimeout(250); if (await a.evaluate(() => AG.cur.st.y) < 3) fail('the hero did not walk down');
    await a.evaluate(() => sqPath(AG.cur.st, 7, 2)); await a.waitForFunction(() => AG.cur.st.mode === 'talk', null, { timeout: 8000 }); if (!(await a.textContent('#sqbox')).includes('Rest Stone')) fail('tapping the sign did not walk there and read it'); await a.keyboard.press('Space');
    const sqAns = async right => { await a.waitForFunction(() => QM && QM.phase === 'ask'); const ch = await a.evaluate(() => QM.q.choices ? QM.q.choices.length : 0), a0 = await a.evaluate(() => QM.q.a[0]);
      if (ch) await a.click(`#qmodal .bchoices button >> nth=${right ? a0 : (a0 + 1) % ch}`); else { await a.fill('#qmin', right ? await a.evaluate(() => fmtA(QM.q)) : '987654'); await a.click('#qmodal .bans button') }
      if (!right) { await a.waitForSelector('#qmok'); await a.click('#qmok') } await a.waitForFunction(() => !QM) };
    await a.evaluate(() => sqBattle(AG.cur.st, 0)); await a.waitForFunction(() => AG.cur.st.mode === 'battle'); await a.click('#sqnext'); await a.waitForSelector('.sqmenu');
    if (!(await a.isDisabled('.sqmenu button:has-text("Make friends")'))) fail('Make friends was open at full health');
    if (!(await a.evaluate(() => getComputedStyle($('sqhudw')).display === 'none' && !$('sqfoe').hidden))) fail('the battle boxes did not replace the map HUD');
    await a.keyboard.press('1'); await sqAns(false); await a.waitForFunction(() => AG.cur.st.B.ph === 'msg'); if (await a.evaluate(() => AG.cur.st.hp) >= 100) fail('a wrong answer did not hurt the hero'); await a.click('#sqnext');
    let sqn = 0; while (await a.evaluate(() => AG.cur.st.B && AG.cur.st.B.ph === 'menu' && AG.cur.st.B.hp > AG.cur.st.B.max * .4) && sqn++ < 8) { await a.keyboard.press('1'); await sqAns(true); await a.waitForFunction(() => AG.cur.st.B.ph === 'msg'); await a.click('#sqnext') }
    if (await a.evaluate(() => AG.cur.st.B.ph) === 'menu') { await a.click('.sqmenu button:has-text("Make friends")'); await sqAns(true) }
    await a.waitForFunction(() => AG.cur.st.B && AG.cur.st.B.ph === 'won'); if (!(await a.textContent('#sqbox')).includes('joined your Creature Journal')) fail('a first friend did not join the journal'); await a.click('#sqnext');
    if (!(await a.evaluate(() => LS('meadow').won[0] === 1 && SQ().seen['meadow:0'] && AG.got('sq', 'first')))) fail('befriending did not save');
    await a.evaluate(() => { LS('meadow').won = [1, 1, 0] }); await a.evaluate(() => sqBattle(AG.cur.st, 2)); await a.waitForFunction(() => AG.cur.st.mode === 'battle'); await a.click('#sqnext');
    await a.evaluate(() => { AG.cur.st.B.hp = 5 }); await a.keyboard.press('1'); await sqAns(true); await a.waitForFunction(() => AG.cur.st.B.ph === 'msg'); await a.click('#sqnext'); await a.waitForFunction(() => AG.cur.st.B && AG.cur.st.B.ph === 'won'); await a.click('#sqnext');
    await a.waitForFunction(() => AG.cur.st.mode === 'talk'); if (!(await a.textContent('#sqbox')).includes('gate swings open') || await a.evaluate(() => AG.cur.st.m.flat().includes('G'))) fail('the gate did not open after 3 friends');
    await a.keyboard.press('Space'); await a.keyboard.press('Space'); await a.evaluate(() => sqPath(AG.cur.st, 18, 13)); await a.waitForFunction(() => AG.cur.st.mode === 'talk', null, { timeout: 15000 });
    if (!(await a.textContent('#sqbox')).includes('Thornback')) fail('walking to the boss did not start its talk');
    await a.keyboard.press('Space'); await a.keyboard.press('Space'); await a.waitForFunction(() => AG.cur.st.mode === 'battle' && AG.cur.st.B.boss); await a.click('#sqnext'); await a.waitForSelector('.sqmenu');
    if (await a.$('.sqmenu button:has-text("Run away")')) fail('you can run from a boss');
    const sqMus = await a.evaluate(() => SND.mus.name); await a.keyboard.press('p'); const sqMp = await a.evaluate(() => !!SND.mus.timer); await a.keyboard.press('p');
    if (sqMp) fail('the music kept playing while paused');
    await a.evaluate(() => { AG.cur.st.B.hp = 5 }); await a.keyboard.press('1'); await sqAns(true); await a.waitForFunction(() => AG.cur.st.B.ph === 'msg'); await a.click('#sqnext'); await a.waitForFunction(() => AG.cur.st.B && AG.cur.st.B.ph === 'won');
    if (!(await a.evaluate(() => LS('meadow').boss === 1 && AG.got('sq', 'boss')))) fail('the boss win did not save'); await a.click('#sqnext');
    await a.click('#sqbox >> text=World map'); await a.waitForSelector('.endcard'); await a.click('.endcard >> text=Creature Journal'); await a.waitForSelector('.sqjr');
    await a.click('.sqjr .c >> text=Make buddy >> nth=0'); if (await a.evaluate(() => SQ().buddy) !== 'meadow:0') fail('could not pick a buddy');
    ok(`Spell Quest: 7 maps reachable with each boss behind its gate, 28 creatures drawn, walked and read a sign, a battle (a miss hurt, spells, befriended Slimey), the gate opened after 3 friends, walked to Thornback and befriended it (no running from a boss), ${sqMus} music paused with the game, a buddy picked in the journal`); await shot(a, 'g-sq');
    await a.evaluate(() => { AR.mode = null; toHub() });
    // Turbo Trivia Kart: three different lane answers, the right one included
    const kc = await a.evaluate(() => { const bad = [], v = s => s.includes('/') ? s.split('/')[0] / s.split('/')[1] : +s; let n = 0;
      for (const sub of Object.keys(SUBN)) { GM.rsub = sub; for (let i = 0; i < 60; i++) { const x = rquestion(); if (!x) break; const c = kartChoices(x.q); if (!c) continue; n++;
        const right = x.q.choices ? c.L[c.cor] === x.q.choices[x.q.a[0]] : Math.abs(v(c.L[c.cor]) - x.q.a[0] / x.q.a[1]) < 1e-9; if (c.L.length !== 3 || new Set(c.L).size !== 3 || !right) bad.push(x.q.q + ' -> ' + c.L.join('|')) } }
      GM.rsub = 'math'; return { n, bad } });
    if (kc.bad.length || kc.n < 100) fail('kart lanes wrong: ' + JSON.stringify(kc).slice(0, 300));
    await a.evaluate(() => toHub()); await a.click('.tile:has-text("Turbo Trivia Kart")'); await a.waitForSelector('.ktracks2'); await a.click('text=▶ Start race');
    await a.waitForFunction(() => AG.cur && AG.cur.phase === 'play' && AG.cur.st, null, { timeout: 10000 });
    const kg0 = await a.evaluate(() => GEMS()), kp0 = await a.evaluate(() => DAY().play); await a.evaluate(() => realmTick(5)); if (await a.evaluate(() => DAY().play) !== kp0 + 5) fail('a race did not use play time');
    // pause with P: the kart stops; a hidden tab pauses too
    await a.keyboard.press('p'); await a.waitForSelector('#agover:not([hidden]) >> text=Paused'); const kz0 = await a.evaluate(() => AG.cur.st.pos); await a.waitForTimeout(400);
    if (await a.evaluate(() => AG.cur.st.pos) !== kz0) fail('the kart moved while paused'); await a.keyboard.press('p'); await a.waitForFunction(() => !AG.paused());
    await a.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden });
    if (!(await a.evaluate(() => AG.holds.has('away')))) fail('a hidden tab did not pause the race'); await a.click('#agres'); await a.waitForFunction(() => !AG.paused());
    // eight gates: lane buttons and number keys; the 4th gate on purpose in the wrong lane
    for (let i = 0; i < 8; i++) {
      await a.evaluate(i => { const T = AG.cur.st, g = T.Z.gates[i]; T.pos = Math.max(T.pos, g.z - T.tier.vmax * T.tier.read * .4 - KCAMH * KCAMD) }, i);
      await a.waitForFunction(() => AG.cur.st.q && !AG.cur.st.q.none, null, { timeout: 8000 }); const c = await a.evaluate(() => AG.cur.st.q.cor), want = i === 3 ? (c + 1) % 3 : c;
      if (i % 2) await a.keyboard.press(String(want + 1)); else await a.click(`.klanes2 button >> nth=${want}`);
      if (await a.evaluate(() => AG.cur.st.lane) !== want) fail('picking a lane did not steer to it');
      await a.evaluate(w => { const T = AG.cur.st; T.x = [-.62, 0, .62][w]; T.pos = T.q.g.z - KCAMH * KCAMD - 20 }, want);
      await a.waitForFunction(i => AG.cur.st.Z.gates[i].done, i, { timeout: 8000 });
      if (i === 3) { await a.waitForTimeout(150); if (!/It was/.test(await a.textContent('#kfb2'))) fail('a wrong lane does not show the answer: ' + await a.textContent('#kfb2')) } }
    await a.evaluate(() => { const T = AG.cur.st; T.pos = T.Z.fin - 5 }); await a.waitForSelector('text=Silver medal!', { timeout: 10000 }); await a.waitForTimeout(1600);
    const kr = await a.evaluate(g => { const S = ARS('kart'), r = AG.cur.res; return { gems: GEMS() - g, rg: r.gems, medal: r.medal, ok: r.ok, n: r.n, pb: (S.pb.neon || {}).time, ghost: ((S.gh.neon || {}).s || []).length, next: ktOpen(1), after: ktOpen(2), ach: AG.got('kart', 'first'), paint: AG.has('kart.paint.yellow') } }, kg0);
    if (kr.medal !== 2 || kr.ok !== 7 || kr.n !== 8 || kr.pb == null || kr.ghost < 4 || !kr.next || kr.after || !kr.ach || !kr.paint || kr.gems < kr.rg + 1 || !(await a.isVisible('text=New track: Frozen Mountain Pass'))) fail('race result wrong: ' + JSON.stringify(kr));
    ok(`Turbo Trivia Kart: ${kc.n} questions all made 3 different lanes with the right answer; P and a hidden tab pause the race; lane buttons and number keys steer; 7 of 8 gates won silver, ${kr.gems} gems, a best time and a ghost, unlocked Frozen Mountain Pass, the "First finish" achievement and Sunny Yellow paint; a wrong lane shows the answer; racing uses play time`); await shot(a, 'g-kart');
    // the new paint, Restart and the Collection Book
    await a.click('.kcust button[aria-label="Sunny Yellow"]'); if (await a.evaluate(() => ktPaint()) !== 'yellow') fail('picking a paint did not stick');
    await a.click('text=▶ Start race'); await a.waitForFunction(() => AG.cur && AG.cur.phase === 'play' && AG.cur.st && AG.cur.st.time > .8); const kst = await a.evaluate(() => AG.cur.st);
    await a.click('.agbar >> text=↻ Restart'); await a.waitForFunction(() => AG.cur.phase === 'play' && AG.cur.st && AG.cur.st.time < .8); if (await a.evaluate(() => AG.cur.st.pos) > 3000) fail('Restart did not start the race again');
    await a.evaluate(() => { AG.stop(); AG.cur = null; AR.run = false; rerealm() }); await a.click('text=📖 Collection Book'); await a.waitForSelector('text=🏅 Achievements');
    const bk = await a.evaluate(() => ({ got: document.querySelectorAll('.bitem:not(.locked)').length, txt: document.querySelector('.gworld').textContent.includes('Sunny Yellow') }));
    if (bk.got < 4 || !bk.txt) fail('Collection Book wrong: ' + JSON.stringify(bk)); ok(`picked the new paint, Restart began the race again, the Collection Book shows ${bk.got} unlocked things`);
    await a.click('text=← Back to Turbo Trivia Kart'); await a.waitForSelector('.ktracks2');
    // Goblin Gate: build by tapping a pad, an upgrade needs a right answer (a miss changes nothing), goblins freeze while a question is open, the boss cannon, a won map
    await a.evaluate(() => toHub()); await a.click('.tile:has-text("Goblin Gate")'); await a.waitForSelector('.ggmaps'); await a.click('text=▶ Start defending');
    await a.waitForFunction(() => AG.cur && AG.cur.phase === 'play' && AG.cur.st); const gg0 = await a.evaluate(() => GEMS());
    const gbox = await a.locator('#agcv').boundingBox(), gp = await a.evaluate(() => AG.cur.st.m.pads[0]);
    await a.mouse.click(gbox.x + gp[0] / 640 * gbox.width, gbox.y + gp[1] / 360 * gbox.height); await a.waitForSelector('.ggbuild');
    if (await a.evaluate(() => AG.cur.st.sel) !== 0) fail('tapping a pad did not select it');
    const gload = await a.$$eval('.ggbuild', b => b.length); if (gload !== 5) fail('the build list is not the 5-tower loadout: ' + gload);
    await a.click('.ggbuild >> nth=1'); if (await a.evaluate(() => (AG.cur.st.tw[0] || {}).t) !== 'ice') fail('tapping Frost Spire did not build it');
    await a.evaluate(() => { AG.cur.st.gold = 500; ggpanel(AG.cur.st) }); await a.click('.ggup'); await answerQM(a, false); await a.click('#qmok'); await a.waitForFunction(() => !QM);
    if (await a.evaluate(() => AG.cur.st.tw[0].lvl) !== 1) fail('a wrong answer upgraded the tower');
    await a.click('.ggup'); await answerQM(a, true); await a.waitForFunction(() => !QM && AG.cur.st.tw[0].lvl === 2);
    const gu = await a.evaluate(() => ({ lvl: AG.cur.st.tw[0].lvl, gold: AG.cur.st.gold })); if (gu.gold !== 467) fail('upgrade wrong: ' + JSON.stringify(gu));
    await a.click('text=⚔️ Start wave 1'); await a.waitForFunction(() => AG.cur.st.gobs.length > 0 && AG.cur.st.gobs[0].d > 20);
    await a.click('.ggup'); await a.waitForFunction(() => QM && QM.phase === 'ask'); const gd0 = await a.evaluate(() => AG.cur.st.gobs.map(g => g.d.toFixed(2)).join()); await a.waitForTimeout(600);
    if (gd0 !== await a.evaluate(() => AG.cur.st.gobs.map(g => g.d.toFixed(2)).join())) fail('goblins kept moving while a question was open'); await answerQM(a, true); await a.waitForFunction(() => !QM && AG.cur.st.tw[0].lvl === 3);
    // strong towers, then waves until the boss arrives: answer to fire the castle cannon
    await a.evaluate(() => { const Z = AG.cur.st; Z.tw = Z.tw.map(() => ({ t: 'bolt', lvl: 7, cd: 0, spent: 70 })); let n = 0; while (n++ < 60000 && AG.cur.phase === 'play' && !Z.boss) { if (Z.ph === 'build') ggWave(Z); AG.G.gate.step(1 / 60, Z) } ggpanel(Z) });
    if (!(await a.evaluate(() => !!AG.cur.st.boss))) fail('no boss came in the last wave');
    await a.click('#ggcannon'); await answerQM(a, true); await a.waitForFunction(() => !QM); await a.waitForTimeout(700);
    const gb = await a.evaluate(() => { const b = AG.cur.st.boss; return b ? b.hp / b.max : 0 }); if (gb > .9) fail('the castle cannon did not hit the boss: ' + gb);
    await a.evaluate(() => { const Z = AG.cur.st; let n = 0; while (n++ < 80000 && AG.cur.phase === 'play') { if (Z.ph === 'build') ggWave(Z); AG.G.gate.step(1 / 60, Z) } });
    await a.waitForSelector('text=The castle is safe!'); await a.waitForTimeout(1600);
    const gr = await a.evaluate(g => ({ gems: GEMS() - g, r: AG.cur.res, st: ARS('gate').st.valley, next: ggOpen(1), after: ggOpen(2), boss: AG.got('gate', 'boss'), flag: AG.has('gate.flag.blue') }), gg0);
    if (gr.st < 1 || !gr.next || gr.after || !gr.boss || !gr.flag || gr.gems < gr.r.gems || !(await a.isVisible('text=Stage 2 unlocked: Frozen Kingdom'))) fail('Goblin Gate result wrong: ' + JSON.stringify(gr));
    ok(`Goblin Gate: tapping a pad and Frost Spire (from the 5-tower loadout) built it, a miss left the upgrade undone and a right answer took it to level 2 (33 gold), goblins froze while a question was open, the boss came in the last wave and a right answer fired the castle cannon, stage 1 was won with ${gr.r.stars} stars, ${gr.gems} gems and ${gr.r.coins} Gate coins, unlocking Frozen Kingdom, the boss achievement and the blue banner`); await shot(a, 'g-gate');
    // chests (odds shown, pity, the lucky roll), the loadout, level 7, and the Goblin King on stage 7
    await a.evaluate(() => { AG.stop(); AG.cur = null; AR.run = false; ggS().coins = 60; rerealm() }); await a.waitForSelector('.ggshop');
    if (!(await a.isVisible('text=Common 60% · Rare 28% · Epic 10% · Legendary 2%'))) fail('the chest odds are not shown');
    await a.click('.ggshop button >> nth=0'); await a.waitForSelector('.ggreveal'); const gc1 = await a.evaluate(() => ({ coins: ggS().coins, t: GGLAST.t, have: ggS().own.includes(GGLAST.t) }));
    await a.click('.ggreveal button'); await a.click('.ggshop button.lucky'); await a.waitForSelector('.ggreveal'); const gc2 = await a.evaluate(() => ({ coins: ggS().coins, rar: GGLAST.rar }));
    if (gc1.coins !== 50 || !gc1.have || gc2.coins !== 0 || gc2.rar < 1) fail('chests wrong: ' + JSON.stringify([gc1, gc2]));
    const gp2 = await a.evaluate(() => { const S = ggS(), r = []; for (let k = 0; k < 20; k++) { S.coins = 10; S.pity = 9; r.push(ggRoll(false).rar) } S.coins = 5; return { pity: Math.min(...r), broke: ggRoll(false), coins: S.coins } });
    if (gp2.pity < 2 || gp2.broke !== null || gp2.coins !== 5) fail('chest pity or cost wrong: ' + JSON.stringify(gp2));
    await a.evaluate(() => { GGLAST = null; rerealm() }); const gl0 = await a.evaluate(() => ggS().load.length); await a.click('.ggtw .c.in button >> nth=0'); const gl1 = await a.evaluate(() => ggS().load.length);
    if (gl1 !== gl0 - 1) fail('taking a tower out of the loadout did not work');
    await a.evaluate(() => { const S = ggS(); for (const m of GGMAPS.slice(0, 6)) S.st[m.id] = S.st[m.id] || 1; S.map = 'fortress'; SYNC(); rerealm() }); await a.click('text=▶ Start defending');
    await a.waitForFunction(() => AG.cur && AG.cur.phase === 'play' && AG.cur.st && AG.cur.st.m.id === 'fortress');
    const gking = await a.evaluate(() => { const Z = AG.cur.st; Z.w = Z.m.waves - 1; Z.tw = Z.tw.map(() => null); Z.ph = 'wave'; Z.q = []; ggSpawn(Z, 'king');
      const k = Z.gobs.find(g => g.k === 'king'); if (!k) return null; const n0 = Z.gobs.length; for (let i = 0; i < 380; i++) AG.G.gate.step(1 / 60, Z); const r = { hp: k.max, help: Z.gobs.length - n0, bar: Z.boss === k };
      k.hp = k.max * .6; AG.G.gate.step(1 / 60, Z); r.shield = k.shieldU > Z.time; const h0 = k.hp; ggDmg(Z, k, 999, 1); r.immune = k.hp === h0; k.shieldU = 0; Z.tw[0] = { t: 'ice', lvl: 6, cd: 0, spent: 1 }; Z.sel = 0; Z.gold = 999; ggpanel(Z); return r });
    if (!gking || gking.hp < 10000 || gking.help < 3 || !gking.bar || !gking.shield || !gking.immune) fail('the Goblin King is wrong: ' + JSON.stringify(gking));
    await a.click('.ggup'); await answerQM(a, true); await a.waitForFunction(() => !QM && AG.cur.st.tw[0].lvl === 7); if (!(await a.evaluate(() => AG.got('gate', 'max')))) fail('level 7 gave no achievement');
    await a.evaluate(() => { const Z = AG.cur.st, k = Z.gobs.find(g => g.k === 'king'); k.hp = 1; ggDmg(Z, k, 9, 1) }); if (!(await a.evaluate(() => AG.got('gate', 'king')))) fail('defeating the Goblin King gave no achievement');
    ok(`Goblin Gate chests: odds shown, a 10-coin chest gave ${gc1.t}, a 50-coin lucky roll gave rarity ${gc2.rar} or better, pity guarantees Epic+, too few coins buys nothing; the loadout changed; the Goblin King (${gking.hp} health) called ${gking.help} helpers and his shield blocked damage; a tower reached level 7`);
    // Block Builder: 4 + 6 side by side (keys), 8 + 2 stacked (tapping the column), 3 × 4 = 12, a mystery block, level 2, a rescue, a full tower, a challenge level
    await a.evaluate(() => toHub()); await a.click('.tile:has-text("Block Builder")'); await a.waitForSelector('.bbmodes'); await a.click('.bbmode:has-text("Endless")'); await a.click('.chip:has-text("Make 10")'); await a.click('text=▶ Start');
    await a.waitForFunction(() => AG.cur && AG.cur.phase === 'play' && AG.cur.st && AG.cur.st.phase === 'fall');
    const bset = (cells, cur, t = 10) => a.evaluate(([cells, cur, t]) => { const Z = AG.cur.st; Z.p = { op: '+', t }; Z.g = Z.g.map(r => r.map(() => null)); for (const [r, c, b] of cells) Z.g[r][c] = b; Z.cur = { b: cur.b, c: cur.c, x: cur.c, y: cur.y || 0, lock: 0 }; Z.phase = 'fall'; Z.combo = 0 }, [cells, cur, t]);
    const bwait = n => a.waitForFunction(n => AG.cur.st.clears >= n && AG.cur.st.phase === 'fall', n, { timeout: 8000 }), bfeed = () => a.evaluate(() => AG.cur.st.feed[0]);
    await bset([[9, 1, { k: 'n', v: 4 }]], { b: { k: 'n', v: 6 }, c: 3 }); await a.keyboard.press('ArrowLeft'); await a.keyboard.press(' '); await bwait(1);
    if (await bfeed() !== '4 + 6 = 10' || !(await a.evaluate(() => AG.cur.st.g[9].every(x => !x)))) fail('side-by-side clear wrong: ' + await bfeed());
    await bset([[9, 5, { k: 'n', v: 2 }]], { b: { k: 'n', v: 8 }, c: 5 }); const bbox = await a.locator('#agcv').boundingBox();
    await a.mouse.click(bbox.x + (14 + 5 * 52 + 26) / 392 * bbox.width, bbox.y + .5 * bbox.height); await bwait(2); if (await bfeed() !== '8 + 2 = 10') fail('a stacked 8 + 2 did not clear by tapping its column: ' + await bfeed());
    await bset([[9, 0, { k: 'n', v: 3 }], [9, 1, { k: 'op', op: '×' }]], { b: { k: 'n', v: 4 }, c: 2, y: 8 }, 12); await a.keyboard.press(' '); await bwait(3); if (await bfeed() !== '3 × 4 = 12') fail('the 3 × 4 equation did not clear: ' + await bfeed());
    await bset([[9, 0, { k: 'n', v: 7 }]], { b: { k: 'myst' }, c: 1, y: 8 }); await a.keyboard.press(' '); await answerQM(a, true); await bwait(4);
    if (!/^(7 \+ 3|3 \+ 7)( \+ \d+)? = 10/.test(await bfeed())) fail('a right answer on a mystery block did not make the number that clears: ' + await bfeed());
    await a.evaluate(() => { AG.cur.st.clears = 5 }); await bset([[9, 0, { k: 'n', v: 5 }]], { b: { k: 'n', v: 5 }, c: 1, y: 8 }); await a.keyboard.press(' '); await bwait(6);
    if (await a.evaluate(() => AG.cur.st.lv) !== 2) fail('6 clears did not reach level 2');
    await a.evaluate(() => { const Z = AG.cur.st; Z.rescued = 0; Z.g = Z.g.map((r, i) => r.map((_, c) => i >= 1 && c !== 3 ? { k: 'n', v: 1 } : null)); Z.cur = { b: { k: 'n', v: 1 }, c: 3, x: 3, y: 0, lock: 0 }; Z.phase = 'fall' });
    await a.keyboard.press(' '); await answerQM(a, true); await a.waitForFunction(() => AG.cur.st.phase === 'fall'); const resc = await a.evaluate(() => AG.cur.st.g.slice(1, 5).every(r => r.every(x => !x)));
    if (!resc) fail('a right rescue answer did not clear the top rows');
    const bg0 = await a.evaluate(() => GEMS()); await a.evaluate(() => { const Z = AG.cur.st; Z.rescued = 9; Z.clears = 8; Z.g = Z.g.map((r, i) => r.map((_, c) => i === 0 && c === 3 ? null : { k: 'n', v: 1 })); Z.cur = { b: { k: 'n', v: 1 }, c: 3, x: 3, y: 0, lock: 0 }; Z.phase = 'fall' });
    await a.keyboard.press(' '); await a.waitForSelector('text=Tower full!'); const bres = await a.evaluate(g => ({ d: GEMS() - g, r: AG.cur.res.gems, best: ARS('blocks').best }), bg0);
    if (bres.r !== 2 || bres.d < 2 || !bres.best) fail('Block Builder result wrong: ' + JSON.stringify(bres));
    await a.click('.bbmode:has-text("Equation Builder")'); await a.click('text=▶ Start'); await a.waitForFunction(() => AG.cur && AG.cur.phase === 'play' && AG.cur.st && AG.cur.st.phase === 'fall');
    await a.evaluate(() => { AG.cur.st.goal = 1 }); await bset([[9, 0, { k: 'n', v: 2 }], [9, 1, { k: 'op', op: '×' }]], { b: { k: 'n', v: 5 }, c: 2, y: 8 }, 10); await a.keyboard.press(' ');
    await a.waitForSelector('text=Equation Builder level 1 complete!'); if (await a.evaluate(() => ARS('blocks').ch.eq) !== 1) fail('the challenge level was not saved');
    ok('Block Builder: 4 + 6 side by side and 8 + 2 stacked cleared, 3 × 4 = 12 made an equation, a mystery block became the number that clears, 6 clears reached level 2, a rescue cleared the top rows, a full tower paid 2 gems for 8 clears, and Equation Builder level 1 was completed'); await shot(a, 'g-blocks');
    // Building mode: bricks from the puzzle rounds, tap and drag to build, undo, erase, out of bricks, the math challenges, save
    await a.evaluate(() => { DAY().play = 0; AG.cur = null; AR.mode = 'blocks'; rerealm() }); await a.waitForSelector('.bbbuild');
    const bd0 = await a.evaluate(() => ({ b: bdS().bricks, e: bdS().bearn || 0 })); if (!bd0.e || bd0.b !== 40 + bd0.e) fail('the puzzle rounds did not earn bricks: ' + JSON.stringify(bd0));
    await a.click('.bbbuild button:has-text("Build")'); await a.waitForFunction(() => AG.on('bbuild') && AG.cur.phase === 'play'); await a.waitForSelector('#bdpanel .bbpal');
    const bdCv = await (await a.$('#agcv')).boundingBox(), bdAt = (c, r) => [bdCv.x + (c + .5) / 20 * bdCv.width, bdCv.y + (r + .5) * 24 / 312 * bdCv.height];
    const bdN = () => a.evaluate(() => [AG.cur.st.g.filter(v => v !== '.').length, bdS().bricks]);
    await a.mouse.click(...bdAt(2, 11)); let bdv = await bdN(); if (bdv[0] !== 1 || bdv[1] !== bd0.b - 1) fail('a tap did not place one block for one brick: ' + bdv);
    await a.mouse.move(...bdAt(4, 11)); await a.mouse.down(); for (let c = 5; c <= 8; c++) await a.mouse.move(...bdAt(c, 11), { steps: 2 }); await a.mouse.up(); bdv = await bdN(); if (bdv[0] !== 6) fail('dragging did not paint 5 blocks: ' + bdv);
    await a.click('#bdpanel button:has-text("Undo")'); bdv = await bdN(); if (bdv[0] !== 1 || bdv[1] !== bd0.b - 1) fail('Undo did not take back the whole drag and its bricks: ' + bdv);
    await a.click('#bdpanel button:has-text("Erase")'); await a.mouse.click(...bdAt(2, 11)); bdv = await bdN(); if (bdv[0] !== 0 || bdv[1] !== bd0.b) fail('erasing did not give the brick back: ' + bdv);
    await a.click('#bdpanel .bbpal button >> nth=0'); await a.evaluate(() => { ARS('blocks').bricks = 0 }); await a.mouse.click(...bdAt(3, 11)); if ((await bdN())[0] !== 0 || !(await a.textContent('#bdmsg')).includes('Out of bricks')) fail('a block was placed with no bricks');
    await a.evaluate(() => { ARS('blocks').bricks = 300 });
    const bdc = await a.evaluate(() => { const g = (f) => { const a = Array(240).fill('.'); f((c, r, v) => a[r * 20 + c] = v); return bdCheck(a.join('')) };
      return { tower: g(s => { for (let r = 4; r < 12; r++) s(0, r, 's') }).tower, notower: g(s => { for (let r = 3; r < 11; r++) s(0, r, 's') }).tower,
        sym: g(s => { for (let r = 4; r < 12; r++) { s(3, r, 'r'); s(16, r, 'r') } }).sym, nosym: g(s => { for (let r = 4; r < 12; r++) { s(3, r, 'r'); s(16, r, 'b') } }).sym,
        rect: g(s => { for (let r = 9; r < 12; r++) for (let c = 2; c < 6; c++) s(c, r, 'g') }).rect, line: g(s => { for (let c = 2; c < 14; c++) s(c, 11, 'g') }).rect, big: g(s => { for (let r = 9; r < 12; r++) for (let c = 2; c < 10; c++) s(c, r, 'g') }).rect,
        rain: g(s => 'roygbp'.split('').forEach((v, j) => s(5 + j, 11, v))).rainbow, norain: g(s => 'roygbr'.split('').forEach((v, j) => s(5 + j, 11, v))).rainbow } });
    if (!bdc.tower || bdc.notower || !bdc.sym || bdc.nosym || !bdc.rect || bdc.line || bdc.big || !bdc.rain || bdc.norain) fail('a building challenge checks wrongly: ' + JSON.stringify(bdc));
    await a.evaluate(() => { const Z = AG.cur.st; for (let r = 4; r < 12; r++) Z.g[r * 20] = 's'; bdAfter(Z) }); if (!(await a.evaluate(() => AG.got('bbuild', 'tower'))) || !(await a.$('#bdchl li.ok'))) fail('finishing a challenge did not unlock it');
    if (!(await a.isDisabled('#bdpanel .bbpal button[aria-label^="Rainbow"]'))) fail('the Rainbow block was open before 200 bricks earned');
    await a.click('#bdpanel button:has-text("Done")'); await a.waitForSelector('.bbbuild img'); if ((await a.evaluate(() => bdS().bslots[bdS().bslot].replace(/\./g, '').length)) !== 8) fail('the build was not saved');
    ok(`Building mode: ${bd0.e} bricks earned in the puzzles, a tap placed a block for a brick, a drag painted 5, Undo took back the drag, erasing refunded, no bricks means no block, the tower/symmetry/area-12/rainbow checks are right, the build saved`); await shot(a, 'g-build');
    // Ocean Explorer: steer, scan an animal (a true fact), a pressure gate, air running out, an air station, surface
    const ocFacts = await a.evaluate(() => ({ n: OCA.length, ids: new Set(OCA.map(x => x.id)).size, zones: [0, 1, 2, 3].map(z => OCA.filter(x => x.z === z).length), short: OCA.filter(x => !x.f || x.f.length < 40).map(x => x.id) }));
    if (ocFacts.n !== 20 || ocFacts.ids !== 20 || ocFacts.zones.some(n => n < 4) || ocFacts.short.length) fail('the Sea Log data is off: ' + JSON.stringify(ocFacts));
    await a.evaluate(() => { DAY().play = 0; if (GM.ar) delete GM.ar.ocean; AG.cur = null; AR.mode = null; toHub() }); await a.waitForSelector('.wmap'); await a.click('.wmloc:has-text("Ocean Explorer")'); await a.waitForSelector('.oclog');
    await a.click('text=▶ Dive!'); await a.waitForFunction(() => AG.on('ocean') && AG.cur.phase === 'play');
    await a.keyboard.down('ArrowDown'); await a.keyboard.down('ArrowRight'); await a.waitForTimeout(700); await a.keyboard.up('ArrowDown'); await a.keyboard.up('ArrowRight');
    if (await a.evaluate(() => AG.cur.st.y < 40 || AG.cur.st.x < 180)) fail('the submarine did not steer');
    await a.evaluate(() => { const Z = AG.cur.st, n = Z.an.find(q => q.a.id === 'clown'); n.r = 0; Z.x = n.x - 40; Z.y = n.y; Z.vx = Z.vy = 0 }); await a.waitForFunction(() => AG.cur.st.near && AG.cur.st.near.a.id === 'clown');
    await a.keyboard.press('Space'); await a.waitForFunction(() => ocS().log.clown, null, { timeout: 4000 }); if (!(await a.textContent('#ocbox')).includes('anemone')) fail('scanning did not show the clownfish fact');
    const ocAns = async right => { await a.waitForFunction(() => QM && QM.phase === 'ask'); const c = await a.evaluate(() => QM.q.choices ? QM.q.choices.length : 0), r = await a.evaluate(() => QM.q.a[0]);
      if (c) await a.click(`#qmodal .bchoices button >> nth=${right ? r : (r + 1) % c}`); else { await a.fill('#qmin', right ? await a.evaluate(() => fmtA(QM.q)) : '987654'); await a.click('#qmodal .bans button') }
      if (!right) { await a.waitForSelector('#qmok'); await a.click('#qmok') } await a.waitForFunction(() => !QM) };
    await a.evaluate(() => { const Z = AG.cur.st; Z.x = 600; Z.y = 380; Z.cd = 0 }); await a.keyboard.down('ArrowDown'); await a.waitForFunction(() => QM && QM.phase === 'ask', null, { timeout: 6000 }); await a.keyboard.up('ArrowDown');
    await ocAns(false); if (await a.evaluate(() => ocS().zones) !== 1) fail('a wrong answer opened the gate');
    await a.evaluate(() => { AG.cur.st.cd = 0 }); await a.keyboard.down('ArrowDown'); await a.waitForFunction(() => QM && QM.phase === 'ask', null, { timeout: 6000 }); await a.keyboard.up('ArrowDown'); await ocAns(true);
    if (await a.evaluate(() => ocS().zones) !== 2 || !(await a.textContent('#ocbox')).includes('200 to 1,000 meters')) fail('the twilight gate did not open with its fact');
    await a.evaluate(() => { const Z = AG.cur.st; Z.y = 500; Z.air = .01 }); await a.waitForFunction(() => AG.cur.st.y < 30); if (!(await a.textContent('#ocbox')).includes('surface')) fail('running out of air did not float the sub up');
    await a.evaluate(() => { const Z = AG.cur.st, s = Z.st[0]; Z.x = s.x; Z.y = s.y + 10; Z.air = 40; Z.cd = 0 }); await a.keyboard.press('Space'); await ocAns(true); if (await a.evaluate(() => AG.cur.st.air) < 99) fail('the air station did not fill the tank');
    await a.click('#ocbox >> text=Surface and save'); await a.waitForSelector('.endcard'); if (!(await a.textContent('.endcard')).includes('1 new animal')) fail('the surface card is wrong');
    if (!(await a.evaluate(() => AG.got('ocean', 'scan') && AG.got('ocean', 'z2')))) fail('Ocean Explorer achievements did not unlock');
    ok(`Ocean Explorer: 20 animals with facts across 4 zones, the sub steered, a scan logged the clownfish fact, a wrong answer kept the gate shut and a right one opened the twilight zone with its depth fact, no air floated the sub up, an air station refilled it, the trip saved`); await shot(a, 'g-ocean');
    // Mystery Mansion: clue notes need right answers, a lock needs both notes, each room's puzzle gives a gear, Pip, the clock
    const mmP = await a.evaluate(() => { const S = ARS('mansion'); Object.assign(S, { seed: 12345, gears: {}, clues: {}, pip: {}, tries: {}, room: 'hall', spun: 0, runs: 0 }); const P = mmPuzzles(), bad = [];
      const h = P.hall; if (h.seq[4] - h.seq[3] !== h.seq[1] - h.seq[0] || h.ans !== h.seq[h.hole] || !h.opts.includes(h.ans) || new Set(h.opts).size !== h.opts.length) bad.push('hall');
      if (P.library.ans.join() !== P.library.books.slice().sort((x, y) => x - y).join()) bad.push('library');
      const k = P.kitchen; if ((k.young ? k.M * k.kk : k.N / k.M) !== k.ans || !k.opts.includes(k.ans)) bad.push('kitchen');
      const g = P.attic; if (g.ans === g.a || g.ans === g.b || g.a === g.b) bad.push('attic'); return { P, bad } });
    if (mmP.bad.length) fail('mansion puzzles are wrong: ' + mmP.bad);
    await a.evaluate(() => { DAY().play = 0; AG.cur = null; AR.mode = null; toHub() }); await a.waitForSelector('.wmap'); await a.click('.wmloc:has-text("Mystery Mansion")'); await a.click('text=▶ Enter the mansion'); await a.waitForFunction(() => AG.on('mansion') && AG.cur.phase === 'play');
    await a.click('#mmbox .chip:has-text("Coat hooks")'); if (!(await a.textContent('#mmbox')).includes('Find both clue notes')) fail('the lock opened without the clue notes');
    await a.click('#mmbox .chip:has-text("Painting")'); await ocAns(false); if (!(await a.textContent('#mmbox')).includes('smudged')) fail('a wrong answer read the clue');
    await a.click('#mmbox .chip:has-text("Painting")'); await ocAns(true); await a.click('#mmbox .chip:has-text("Umbrella")'); await ocAns(true);
    { const bx = await (await a.$('#agcv')).boundingBox(), hk = await a.evaluate(() => { const Z = AG.cur.st; mmAim(Z, 'coat'); const o = MMO.hall.find(q => q[0] === 'coat'); return mmScr(Z, o[3] + o[5] / 2, o[4] + o[6] / 2) }); await a.mouse.click(bx.x + hk[0] / 640 * bx.width, bx.y + hk[1] / 340 * bx.height) } await a.waitForSelector('.mmpz');
    await a.click(`.mmpz button:text-is("${mmP.P.hall.opts.find(v => v !== mmP.P.hall.ans)}")`); if (!(await a.textContent('#mmbox')).includes('Not quite')) fail('a wrong puzzle answer was accepted');
    await a.click(`.mmpz button:text-is("${mmP.P.hall.ans}")`); if (!(await a.evaluate(() => mmS().gears.hall))) fail('the hall puzzle gave no gear');
    for (const [room, nm, lock, c1, c2] of [['library', 'Library', 'Bookshelf', 'Open book', 'Fireplace'], ['kitchen', 'Kitchen', 'Oven', 'Recipe book', 'Jar shelf'], ['green', 'Greenhouse', 'Flower bed', 'Watering can', 'Bench'], ['attic', 'Attic', 'Three trunks', 'Round window', 'Old map']]) {
      await a.click(`#mmbox .mmrooms .chip:has-text("${nm}")`); await a.click(`#mmbox .chip:has-text("${c1}")`); await ocAns(true); await a.click(`#mmbox .chip:has-text("${c2}")`); await ocAns(true); await a.click(`#mmbox .chip:has-text("${lock}")`); await a.waitForSelector('.mmpz');
      const q = mmP.P[room]; if (q.k === 'sort') for (const v of q.ans) await a.click(`.mmpz button:has-text("📕 ${v}")`); else if (q.k === 'logic') await a.click(`.mmpz button:has-text("${q.ans[0].toUpperCase() + q.ans.slice(1)} trunk")`); else if (q.k === 'pattern') await a.click(`.mmpz button[aria-label="${q.ans}"]`); else await a.click(`.mmpz button:text-is("${q.ans}")`);
      if (!(await a.evaluate(r => mmS().gears[r], room))) fail(`the ${room} puzzle gave no gear`) }
    await a.click('#mmbox .chip:has-text("Corners")'); if (!(await a.evaluate(() => mmS().pip.attic))) fail('Pip was not found');
    await a.click('#mmbox .mmrooms .chip:has-text("Clock Tower")'); await a.click('#mmbox .chip:has-text("The Great Clock")'); await a.waitForSelector('.endcard', { timeout: 8000 });
    if (!(await a.textContent('.endcard')).includes('ticking again') || !(await a.evaluate(() => AG.got('mansion', 'clock') && mmS().spun === 1))) fail('the Great Clock did not start');
    ok('Mystery Mansion: the puzzles check out, a lock needs both clue notes, a wrong answer smudged a note, a wrong puzzle answer was refused, all five puzzles (pattern, order, trays, flowers, trunks) gave their gears, Pip was found, and the Great Clock started'); await shot(a, 'g-mansion');
    // Island Architect: build with coins, earn coins with answers, the rules for land, a day's report and growth, missions, bulldozing
    await a.evaluate(() => { DAY().play = 0; if (GM.ar) delete GM.ar.island; AG.cur = null; AR.mode = null; toHub() }); await a.waitForSelector('.wmap'); await a.click('.wmloc:has-text("Island Architect")'); await a.click('text=▶ Build'); await a.waitForFunction(() => AG.on('island') && AG.cur.phase === 'play');
    const isC = await a.evaluate(() => { const g = [], s = [], w = []; ISLAND.forEach((v, i) => { const c = [i % 16, Math.floor(i / 16)]; (v === 'g' ? g : v === 's' ? s : v === '.' ? w : g).push(c) }); return { g: g.filter((_, i) => i % 3 === 0), s, w } });
    const isBx = await (await a.$('#agcv')).boundingBox(), isTap = async ([c, r]) => { const [X, Y] = await a.evaluate(([c, r]) => isoScreen(c, r), [c, r]); await a.mouse.click(isBx.x + X / 640 * isBx.width, isBx.y + Y / 400 * isBx.height) };
    for (let i = 0; i < 3; i++) await isTap(isC.g[i]); if ((await a.evaluate(() => [isS().coins, isStats().n.h])).join() !== '0,3') fail('3 houses did not cost 60 coins');
    await a.click('.ispal button:has-text("Well")'); await isTap(isC.g[3]); if (!(await a.textContent('#ismsg')).includes('You need 15 more')) fail('a building was built without enough coins');
    await a.click('text=Earn coins'); await ocAns(true); await isTap(isC.g[3]); if (await a.evaluate(() => isS().mis) !== 1) fail('the first mission did not finish');
    await isTap(isC.w[0]); if (!(await a.textContent('#ismsg')).includes('ocean')) fail('built on the ocean');
    await a.evaluate(() => { isS().coins = 200 }); await a.click('.ispal button:has-text("Farm")'); await isTap(isC.g[4]); await isTap(isC.s[0]); if (!(await a.textContent('#ismsg')).includes('Sand is too soft')) fail('a farm went on the sand');
    await a.click('.ispal button:has-text("Park")'); await isTap(isC.g[5]); await a.evaluate(() => isDay(AG.cur.st));
    const isR = await a.evaluate(() => ({ rep: document.querySelector('.isrep').textContent, pop: isS().pop, mis: isS().mis }));
    if (!isR.rep.includes('2 people need 2 food and 2 water') || !isR.rep.includes('Farms make 6 food ✓') || isR.pop !== 4 || isR.mis !== 2) fail('the day report or growth is wrong: ' + JSON.stringify(isR));
    const isC0 = await a.evaluate(() => isS().coins); await a.click('.ispal button:has-text("Bulldoze")'); await isTap(isC.g[4]); if ((await a.evaluate(() => isS().coins)) - isC0 !== 12) fail('bulldozing a farm did not give back half (12)');
    await a.click('#isbox >> text=Save and leave'); await a.waitForSelector('.endcard'); if (!(await a.evaluate(() => AG.got('island', 'first')))) fail('Island Architect achievement missing');
    ok('Island Architect: 3 houses cost 60 coins, no coins means no well until a right answer earned 15, ocean and sand rules held, a day report did the food and water math and 2 people moved in, missions advanced, bulldozing gave half back'); await shot(a, 'g-island');
    // Classroom mode: the teacher closes the Arcade, then opens it with 2 games, 5 minutes a day and math questions; the teacher sees the week's Arcade numbers
    const arcLoad = async () => { await a.evaluate(async () => { ST.joined = (await api('GET', '/api/classes')).joined; AG.cur = null; AR.mode = null; rerealm() }) };
    await t.evaluate(async () => { await LOAD.teacher(); if (ST.tab !== 'teacher') go('teacher') }); await t.click('#tabs >> text=Teacher'); await t.waitForSelector('[id^=arco]');
    await t.uncheck(`#arco${cid}`); await t.click('text=Save Arcade settings'); await t.waitForFunction(id => ST.classes.find(c => c.id === id).game.arc && ST.classes.find(c => c.id === id).game.arc.off === true, cid);
    await arcLoad(); if (!(await a.$('.arcclosed'))) fail('the Arcade did not close for the class');
    await t.check(`#arco${cid}`); await t.selectOption(`#arcm${cid}`, '5'); await t.selectOption(`#arcs${cid}`, 'math');
    for (const g of await t.$$eval(`input[name="arcg${cid}"]`, x => x.map(i => i.value))) if (!['kart', 'blocks'].includes(g)) await t.uncheck(`input[name="arcg${cid}"][value="${g}"]`);
    await t.click('text=Save Arcade settings'); await t.waitForFunction(id => { const a = ST.classes.find(c => c.id === id).game.arc; return a && !a.off && a.mins === 5 && a.sub === 'math' && a.games && a.games.join() === 'kart,blocks' }, cid);
    await arcLoad(); await a.waitForSelector('.wmap');
    const arcHub = await a.evaluate(() => ({ off: [...document.querySelectorAll('.tile.classoff .tname')].map(x => x.textContent), on: [...document.querySelectorAll('.tile:not(.classoff) .tname')].map(x => x.textContent), cap: playAllowed() }));
    if (arcHub.on.sort().join() !== 'Block Builder,Turbo Trivia Kart' || arcHub.off.length !== 8 || arcHub.cap > 300) fail('the class Arcade rules did not apply on the hub: ' + JSON.stringify(arcHub));
    await a.evaluate(() => openGame('snake')); if (await a.evaluate(() => AR.mode) === 'snake') fail('a turned-off game opened');
    await a.evaluate(() => { GM.rsub = 'ela'; openGame('kart') }); await a.waitForSelector('text=picked by your teacher'); if (await a.evaluate(() => GM.rsub) !== 'math') fail('the teacher\'s subject was not used');
    await a.evaluate(() => { AG.answered('kart', true, 900); AG.answered('kart', false, 900); WEEK().play = (WEEK().play || 0) + 180 }); await save(a);
    await t.evaluate(async () => { await LOAD.teacher(); go('teacher') }); await t.waitForSelector('[id^=arco]');
    const arcRow = await t.evaluate(name => { const tr = [...document.querySelectorAll('.gblock')].find(b => b.textContent.includes('Arcade this week')); if (!tr) return null; const r = [...tr.querySelectorAll('tr')].find(x => x.cells[0].textContent === name); return r ? [...r.cells].map(c => c.textContent) : null }, creds[0][0]);
    if (!arcRow || +arcRow[2] < 2 || +arcRow[1] < 3) fail('the teacher did not see the week\'s Arcade numbers: ' + JSON.stringify(arcRow));
    await t.evaluate(id => setGame(id, { arc: null }), cid); await t.waitForFunction(id => !ST.classes.find(c => c.id === id).game.arc, cid); await arcLoad();
    ok(`Classroom mode: the teacher closed the Arcade and the class saw it closed; then 2 games, 5 minutes a day and math questions applied (8 games greyed out, a turned-off game would not open, the questions switched to math); the teacher saw ${creds[0][0]}'s week: ${arcRow[1]} minutes, ${arcRow[2]} game questions, ${arcRow[3]} right`);
    // Goblin Gate Map Maker: draw a road (a wrong start, a drag that backs up), pads (one with the keyboard), test play, save, share with the class;
    // the server checks maps and limits; a classmate sees, likes and opens it but can't remove it; the teacher removes one
    await a.evaluate(() => { DAY().play = 0; toHub() }); await a.click('.tile:has-text("Goblin Gate")'); await a.waitForSelector('.ggmaps');
    await a.click('text=➕ Make a map'); await a.waitForSelector('#ggedcv');
    const mcv = await a.locator('#ggedcv').boundingBox(), mat = (c, r) => [mcv.x + (c * 40 + 20) / 640 * mcv.width, mcv.y + (r * 40 + 20) / 360 * mcv.height];
    await a.mouse.click(...mat(4, 4)); if (!(await a.textContent('#ggedmsg')).includes('left column')) fail('a road starting away from the left edge was allowed');
    await a.mouse.click(...mat(0, 1)); for (let c = 1; c <= 6; c++) await a.mouse.click(...mat(c, 1));
    await a.mouse.move(...mat(6, 1)); await a.mouse.down(); await a.mouse.move(...mat(6, 6), { steps: 8 }); await a.mouse.move(...mat(14, 6), { steps: 12 }); await a.mouse.move(...mat(13, 6), { steps: 2 }); await a.mouse.up(); await a.mouse.click(...mat(14, 6));
    const mr = await a.evaluate(() => ({ n: GGED.o.road.length, chk: ggCheck(GGED.o) })); if (mr.n !== 20 || !mr.chk.includes('Stone pads')) fail('the road was not drawn right: ' + JSON.stringify(mr));
    await a.click('.ggtools >> text=Stone pads'); for (const [c, r] of [[3, 2], [5, 0], [6, 4], [9, 5]]) await a.mouse.click(...mat(c, r));
    await a.mouse.click(...mat(3, 1)); if (!(await a.textContent('#ggedmsg')).includes('beside the road')) fail('a stone pad on the road was allowed');
    await a.focus('#ggedcv'); await a.evaluate(() => { GGED.cur = 15 * 8 + 1 }); await a.keyboard.press('ArrowRight'); await a.keyboard.press('Enter');
    await a.click('.ggedrows .chip:has-text("Lava")'); await a.selectOption('#ggna', '0'); await a.selectOption('#ggnb', '1'); await a.selectOption('#ggw', '5');
    const mp = await a.evaluate(() => ({ pads: GGED.o.pads.length, chk: ggCheck(GGED.o), name: ggName(GGED.o), th: GGED.o.th, w: GGED.o.w }));
    if (mp.pads !== 5 || mp.chk || mp.name !== 'Twisty Canyon' || mp.th !== 'lava' || mp.w !== 5) fail('the map settings are wrong: ' + JSON.stringify(mp));
    await a.click('text=▶ Test play'); await a.waitForFunction(() => AG.cur && AG.cur.phase === 'play' && AG.cur.st && AG.cur.st.m.custom); const mc0 = await a.evaluate(() => ggS().coins);
    await a.evaluate(() => { const Z = AG.cur.st; Z.tw = Z.tw.map(() => ({ t: 'titan', lvl: 7, cd: 0, spent: 1 })); let n = 0; while (n++ < 80000 && AG.cur.phase === 'play') { if (Z.ph === 'build') ggWave(Z); AG.G.gate.step(1 / 60, Z) } });
    await a.waitForSelector('#ggedcv'); if (!(await a.textContent('.ggmsg')).includes('Test play: you won')) fail('the test play result is missing'); if (await a.evaluate(() => ggS().coins) !== mc0) fail('a made map paid wave coins');
    await a.click('text=💾 Save map'); await a.waitForSelector('.ggmine'); await a.click('.ggmine .chip:has-text("Share with Dragon Class")');
    await a.waitForFunction(() => GGCM && !GGCM.busy && GGCM.list.length === 1, null, { timeout: 8000 });
    const ms = await a.evaluate(() => ({ mine: ggS().mine.length, maker: AG.got('gate', 'maker'), share: AG.got('gate', 'share'), own: GGCM.list[0].mine }));
    if (ms.mine !== 1 || !ms.maker || !ms.share || !ms.own) fail('saving or sharing the map went wrong: ' + JSON.stringify(ms));
    const mbad = await a.evaluate(async cid => { const out = [], v = ggS().mine[0], tryIt = async m => { try { await api('POST', `/api/classes/${cid}/maps`, m); out.push('saved') } catch (e) { out.push('refused') } };
      for (const m of [{ ...v, road: '0001' }, { ...v, th: 'moon' }, { ...v, pads: v.road.slice(2, 8) }, { ...v, na: 40 }]) await tryIt(m); for (let i = 0; i < 3; i++) await tryIt(ggWire(ggMapOf(v))); return out.join() }, cid);
    if (mbad !== 'refused,refused,refused,refused,saved,saved,refused') fail('the server did not check maps or the limit of 3: ' + mbad);
    const b2 = await login(creds[1][1], creds[1][2]); await b2.evaluate(async () => { ST.joined = (await api('GET', '/api/classes')).joined; DAY().play = 0 });
    await b2.click('#tabs >> text=Arcade'); await b2.waitForSelector('.tiles'); await b2.click('.tile:has-text("Goblin Gate")'); await b2.waitForFunction(() => GGCM && !GGCM.busy && GGCM.list.length === 3, null, { timeout: 8000 });
    const bl = await b2.evaluate(() => GGCM.list.map(v => [ggName(v), v.by, v.mine])); if (bl.some(([n, by, mine]) => n !== 'Twisty Canyon' || !/^Ava/.test(by) || mine)) fail('the classmate saw the wrong class maps: ' + JSON.stringify(bl));
    await b2.click('.ggmine .chip[aria-label^="Like"] >> nth=0'); await b2.waitForFunction(() => GGCM.list.some(v => v.liked && v.likes === 1));
    await b2.click('.ggmine .chip:has-text("▶ Play") >> nth=0'); await b2.waitForSelector('text=Ready to play'); const mid0 = await b2.evaluate(() => GGPLAY.cls.id);
    const bdel = await b2.evaluate(async ([cid, id]) => { try { await api('DELETE', `/api/classes/${cid}/maps/${id}`); return 'deleted' } catch (e) { return e.status } }, [cid, mid0]); if (bdel !== 403) fail('a classmate removed someone else\'s map: ' + bdel);
    const mst = await a.evaluate(async ([cid, id]) => (await api('GET', `/api/classes/${cid}/maps`)).maps.find(m => m.id === id), [cid, mid0]); if (!mst || mst.plays !== 1 || mst.likes !== 1) fail('plays and likes were not counted: ' + JSON.stringify(mst));
    await t.evaluate(async () => { await LOAD.teacher(); go('teacher') }); await t.click(`#arcmaps${cid} >> text=Show shared maps`); await t.waitForSelector(`#arcmaps${cid} table`);
    const mtr0 = await t.$$eval(`#arcmaps${cid} tr`, r => r.length); await t.click(`#arcmaps${cid} button:has-text("Remove") >> nth=0`); await t.waitForFunction(id => document.querySelectorAll(`#arcmaps${id} tr`).length === 3, cid);
    await a.click('text=🔄 Refresh'); await a.waitForFunction(() => GGCM && !GGCM.busy && GGCM.list.length === 2); await a.click('.ggmine .chip:has-text("Remove") >> nth=0'); await a.waitForFunction(() => GGCM && !GGCM.busy && GGCM.list.length === 1);
    if (mtr0 !== 4) fail('the teacher did not see the 3 shared maps: ' + mtr0); await b2.close();
    ok(`Goblin Gate Map Maker: a road had to start on the left, a drag drew it and backing up undid a square, pads could not go on the road (one placed with the keyboard), a test play won with no wave coins, the map saved and was shared with the class; the server refused 4 bad maps and a 4th share; a classmate saw 3 maps by ${bl[0][1]}, liked and opened one (counted) but could not remove it; the teacher and the author each removed one`); await shot(a, 'g-mapmaker');
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
    // A free membership day: everyone has unlimited play and there is nothing to pay
    await a.evaluate(() => { window.NO_FREE_DAY = false; if (!FREE_DAYS.includes(dstr())) FREE_DAYS.push(dstr()); DAY().play = playAllowed() + 999; go('play') }); await a.waitForSelector('text=🎉 Free day: unlimited play');
    const fd = await a.evaluate(() => ({ member: isMember(), limit: noLimit(), out: outOfTime() })); if (!fd.member || !fd.limit || fd.out) fail('free day did not give unlimited play: ' + JSON.stringify(fd));
    await a.evaluate(() => go('member')); await a.waitForSelector('text=Membership is free today!'); if (await a.$('.paybtn')) fail('pay buttons still show on a free day');
    await a.evaluate(() => { window.NO_FREE_DAY = true; go('learn') }); if (await a.evaluate(() => isMember())) fail('switching the free day off did not end it');
    ok('free membership day: a learner out of play time had unlimited play, and the Membership page said it is free with no pay buttons');
    const sm = await call(a, 'POST', '/api/owner/members', { who: creds[0][1], until: Date.now() + 9e9 }), tm2 = await call(t, 'POST', '/api/owner/members', { who: code, until: Date.now() + 9e9 }), sl = await call(a, 'GET', '/api/owner/members');
    if (sm.s !== 403 || tm2.s !== 403 || sl.s !== 403) fail(`students or teachers could switch on membership: ${sm.s} ${tm2.s} ${sl.s}`);
    ok('students and teachers get 403 when they try to switch on membership');
    // Teachers play without a time limit
    await t.click('#tabs >> text=Arcade'); await t.waitForSelector('text=No time limit (preview)'); ok('teachers can try the game with no time limit');
  } catch (e) { console.log('FAIL', e.message); errs.push(e.message) }
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'all game checks passed'); await br.close(); process.exit(errs.length ? 1 : 0);
})();
