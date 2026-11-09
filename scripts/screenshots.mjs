// Regenerates the README screenshots with fictional demo data (no real sessions, paths or names).
// The API and the terminal WebSocket are mocked, so the server doesn't need to run.
//
//   node scripts/screenshots.mjs [repo-dir] [out-dir]     (defaults: this repo, docs/screenshots)
//
// Needs Playwright with Chromium: `npm i --no-save playwright && npx playwright install chromium`,
// or point PLAYWRIGHT_PATH at an existing playwright / playwright-core folder.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(process.argv[2] || path.join(HERE, '..'));
const OUT = path.resolve(process.argv[3] || path.join(REPO, 'docs/screenshots'));
const require = createRequire(path.join(REPO, 'package.json'));
const load = (m) => { try { return require(m); } catch { return null; } };
const pw = (process.env.PLAYWRIGHT_PATH && load(path.resolve(process.env.PLAYWRIGHT_PATH))) || load('playwright') || load('playwright-core');
if (!pw) { console.error('Playwright not found: npm i --no-save playwright && npx playwright install chromium (or set PLAYWRIGHT_PATH)'); process.exit(1); }
const { chromium } = pw;
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:4999';
const VENDOR = {
  '/vendor/xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
};
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// ---------------- demo data ----------------
const now = Date.now();
const SESSIONS = [
  { pane: '%1', session: 'acme-shop', account: 'work', tone: 0, target: 'acme-shop:0.0', project: 'acme-shop', title: 'checkout-redesign', cwd: '/home/dev/projects/acme-shop', state: 'waiting', attached: true, activity: now,
    preview: ['Do you want to make this edit to CartSummary.tsx?', '❯ 1. Yes', '  2. Yes, allow all edits during this session', '  3. No, and tell Claude what to do differently'] },
  { pane: '%2', session: 'blog-engine', account: 'personal', tone: 1, target: 'blog-engine:0.0', project: 'blog-engine', title: '', cwd: '/home/dev/projects/blog-engine', state: 'working', attached: false, activity: now - 1000,
    preview: ['● Running the test suite after adding pagination…', '✻ Testing… (34s · ↓ 1.2k tokens · esc to interrupt)'] },
  { pane: '%3', session: 'data-pipeline', account: 'work', tone: 0, target: 'data-pipeline:0.0', project: 'data-pipeline', title: '', cwd: '/home/dev/code/data-pipeline', state: 'idle', attached: true, activity: now - 2000,
    preview: ['● Done. The nightly job now retries failed batches.', '>', '  ? for shortcuts'] },
  { pane: '%4', session: 'infra-terraform', account: null, tone: null, target: 'infra-terraform:0.0', project: 'infra-terraform', title: '', cwd: '/home/dev/code/infra-terraform', state: 'term', attached: false, activity: now - 3000,
    preview: ['dev@laptop:~/code/infra-terraform$ terraform plan', 'Plan: 2 to add, 1 to change, 0 to destroy.', 'dev@laptop:~/code/infra-terraform$'] },
];
const PROJECTS = ['acme-shop', 'blog-engine', 'data-pipeline', 'design-system', 'dotfiles', 'infra-terraform', 'mobile-app']
  .map((n) => ({ name: n, dir: `/home/dev/${['data-pipeline', 'infra-terraform', 'dotfiles'].includes(n) ? 'code' : 'projects'}/${n}` }));
