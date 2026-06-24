// webtest driver — connects to a running Chrome (CDP), acts on the first tab, and
// keeps the session alive between calls. Adds testing primitives: assertions, a
// PASS/FAIL report, and access to the captured console/network error feed.
//
//   node drive.mjs <command> [args...] [--flags]
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const PORT = process.env.BROWSER_PORT || '9222';
const STATE = process.env.STATE_DIR || resolve(homedir(), '.cache/claude-browser');
const SHOTS = process.env.SHOTS_DIR || resolve(STATE, 'shots');
const EVENTS = resolve(STATE, 'events.jsonl');
const REPORT = resolve(STATE, 'report.jsonl');
mkdirSync(SHOTS, { recursive: true });

const [, , cmd, ...rest] = process.argv;
const flags = {};
const pos = [];
for (const a of rest) {
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); flags[k] = v ?? true; }
  else pos.push(a);
}

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonl = (f) => { try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

function logAssert(name, ok, detail = '') {
  appendFileSync(REPORT, JSON.stringify({ t: now(), name, status: ok ? 'PASS' : 'FAIL', detail }) + '\n');
  console.log((ok ? '✅ PASS ' : '❌ FAIL ') + name + (detail ? ` — ${detail}` : ''));
  if (!ok) process.exitCode = 1;
  return ok;
}

// "real failure" filter over the captured event feed
function badEvents(evs, { include4xx = false, strict = false } = {}) {
  return evs.filter((e) =>
    e.kind === 'pageerror' ||
    (e.kind === 'console' && e.level === 'error') ||
    (strict && e.kind === 'console' && e.level === 'warning') ||
    e.kind === 'requestfailed' ||
    (e.kind === 'httperror' && (e.status >= 500 || (include4xx && e.status >= 400))));
}
const fmtEv = (e) => `[${e.kind}${e.status ? ' ' + e.status : ''}${e.level ? '/' + e.level : ''}] ${e.text || e.url || ''}`.slice(0, 160);

// ---------- file-only commands (no browser needed) ----------
if (['reset', 'events', 'report', 'wait-up', 'help', undefined].includes(cmd)) {
  switch (cmd) {
    case 'reset':
      writeFileSync(EVENTS, ''); writeFileSync(REPORT, '');
      console.log('reset — events + report limpos. Pronto pra um novo teste.');
      break;
    case 'events': {
      const evs = readJsonl(EVENTS).filter((e) => e.kind !== 'monitor');
      const sel = flags.errors ? badEvents(evs, { include4xx: true, strict: true }) : evs;
      const n = Number(flags.max) || 50;
      console.log(`${sel.length} evento(s)` + (sel.length > n ? ` (mostrando ${n})` : '') + ':');
      for (const e of sel.slice(-n)) console.log(' ', e.t.slice(11, 19), fmtEv(e));
      break;
    }
    case 'report': {
      const r = readJsonl(REPORT);
      const pass = r.filter((x) => x.status === 'PASS');
      const fail = r.filter((x) => x.status === 'FAIL');
      const errs = badEvents(readJsonl(EVENTS));
      console.log('──────── RELATÓRIO ────────');
      console.log(`Asserts: ${pass.length} PASS / ${fail.length} FAIL`);
      for (const f of fail) console.log('  ❌', f.name, f.detail ? `— ${f.detail}` : '');
      console.log(`Erros capturados (console/JS/rede): ${errs.length}`);
      for (const e of errs.slice(0, 8)) console.log('  •', fmtEv(e));
      const verdict = fail.length === 0 ? (errs.length ? 'PASS (com avisos de erro capturado)' : 'PASS') : 'FAIL';
      console.log('VERDICT:', verdict);
      if (fail.length) process.exitCode = 1;
      break;
    }
    case 'wait-up': {
      const url = pos[0];
      const timeout = Number(flags.timeout) || 30000;
      const start = Date.now();
      let ok = false;
      while (Date.now() - start < timeout) {
        try { await fetch(url, { method: 'GET' }); ok = true; break; } catch { await sleep(500); }
      }
      console.log(ok ? `UP ${url} (${Date.now() - start}ms)` : `TIMEOUT esperando ${url}`);
      if (!ok) process.exitCode = 1;
      break;
    }
    default:
      console.log('webtest commands:');
      console.log('  lifecycle: start | stop | restart | status   (via webtest.sh)');
      console.log('  navigate : goto <url> | back | wait <sel> | wait-up <url> | scroll <bottom|top|px>');
      console.log('  act      : click <sel> | clicktext <txt> | type <sel> <txt> | fill <sel> <txt> | press <key>');
      console.log('  login    : login --url= --user= --pass= [--userSel= --passSel= --submitSel=]');
      console.log('  inspect  : eval <js> | text [sel] | links [filter] | info | shot [name] (--full)');
      console.log('  test     : reset | assert-text <txt> | assert-no-text <txt> | assert-url <substr>');
      console.log('             assert-visible <sel> | assert-gone <sel> | assert-no-errors [--include4xx --strict]');
      console.log('             events [--errors] | report');
  }
  process.exit(process.exitCode || 0);
}

// ---------- browser commands ----------
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: { width: 1366, height: 900 } });
const pages = await browser.pages();
const page = pages[0] || (await browser.newPage());
await page.bringToFront().catch(() => {});

