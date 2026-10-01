import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/client.js',import.meta.url),'utf8');
const functionLine=name=>source.split('\n').find(line=>line.startsWith(`function ${name}(`)||line.startsWith(`async function ${name}(`));

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
