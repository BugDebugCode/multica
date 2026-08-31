const { chromium } = require('playwright');
const path = require('path');

async function takeScreenshots() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Load the local demo HTML file
  const demoPath = path.join(__dirname, 'skill-matrix-demo.html');
  await page.goto(`file://${demoPath}`);
  await page.waitForSelector('.matrix-container');

  // Screenshot 1: Main Skill Matrix view
  await page.screenshot({
    path: 'screenshots/skill-matrix-main.png',
    fullPage: true
  });
  console.log('✅ Screenshot 1: screenshots/skill-matrix-main.png');

  // Click sync button to open dialog
  await page.click('button:has-text("Sync")');
  await page.waitForSelector('.modal-overlay.active');

  // Screenshot 2: Sync Dialog
  await page.screenshot({
    path: 'screenshots/skill-matrix-sync-dialog.png',
    fullPage: true
  });
  console.log('✅ Screenshot 2: screenshots/skill-matrix-sync-dialog.png');

  await browser.close();
  console.log('\n📸 All screenshots captured successfully!');
}

takeScreenshots().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
