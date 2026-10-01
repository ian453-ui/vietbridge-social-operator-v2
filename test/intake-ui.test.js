import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/client.js',import.meta.url),'utf8');
const functionLine=name=>source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));
const updateFunction=source.slice(source.indexOf('async function checkGptUpdates('),source.indexOf('\nsetInterval(',source.indexOf('async function checkGptUpdates(')));
function updateContext(get){
 const context=vm.createContext({workspace:'ws-test',route:'groups',gptUpdateBusy:false,gptUpdateWorkspace:'',gptUpdateCheckedAt:'',gptUpdateError:'',libraryItems:[{key:'old'}],libraryWorkspace:'ws-test',libraryPicked:new Set(['old']),message:'',get,render(){},encodeURIComponent,Date,Set});
 vm.runInContext(updateFunction,context);return context;
}

test('manual and automatic update use forced refresh, retain state on error and recover on retry',async()=>{
 let fail=true;const urls=[];
 const context=updateContext(async url=>{urls.push(url);if(fail)throw Error('Sync unavailable');return {items:[{key:'new',revision:'v2',ready:false}]};});
 await vm.runInContext('checkGptUpdates()',context);
 assert.equal(context.libraryItems[0].key,'old');assert.equal(context.gptUpdateCheckedAt,'');assert.match(context.gptUpdateError,/Sync unavailable/);
 fail=false;await vm.runInContext('checkGptUpdates(true)',context);
 assert.equal(context.libraryItems[0].revision,'v2');assert.equal(context.gptUpdateError,'');assert.ok(context.gptUpdateCheckedAt);
 assert.equal(context.libraryPicked.size,0);assert.ok(urls.every(url=>url.includes('refresh=1')));
});
test('overlapping checks coalesce and a prior workspace response cannot replace current drafts',async()=>{
 let finish,calls=0;
 const context=updateContext(()=>{calls++;return new Promise(resolve=>{finish=resolve});});
 const first=vm.runInContext('checkGptUpdates()',context);
 await vm.runInContext('checkGptUpdates(true)',context);assert.equal(calls,1);
 context.workspace='ws-other';finish({items:[{key:'wrong-workspace'}]});await first;
 assert.equal(context.libraryItems[0].key,'old');assert.equal(context.gptUpdateBusy,false);
});

test('review source remains visible before Facebook account setup',()=>{
 const html=vm.runInNewContext(functionLine('groups')+'\ngroups()',{
  selectedFacebookAccount:()=>null,
  contentSourceView:()=>'<section class="review-source">Pending submission</section>'
 });
 assert.match(html,/review-source/);
 assert.match(html,/发布到群组前/);
});

test('unavailable library preserves page and permits refresh retry',async()=>{
 let rendered=0,requests=0;
 const state={workspace:'ws-test',workspaces:[{id:'ws-test'}]};
 const context=vm.createContext({
  core:null,fb:null,workspace:'ws-test',route:'groups',libraryWorkspace:'',
  libraryItems:[{articleId:'OLD'}],libraryPicked:new Set(['OLD']),
  message:'',loadPromise:null,encodeURIComponent,
  get:async url=>{if(url.startsWith('/api/state'))return state;if(url.startsWith('/api/facebook'))return {};requests++;throw Error('Not connected');},
  render:()=>rendered++,document:{querySelector:()=>{throw Error('Full page replaced');}},
  localStorage:{removeItem(){}},esc:String
 });
 vm.runInContext(functionLine('load'),context);
 await vm.runInContext('load()',context);
 assert.equal(rendered,1);assert.equal(context.libraryItems.length,0);
 assert.match(context.message,/资料库暂不可用/);
 assert.equal(context.libraryWorkspace,'');
 await vm.runInContext('load()',context);assert.equal(requests,2);
});
