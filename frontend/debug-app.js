import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500 // Slow down actions for debugging
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.log(`[Page Error] ${err.message}`);
  });

  console.log('Opening app...');
  await page.goto('http://localhost:5173/');

  // Wait for app to load
  await page.waitForSelector('.app-container', { timeout: 10000 }).catch(() => {
    console.log('Warning: app-container not found, continuing anyway...');
  });

  console.log('\n=== DEBUG SESSION STARTED ===');
  console.log('The browser is now open. You can:');
  console.log('1. Test the prompt input');
  console.log('2. Test the settings key hide/show');
  console.log('\nPress Ctrl+C to close when done.');

  // Keep browser open for manual debugging
  await new Promise(() => {}); // Never resolves - keeps browser open
})();
