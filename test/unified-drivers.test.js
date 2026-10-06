import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ApiDriver,BrowserDriver} from '../src/unified-drivers.js';
const snapshot={workspace:'w',accountId:'a',externalId:'12345',expectedIdentity:'Page',body:'approved complete body',title:'Title',contentHash:'hash',media:[],cdpPort:19999};
test('API adapter validates target, dry-runs, submits once and independently verifies full body and author',async t=>{
  const root=mkdtempSync(join(tmpdir(),'vb-api-driver-')),config=join(root,'fixture.env');writeFileSync(config,'FB_PAGE_ID=12345\n',{mode:0o600});t.after(()=>rmSync(root,{recursive:true,force:true}));
  const calls=[],client={async useConfig(path){assert.equal(path,config);},async call(name,args){calls.push([name,args]);if(name==='fb_get_auth_status')return {status:'ready',page_id:'12345'};if(name==='fb_get_page_feed')return {posts:[]};if(name==='fb_get_post_details')return {id:'12345_999',from:{id:'12345'},message:snapshot.body};return args.dry_run?{dry_run:true}:{post_id:'12345_999'};},async close(){}};
  const s={...snapshot,credentialRef:config},driver=new ApiDriver(s,{client});await driver.prepare(s,[]);const receipt=await driver.submit();const result=await driver.readback(s,receipt);
  assert.equal(result.verified,true);assert.equal(calls.filter(([name,args])=>name==='fb_publish_post'&&args.dry_run===false).length,1);
  client.call=async()=>({status:'ready',page_id:'wrong'});await assert.rejects(()=>driver.prepare(s,[]),/身份/);
});
test('browser adapter verifies actor before fill and submit, and never calls an API fallback',async()=>{
  const calls=[],facebook={async inspect(){calls.push('identity');return {healthy:true,externalId:'12345'};}},browser={browser:{},async connect(){calls.push('connect');},async publishedMatch(){return null;},async fill(body){assert.equal(body,snapshot.body);calls.push('fill');},async submit(){calls.push('submit');},async readback(){calls.push('readback');return {id:'999',url:'https://www.facebook.com/12345/posts/999'};},async close(){}};
  const driver=new BrowserDriver(snapshot,facebook,{browser});await driver.prepare(snapshot,[]);await driver.submit();assert.equal((await driver.readback(snapshot)).verified,true);
  assert.ok(calls.indexOf('identity')<calls.indexOf('fill'));assert.equal(calls.filter(x=>x==='submit').length,1);
  facebook.inspect=async()=>({healthy:true,externalId:'wrong'});await assert.rejects(()=>driver.submit(),/身份/);
  await assert.rejects(()=>driver.prepare(snapshot,['video.mp4']),/视频发布尚未验证/);
});
