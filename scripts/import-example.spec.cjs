const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');

test('repository example CSV imports accessible stations and districts, then supports queries', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5180');
  await page.getByLabel('Import CSV', { exact: true }).setInputFiles(path.join(__dirname, '..', 'examples', 'stations.csv'));
  await expect(page.locator('.station-row')).toHaveCount(3);
  await expect(page.locator('svg circle')).toHaveCount(3);
  await expect(page.locator('polygon')).toHaveCount(3);
  await expect(page.getByLabel('Draw districts', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Remove West Hall', exact: true })).toBeVisible();
  await page.getByLabel('Query X', { exact: true }).fill('50');
  await page.getByLabel('Query Y', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Find nearest stations', exact: true }).click();
  await expect(page.locator('.query-result')).toContainText('Central Library');
  await expect(page.locator('.query-result')).toContainText('Distance 0');
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(report.violations.map(v => `${v.id}: ${v.description}`)).toEqual([]);
  await page.screenshot({ path: path.join(__dirname, 'artifacts', 'imported-stations.png'), fullPage: true });
});
