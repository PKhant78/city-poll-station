const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const URL = process.env.APP_URL || 'http://127.0.0.1:5180';
const upload = (page, content, name='stations.csv') => page.getByLabel('Import CSV', {exact:true}).setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(content)});
const csv='id,name,x,y\r\na,"West, Hall",25.25,50\r\nb,"East ""Hall""",74.75,50\r\nc,Center,50,20\r\n';
test('imports a final decimal set, draws all districts and round trips exported CSV', async({page})=>{
  await page.goto(URL);
  await page.getByLabel('Draw districts').uncheck();
  await upload(page,'\ufeff'+csv,'STATIONS.CSV');
  await expect(page.getByLabel('District for West, Hall',{exact:true})).toBeAttached();
  await expect(page.getByLabel('District for East "Hall"',{exact:true})).toBeAttached();
  await expect(page.getByLabel('District for Center',{exact:true})).toBeAttached();
  await expect(page.getByLabel('Draw districts')).toBeChecked();
  await expect(page.getByText('Unsaved changes',{exact:true})).toBeVisible();
  await expect(page.locator('.station-count')).toHaveText('3 stations');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  const contents=await fs.readFile(await (await downloaded).path(),'utf8');
  page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:'New plan',exact:true}).click();
  await upload(page,contents);
  await expect(page.getByRole('button',{name:'Remove West, Hall',exact:true})).toBeVisible();
  await expect(page.getByLabel('District for East "Hall"',{exact:true})).toBeAttached();
  await expect(page.locator('.station-count')).toHaveText('3 stations');
});
for(const value of ['oops','101','']) {
  test(`rejects coordinate ${JSON.stringify(value)} without any partial changes`, async({page})=>{
    await page.goto(URL); await upload(page,csv);
    await expect(page.getByLabel('District for Center',{exact:true})).toBeAttached();
    const before=await page.getByRole('img',{name:'City planning map',exact:true}).innerHTML();
    await upload(page,`x,y\n10,10\n${value},30`);
    await expect(page.getByRole('alert')).toContainText(/Invalid coordinates.*row 3/);
    expect(await page.getByRole('img',{name:'City planning map',exact:true}).innerHTML()).toBe(before);
    await expect(page.locator('.station-count')).toHaveText('3 stations');
    await expect(page.getByRole('button',{name:'Remove Station 1',exact:true})).toHaveCount(0);
  });
}
test('rejects a non-CSV extension visibly and preserves the map',async({page})=>{
  await page.goto(URL); await upload(page,csv);
  await expect(page.getByLabel('District for Center',{exact:true})).toBeAttached();
  await upload(page,'x,y\n10,10','stations.txt');
  await expect(page.getByRole('alert')).toHaveText('Error uploading file: choose a CSV file.');
  await expect(page.locator('.station-count')).toHaveText('3 stations');
});
test('asks before replacing a draft and preserves it when cancelled',async({page})=>{
  await page.goto(URL); await upload(page,csv);
  await expect(page.getByLabel('District for Center',{exact:true})).toBeAttached();
  const dialog=page.waitForEvent('dialog');
  const uploading=upload(page,'x,y\n10,10');
  await (await dialog).dismiss(); await uploading;
  await expect(page.locator('.station-count')).toHaveText('3 stations');
  await expect(page.getByLabel('District for Center',{exact:true})).toBeAttached();
});
