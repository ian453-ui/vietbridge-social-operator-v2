import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createApp} from '../src/server.js';
test('HTTP persistence, isolation, approvals, duplicate prevention and recovery',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'smo-v2-')),'test.sqlite');let server,base,token;
 async function start(){server=createApp(path);await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;token=(await read()).token;}
 async function read(ws=''){return (await fetch(base+'/api/state'+(ws?'?workspace='+ws:''))).json();}
 async function act(ws,kind,id,action,b){const r=await fetch(`${base}/api/workspaces/${ws}/${kind}/${id}/${action}`,{method:'POST',headers:{'content-type':'application/json','x-local-token':token,origin:base},body:JSON.stringify(b)});return {status:r.status,value:await r.json()};}
 const close=()=>new Promise(r=>server.close(r));await start();
 try{
 assert.equal((await read()).tasks.length,0);const a=await read('ws-vietbridge');assert.ok(a.content.every(c=>c.workspaceId==='ws-vietbridge'));
 for(const p of ['/','/client.js','/styles.css'])assert.equal((await fetch(base+p)).status,200);
 let t=a.tasks[0];assert.equal((await act('ws-abc','tasks',t.id,'approve',{version:t.version})).status,409);
 assert.equal((await act('ws-vietbridge','tasks',t.id,'prepare',{version:t.version})).status,409);
 t=(await act('ws-vietbridge','tasks',t.id,'approve',{version:t.version})).value;
 const content=a.content.find(c=>c.id===t.contentId);await act('ws-vietbridge','content',content.id,'revise',{body:'新的审核正文'});
 assert.equal((await act('ws-vietbridge','tasks',t.id,'prepare',{version:t.version})).status,409);
 t=(await act('ws-vietbridge','tasks',t.id,'approve',{version:t.version})).value;
 t=(await act('ws-vietbridge','tasks',t.id,'prepare',{version:t.version})).value;assert.equal(t.state,'COMPOSER_READY');
 const results=await Promise.all([act('ws-vietbridge','tasks',t.id,'submit',{version:t.version}),act('ws-vietbridge','tasks',t.id,'submit',{version:t.version})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 await close();await start();t=(await read('ws-vietbridge')).tasks.find(x=>x.id===t.id);assert.equal(t.state,'UNKNOWN');
 t=(await act('ws-vietbridge','tasks',t.id,'reconcile',{version:t.version})).value;assert.equal(t.state,'PUBLISHED');assert.equal((await act('ws-vietbridge','tasks',t.id,'prepare',{version:t.version})).status,409);
 const c=a.comments.find(c=>c.intent!=='RISK_QUESTION');assert.equal((await act('ws-vietbridge','comments',c.id,'reply',{body:'谢谢您的反馈'})).status,200);assert.equal((await act('ws-vietbridge','comments',c.id,'reply',{body:'重复回复'})).status,409);
 assert.ok((await read('ws-vietbridge')).audit.length>0);
 }finally{await close();}
});
