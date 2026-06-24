// Persistent observer: attaches to Chrome via CDP and records "problem" events
// (console errors/warnings, uncaught page errors, failed requests, HTTP >= 400)
// to events.jsonl. Survives navigation; runs in the background for the whole session.
import puppeteer from 'puppeteer-core';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const PORT = process.env.BROWSER_PORT || '9222';
const STATE = process.env.STATE_DIR || resolve(homedir(), '.cache/claude-browser');
mkdirSync(STATE, { recursive: true });
const EVENTS = resolve(STATE, 'events.jsonl');

const rec = (o) => appendFileSync(EVENTS, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');

const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });

function watch(page) {
  if (!page || page.__watched) return;
  page.__watched = true;
  page.on('console', (msg) => {
    const level = msg.type();
    if (level === 'error' || level === 'warning')
      rec({ kind: 'console', level, text: msg.text(), url: page.url() });
  });
  page.on('pageerror', (err) => rec({ kind: 'pageerror', text: String(err?.stack || err), url: page.url() }));
  page.on('requestfailed', (req) =>
    rec({ kind: 'requestfailed', method: req.method(), status: 0, url: req.url(), text: req.failure()?.errorText }));
  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400)
      rec({ kind: 'httperror', status, method: res.request().method(), url: res.url() });
  });
}

for (const p of await browser.pages()) watch(p);
browser.on('targetcreated', async (t) => { try { watch(await t.page()); } catch {} });
browser.on('disconnected', () => process.exit(0)); // chrome gone -> let wrapper restart us

rec({ kind: 'monitor', text: 'attached' });
process.stdin.resume(); // keep alive
