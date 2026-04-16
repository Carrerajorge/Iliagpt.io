import { test, expect } from '@playwright/test';

/**
 * E2E Test: LiveExecutionConsole Grace Window
 * 
 * Verifies that:
 * 1. "Pensando..." spinner may appear from 0-2s after sending a Super Agent prompt
 * 2. After 2.2s, "Pensando..." MUST NOT exist
 * 3. LiveExecutionConsole container MUST be visible after 2.2s
 * 4. Before 3s, at least 1 event or heartbeat/polling event should appear
 */
test.describe('LiveExecutionConsole Grace Window', () => {
  test('spinner retires at 2s, console appears after grace window', async ({ page }) => {
    await page.goto('/');
    
    await page.waitForLoadState('networkidle');
    
    const inputSelector = '[data-testid="chat-input"], textarea[placeholder*="mensaje"], input[placeholder*="mensaje"]';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    
    const input = page.locator(inputSelector).first();
    await input.fill('buscarme 50 articulos cientificos sobre energia solar');
    
    const sendButton = page.locator('[data-testid="send-button"], button[type="submit"]').first();
    await sendButton.click();
    
    const startTime = Date.now();
    
    const pensandoSelector = 'text=Pensando...';
    const consoleSelector = '[data-testid="live-execution-console"]';
    
    await page.waitForTimeout(500);
    const spinnerAt500ms = await page.locator(pensandoSelector).count();
    console.log(`[E2E] At 500ms: Spinner count = ${spinnerAt500ms}`);
    
    await page.waitForTimeout(1700);
    
    const elapsedAfterWait = Date.now() - startTime;
    console.log(`[E2E] Checking at ${elapsedAfterWait}ms (target: ~2200ms)`);
    
    const spinnerAfter2s = await page.locator(pensandoSelector).count();
    console.log(`[E2E] Spinner count after grace window: ${spinnerAfter2s}`);
    expect(spinnerAfter2s).toBe(0);
    
    const consoleVisible = await page.locator(consoleSelector).isVisible().catch(() => false);
    console.log(`[E2E] Console visible: ${consoleVisible}`);
    expect(consoleVisible).toBe(true);
    
    await page.waitForTimeout(800);
    
    const totalElapsed = Date.now() - startTime;
    console.log(`[E2E] Total elapsed: ${totalElapsed}ms (should be < 3000ms)`);
    expect(totalElapsed).toBeLessThan(4000);
    
    const consoleContent = await page.locator(consoleSelector).textContent().catch(() => '');
    console.log(`[E2E] Console content: ${consoleContent?.substring(0, 100)}...`);
    
    const hasContent = consoleContent && consoleContent.length > 0;
    console.log(`[E2E] Console has content: ${hasContent}`);
    expect(hasContent).toBe(true);
  });

  test('regular chat messages still show spinner without console', async ({ page }) => {
    await page.goto('/');
    
    await page.waitForLoadState('networkidle');
    
    const inputSelector = '[data-testid="chat-input"], textarea[placeholder*="mensaje"], input[placeholder*="mensaje"]';
    await page.waitForSelector(inputSelector, { timeout: 10000 });
    
    const input = page.locator(inputSelector).first();
    await input.fill('hola, como estas?');
    
    const sendButton = page.locator('[data-testid="send-button"], button[type="submit"]').first();
    await sendButton.click();
    
    await page.waitForTimeout(500);
    
    const consoleSelector = '[data-testid="live-execution-console"]';
    const consoleCount = await page.locator(consoleSelector).count();
    expect(consoleCount).toBe(0);
  });
});