const SNIPPETS = [
  { id: 'a', name: 'Tests', text: 'npm test -- --watch=false' },
  { id: 'b', name: 'Revisar PR', text: '/code-review high' },
  { id: 'c', name: 'Logs', text: 'docker compose logs -f --tail=100 api' },
];
const day = (d, h, m) => { const x = new Date(now - d * 864e5); x.setHours(h, m, 0, 0); return x.toISOString(); };
const MEM = `[blog-engine] recent context, ${new Date(now).toISOString().slice(0, 10)}\nMode: Code Development (code)\n\nLegend: ●bugfix ◆feature ↻refactor ✓change ○discovery\n\n12 7:02a ◆ Posts API returns plain arrays\n13 7:05a ○ findAll() loads every row\n14 7:20a ✓ Cursor pagination planned`;
const HISTORY = [
  { role: 'note', source: 'claude-mem', title: `[blog-engine] recent context, ${new Date(now).toISOString().slice(0, 10)}`, text: MEM, ts: day(1, 7, 9) },
  { role: 'user', text: 'The posts endpoint returns everything at once. Add cursor pagination to GET /api/posts and keep the old clients working.', ts: day(1, 7, 10) },
  { role: 'assistant', text: 'Let me look at how the posts route and its tests are set up first.', ts: day(1, 7, 11) },
  { role: 'tools', ts: day(1, 7, 11), tools: [
    { name: 'Grep', arg: "router.get('/api/posts'" },
    { name: 'Read', arg: '/home/dev/projects/blog-engine/src/routes/posts.ts' },
    { name: 'Bash', arg: 'npm test -- posts', cmd: 'npm test -- posts' },
  ] },
  { role: 'assistant', text: 'Plan\n\nThe route loads **every** post with `findAll()`. I will:\n\n1. Accept optional `cursor` and `limit` query params\n2. Return `{ items, nextCursor }` only when `cursor` or `limit` is present\n3. Keep the plain array response for old clients\n\n```ts\nconst limit = Math.min(Number(req.query.limit) || 20, 100);\nconst items = await posts.findPage({ after: req.query.cursor, limit: limit + 1 });\nconst nextCursor = items.length > limit ? items.pop().id : null;\nres.json({ items, nextCursor });\n```', ts: day(0, 7, 18) },
  { role: 'tools', ts: day(0, 7, 19), tools: [{ name: 'Edit', arg: '/home/dev/projects/blog-engine/src/routes/posts.ts' }] },
  { role: 'tools', ts: day(0, 7, 21), tools: [{ name: 'Bash', arg: 'cd /home/dev/projects/blog-engine && npm run lint && npm test -- --reporter=dot …',
    cmd: 'cd /home/dev/projects/blog-engine && npm run lint && npm test -- --reporter=dot --coverage | tee /tmp/test.log' }] },
  { role: 'user', text: 'Nice. Also add a Link header?', ts: day(0, 7, 38) },
  { role: 'assistant', text: 'Done — responses now include a `Link: <…?cursor=…>; rel="next"` header when there is a next page.\n\n- 48 tests pass\n- Old clients still get a plain array\n- Added `test/pagination.test.ts`', ts: day(0, 7, 40) },
];
const E = '\x1b[';
const TERM = [
  `${E}38;5;209m✻${E}0m ${E}1mWelcome to Claude Code${E}0m`, '',
  `  ${E}2m/help for help · cwd: /home/dev/projects/acme-shop${E}0m`, '',
  `${E}2m>${E}0m Make the cart summary sticky on mobile and show the item count`, '',
  `${E}38;5;209m●${E}0m I'll update CartSummary.tsx to use a sticky footer below 640px.`, '',
  `${E}38;5;209m●${E}0m ${E}1mUpdate${E}0m(src/components/CartSummary.tsx)`,
  `  ⎿  Updated with ${E}32m12 additions${E}0m and ${E}31m3 removals${E}0m`,
  `     ${E}32m+  <footer className="cart-summary sticky">${E}0m`,
  `     ${E}32m+    <span>{items.length} items</span>${E}0m`, '',
  `${E}38;5;209m●${E}0m ${E}1mBash${E}0m(npm test -- CartSummary)`,
  `  ⎿  ${E}32mPASS${E}0m src/components/CartSummary.test.tsx (6 tests)`, '',
  `${E}38;5;209m●${E}0m Done. The summary now sticks to the bottom on small screens.`, '',
  `${E}2m╭──────────────────────────────────────╮${E}0m`,
  `${E}2m│${E}0m > ${E}2m                                    │${E}0m`,
  `${E}2m╰──────────────────────────────────────╯${E}0m`,
  `  ${E}2m? for shortcuts${E}0m`,
].join('\r\n');
// What is left on screen after /exit: Claude's exit summary and the shell prompt.
const RESUME_ID = '5f3c9a1e-7b2d-4e8a-9c61-2d0b8f4a7e13';
const TERM_ENDED = [
  `${E}2m>${E}0m /exit`,
  `  ⎿  ${E}2mGoodbye!${E}0m`, '',
  `${E}2mResume this session with:${E}0m`,
  `claude --resume ${RESUME_ID}`,
  `${E}32mdev@laptop${E}0m:${E}34m~/code/data-pipeline${E}0m$ `,
].join('\r\n');

