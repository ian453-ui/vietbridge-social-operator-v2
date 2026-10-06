import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {FacebookBrowser,normalizeRadarResults} from '../src/facebook-browser.js';

function fixture(){
 const store=new Store(join(mkdtempSync(join(tmpdir(),'interaction-repair-')),'db.sqlite')),ws='ws-vietbridge';
 const profile=store.saveProfile(ws,{name:'Browser',cdp_port:19621,user_data_dir:'/tmp/interaction-repair'});
 const account=store.saveAccount(ws,{display_name:'Actor',expected_identity:'Actor',external_id:'123456',profile_id:profile.id,execution_transport:'BROWSER'});
 const group=store.addGroup(ws,{account_id:account.id,name:'HR',url:'https://www.facebook.com/groups/123',tags:'招聘',proactive_engagement_enabled:true});
 store.db.prepare("UPDATE facebook_accounts SET session_health='HEALTHY' WHERE id=?").run(account.id);
 store.saveEngagementPolicy(ws,{account_id:account.id,mode:'AUTO_LOW_RISK',topics:'招聘'});
 store.ingestRadarPosts(ws,account.id,[{group_id:group.id,external_id:'456',permalink:group.url+'/posts/456/',author:'Alice',body:'越南工厂招聘怎么提高面试到岗率？',topic:'招聘'}]);
 const candidate=store.buildEngagementCandidates(ws,account.id)[0];
 return {store,ws,account,group,candidate};
}

test('policy edits reclassify unsent candidates and preserve locked outcomes',()=>{
 const {store,ws,account,candidate}=fixture();try{
  store.saveEngagementPolicy(ws,{account_id:account.id,mode:'AUTO_LOW_RISK',topics:'无关主题'});
  assert.equal(store.buildEngagementCandidates(ws,account.id)[0].state,'SKIP');
  store.saveEngagementPolicy(ws,{account_id:account.id,mode:'AUTO_LOW_RISK',topics:'招聘'});
  assert.equal(store.buildEngagementCandidates(ws,account.id)[0].state,'REPLY_CANDIDATE');
  const reservation=store.reserveReplyQuota(ws,candidate.id).reservation;
  store.beginAutoReply(ws,candidate.id,reservation.id);
  store.markAutoReplyUnknown(ws,candidate.id,reservation.id,'Readback pending');
  store.buildEngagementCandidates(ws,account.id);
  assert.equal(store.engagementCandidate(ws,candidate.id).state,'UNKNOWN');
  assert.equal(store.engagementCandidate(ws,candidate.id).reason,'Readback pending');
 }finally{store.close()}
});

test('radar recognizes canonical permalink and photo links but rejects another host or group',()=>{
 const group={id:'g',url:'https://www.facebook.com/groups/123'};
 const row=url=>({body:'招聘怎么改善？',links:[{url,text:'post'}]});
 const rows=normalizeRadarResults([row('https://www.facebook.com/groups/123/permalink/456/?ref=share'),row('https://www.facebook.com/photo/?fbid=789&set=gm.456&idorvanity=123'),row('https://evil.example/groups/123/posts/789/'),row('https://www.facebook.com/groups/1234/posts/789/')],group,'招聘');
 assert.equal(rows.length,1);assert.equal(rows[0].permalink,'https://www.facebook.com/groups/123/posts/456/');
});

test('shadow proactive settings block writes and verified facts survive a rescan',()=>{
 const {store,ws,account,group}=fixture();try{
  store.saveProactiveSettings(ws,{account_id:account.id,enabled:true,auto_like:true,auto_reply:true,mode:'SHADOW',project_topics:'招聘'});
  const item={group_id:group.id,external_id:'999',body:'招聘最新劳动法规定怎么处理加班？'};
  const [post]=store.ingestEngagementPosts(ws,account.id,[item]);
  store.addFactSource(ws,post.id,{source_url:'https://example.gov.vn/rule',supports_reply:true});
  assert.equal(store.ingestEngagementPosts(ws,account.id,[item])[0].state,'FACT_VERIFIED');
  assert.throws(()=>store.reserveProactivePost(ws,post.id,'Reviewed reply'),/影子模式/);
  assert.equal(store.rows('engagement_daily_slots',ws).length,0);
 }finally{store.close()}
});

for(const verified of [true,false])test(`browser radar reply ${verified?'confirms readback':'locks ambiguous submission without retry'}`,async()=>{
 const {store,ws,account,group,candidate}=fixture();let presses=0,closed=0;
 const browser=new FacebookBrowser(store);
 browser.inspect=async()=>({healthy:true,externalId:'123456',actualIdentity:'Actor'});
 const box={count:async()=>1,fill:async()=>{},textContent:async()=>candidate.draft,press:async()=>{presses++}};
 const actor={first(){return this},waitFor:async()=>{},getAttribute:async()=>'true',locator(){return this},innerText:async()=>'Actor'};
 const page={goto:async()=>{},waitForTimeout:async()=>{},url:()=>group.url+'/posts/456/',getByRole:()=>actor,locator:selector=>selector==='body'?{innerText:async()=>'越南工厂招聘怎么提高面试到岗率？'}:{last:()=>box}};
 const fresh={...page,close:async()=>{},locator:selector=>selector==='div[role="article"]'?{evaluateAll:async()=>verified}:page.locator(selector)};
 browser.page=async()=>({page,browser:{close:async()=>{closed++},contexts:()=>[{newPage:async()=>fresh}]}});
 try{
  const result=await browser.replyRadarCandidate(ws,candidate.id);
  assert.equal(result.state,verified?'REPLIED':'UNKNOWN');assert.equal(presses,1);assert.equal(closed,1);
  assert.equal(store.facebookView(ws).quotaEvents[0].state,verified?'CONSUMED':'RESERVED');
  assert.equal(browser.activeProfiles.size,0);
  await assert.rejects(browser.replyRadarCandidate(ws,candidate.id),/已有|候选|只有/);
  assert.equal(presses,1);
 }finally{store.close()}
});