async function shot(name) {
  const file = resolve(SHOTS, (name || 'last') + '.png');
  await page.screenshot({ path: file, fullPage: !!flags.full });
  console.log('SHOT', file);
  return file;
}
async function settle(action) {
  const before = page.url();
  await action();
  let navigated = false;
  const start = Date.now();
  while (Date.now() - start < 2200) { await sleep(150); if (page.url() !== before) { navigated = true; break; } }
  if (navigated) {
    await page.waitForFunction(() => document.readyState === 'complete', { polling: 200, timeout: 15000 }).catch(() => {});
    await sleep(500);
  } else await sleep(400);
  return navigated;
}
async function firstSel(cands) {
  for (const s of cands) { if (await page.$(s)) return s; }
  return null;
}

try {
  switch (cmd) {
    case 'goto':
      await page.goto(pos[0], { waitUntil: 'networkidle2', timeout: 45000 });
      console.log('URL', page.url(), '| TITLE', await page.title());
      await shot(flags.name);
      break;
    case 'info':
      console.log('URL', page.url(), '| TITLE', await page.title());
      await shot(flags.name);
      break;
    case 'shot':
      await shot(flags.name || pos[0]);
      break;
    case 'eval':
      console.log('EVAL', JSON.stringify(await page.evaluate(pos.join(' ')), null, 2));
      if (flags.shot) await shot(flags.name);
      break;
    case 'click': {
      await page.waitForSelector(pos[0], { timeout: 10000 });
      await page.$eval(pos[0], (el) => el.scrollIntoView({ block: 'center' }));
      const nav = await settle(() => page.click(pos[0]));
      console.log(nav ? 'NAVIGATED ->' : 'CLICKED @', page.url());
      await shot(flags.name);
      break;
    }
    case 'clicktext': {
      const text = pos.join(' ');
      const h = await page.evaluateHandle((t) => {
        const q = t.toLowerCase();
        return [...document.querySelectorAll('a,button,[role=button],input[type=submit],input[type=button],summary,label')]
          .find((e) => ((e.innerText || e.value || '').trim().toLowerCase().includes(q))) || null;
      }, text);
      const el = h.asElement();
      if (!el) { console.log('NOT FOUND text:', text); process.exitCode = 1; break; }
      await el.scrollIntoView();
      const nav = await settle(() => el.click());
      console.log(nav ? 'NAVIGATED ->' : 'CLICKED @', page.url());
      await shot(flags.name);
      break;
    }
    case 'type':
      await page.waitForSelector(pos[0], { timeout: 10000 });
      await page.type(pos[0], pos.slice(1).join(' '), { delay: 25 });
      console.log('TYPED into', pos[0]);
      await shot(flags.name);
      break;
    case 'fill':
      await page.waitForSelector(pos[0], { timeout: 10000 });
      await page.$eval(pos[0], (el) => { el.value = ''; });
      await page.type(pos[0], pos.slice(1).join(' '), { delay: 25 });
      console.log('FILLED', pos[0]);
      await shot(flags.name);
      break;
    case 'press': {
      const nav = await settle(() => page.keyboard.press(pos[0]));
      console.log(nav ? 'NAVIGATED ->' : 'PRESSED', pos[0], '@', page.url());
      await shot(flags.name);
      break;
    }
    case 'wait':
      await page.waitForSelector(pos[0], { timeout: Number(flags.timeout) || 15000 });
      console.log('VISIBLE', pos[0]);
      await shot(flags.name);
      break;
    case 'scroll': {
      const to = pos[0] || 'bottom';
      await page.evaluate((t) => { t === 'bottom' ? window.scrollTo(0, document.body.scrollHeight) : t === 'top' ? window.scrollTo(0, 0) : window.scrollBy(0, Number(t) || 600); }, to);
      await sleep(500); console.log('SCROLLED', to); await shot(flags.name);
      break;
    }
    case 'back':
      await page.goBack({ waitUntil: 'networkidle2' });
      console.log('URL', page.url()); await shot(flags.name);
      break;
    case 'links': {
      const pat = (pos.join(' ') || '').toLowerCase();
      console.log(JSON.stringify(await page.evaluate((p) =>
        [...document.querySelectorAll('a')].map((a) => ({ text: a.innerText.trim().replace(/\s+/g, ' ').slice(0, 70), href: a.href }))
          .filter((l) => l.text && (!p || l.text.toLowerCase().includes(p) || l.href.toLowerCase().includes(p))).slice(0, 40), pat), null, 2));
      break;
    }
    case 'text': {
      const sel = pos[0] || 'body';
      const txt = await page.$eval(sel, (el) => el.innerText).catch(() => '(selector não encontrado)');
      console.log(txt.slice(0, Number(flags.max) || 4000));
      break;
    }
    case 'login': {
      const url = flags.url, user = flags.user, pass = flags.pass;
      if (url) await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      const uSel = flags.userSel || await firstSel(['input[type=email]', 'input[name=email]', 'input[name=username]', 'input[name=login]', 'input[name=user]', '#email', '#username']);
      const pSel = flags.passSel || await firstSel(['input[type=password]', 'input[name=password]', '#password']);
      if (!uSel || !pSel) { console.log('Campos de login não encontrados — passe --userSel/--passSel'); process.exitCode = 1; break; }
      await page.type(uSel, user, { delay: 25 });
      await page.type(pSel, pass, { delay: 25 });
      const sSel = flags.submitSel || await firstSel(['button[type=submit]', 'input[type=submit]', 'button']);
      const nav = await settle(() => (sSel ? page.click(sSel) : page.keyboard.press('Enter')));
      console.log(nav ? 'LOGIN -> NAVIGATED ->' : 'LOGIN submetido @', page.url());
      await shot(flags.name || 'login');
      break;
    }
    case 'assert-text': {
      const t = pos.join(' ');
      const ok = await page.evaluate((x) => document.body.innerText.includes(x), t);
      logAssert(`text "${t}"`, ok, ok ? '' : 'não encontrado na página');
      if (!ok) await shot('fail-assert-text');
      break;
    }
    case 'assert-no-text': {
      const t = pos.join(' ');
      const present = await page.evaluate((x) => document.body.innerText.includes(x), t);
      logAssert(`no-text "${t}"`, !present, present ? 'texto apareceu (não deveria)' : '');
      if (present) await shot('fail-assert-no-text');
      break;
    }
    case 'assert-url': {
      const sub = pos.join(' ');
      const ok = page.url().includes(sub);
      logAssert(`url contém "${sub}"`, ok, ok ? '' : `url atual: ${page.url()}`);
      if (!ok) await shot('fail-assert-url');
      break;
    }
    case 'assert-visible': {
      const sel = pos[0];
      const ok = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !!(e.offsetParent || r.width || r.height); }, sel);
      logAssert(`visible ${sel}`, ok, ok ? '' : 'ausente ou invisível');
      if (!ok) await shot('fail-assert-visible');
      break;
    }
    case 'assert-gone': {
      const sel = pos[0];
      const present = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !!(e.offsetParent || r.width || r.height); }, sel);
      logAssert(`gone ${sel}`, !present, present ? 'ainda visível' : '');
      if (present) await shot('fail-assert-gone');
      break;
    }
    case 'assert-no-errors': {
      const bad = badEvents(readJsonl(EVENTS), { include4xx: !!flags.include4xx, strict: !!flags.strict });
      const ok = bad.length === 0;
      logAssert('no-errors', ok, ok ? '' : `${bad.length} evento(s): ` + bad.slice(0, 4).map(fmtEv).join(' | '));
      if (!ok) await shot('fail-assert-no-errors');
      break;
    }
    default:
      console.log('Unknown command:', cmd, '— rode "help"');
      process.exitCode = 1;
  }
} finally {
  await browser.disconnect();
}
