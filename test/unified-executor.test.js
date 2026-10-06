import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {UnifiedPublisher} from '../src/unified-publisher.js';
import {UnifiedExecutor} from '../src/unified-executor.js';
import {BrowserResources} from '../src/browser-resources.js';

function setup(t){
  const root=mkdtempSync(join(tmpdir(),'vb-executor-')),store=new Store(join(root,'publisher.sqlite'),{seedDemo:false}),publisher=new UnifiedPublisher(store),workspace=store.saveWorkspace({name:'Client',content_root:root});
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const profile=store.saveProfile(workspace.id,{name:'Chrome',cdp_port:19981,user_data_dir:join(root,'chrome')}),account=publisher.saveAccount(workspace.id,{display_name:'Client Page',expected_identity:'Client Page',identity_type:'PAGE',external_id:'12345',profile_id:profile.id});
  const content=publisher.importContent(workspace.id,{source_id:'c1',revision:'r1',body:'Approved body',media:[]}),job=publisher.createPageJob(workspace.id,{account_id:account.id,content_id:content.id});
  let submits=0,readback=true,prepareFail=false,submitFail=false;
  const driver={async prepare(){if(prepareFail)throw Error('preflight failed');return {identityVerified:true};},async submit(){submits++;if(submitFail)throw Error('connection lost after click');return {id:'999',url:'https://www.facebook.com/12345/posts/999'};},async readback(snapshot){if(!readback)throw Error('missing independent readback');return {verified:true,id:'999',url:'https://www.facebook.com/12345/posts/999',pageId:snapshot.externalId,contentHash:snapshot.contentHash};},async close(){}};
  const executor=new UnifiedExecutor(publisher,{enabled:true,resources:new BrowserResources(join(root,'locks')),drivers:{create:async()=>driver},mediaRoots:[root],snapshotRoot:join(root,'snapshots')});
  return {root,store,publisher,executor,workspace,account,job,content,driver,get submits(){return submits;},set readback(x){readback=x;},set prepareFail(x){prepareFail=x;},set submitFail(x){submitFail=x;}};
}
test('execution persists immutable intent before one submit and requires independent evidence',async t=>{
  const f=setup(t);f.executor.approve(f.workspace.id,f.job.id,f.job.snapshot_hash);
  const old=f.driver.submit;f.driver.submit=async()=>{assert.equal(f.publisher.job(f.workspace.id,f.job.id).state,'SUBMITTING');assert.equal(f.store.db.prepare('SELECT count(*) n FROM publisher_submit_intents').get().n,1);return old();};
  const result=await f.executor.execute(f.workspace.id,f.job.id);assert.equal(result.state,'PUBLISHED');assert.equal(f.submits,1);
  await assert.rejects(()=>f.executor.execute(f.workspace.id,f.job.id));assert.equal(f.submits,1);
});
test('acceptance mode rejects execution before any external call',async t=>{const f=setup(t);f.executor.enabled=false;await assert.rejects(()=>f.executor.execute(f.workspace.id,f.job.id),/验收模式/);assert.equal(f.submits,0);assert.equal(f.publisher.job(f.workspace.id,f.job.id).state,'DRAFT');});
test('submit uncertainty retains durable lock and allows only readback, never resend',async t=>{
  const f=setup(t);f.executor.approve(f.workspace.id,f.job.id,f.job.snapshot_hash);f.submitFail=true;
  await assert.rejects(()=>f.executor.execute(f.workspace.id,f.job.id));assert.equal(f.publisher.job(f.workspace.id,f.job.id).state,'UNKNOWN');
  await assert.rejects(()=>f.executor.execute(f.workspace.id,f.job.id));assert.equal(f.submits,1);
  f.submitFail=false;const result=await f.executor.reconcile(f.workspace.id,f.job.id);assert.equal(result.state,'PUBLISHED');assert.equal(f.submits,1);
});
test('before-submit failure can return to review without inventing a successful publication',async t=>{
  const f=setup(t);f.executor.approve(f.workspace.id,f.job.id,f.job.snapshot_hash);f.prepareFail=true;
  await assert.rejects(()=>f.executor.execute(f.workspace.id,f.job.id));assert.equal(f.publisher.job(f.workspace.id,f.job.id).state,'BLOCKED');assert.equal(f.submits,0);
  assert.equal(f.executor.reopen(f.workspace.id,f.job.id).state,'DRAFT');
});
test('wrong identity or body evidence cannot finish an uncertain task',async t=>{
  const f=setup(t);f.executor.approve(f.workspace.id,f.job.id,f.job.snapshot_hash);f.readback=false;await assert.rejects(()=>f.executor.execute(f.workspace.id,f.job.id));
  assert.throws(()=>f.executor.complete(f.workspace.id,f.job.id,{verified:true,id:'999',pageId:'different',contentHash:f.job.snapshot.contentHash}),/完整/);assert.equal(f.publisher.job(f.workspace.id,f.job.id).state,'UNKNOWN');
});
test('approved media is copied and checked independently from changing source files',async t=>{
  const f=setup(t),path=join(f.root,'cover.png');writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10,0,1]));
  const content=f.publisher.importContent(f.workspace.id,{source_id:'image',revision:'r1',body:'Image body',media:[path]}),job=f.publisher.createPageJob(f.workspace.id,{account_id:f.account.id,content_id:content.id});
  f.executor.approve(f.workspace.id,job.id,job.snapshot_hash);writeFileSync(path,'changed source');
  const asset=f.store.db.prepare('SELECT * FROM publisher_job_assets WHERE job_id=?').get(job.id);assert.notEqual(asset.path,path);
  writeFileSync(asset.path,'tampered snapshot');await assert.rejects(()=>f.executor.execute(f.workspace.id,job.id),/媒体/);assert.equal(f.submits,0);
});
