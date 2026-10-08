import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('every shipped browser module parses as a complete module',()=>{
 for(const name of ['client.js','unified-client.js','publisher-form-state.js','group-selection.js','group-filters.js','publisher-access-ui.js','publication-selection.js']){
  const path=fileURLToPath(new URL('../src/'+name,import.meta.url));
  const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
  assert.equal(result.status,0,name+': '+result.stderr);
 }
});
test('group confirmation belongs inside the task function, before any request',()=>{
 const source=readFileSync(new URL('../src/client.js',import.meta.url),'utf8');
 const start=source.indexOf('async function createGroupTasks('),end=source.indexOf('\nlet groupRefreshTimer',start);
 const functionSource=source.slice(start,end);
 const prompt=source.indexOf("if(autoPublish&&!window.confirm(");
 assert.ok(prompt>start&&prompt<end);
 assert.ok(functionSource.indexOf('window.confirm(')<functionSource.indexOf('await request('));
});
