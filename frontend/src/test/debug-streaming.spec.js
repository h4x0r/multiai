// @ts-check
import { test, expect } from '@playwright/test';

test('debug streaming error', async ({ page }) => {
  // Capture all network requests and responses
  const requests = [];
  const responses = [];

  page.on('request', request => {
    if (request.url().includes('/v1/chat/completions')) {
      requests.push({
        url: request.url(),
        method: request.method(),
        postData: request.postData(),
      });
      console.log('REQUEST:', request.method(), request.url());
      console.log('POST DATA:', request.postData());
    }
  });

  page.on('response', async response => {
    if (response.url().includes('/v1/chat/completions')) {
      const headers = response.headers();
      let body = '';
      try {
        body = await response.text();
      } catch (e) {
        body = `[Could not read body: ${e.message}]`;
      }
      responses.push({
        url: response.url(),
        status: response.status(),
        headers,
        body: body.slice(0, 2000),
      });
      console.log('RESPONSE:', response.status(), response.url());
      console.log('HEADERS:', JSON.stringify(headers, null, 2));
      console.log('BODY:', body.slice(0, 2000));
    }
  });

  // Capture console messages
  page.on('console', msg => {
    console.log('BROWSER CONSOLE:', msg.type(), msg.text());
  });

  await page.goto('http://localhost:11434');
  await page.waitForLoadState('networkidle');

  // Wait for app to be ready
  await page.waitForTimeout(2000);

  // Type a message
  const input = page.locator('textarea[placeholder*="Type your message"]');
  await input.fill('Hello, what is 2+2?');

  // Send the message
  await input.press('Enter');

  // Wait for response or error
  await page.waitForTimeout(10000);

  // Log what we captured
  console.log('\n=== CAPTURED REQUESTS ===');
  console.log(JSON.stringify(requests, null, 2));
  console.log('\n=== CAPTURED RESPONSES ===');
  console.log(JSON.stringify(responses, null, 2));

  // Take a screenshot
  await page.screenshot({ path: 'debug-streaming.png', fullPage: true });
});
