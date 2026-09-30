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
