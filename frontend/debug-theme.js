import { chromium } from 'playwright';

async function debugTheme() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Use the test HTML page served by Vite
  await page.goto('http://localhost:5173/theme-test.html');
  await page.waitForTimeout(1000);

  // Take initial screenshot (no class set)
  await page.screenshot({ path: '/tmp/theme-debug-1-initial.png' });
  console.log('1. Initial state (no theme class)');

  let htmlClass = await page.evaluate(() => document.documentElement.className);
  console.log('HTML class:', htmlClass);

  // Check CSS variables at start
  let cssVars = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      'gray-50': style.getPropertyValue('--color-gray-50'),
      'gray-900': style.getPropertyValue('--color-gray-900'),
    };
  });
  console.log('CSS Variables (initial):', cssVars);

  // Click Light theme button
  await page.click('#btn-light');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/theme-debug-2-light.png' });
  console.log('2. Light theme');

  htmlClass = await page.evaluate(() => document.documentElement.className);
  console.log('HTML class after Light:', htmlClass);

  cssVars = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      'gray-50': style.getPropertyValue('--color-gray-50'),
      'gray-900': style.getPropertyValue('--color-gray-900'),
    };
  });
  console.log('CSS Variables (light):', cssVars);

  // Get background colors of test boxes
  const lightBoxColors = await page.evaluate(() => {
    const boxes = document.querySelectorAll('.test-box');
    return Array.from(boxes).map(box => ({
      class: box.className,
      bg: getComputedStyle(box).backgroundColor
    }));
  });
  console.log('Box colors in Light mode:', lightBoxColors);

  // Click Dark theme button
  await page.click('#btn-dark');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/theme-debug-3-dark.png' });
  console.log('3. Dark theme');

  htmlClass = await page.evaluate(() => document.documentElement.className);
  console.log('HTML class after Dark:', htmlClass);

  cssVars = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      'gray-50': style.getPropertyValue('--color-gray-50'),
      'gray-900': style.getPropertyValue('--color-gray-900'),
    };
  });
  console.log('CSS Variables (dark):', cssVars);

  const darkBoxColors = await page.evaluate(() => {
    const boxes = document.querySelectorAll('.test-box');
    return Array.from(boxes).map(box => ({
      class: box.className,
      bg: getComputedStyle(box).backgroundColor
    }));
  });
  console.log('Box colors in Dark mode:', darkBoxColors);

  await browser.close();
  console.log('\nScreenshots saved to /tmp/theme-debug-*.png');
}

debugTheme().catch(console.error);
