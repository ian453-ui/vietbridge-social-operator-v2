import test from 'node:test';
import assert from 'node:assert/strict';
import {FacebookBusinessBrowser} from '../src/publisher-core/facebook-business-browser.ts';

function fixture(patch={}){
  const state={visible:true,enabled:true,count:1,body:'Frozen approved body',url:'https://business.facebook.com/latest/composer?asset_id=1459220443931651',destination:1,public:true,boost:false,photos:0,trialFailure:false,clickFailure:false,...patch};
  let trials=0,clicks=0,pageCloses=0,disconnects=0;
  const publish={async count(){return state.count;},async isVisible(){return state.visible;},async isEnabled(){return state.enabled;},async click(options){if(options.trial){trials++;if(state.trialFailure)throw Error('trial actionability timeout');}else{clicks++;if(state.clickFailure)throw Error('click outcome unknown');}}};
  const page={url:()=>state.url,getByLabel(){return {innerText:async()=>state.body};},getByRole(role,{name}={}){
    if(role==='combobox')return {count:async()=>state.destination};if(role==='radio')return {isChecked:async()=>state.public};if(role==='switch')return {isChecked:async()=>name==='Boost'&&state.boost};if(name==='Publish')return publish;if(name==='Remove photo')return {count:async()=>state.photos};throw Error('unexpected fixture locator');
  },async close(){pageCloses++;}};
  const browser=new FacebookBusinessBrowser({id:'a',page_id:'1459220443931651',page_name:'LP'},17921,'61594159443807');
  browser.composer=page;browser.prepared={caption:'Frozen approved body',images:0,video:false};browser.browser={close:async()=>{disconnects++;}};
  return {browser,state,get trials(){return trials;},get clicks(){return clicks;},get pageCloses(){return pageCloses;},get disconnects(){return disconnects;}};
}
test('readiness trial checks actionability without any final click and retains sanitized form evidence',async()=>{
  const f=fixture(),evidence=await f.browser.readiness();assert.equal(f.trials,1);assert.equal(f.clicks,0);assert.equal(evidence.actionabilityTrialPassed,true);assert.equal(evidence.bodyMatches,true);assert.equal(evidence.finalClickAttempted,false);assert.equal(JSON.stringify(evidence).includes('Frozen approved body'),false);
});
test('hidden/disabled/nonunique/unstable buttons cannot dispatch a final click',async()=>{
  for(const patch of [{visible:false},{enabled:false},{count:2},{trialFailure:true}]){const f=fixture(patch);await assert.rejects(()=>f.browser.submit());assert.equal(f.clicks,0);assert.equal(f.browser.failureEvidence().finalClickAttempted,false);await f.browser.close();assert.equal(f.pageCloses,0);assert.equal(f.disconnects,1);}
});
test('changed body/target/audience/media/boost fail before actionability or final click',async()=>{
  for(const patch of [{body:'Changed'}, {url:'https://business.facebook.com/latest/composer?asset_id=wrong'}, {destination:0}, {public:false}, {photos:1}, {boost:true}]){const f=fixture(patch);await assert.rejects(()=>f.browser.submit(),/核对失败/);assert.equal(f.trials,0);assert.equal(f.clicks,0);}
});
test('final click timeout preserves composer and diagnostic boundary without automatic retry',async()=>{
  const f=fixture({clickFailure:true});await assert.rejects(()=>f.browser.submit(),/unknown/);assert.equal(f.clicks,1);const evidence=f.browser.failureEvidence();assert.equal(evidence.finalClickAttempted,true);assert.equal(evidence.actionabilityTrialPassed,true);assert.equal(evidence.composerRetained,true);await f.browser.close();assert.equal(f.pageCloses,0);assert.equal(f.clicks,1);
});
test('completed click without independent publication proof still retains composer; verified readback permits cleanup',async()=>{
  const f=fixture();await f.browser.submit();assert.equal(f.clicks,1);assert.equal(f.browser.failureEvidence().clickCallCompleted,true);await f.browser.close();assert.equal(f.pageCloses,0);
  const g=fixture();g.browser.publishedMatch=async()=>({id:'123',url:'https://www.facebook.com/61594159443807/posts/123'});await g.browser.readback('Frozen approved body');await g.browser.close();assert.equal(g.pageCloses,1);
});
