import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
const inspector={userId:'queue-test',name:'Queue Inspector',role:'INSPECTOR',inspectorId:'Q-1'};
async function login(page:any,user:any) {
 await page.route('**/api/auth/login', (route:any)=>route.fulfill({json:{token:'test-token',user}}));
 await page.goto('/'); await page.getByPlaceholder('e.g. jdoe_inspector').fill('test');
 await page.locator('input[type="password"]').fill('password');
 await page.getByRole('button',{name:'Sign In',exact:true}).last().click();
 await expect(page.locator('#tab-scanner')).toBeVisible();
}
test('offline revisions queue independently, retry with stable event IDs', async({page,context})=>{
 const attempts:string[]=[];
 await page.route('**/api/history',async route=>{
  const body=route.request().postData()||'';
  const id=body.match(/name="client_event_id"\r\n\r\n([^\r]+)/)?.[1]||'';attempts.push(id);
  if(attempts.length===1)await route.fulfill({status:503,json:{error:'Archive temporarily unavailable'}});
  else await route.fulfill({status:201,json:{id:'saved',event_id:id,sequence:attempts.length}});
 });
 await login(page,inspector);await expect(page.locator('#tab-admin')).toHaveCount(0);
 await context.setOffline(true);
 await page.locator('textarea').fill('Product: Queue Snack\nNet Wt: 100 g\nMRP Rs. 10 incl. of all taxes');
 await page.getByRole('button',{name:'Re-audit Extracted Tokens'}).click();
 await expect(page.getByRole('status').filter({hasText:'Central archive:'})).toContainText('1 submission pending');
 await page.getByLabel('Correction reason').fill('Corrected price from original label');
 await page.locator('textarea').fill('Product: Queue Snack\nNet Wt: 100 g\nMRP Rs. 12 incl. of all taxes');
 await page.getByRole('button',{name:'Re-audit Extracted Tokens'}).click();
 await expect(page.getByRole('status').filter({hasText:'Central archive:'})).toContainText('2 submissions pending');
 const queue=()=>page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const req=indexedDB.open('keyval-store');req.onsuccess=()=>resolve(req.result);});
  const pending=await new Promise<any[]>(resolve=>{const req=db.transaction('keyval').objectStore('keyval').getAll();req.onsuccess=()=>resolve(req.result.filter((value:any)=>value?.eventId));});db.close();return pending;
 });
 expect((await queue()).map(item=>item.revisionReason)).toContain('Corrected price from original label');
 await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect.poll(()=>attempts.length).toBe(1);
 await expect(page.getByRole('status').filter({hasText:'Central archive:'})).toContainText('Archive temporarily unavailable');
 await expect.poll(async()=>(await queue()).length,{timeout:20000}).toBe(0);
 expect(attempts).toHaveLength(3);expect(attempts[0]).toMatch(/^[a-f0-9-]{36}$/);expect(attempts[1]).toBe(attempts[0]);expect(attempts[2]).not.toBe(attempts[0]);
 await expect(page.getByRole('status').filter({hasText:'Central archive:'})).toContainText('No pending submissions');
});
test('admin live feed, real map layer, revision review and verified original photographs work on mobile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const admin={userId:'admin-test',name:'Supervisor',role:'ADMIN',inspectorId:'A-1'};
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6D8AAAAASUVORK5CYII=','base64');
 const sha=createHash('sha256').update(bytes).digest('hex');const timestamp=new Date().toISOString();
 const report={results:[{ruleId:'MRP',status:'FAIL',details:'Missing declaration'}],inspection:{location:{status:'recorded',latitude:19.076,longitude:72.8777,accuracyM:15}},evidence:{images:[{sha256:sha,surface:'Side',fileName:'side.png'}]}};
 const payload={id:'00000000-0000-4000-8000-000000000001',timestamp,product_name:'Reviewed Package',inspector_name:'Inspector One',inspector_id:'I-1',report_json:JSON.stringify(report),score:'0/1',revision_reason:'',passed:0,total:1};
 const event={sequence:1,inspection_id:payload.id,actor_username:'inspector-one',received_at:timestamp,payload,event_hash:'hash-one',previous_hash:'GENESIS',flags:['ORIGINAL_PHOTOS_MISSING'],revisions:1,integrity_valid:true,chain_valid:true};
 let feedRequests=0;const reviews:any[]=[];
 await page.route('**/api/admin/legacy',route=>route.fulfill({json:{data:[]}}));
 await page.route('**/api/admin/inspections',route=>{feedRequests++;return route.fulfill({json:{received_at:new Date().toISOString(),data:[event]}});});
 await page.route('**/api/admin/inspections/*',route=>route.fulfill({json:{events:[event],reviews}}));
 await page.route('**/api/admin/evidence/*',route=>route.fulfill({body:bytes,contentType:'image/png'}));
 await page.route('**/api/admin/reviews',async route=>{const body=route.request().postDataJSON();reviews.push({...body,id:1,event_sequence:body.sequence,admin_username:admin.userId,received_at:timestamp});await route.fulfill({status:201,json:reviews[0]});});
 await login(page,admin);await page.locator('#tab-admin').click();
 await expect(page.getByRole('heading',{name:'Admin supervision'})).toBeVisible();
 await expect(page.locator('.leaflet-container')).toBeVisible();await expect(page.locator('canvas[data-testid="risk-heat-layer"]')).toBeVisible();
 await expect.poll(()=>page.locator('canvas[data-testid="risk-heat-layer"]').evaluate((node:HTMLCanvasElement)=>{
  const pixels=node.getContext('2d')!.getImageData(0,0,node.width,node.height).data;let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)visible++;return visible;
 })).toBeGreaterThan(500);
 await page.getByRole('button',{name:/Reviewed Package.*Inspector One/}).click();
 await expect(page.getByText('Ledger hash verified')).toBeVisible();
 await page.getByRole('button',{name:/Verify and view original/}).click();
 await expect(page.getByAltText('SHA-256 verified original inspection evidence')).toBeVisible();
 await page.getByRole('button',{name:'Close verified photograph'}).click();
 await page.getByLabel('Admin review note').fill('Original photograph reviewed; inspector must correct missing MRP.');
 await page.getByRole('button',{name:'Escalate',exact:true}).click();
 await expect(page.getByText(/ESCALATED · admin-test/)).toBeVisible();
 expect(reviews[0].event_sequence).toBe(1);
 await expect.poll(()=>feedRequests,{timeout:10000}).toBeGreaterThan(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/admin-mobile.png',fullPage:true});expect(errors).toEqual([]);
});
