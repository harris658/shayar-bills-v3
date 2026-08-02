const PW = process.env.PLAYWRIGHT_PATH
  || '/Users/haru/Haru Cowork OS/my-moodboard/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://localhost:8791/harness.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.STB && STB.adjust && STB.adjustModal,
  null, { timeout: 8000 });
console.log('errors:', errs);
await browser.close();
process.exit(errs.length ? 1 : 0);
