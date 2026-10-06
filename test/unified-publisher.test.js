import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {UnifiedPublisher} from '../src/unified-publisher.js';
import {unifiedRoute} from '../src/unified-http.js';
import {unifiedPublisherView} from '../src/unified-client.js';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'vb-unified-')),path=join(root,'publisher.sqlite');
  const store=new Store(path,{seedDemo:false}),publisher=new UnifiedPublisher(store);
  t.after(()=>{store.db.close();rmSync(root,{recursive:true,force:true});});
  const a=store.saveWorkspace({name:'LP'}),b=store.saveWorkspace({name:'VietBridge'});
  function account(ws,port,externalId,type='PAGE') {
    const profile=store.saveProfile(ws.id,{name:`Chrome ${port}`,cdp_port:port,user_data_dir:join(root,`chrome-${port}`)});
    return publisher.saveAccount(ws.id,{display_name:`Page ${externalId}`,identity_type:type,external_id:externalId,profile_id:profile.id});
  }
  const first=account(a,19201,'10001'),second=account(a,19202,'10002'),other=account(b,19203,'10003');
  const input={source_id:'LP-011',revision:'cloud-r1',title:'标题',body:'来自云端账本的正文',media:['asset://lp/image1']};
  const content=publisher.importContent(a.id,input);
  const create=(acc=first)=>publisher.createPageJob(a.id,{account_id:acc.id,content_id:content.id});
  return {store,publisher,a,b,first,second,other,input,content,create,path};
}

