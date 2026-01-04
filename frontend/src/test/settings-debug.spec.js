import { test, expect } from '@playwright/test';

test.describe('Settings Debug', () => {
  test('debug settings key input and show/hide', async ({ page }) => {
    await page.goto('http://localhost:1420');

    // Wait for app to load
    await page.waitForSelector('text=MultiAI', { timeout: 10000 });

    // Click on settings (gear icon in sidebar)
    await page.click('[title="Settings"]');

    // Wait for settings modal
    await page.waitForSelector('text=API Keys', { timeout: 5000 });

    // Screenshot initial state
    await page.screenshot({ path: 'debug-settings-1-initial.png' });

    // Find OpenRouter key input
    const openRouterInput = page.locator('input[placeholder="sk-or-v1-..."]');
    const openRouterValue = await openRouterInput.inputValue();
    console.log('OpenRouter input value:', openRouterValue);
    console.log('OpenRouter input type:', await openRouterInput.getAttribute('type'));

    // Find the show/hide button for OpenRouter (first one)
    const showHideButtons = page.locator('button[title*="key"]');
    const buttonCount = await showHideButtons.count();
    console.log('Show/hide button count:', buttonCount);

    // Click first show/hide button
    if (buttonCount > 0) {
      await showHideButtons.first().click();
      await page.screenshot({ path: 'debug-settings-2-after-show-click.png' });
      console.log('After click - OpenRouter input type:', await openRouterInput.getAttribute('type'));

      // Click again to hide
      await showHideButtons.first().click();
      await page.screenshot({ path: 'debug-settings-3-after-hide-click.png' });
      console.log('After second click - OpenRouter input type:', await openRouterInput.getAttribute('type'));
    }

    // Check OpenCode Zen input
    const zenInput = page.locator('input[placeholder="zen-..."]');
    const zenValue = await zenInput.inputValue();
    console.log('Zen input value:', zenValue);

    // Check the settings API directly
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/settings');
      return res.json();
    });
    console.log('Settings API response:', response);

    // Also check models API
    const modelsResponse = await page.evaluate(async () => {
      const res = await fetch('/v1/models/grouped');
      return res.json();
    });
    console.log('Models count:', modelsResponse.models?.length);
    console.log('First few models:', modelsResponse.models?.slice(0, 3).map(m => ({
      name: m.name,
      providers: m.providers?.map(p => ({ id: p.id, source: p.source }))
    })));
  });

  test('debug chat completions API', async ({ page }) => {
    await page.goto('http://localhost:1420');

    // Wait for app to load
    await page.waitForSelector('text=MultiAI', { timeout: 10000 });

    // Try a direct API call to chat completions
    const response = await page.evaluate(async () => {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'big-pickle',
          messages: [{ role: 'user', content: 'hello' }],
          stream: false
        })
      });
      return {
        status: res.status,
        body: await res.json()
      };
    });
    console.log('Chat completions response:', JSON.stringify(response, null, 2));
  });
});
