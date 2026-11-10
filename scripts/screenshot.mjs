import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const out = process.argv[3] ?? 'docs/live.png';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.getByText(/منصة تشغيل المدفوعات|Payments operations console/).waitFor();
await page.screenshot({ path: out, fullPage: true });
console.log('wrote', out);
await browser.close();
