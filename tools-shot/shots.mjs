// usage: node shots.mjs <base> name=query ...
import { chromium } from 'playwright-core';
const [base, ...pairs] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(String(e)));
for (const pr of pairs) { const i = pr.indexOf('='); const n = pr.slice(0, i), q = pr.slice(i + 1);
  await p.goto(base + q, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.screenshot({ path: `../screenshots/${n}.png` }); console.log('shot', n); }
console.log('errors', errs); await b.close();
