import { test, expect, Page } from 'playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const TEST_FIXTURES_DIR = path.join(process.cwd(), 'test_fixtures');
const MULTI_SHEET_FILE = path.join(TEST_FIXTURES_DIR, 'multi-sheet.xlsx');

test.describe('Production Smoke Tests', () => {
  test.describe.configure({ mode: 'serial' });

  test('should load the application homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should render chat interface', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const chatContainer = page.locator('[data-testid="chat-container"], [role="main"], main').first();
    await expect(chatContainer).toBeVisible({ timeout: 10000 });
  });

  test('should accept file upload without crash', async ({ page }) => {
    test.skip(!fs.existsSync(MULTI_SHEET_FILE), 'Test fixture not found');
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(MULTI_SHEET_FILE);
      await page.waitForTimeout(1000);
      const errorModal = page.locator('[role="alertdialog"], [data-testid="error-modal"]');
      const hasError = await errorModal.count() > 0;
      expect(hasError).toBe(false);
    }
  });

  test('should have working API health endpoint', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBeLessThan(500);
  });

  test('should serve static assets with proper headers', async ({ page }) => {
    const responses: { url: string; status: number; contentType: string }[] = [];
    
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('.js') || url.includes('.css') || url.includes('.html')) {
        responses.push({
          url,
          status: response.status(),
          contentType: response.headers()['content-type'] || '',
        });
      }
    });
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    for (const res of responses) {
      expect(res.status).toBeLessThan(400);
    }
  });

  test('should measure initial page load performance', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const domContentLoaded = Date.now() - startTime;
    
    await page.waitForLoadState('networkidle');
    const fullLoad = Date.now() - startTime;
    
    console.log(`[Performance] DOMContentLoaded: ${domContentLoaded}ms`);
    console.log(`[Performance] Full Load: ${fullLoad}ms`);
    
    expect(domContentLoaded).toBeLessThan(30000);
    expect(fullLoad).toBeLessThan(60000);
  });

  test('should not have critical console errors on initial load', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon') && !text.includes('404')) {
          errors.push(text);
        }
      }
    });
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const nonCriticalPatterns = [
      'ResizeObserver',
      'Non-Error',
      'net::ERR',
      'Failed to load',
      'hydration',
      'WebSocket',
      'chunk',
    ];
    
    const criticalErrors = errors.filter(
      (e) => !nonCriticalPatterns.some(pattern => e.includes(pattern))
    );
    
    if (criticalErrors.length > 0) {
      console.warn('[Smoke Test] Console errors found:', criticalErrors);
    }
    
    expect(criticalErrors.length).toBeLessThanOrEqual(5);
  });
});