// ---------------- mocked server ----------------
async function setup(page, { sessions = SESSIONS, term = TERM } = {}) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/sessions') return json(sessions);
    if (/\/history$/.test(p)) return json({ messages: HISTORY });
    if (/\/relaunch$/.test(p)) return json({ cmd: 'claude', resume: RESUME_ID });
    if (p === '/api/projects') return json(PROJECTS);
    if (p === '/api/commands') return json(['claude', 'claude --continue']);
    if (p === '/api/snippets') return json(SNIPPETS);
    if (p.startsWith('/api/')) return json({});
    const file = VENDOR[p] ? path.join(REPO, VENDOR[p]) : path.join(REPO, 'public', p === '/' ? 'index.html' : p);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.routeWebSocket(/\/ws\?/, (ws) => { setTimeout(() => ws.send(term), 300); ws.onMessage(() => {}); });
}

const browser = await chromium.launch();
const shot = async (name, { phone = true, sessions, term, act } = {}) => {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'es' }
    : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'es' });
  const page = await ctx.newPage();
  await setup(page, { sessions, term });
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector('#sessions li');
  await page.evaluate(() => document.fonts.ready);
  if (act) await act(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await ctx.close();
};
const openTerm = async (page) => { await page.click('.card[data-pane="%1"]'); await page.waitForTimeout(900); };
const openHistory = async (page, { scroll = 'bottom', expand = false } = {}) => {
  await openTerm(page);
  await page.click('#btn-history');
  await page.waitForSelector('#history-chat .msg');
  if (expand) await page.evaluate(() => document.querySelectorAll('#history-chat details.msg.tools').forEach((d) => { if (d.querySelector('.cmd')) d.open = true; }));
  await page.evaluate((s) => { const c = document.querySelector('#history-chat'); c.scrollTop = s === 'top' ? 0 : c.scrollHeight; }, scroll);
};

await shot('phone-list');
await shot('phone-empty', { sessions: [] });
await shot('phone-new-session', { act: async (p) => { await p.click('#btn-new'); await p.waitForSelector('#project-list li'); await p.fill('#new-search', 'shop'); await p.dispatchEvent('#new-search', 'input'); await p.click('#project-list li[data-dir]'); } });
await shot('phone-terminal', { act: openTerm });
await shot('phone-history', { act: (p) => openHistory(p, { scroll: 'top' }) });
await shot('phone-snippets', { act: async (p) => { await openTerm(p); await p.click('#btn-snippets'); await p.waitForSelector('#snippet-list li[data-id]'); } });
await shot('phone-help', { act: async (p) => { await openTerm(p); await p.click('#btn-help'); await p.waitForSelector('#help-body li'); } });
const ENDED = SESSIONS.map((s) => (s.pane === '%3' ? { ...s, state: 'ended', preview: ['Resume this session with:', `claude --resume ${RESUME_ID}`, 'dev@laptop:~/code/data-pipeline$'] } : s));
await shot('phone-ended', { sessions: ENDED, term: TERM_ENDED, act: async (p) => { await p.click('.card[data-pane="%3"]'); await p.waitForSelector('#relaunch:not(.hidden)'); await p.waitForTimeout(600); } });
await shot('desktop-list', { phone: false });
await shot('desktop-terminal', { phone: false, act: openTerm });
await shot('desktop-history', { phone: false, act: (p) => openHistory(p, { expand: true }) });

// Hero: three phone shots on a graphite background.
const b64 = (n) => fs.readFileSync(path.join(OUT, `${n}.png`)).toString('base64');
const ctx = await browser.newContext({ viewport: { width: 1400, height: 760 } });
const page = await ctx.newPage();
await page.setContent(`<html><body style="margin:0;width:1400px;height:760px;background:radial-gradient(ellipse at 50% 110%,#3a1c10 0%,#0d0d0d 55%);display:flex;align-items:center;justify-content:center;gap:44px">
${['phone-list', 'phone-terminal', 'phone-history'].map((n, i) => `<div style="width:300px;height:650px;border-radius:38px;padding:8px;background:#1d1d1d;box-shadow:0 30px 60px rgba(0,0,0,.6),0 0 0 2px #2a2a2a;${i === 1 ? 'transform:translateY(-26px)' : ''}"><img src="data:image/png;base64,${b64(n)}" style="width:100%;height:100%;object-fit:cover;object-position:top;border-radius:30px"></div>`).join('')}
</body></html>`);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'hero.png') });
await browser.close();
console.log('ok', fs.readdirSync(OUT).join(' '));