test('fresh unified database contains no demo clients, mock content or mock tasks',t=>{
  const {store}=fixture(t);
  assert.equal(store.list('workspaces').length,2);
  assert.equal(store.list('content').length,0);
  assert.equal(store.list('tasks').length,0);
});
test('publishing and interaction share the same account registry and selection',t=>{
  const {store,publisher,a,second}=fixture(t);
  store.selectAccount(a.id,second.id);
  assert.equal(store.facebookView(a.id).selectedAccountId,second.id);
  assert.equal(publisher.context(a.id,second.id).account.id,second.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM facebook_accounts').get().n,3);
});
test('cloud import is idempotent and changed payload requires a new revision',t=>{
  const {publisher,a,input,content}=fixture(t);
  assert.equal(publisher.importContent(a.id,input).id,content.id);
  assert.throws(()=>publisher.importContent(a.id,{...input,body:'偷偷更改'}),/新版本/);
  const newer=publisher.importContent(a.id,{...input,revision:'cloud-r2',body:'新版'});
  assert.notEqual(newer.id,content.id);
});
test('client content is shared by accounts, while jobs and history remain separate',t=>{
  const {publisher,a,first,second,create,content}=fixture(t);
  const j1=create(),j2=create(second);
  assert.equal(j1.content_id,j2.content_id);
  assert.equal(j1.content_id,content.id);
  assert.notEqual(j1.id,j2.id);
  assert.equal(publisher.list(a.id).length,2);
  assert.deepEqual(publisher.list(a.id,first.id).map(x=>x.id),[j1.id]);
});
test('switching accounts cannot rewrite a queued task snapshot',t=>{
  const {publisher,store,a,first,second,create}=fixture(t);
  const job=create();publisher.approve(a.id,job.id,job.snapshot_hash);
  store.selectAccount(a.id,second.id);
  const queued=publisher.job(a.id,job.id);
  assert.equal(queued.account_id,first.id);
  assert.equal(queued.snapshot.externalId,first.external_id);
  assert.equal(queued.state,'READY');
});
test('rejects cross-client accounts, content, task access and history queries',t=>{
  const {publisher,a,b,first,other,content,create}=fixture(t);
  assert.throws(()=>publisher.createPageJob(a.id,{account_id:other.id,content_id:content.id}));
  assert.throws(()=>publisher.createPageJob(b.id,{account_id:other.id,content_id:content.id}),/内容不属于/);
  assert.throws(()=>publisher.job(b.id,create().id),/任务不属于/);
  assert.throws(()=>publisher.list(b.id,first.id));
  assert.equal(publisher.list(b.id).length,0);
});
test('duplicate creation returns the same durable task, including after cancellation',t=>{
  const {publisher,a,create}=fixture(t);
  const job=create();assert.equal(create().id,job.id);
  publisher.cancel(a.id,job.id);
  assert.equal(create().state,'CANCELLED');
});
test('approval rejects tampering, identity changes and content changes',t=>{
  const {publisher,store,a,first,create,content}=fixture(t);
  const job=create();
  assert.throws(()=>publisher.approve(a.id,job.id,'old-preview'),/预览已失效/);
  store.db.prepare('UPDATE facebook_accounts SET external_id=? WHERE id=?').run('99999',first.id);
  assert.throws(()=>publisher.approve(a.id,job.id,job.snapshot_hash),/账号或浏览器/);
  store.db.prepare('UPDATE facebook_accounts SET external_id=? WHERE id=?').run(first.external_id,first.id);
  store.db.prepare('UPDATE group_content SET body=? WHERE id=?').run('changed',content.id);
  assert.throws(()=>publisher.approve(a.id,job.id,job.snapshot_hash),/内容版本/);
  assert.equal(publisher.job(a.id,job.id).state,'DRAFT');
});
test('API mode requires existing secure authorization; personal identity cannot create a Page job',t=>{
  const {publisher,a,first,create,store}=fixture(t);
  assert.throws(()=>publisher.saveAccount(a.id,{...first,publisher_transport:'API'}),/授权配置/);
  store.db.prepare("UPDATE facebook_accounts SET identity_type='PROFILE' WHERE id=?").run(first.id);
  assert.throws(()=>create(),/企业 Page/);
});
test('manual API/browser switching affects new tasks and preserves the queued execution mode',t=>{
  const {publisher,a,first,create,path}=fixture(t),browserJob=create();
  const config=join(path,'..','fixture.env');writeFileSync(config,'# disposable test configuration, no credentials\n',{mode:0o600});
  publisher.switchTransport(a.id,first.id,'API',config);
  assert.equal(publisher.context(a.id,first.id).account.execution_transport,'BROWSER','interaction remains browser-only');
  const apiJob=create();assert.equal(apiJob.snapshot.transport,'API');assert.equal(apiJob.snapshot.credentialRef,config);
  publisher.switchTransport(a.id,first.id,'BROWSER');
  assert.equal(publisher.job(a.id,apiJob.id).snapshot.transport,'API');
  assert.equal(publisher.job(a.id,browserJob.id).snapshot.transport,'BROWSER');
  assert.equal(publisher.approve(a.id,apiJob.id,apiJob.snapshot_hash).state,'READY');
});
test('manual switching never creates a second task for an already uncertain submission',t=>{
  const {publisher,store,a,first,create,path}=fixture(t),job=create();
  store.db.prepare("UPDATE publisher_jobs SET state='UNKNOWN' WHERE id=?").run(job.id);
  const config=join(path,'..','fixture.env');writeFileSync(config,'# test only\n',{mode:0o600});
  publisher.switchTransport(a.id,first.id,'API',config);
  assert.throws(()=>create(),/先核对历史/);
});
test('startup recovery preserves unknown outcomes and forbids cancellation',t=>{
  const {publisher,store,a,create}=fixture(t);
  const job=create();store.db.prepare("UPDATE publisher_jobs SET state='SUBMITTING' WHERE id=?").run(job.id);
  new UnifiedPublisher(store);
  assert.equal(publisher.job(a.id,job.id).state,'SUBMITTING','reader construction must not recover live jobs');
  assert.equal(publisher.recoverAfterShutdown(),1);
  assert.equal(publisher.job(a.id,job.id).state,'UNKNOWN');
  assert.throws(()=>publisher.cancel(a.id,job.id),/结果未知/);
  assert.throws(()=>publisher.approve(a.id,job.id,job.snapshot_hash),/只能批准/);
});
test('unified tasks survive reopening the database with frozen content',t=>{
  const {publisher,a,create,path}=fixture(t),job=create();
  const reader=new Store(path,{seedDemo:false});
  try {const reopened=new UnifiedPublisher(reader).job(a.id,job.id);assert.deepEqual(reopened.snapshot,job.snapshot);}
  finally {reader.db.close();}
});
test('history uses bounded pagination and rejects invalid bounds',t=>{
  const {publisher,a,second,create}=fixture(t);create();create(second);
  assert.equal(publisher.list(a.id,null,{limit:1}).length,1);
  assert.equal(publisher.list(a.id,null,{limit:1,offset:1}).length,1);
  assert.throws(()=>publisher.list(a.id,null,{limit:1000}),/分页/);
});
test('changed cloud revision cannot bypass an unknown result for identical content',t=>{
  const {publisher,store,a,first,input,create}=fixture(t),job=create();
  store.db.prepare("UPDATE publisher_jobs SET state='UNKNOWN' WHERE id=?").run(job.id);
  const next=publisher.importContent(a.id,{...input,revision:'cloud-r2'});
  assert.throws(()=>publisher.createPageJob(a.id,{account_id:first.id,content_id:next.id}),/先核对历史/);
});
test('unified route runs create, scoped list, approval and cancellation on the same store',t=>{
  const {publisher,a,first,content}=fixture(t),url=path=>new URL(`http://localhost/api/unified/workspaces/${a.id}${path}`);
  const created=unifiedRoute(publisher,'POST',url('/jobs'),{account_id:first.id,content_id:content.id});
  assert.equal(created.status,201);
  const listed=unifiedRoute(publisher,'GET',url('/jobs?accountId='+first.id));
  assert.equal(listed.body.jobs[0].id,created.body.id);
  const approved=unifiedRoute(publisher,'POST',url(`/jobs/${created.body.id}/approve`),{snapshot_hash:created.body.snapshot_hash});
  assert.equal(approved.body.state,'READY');
  assert.equal(unifiedRoute(publisher,'POST',url(`/jobs/${created.body.id}/cancel`)).body.state,'CANCELLED');
  assert.equal(unifiedRoute(publisher,'DELETE',url('/jobs')).status,405);
  assert.equal(unifiedRoute(publisher,'GET',new URL('http://localhost/api/state')),null);
});
test('native publisher view escapes content and has no version binding or iframe',()=>{
  const markup=unifiedPublisherView('w',{id:'a',display_name:'<script>bad</script>',identity_type:'PAGE'},[{id:'c',title:'<img onerror=bad>'}]);
  assert.ok(markup.includes('&lt;script&gt;'));
  assert.ok(markup.includes('&lt;img'));
  assert.ok(!markup.includes('<iframe'));
  assert.ok(!markup.includes('publisherAccountId'));
});
