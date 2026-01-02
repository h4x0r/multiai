const { test, expect } = require('@playwright/test');

test.describe('MultiAI App', () => {
  test('should load and show welcome message', async ({ page }) => {
    await page.goto('/');

    // Wait for app to load
    await page.waitForLoadState('networkidle');

    // Check for welcome heading
    const welcome = page.locator('h2:has-text("Welcome to MultiAI")');
    await expect(welcome).toBeVisible({ timeout: 10000 });
  });

  test('should display sidebar with New Chat button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newChatBtn = page.locator('button:has-text("New Chat")');
    await expect(newChatBtn).toBeVisible();
  });

  test('should show model status indicator', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Either "models available" or "No models available"
    const statusText = page.locator('text=/\\d+ models? available|No models available/');
    await expect(statusText).toBeVisible({ timeout: 10000 });
  });

  test('should have a message input field', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
  });

  test('should create a new chat when New Chat is clicked', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const newChatBtn = page.locator('button:has-text("New Chat")');
    await newChatBtn.click();

    // Wait for navigation
    await page.waitForURL(/\/chat\/.+/);

    // URL should contain chat ID
    expect(page.url()).toMatch(/\/chat\/[a-f0-9-]+/);
  });

  test('should be able to type in message input', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('textarea');
    await textarea.fill('Hello, this is a test message');

    await expect(textarea).toHaveValue('Hello, this is a test message');
  });

  test('should show sidebar version info', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const versionText = page.locator('text=MultiAI v0.1.0');
    await expect(versionText).toBeVisible();
  });

  test('should show privacy warning when models are available', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if models are available first
    const modelsAvailable = await page.locator('text=/\\d+ models? available/').isVisible();

    if (modelsAvailable) {
      // The text uses smart quotes, match with regex
      const privacyWarning = page.locator('text=/not paying.*product/');
      await expect(privacyWarning).toBeVisible();
    } else {
      // Skip test if no models
      test.skip();
    }
  });

  test('should show export button in chat view', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a new chat first - use the sidebar button specifically
    await page.locator('aside button:has-text("New Chat")').first().click();
    await page.waitForURL(/\/chat\/.+/);

    // Export button should appear
    const exportBtn = page.locator('button[title="Export chat"]');
    await expect(exportBtn).toBeVisible();
  });

  test('should open export menu when export button is clicked', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Use sidebar button specifically
    await page.locator('aside button:has-text("New Chat")').first().click();
    await page.waitForURL(/\/chat\/.+/);

    const exportBtn = page.locator('button[title="Export chat"]');
    await exportBtn.click();

    // Export menu should show format options
    const markdownOption = page.locator('text=Markdown');
    await expect(markdownOption).toBeVisible();
  });

  test('should send a message successfully', async ({ page }) => {
    // Skip if no models available
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const modelsAvailable = await page.locator('text=/\\d+ models? available/').isVisible();
    if (!modelsAvailable) {
      test.skip();
      return;
    }

    const textarea = page.locator('textarea');
    await textarea.fill('Test message');

    // Click the send button directly
    const sendButton = page.locator('button[type="submit"]');
    await sendButton.click();

    // Wait for message to be sent - the input should be cleared
    await expect(textarea).toHaveValue('', { timeout: 5000 });

    // User message should appear in the chat (in message bubble, not header/sidebar)
    await expect(page.locator('.justify-end .text-sm:has-text("Test message")')).toBeVisible({ timeout: 10000 });

    // URL should have changed to a chat route
    await page.waitForURL(/\/chat\/[a-f0-9-]+/, { timeout: 5000 });
  });
});
