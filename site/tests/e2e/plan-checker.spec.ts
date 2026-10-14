import { expect, test } from '@playwright/test';
import { prepare, waitForHydration } from './helpers';

test.describe('plan checker', () => {
  test.beforeEach(async ({ page }) => {
    await prepare(page);
  });

  test('saves what you pay and rates it against the cheapest plan on the tier page', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page);

    await page.getByPlaceholder('$89.00').fill('89.90');
    await page.getByPlaceholder('e.g. Telstra').fill('Telstra');
    await page.getByRole('button', { name: /am i getting rorted\?/i }).and(page.locator(':visible')).first().click();

    // 100 Mbps is the default selection, and its default upload is 20
    await expect(page).toHaveURL(/\/nbn-100-20$/);
    await waitForHydration(page);

    // $89.90 against a $68.90 cheapest plan is 30% over
    await expect(page.locator('body')).toContainText(/rort/i);

    // With a single upload speed on offer the checker saves under the grouped key ("nbn-100")
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ismynbncooked_plans') ?? '{}'));
    expect(Object.values(saved)).toEqual([expect.objectContaining({ price: 89.9, provider: 'Telstra' })]);
  });

  test('remembers the plan on the next visit', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ismynbncooked_plans', JSON.stringify({
        'nbn-250-25': { price: 120, provider: 'Telstra', savedAt: '2026-09-01T00:00:00.000Z' },
      }));
    });
    await page.goto('/');
    await waitForHydration(page);

    await expect(page.getByRole('heading', { name: 'Update your plan' })).toBeVisible();
    await expect(page.getByPlaceholder('$89.00')).toHaveValue('120');
    await expect(page.getByPlaceholder('e.g. Telstra')).toHaveValue('Telstra');
  });

  test('upgrades plans saved under the old key format', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ismynbncooked_plans', JSON.stringify({
        nbn100: { price: 95, provider: 'Telstra', savedAt: '2026-09-01T00:00:00.000Z' },
      }));
    });
    await page.goto('/');
    await waitForHydration(page);

    await expect(page.getByPlaceholder('$89.00')).toHaveValue('95');
    const keys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('ismynbncooked_plans')!)));
    expect(keys).toEqual(['nbn-100-20']);
  });
});

test.describe('tier page', () => {
  test('lists every fixture provider for the tier', async ({ page }) => {
    await prepare(page);
    await page.goto('/nbn-100-20');
    await waitForHydration(page);
    for (const name of ['Tangerine', 'Superloop', 'Aussie Broadband', 'Exetel', 'TPG', 'Telstra']) {
      await expect(page.locator('body')).toContainText(name);
    }
  });
});
