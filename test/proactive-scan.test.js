import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFacebookPostTime,normalizeProactiveResults,FacebookBrowser} from '../src/facebook-browser.js';

const now=Date.parse('2026-10-01T10:00:00Z'),group={id:'g',url:'https://www.facebook.com/groups/123'};
function row(time,url='https://www.facebook.com/groups/123/posts/456/'){
 return {body:'How can our factory improve recruitment?',time,links:[{url:'https://www.facebook.com/alice',text:'Alice'},{url,text:'post'}]};
}
test('numeric, ISO and Chinese/English/Vietnamese times resolve with a fixed observation time',()=>{
 for(const label of ['2 hours ago','2 h','2 小时前','2 小時前','2 giờ trước'])assert.equal(parseFacebookPostTime(label,now),'2026-10-01T08:00:00.000Z');
 assert.equal(parseFacebookPostTime('5 phút',now),'2026-10-01T09:55:00.000Z');
 assert.equal(parseFacebookPostTime(String(now/1000),now),new Date(now).toISOString());
 assert.equal(parseFacebookPostTime('2026-10-01T09:00:00Z',now),'2026-10-01T09:00:00.000Z');
 assert.equal(parseFacebookPostTime('Just now',now),new Date(now).toISOString());
 for(const value of ['Sponsored','Alice','99999999999999999','2026-10-02T10:00:00Z'])assert.equal(parseFacebookPostTime(value,now),null);
});
test('scan accepts permalink format, verifies host/group, filters old or unknown times and deduplicates',()=>{
 const result=normalizeProactiveResults([
  row('2 小时前','https://www.facebook.com/groups/123/permalink/456/?ref=share'),
  row('1 小时前'),row('2 days ago','https://www.facebook.com/groups/123/posts/789/'),
  row('unknown','https://www.facebook.com/groups/123/posts/999/'),
  row('2 hours ago','https://evil.example/groups/123/posts/100/'),
  row('2 hours ago','https://www.facebook.com/groups/1234/posts/100/'),
 ],group,24,now);
 assert.equal(result.length,1);assert.equal(result[0].external_id,'456');
 assert.equal(result[0].published_at,'2026-10-01T08:00:00.000Z');
 assert.equal(result[0].permalink,'https://www.facebook.com/groups/123/posts/456/');
 assert.equal(normalizeProactiveResults([{...row(null),times:['Alice','3 giờ']}],group,24,now).length,1);
});
test('empty or unreadable group feed is an explicit blocker instead of successful zero scan',async()=>{
 const account={id:'a',profile_id:'p',expected_identity:'Actor',external_id:'123456'};
 const store={account:()=>account,proactiveSettings:()=>({enabled:true,global_enabled:true,account_enabled:true,max_posts_per_group:30}),db:{prepare:()=>({all:()=>[group]})}};
 const browser=new FacebookBrowser(store);browser.profile=()=>({id:'p'});
 browser.inspect=async()=>({healthy:true,externalId:'123456',actualIdentity:'Actor'});
 const page={goto:async()=>{},waitForTimeout:async()=>{},url:()=>group.url,getByRole:()=>({first(){return this},waitFor:async()=>{},getAttribute:async()=> 'true',locator(){return this},innerText:async()=> 'Actor'}),locator:selector=>selector==='body'?{innerText:async()=> 'Test group'}:{first(){return this},waitFor:async()=>{},evaluateAll:async()=>[]}};
 let closed=false;browser.page=async()=>({page,browser:{close:async()=>{closed=true}}});
 await assert.rejects(browser.scanProactiveEngagement('ws','a'),/不能将读取失败当作零结果/);
 assert.equal(closed,true);assert.equal(browser.activeProfiles.size,0);
});
