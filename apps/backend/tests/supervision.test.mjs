import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
process.env.DOTENV_CONFIG_PATH='/dev/null';
process.env.COMPLISCAN_TEST='1'; process.env.JWT_SECRET='supervision-tests-only'; delete process.env.DATABASE_URL;
const { normalizeInspection, supervisionFlags } = await import('../dist/inspectionIntegrity.js');
const { generateToken } = await import('../dist/authMiddleware.js');
const { default: pool } = await import('../dist/db.js');
const { default: app } = await import('../dist/server.js');
const inspector={userId:'inspector',name:'Inspector',inspectorId:'I-1',role:'INSPECTOR'};
const photo=Buffer.from([255,216,255,0,1,2,3]); const sha=createHash('sha256').update(photo).digest('hex');
const fixture=()=>({id:randomUUID(),client_event_id:randomUUID(),timestamp:new Date().toISOString(),inspector_id:'I-1',inspector_name:'Inspector',passed:99,total:99,score:'99/99',report_json:JSON.stringify({results:[{ruleId:'MRP',status:'FAIL'}],inspection:{location:{status:'recorded',latitude:19,longitude:72,accuracyM:10}},evidence:{images:[{imageIndex:0,fileName:'front.jpg',surface:'Front',sha256:sha}],checksum:sha}})});
test('server verifies original bytes, recomputes score and binds inspector identity',()=>{
 const body=fixture();const normalized=normalizeInspection(body,inspector,[{buffer:photo,mimetype:'image/jpeg'}]);
 assert.equal(normalized.payload.score,'0/1');assert.equal(normalized.payload.inspector_name,'Inspector');
 assert.equal(JSON.parse(normalized.payload.report_json).inspection.inspectorId,'I-1');
 assert.throws(()=>normalizeInspection(body,inspector,[{buffer:Buffer.from('changed'),mimetype:'image/jpeg'}]),/hash/);
 assert.throws(()=>normalizeInspection(body,inspector,[]),/Every declared/);
 const invalid=fixture();const report=JSON.parse(invalid.report_json);report.inspection.location.latitude=100;invalid.report_json=JSON.stringify(report);
 assert.throws(()=>normalizeInspection(invalid,inspector,[{buffer:photo,mimetype:'image/jpeg'}]),/coordinates/);
});
test('revision flags identify changed failures and removed originals',()=>{
 const old=normalizeInspection(fixture(),inspector,[{buffer:photo,mimetype:'image/jpeg'}]).payload;
 const next=structuredClone(old);const report=JSON.parse(next.report_json);report.results[0].status='PASS';delete report.evidence;report.inspection.sources=['manual'];next.report_json=JSON.stringify(report);next.revision_reason='';
 assert.deepEqual(supervisionFlags(next,old).sort(),['ORIGINAL_PHOTOS_MISSING','MANUAL_DECLARATIONS','REVISED_INSPECTION','CORRECTION_REASON_MISSING','FAILED_CHECK_CHANGED_TO_PASS','PHOTOGRAPHS_REMOVED'].sort());
});
let server,base;
before(async()=>{process.env.DATABASE_URL='test-mocked';pool.query=async(query,params)=>{
 if(query.includes('FROM users'))return{rows:[{username:params[0],role:params[0]==='admin'?'ADMIN':'INSPECTOR',full_name:'Server account',inspector_id:'SERVER-1'}]};
 if(query.includes('append_inspection_event'))return{rows:[{inspection_id:params[1],client_event_id:params[0],sequence:1,event_hash:'verified',received_at:new Date().toISOString()}]};
 return{rows:[]};
};server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});base=`http://127.0.0.1:${server.address().port}`;});
after(()=>new Promise(resolve=>server.close(resolve)));
const request=(path,user,options={})=>fetch(base+path,{...options,headers:{Authorization:`Bearer ${generateToken(user)}`,...options.headers}});
test('admin routes use current database role, rejecting inspector tokens claiming admin',async()=>{
 assert.equal((await request('/api/admin/inspections',{...inspector,role:'ADMIN'})).status,403);
 assert.equal((await request('/api/admin/inspections',{...inspector,userId:'admin',role:'INSPECTOR'})).status,200);
 assert.equal((await fetch(base+'/api/admin/inspections')).status,401);
});
test('central deletion is disabled and admin review requires a note',async()=>{
 const admin={...inspector,userId:'admin',role:'ADMIN'};
 assert.equal((await request('/api/history/'+randomUUID(),admin,{method:'DELETE'})).status,405);
 assert.equal((await request('/api/admin/reviews',admin,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sequence:1,action:'REVIEWED',note:''})})).status,400);
});
