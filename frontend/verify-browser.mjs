import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('../scripts/node_modules/playwright');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.ATLAS_URL || 'http://127.0.0.1:5180');await page.getByRole('heading',{name:'The Polling Atlas.'}).waitFor();
 await page.screenshot({path:'atlas-desktop.png',fullPage:true});
 for (const [name,x,y] of [['West','10','10'],['East','30','10']]) {await page.getByLabel('Station label',{exact:true}).fill(name);await page.getByLabel('Station X',{exact:true}).fill(x);await page.getByLabel('Station Y',{exact:true}).fill(y);await page.getByRole('button',{name:'Add station',exact:true}).click();await page.getByRole('button',{name:`Remove ${name}`,exact:true}).waitFor();}
 await page.getByLabel('Query X',{exact:true}).fill('20');await page.getByLabel('Query Y',{exact:true}).fill('10');await page.getByRole('button',{name:'Find nearest stations',exact:true}).click();await page.getByText('Tie: 2 stations',{exact:false}).waitFor();
 const png=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const download=await png;if(download.suggestedFilename()!=='polling-atlas.png')throw Error('PNG download failed');
 await page.getByRole('button',{name:'Account / Sign in',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');if(await page.getByRole('dialog').count())throw Error('Escape did not close dialog');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'atlas-mobile.png',fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('Verified real API station placement, district geometry, nearest-station tie, PNG download, modal Escape, and mobile no-overflow; no page errors.');
} finally {await browser.close();}
