import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Listen to ALL console messages
  page.on('console', msg => {
    console.log(`[${msg.type()}] ${msg.text()}`);
  });

  console.log('=== TEST 1: Send message IMMEDIATELY (no wait) ===');
  await page.goto('http://localhost:5173');

  // Try to send message immediately without waiting for app to load
  const input = page.locator('textarea, input[type="text"]').first();
  try {
    await input.fill('test message 1', { timeout: 2000 });
    await page.keyboard.press('Enter');
    console.log('Sent message immediately');
  } catch (e) {
    console.log('Could not send immediately:', e.message);
  }

  // Wait and observe
  await page.waitForTimeout(5000);

  // Take screenshot
  await page.screenshot({ path: '/tmp/timing-test-1.png' });
  console.log('Screenshot saved to /tmp/timing-test-1.png');

  // Check if response is visible
  const responseVisible = await page.locator('text=/Hello|Hi|I\'m|sorry/i').count();
  console.log('Responses visible after immediate send:', responseVisible);

  console.log('\n=== TEST 2: Wait for app ready, then send ===');
  await page.goto('http://localhost:5173');

  // Wait for loading to complete (look for "Ready!" or input placeholder change)
  try {
    await page.waitForSelector('textarea:not([disabled])', { timeout: 15000 });
    console.log('App ready - input enabled');
  } catch (e) {
    console.log('Timeout waiting for app ready');
  }

  // Additional wait for models to load
  await page.waitForTimeout(2000);

  // Now send message
  const input2 = page.locator('textarea').first();
  await input2.fill('test message 2');
  await page.keyboard.press('Enter');
  console.log('Sent message after waiting');

  // Wait for response
  await page.waitForTimeout(8000);

  // Take screenshot
  await page.screenshot({ path: '/tmp/timing-test-2.png' });
  console.log('Screenshot saved to /tmp/timing-test-2.png');

  // Check if response is visible
  const responseVisible2 = await page.locator('.whitespace-pre-wrap').count();
  console.log('Response elements visible after waited send:', responseVisible2);

  // Check console for state
  const comparisonState = await page.evaluate(() => {
    // Try to access any global debug info
    return document.body.innerText.substring(0, 500);
  });
  console.log('Page content sample:', comparisonState.substring(0, 200));

  await browser.close();
})();
