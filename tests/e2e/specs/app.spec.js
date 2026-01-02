describe('MultiAI App', () => {
  it('should launch and show the main window', async () => {
    // Wait for app to load
    await browser.pause(3000);

    // Get the page title or check for main elements
    const title = await browser.getTitle();
    console.log('Window title:', title);

    // The app should have loaded
    expect(title).toBeTruthy();
  });

  it('should display welcome message when no chats exist', async () => {
    // Wait for UI to render
    await browser.pause(2000);

    // Look for the welcome text
    const welcomeText = await $('h2*=Welcome to MultiAI');
    const isDisplayed = await welcomeText.isDisplayed();

    expect(isDisplayed).toBe(true);
  });

  it('should show sidebar with New Chat button', async () => {
    const newChatBtn = await $('button*=New Chat');
    const isDisplayed = await newChatBtn.isDisplayed();

    expect(isDisplayed).toBe(true);
  });

  it('should show model status indicator', async () => {
    // Look for the status indicator (either "models available" or "No models")
    const statusIndicator = await $('//*[contains(text(), "model")]');
    const exists = await statusIndicator.isExisting();

    expect(exists).toBe(true);
  });

  it('should create a new chat when New Chat is clicked', async () => {
    const newChatBtn = await $('button*=New Chat');
    await newChatBtn.click();

    // Wait for navigation
    await browser.pause(1000);

    // Should now be in a chat view (welcome message might still show for new empty chat)
    const url = await browser.getUrl();
    console.log('URL after new chat:', url);

    // URL should change to include chat ID
    expect(url).toContain('/chat/');
  });

  it('should have a message input field', async () => {
    const input = await $('textarea');
    const isDisplayed = await input.isDisplayed();

    expect(isDisplayed).toBe(true);
  });

  it('should be able to type in the message input', async () => {
    const input = await $('textarea');
    await input.setValue('Hello, this is a test message');

    const value = await input.getValue();
    expect(value).toContain('Hello');
  });

  it('should show export button when in a chat', async () => {
    // Should have export button visible
    const exportBtn = await $('button[title="Export chat"]');
    const exists = await exportBtn.isExisting();

    expect(exists).toBe(true);
  });

  it('should open model selector dropdown when clicked', async () => {
    // Find model selector button (shows "Select model" or model name)
    const modelSelector = await $('button*=model');

    if (await modelSelector.isExisting()) {
      await modelSelector.click();
      await browser.pause(500);

      // Dropdown should appear
      const dropdown = await $('[role="listbox"]');
      const isDisplayed = await dropdown.isDisplayed();

      expect(isDisplayed).toBe(true);

      // Close by clicking elsewhere
      await $('body').click();
    } else {
      // Model selector might not be visible if no models available
      console.log('Model selector not found - models may be unavailable');
    }
  });
});
