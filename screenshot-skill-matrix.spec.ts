import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Skill Matrix Screenshots', () => {
  test('screenshot skill matrix main view', async ({ page }) => {
    // Load the local demo HTML file
    const demoPath = path.join(process.cwd(), 'skill-matrix-demo.html');
    await page.goto(`file://${demoPath}`);
    
    // Wait for the page to load
    await page.waitForSelector('.matrix-container');
    
    // Set viewport for consistent screenshot
    await page.setViewportSize({ width: 1440, height: 900 });
    
    // Take screenshot of the full page
    await page.screenshot({
      path: 'screenshots/skill-matrix-main.png',
      fullPage: true
    });
    
    console.log('Screenshot saved: screenshots/skill-matrix-main.png');
  });

  test('screenshot sync dialog', async ({ page }) => {
    const demoPath = path.join(process.cwd(), 'skill-matrix-demo.html');
    await page.goto(`file://${demoPath}`);
    
    await page.waitForSelector('.matrix-container');
    await page.setViewportSize({ width: 1440, height: 900 });
    
    // Click sync button to open dialog
    await page.click('button:has-text("Sync")');
    
    // Wait for dialog
    await page.waitForSelector('.modal-overlay.active');
    
    // Take screenshot with dialog open
    await page.screenshot({
      path: 'screenshots/skill-matrix-sync-dialog.png',
      fullPage: true
    });
    
    console.log('Screenshot saved: screenshots/skill-matrix-sync-dialog.png');
    
    // Close dialog
    await page.click('button:has-text("Cancel")');
  });
});
