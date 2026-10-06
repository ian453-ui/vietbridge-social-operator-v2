import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/server.js';
import {cloudRuntime} from '../src/cloud-runtime.js';
test('cloud requires auth and disables local execution',async()=>{
 const cloud=cloudRuntime({PUBLISHER_MODE:'cloud',PUBLIC_ORIGIN:'https://social.example.com',ADMIN_PASSWORD:'test-only-long-password-123456',DATA_DIR:'/data'});
 const server=createApp(join(mkdtempSync(join(tmpdir(),'cloud-test-')),'db.sqlite'),{cloud});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 cloud.host=new URL(url).host;
 try{
  assert.equal((await fetch(url+'/api/state',{headers:{host:cloud.host}})).status,401);
  const headers={host:cloud.host,authorization:'Basic '+Buffer.from(cloud.user+':'+cloud.password).toString('base64')};
  assert.equal((await fetch(url+'/api/state',{headers})).status,200);
  assert.equal((await fetch(url+'/api/group-library',{headers})).status,409);
  cloud.host='other.example';
  assert.equal((await fetch(url+'/api/state',{headers})).status,409);
 }finally{await new Promise(r=>server.close(r));}
});

test('authenticated Mac Tunnel serves the sole public host and permits local settings with CSRF checks',async()=>{
 const cloud=cloudRuntime({PUBLISHER_MODE:'mac-tunnel',PUBLIC_ORIGIN:'https://publisher.vietbridge.one',ADMIN_PASSWORD:'test-only-long-password-123456',DATA_DIR:'/tmp'});
 const server=createApp(join(mkdtempSync(join(tmpdir(),'tunnel-test-')),'db.sqlite'),{cloud});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port,headers={host:cloud.host,authorization:'Basic '+Buffer.from(cloud.user+':'+cloud.password).toString('base64')};
 try{
  assert.equal((await fetch(url+'/api/state',{headers:{host:cloud.host}})).status,401);
  assert.equal((await fetch(url+'/api/state',{headers:{...headers,host:'second.example'}})).status,409);
  const health=await (await fetch(url+'/api/health',{headers})).json();assert.equal(health.mode,'mac-tunnel');assert.equal(health.executionConnected,true);
  const state=await (await fetch(url+'/api/state?workspace=ws-vietbridge',{headers})).json();
  const fb=await (await fetch(url+'/api/facebook?workspace=ws-vietbridge',{headers})).json();assert.equal(fb.executionConnected,true);
  const profile=await fetch(url+'/api/workspaces/ws-vietbridge/profiles',{method:'POST',headers:{...headers,origin:cloud.origin,'content-type':'application/json','x-local-token':state.token},body:JSON.stringify({name:'Test only',cdp_port:19701,user_data_dir:'/tmp/test-only-profile'})});
  assert.equal(profile.status,200);
  assert.equal((await fetch(url+'/api/workspaces/ws-vietbridge/profiles',{method:'POST',headers:{...headers,origin:'https://other.example','content-type':'application/json','x-local-token':state.token},body:'{}'})).status,409);
 }finally{await new Promise(r=>server.close(r))}
});
