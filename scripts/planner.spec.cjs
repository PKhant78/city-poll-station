const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');
const fs = require('node:fs/promises');
const URL = process.env.APP_URL || 'http://127.0.0.1:5180';

async function add(page, name, x, y) {
  await page.getByLabel('Station label', { exact: true }).fill(name);
  await page.getByLabel('Station X', { exact: true }).fill(String(x));
  await page.getByLabel('Station Y', { exact: true }).fill(String(y));
  await page.getByRole('button', { name: 'Add station', exact: true }).click();
}

test('real API map, boundary rejection, tie query, removal and accessibility', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(URL);
  await expect(page.getByText('No stations placed yet.', { exact: true })).toBeVisible();
  await add(page, 'West Hall', 25.25, 50);
  await expect(page.getByRole('button', { name: 'Remove West Hall' })).toBeVisible();
  await add(page, 'East Hall', 74.75, 50);
  await expect(page.getByLabel('District for West Hall', { exact: true })).toBeAttached();
  await expect(page.getByLabel('District for East Hall', { exact: true })).toBeAttached();
  await add(page, 'Boundary station', 50, 20);
  await expect(page.getByRole('alert')).toContainText(/boundary/i);
  await expect(page.getByRole('button', { name: 'Remove Boundary station' })).toHaveCount(0);
  await add(page, 'Outside city', 101, 20);
  await expect(page.getByRole('alert')).toContainText(/between 0 and 100/i);
  await expect(page.getByRole('button', { name: 'Remove Outside city' })).toHaveCount(0);
  await add(page, 'Duplicate station', 25.25, 50);
  await expect(page.getByRole('alert')).toContainText(/already exists/i);
  await page.getByLabel('Query X', { exact: true }).fill('50');
  await page.getByLabel('Query Y', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Find nearest stations' }).click();
  await expect(page.getByText('West Hall · East Hall', { exact: true })).toBeVisible();
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  if (report.violations.length) console.log(JSON.stringify(report.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), null, 2));
  expect(report.violations.map(v => `${v.id}: ${v.description}`)).toEqual([]);
  await page.screenshot({ path: path.join(__dirname, 'artifacts', 'planner-desktop.png'), fullPage: true });
  const csvEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /CSV/i }).click();
  const csv = await csvEvent;
  const csvText = await fs.readFile(await csv.path(), 'utf8');
  expect(csvText).toContain('West Hall');
  expect(csvText).toContain('25.25');
  const pngEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /PNG/i }).click();
  const png = await pngEvent;
  const image = await fs.readFile(await png.path());
  expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(image.readUInt32BE(16)).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Remove West Hall' }).click();
  await expect(page.getByRole('button', { name: 'Remove West Hall' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('narrow screen has no horizontal overflow and usable map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL);
  await expect(page.getByRole('button', { name: 'Add station', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(__dirname, 'artifacts', 'planner-mobile.png'), fullPage: true });
});
