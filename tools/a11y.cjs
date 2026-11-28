/* Accessibility check: runs axe (WCAG 2.0/2.1/2.2 A and AA rules) on the main pages against a running server.
     npm i --no-save axe-core@4.10.2    (once)
     node tools/a11y.cjs                 exits 1 if any page has a violation
   Owner "owner" / "ownerpass1234", as for the other browser tests. */
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const AXE = require('fs').readFileSync(require.resolve('axe-core/axe.min.js', { paths: [process.cwd(), __dirname] }), 'utf8');
const B = process.env.LUMEN_URL || 'http://localhost:3922';
(async () => { const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(() => { window.NO_FREE_DAY = true }); const p = await ctx.newPage(); let bad = 0;
  const run = async n => { await p.addScriptTag({ content: AXE }); const r = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => `${v.impact} ${v.id} x${v.nodes.length}: ${v.nodes[0].target.join(' ')}`));
    bad += r.length; console.log((r.length ? '✗ ' : '✓ ') + n + (r.length ? '\n   ' + r.join('\n   ') : '')) };
  for (const [u, n] of [['/', 'home page'], ['/privacy.html', 'privacy policy'], ['/terms.html', 'terms'], ['/accessibility.html', 'accessibility statement'], ['/pitch.html', 'school overview'], ['/dpa.html', 'data privacy agreement']]) { await p.goto(B + u); await p.waitForTimeout(500); await run(n) }
  await p.goto(B + '/app'); await p.waitForSelector('#af'); await run('sign-in');
  await p.fill('[name=username]', 'owner'); await p.fill('[name=password]', 'ownerpass1234'); await p.click('#af button'); await p.waitForSelector('#avatarBtn'); await p.waitForTimeout(1500); await run('Learn page');
  await p.click('#tabs >> text=Arcade'); await p.waitForTimeout(1500); await run('Arcade');
  await p.evaluate(() => { showTab('learn'); skGo('soc_4') }); await p.waitForSelector('.sklessons', { timeout: 15000 }); await p.waitForTimeout(1500); await run('skill page with its lessons');
  await p.evaluate(() => clOpen('cs-4-x1-L1')); await p.waitForSelector('.replink'); await run('lesson page with report links');
  await p.evaluate(() => { ST.ot = 'reports'; OREP = null; showTab('owner') }); await p.waitForSelector('text=Reported mistakes'); await p.waitForTimeout(800); await run('owner console: reports');
  await b.close(); process.exit(bad ? 1 : 0) })();
