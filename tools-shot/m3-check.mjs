// M3 done-when check: live theme switch + token conformance + screenshots. Synthetic sample data only.
import { chromium } from 'playwright-core';
import fs from 'fs';
const base = process.argv[2] || 'http://127.0.0.1:4173/';
const out = '../screenshots';
const tokens = JSON.parse(fs.readFileSync('../tokens/tokens.json', 'utf8'));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const results = []; const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const ext = []; page.on('request', r => { if (!r.url().startsWith(base)) ext.push(r.url()); });
const shot = async (q, file, wait = 900) => { await page.goto(base + q, { waitUntil: 'networkidle' }); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${file}.png` }); };
await shot('?theme=dark', 'm3-shell-dark');
await shot('?theme=light', 'm3-shell-light');
await shot('?theme=dark&page=tokens', 'm3-token-sheet-dark');
await shot('?theme=light&page=tokens', 'm3-token-sheet-light');
await shot('?theme=dark&modal=demo', 'm3-modal-dark');
await shot('?theme=light&modal=demo', 'm3-modal-light');
// live switch test (no reload)
await page.goto(base, { waitUntil: 'networkidle' }); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle' });
const probe = () => page.evaluate(() => {
  const cs = (sel, p) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[p] : null; };
  return { theme: document.documentElement.dataset.theme, body: getComputedStyle(document.body).backgroundColor,
    topbar: cs('header', 'backgroundColor'), text: getComputedStyle(document.body).color,
    panel: cs('aside', 'backgroundColor'), status: cs('footer', 'backgroundColor') };
});
const sys = await probe();
await page.click('button[aria-pressed][title*="Light" i]'); await page.waitForTimeout(400); const light = await probe();
await page.screenshot({ path: `${out}/m3-live-switched-to-light.png` });
await page.click('button[aria-pressed][title*="Dark" i]'); await page.waitForTimeout(400); const dark = await probe();
await page.click('button[aria-pressed][title*="System" i]'); await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(400); const sysLight = await probe();
results.push({ sys, light, dark, sysLight });
const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
const chrome = tokens.color?.bg?.chrome || tokens.colors?.bg?.chrome;
// token conformance: computed values vs token sheet
await page.emulateMedia({ colorScheme: 'dark' });
const sizes = await page.evaluate(() => {
  const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
  const st = getComputedStyle(document.documentElement);
  const v = n => st.getPropertyValue(n).trim();
  const vars = [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch { return []; } })
    .flatMap(r => r.style ? [...r.style].filter(p => p.startsWith('--')) : []);
  const uniq = [...new Set(vars)];
  return { header: r('header')?.height, footer: r('footer')?.height, aside: r('aside')?.width,
    bodyFont: getComputedStyle(document.body).fontFamily, bodySize: getComputedStyle(document.body).fontSize,
    vars: Object.fromEntries(uniq.filter(n => /space|radius|font-size|toolbar|panel|status/.test(n)).slice(0, 60).map(n => [n, v(n)])) };
});
results.push({ sizes, chromeToken: chrome });
fs.writeFileSync(`${out}/m3-check.json`, JSON.stringify({ results, errors, externalRequests: ext }, null, 2));
console.log(JSON.stringify({ results, errors: errors.slice(0, 5), externalRequests: ext.length }, null, 1));
await browser.close();
