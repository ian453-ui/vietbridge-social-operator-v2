import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.js';
import {GroupLibrary} from '../src/library.js';
import {ContentLibrary} from '../../Publisher-P0/src/content-library.ts';
test('library reuses public payload, freezes bytes, deduplicates imports and creates content × group jobs',()=>{
  const root=mkdtempSync(join(tmpdir(),'v2-library-')),image=join(root,'poster.png');writeFileSync(image,'original media bytes');
  const store=new Store(join(root,'db.sqlite'));
  let body='Facebook 公开正文';const caption=join(root,'Daily-019-facebook-public.txt');writeFileSync(caption,body);
  const library={index:()=>[{articleId:'Daily-019',version:'v1',title:'企业培训',contentType:'image_text',packageRoot:root,assets:[{path:image,role:'gallery_image',ordinal:1}],payloads:{facebook:caption,xiaohongshu:'不要带入小红书文案'},publishedPlatforms:['facebook']}]};
  const bridge=new GroupLibrary(store,{roots:[root],snapshotRoot:join(root,'frozen'),library});
  try{
    const items=bridge.catalogue('ws-vietbridge');assert.equal(items.length,1);assert.equal(items[0].body,body);
    const firstRevision=items[0].assets[0].revision;assert.match(firstRevision,/^[a-f0-9]{64}$/);
    assert.equal(bridge.catalogue('ws-vietbridge',null).length,1);
    assert.throws(()=>bridge.catalogue('ws-abc'),/尚未配置/);
    const selection={key:items[0].key,revision:items[0].revision};
    const [content]=bridge.import('ws-vietbridge',[selection]);assert.equal(content.body,body);
    assert.equal(bridge.import('ws-vietbridge',[selection])[0].id,content.id);
    const frozen=JSON.parse(content.media_json)[0];writeFileSync(image,'changed media bytes');assert.equal(readFileSync(frozen,'utf8'),'original media bytes');
    const refreshed=bridge.catalogue('ws-vietbridge')[0];assert.notEqual(refreshed.assets[0].revision,firstRevision);assert.notEqual(refreshed.revision,items[0].revision);
    assert.throws(()=>bridge.import('ws-vietbridge',[selection]),/版本已变化/);
    const profile=store.saveProfile('ws-vietbridge',{name:'FB',cdp_port:19325,user_data_dir:join(root,'profile')});
    const account=store.saveAccount('ws-vietbridge',{display_name:'VB',profile_id:profile.id});
    const groups=[1,2].map(i=>store.addGroup('ws-vietbridge',{account_id:account.id,url:'https://www.facebook.com/groups/'+i}));
    const manual=store.createContent('ws-vietbridge',{title:'手工内容',body:'手工正文'});
    const input={account_id:account.id,content_ids:[content.id,manual.id],group_ids:groups.map(g=>g.id)};
    const first=store.createGroupJobs('ws-vietbridge',input);assert.equal(first.length,4);assert.equal(first.filter(j=>j.was_created).length,4);
    const duplicate=store.createGroupJobs('ws-vietbridge',input);assert.equal(duplicate.length,4);assert.equal(duplicate.filter(j=>j.was_created).length,0);
    assert.equal(store.rows('group_jobs','ws-vietbridge').length,4);
    assert.ok(store.rows('group_jobs','ws-vietbridge').every(j=>j.state==='PENDING'));
  }finally{store.close();}
});

test('independent client package stays isolated and visual-only copy cannot be imported',()=>{
  const root=mkdtempSync(join(tmpdir(),'v2-client-library-'));
  const client=join(root,'clients','lp'),content=join(client,'READY','content'),assets=join(client,'READY','assets');
  mkdirSync(content,{recursive:true});mkdirSync(assets,{recursive:true});
  writeFileSync(join(content,'CNVISA-FB-001.md'),'---\ncontent_id: CNVISA-FB-001\n---\n# Visa\nVisual package only. Use the approved Vietnamese Facebook body associated with this content_id.');
  writeFileSync(join(assets,'cover.png'),'cover bytes');writeFileSync(join(assets,'body.png'),'body bytes');
  writeFileSync(join(client,'publisher-manifest.json'),JSON.stringify({status:'READY',items:[{content_id:'CNVISA-FB-001',status:'READY',title:'Visa',cover:'READY/assets/cover.png',infographic:'READY/assets/body.png'}]}));
  const store=new Store(join(root,'db.sqlite'));
  try{
    const workspace=store.saveWorkspace({name:'LP',brand:'LP',content_root:client});
    const library=new GroupLibrary(store,{roots:[root],snapshotRoot:join(root,'snapshots'),library:{index:()=>[]}});
    const [item]=library.catalogue(workspace.id);
    assert.equal(item.ready,false);assert.equal(item.assets.length,2);
    assert.throws(()=>library.import(workspace.id,[{key:item.key,revision:item.revision}]),/缺少已批准/);
    writeFileSync(join(content,'CNVISA-FB-001.md'),'---\ncontent_id: CNVISA-FB-001\n---\n# Visa\nĐây là nội dung Facebook công khai đã duyệt.');
    const [updated]=library.catalogue(workspace.id);
    assert.equal(updated.ready,true);assert.notEqual(updated.revision,item.revision);
    assert.throws(()=>library.catalogue('ws-abc'),/尚未配置/);
  }finally{store.close();}
});

test('client revision 4 selects approved caption and one primary image',()=>{
  const root=mkdtempSync(join(tmpdir(),'v2-client-rev4-'));
  const client=join(root,'clients','lp'),content=join(client,'READY','content'),assets=join(client,'READY','assets');
  mkdirSync(content,{recursive:true});mkdirSync(assets,{recursive:true});
  writeFileSync(join(content,'CNVISA-FB-001.md'),'---\ncontent_id: CNVISA-FB-001\npublish_title: Public title\npublish_caption: |-\n  Approved caption\n  Final CTA\n---\n# Old title\nStale body');
  writeFileSync(join(assets,'primary.png'),'primary bytes');writeFileSync(join(assets,'cover.png'),'old cover');
  writeFileSync(join(client,'publisher-manifest.json'),JSON.stringify({status:'READY',items:[{content_id:'CNVISA-FB-001',status:'READY',primary_image:'READY/assets/primary.png',cover:'READY/assets/cover.png'}]}));
  const store=new Store(join(root,'db.sqlite'));
  try{const workspace=store.saveWorkspace({name:'LP',brand:'LP',content_root:client});const library=new GroupLibrary(store,{roots:[root],snapshotRoot:join(root,'snapshots')});const [item]=library.catalogue(workspace.id);
    assert.equal(item.ready,true);assert.equal(item.body,'Approved caption\nFinal CTA');assert.equal(item.title,'Public title');
    assert.deepEqual(item.assets.map(a=>a.name),['primary.png']);
    const [imported]=library.import(workspace.id,[{key:item.key,revision:item.revision}]);assert.equal(imported.body,item.body);
    assert.deepEqual(JSON.parse(imported.media_json).map(p=>readFileSync(p,'utf8')),['primary bytes']);
  }finally{store.close();}
});

test('GPT Drive submission appears for review and only explicit approval adds it to the publisher library',()=>{
  const root=mkdtempSync(join(tmpdir(),'v2-gpt-inbox-')),client=join(root,'clients','lp'),content=join(client,'READY','content'),assets=join(client,'READY','assets'),inbox=join(client,'GPT-INBOX','draft-001');
  mkdirSync(content,{recursive:true});mkdirSync(assets,{recursive:true});mkdirSync(inbox,{recursive:true});
  writeFileSync(join(client,'publisher-manifest.json'),JSON.stringify({status:'READY',items:[]}));
  writeFileSync(join(inbox,'cover.png'),Buffer.alloc(512,1));
  writeFileSync(join(inbox,'submission.json'),JSON.stringify({schema_version:1,status:'READY_FOR_REVIEW',content_id:'LP-FB-011',title:'Travel planning',facebook_caption:'Approved only after review.',primary_image:'cover.png'}));
  const store=new Store(join(root,'db.sqlite'));
  try{const workspace=store.saveWorkspace({name:'LP',brand:'LP',content_root:client}),library=new GroupLibrary(store,{roots:[root],snapshotRoot:join(root,'snapshots')});
    const [pending]=library.catalogue(workspace.id);assert.equal(pending.reviewStatus,'PENDING_REVIEW');assert.equal(pending.ready,false);
    assert.throws(()=>library.import(workspace.id,[{key:pending.key,revision:pending.revision}]),/待您审核/);
    assert.equal(store.rows('group_jobs',workspace.id).length,0);
    library.approveGpt(workspace.id,pending.key,pending.revision);
    const [approved]=library.catalogue(workspace.id);assert.equal(approved.ready,true);assert.equal(approved.articleId,'LP-FB-011');
    const v1=new ContentLibrary({roots:[root]});assert.equal(v1.index().find(item=>item.articleId==='LP-FB-011')?.readiness,'READY');
    assert.equal(store.rows('group_jobs',workspace.id).length,0);
    assert.throws(()=>library.approveGpt(workspace.id,pending.key,pending.revision),/待审核内容已变化/);
  }finally{store.close();}
});

test('rejecting a GPT Drive draft hides only that exact revision and preserves its source',()=>{
  const root=mkdtempSync(join(tmpdir(),'v2-gpt-reject-')),client=join(root,'clients','lp'),content=join(client,'READY','content'),assets=join(client,'READY','assets'),inbox=join(client,'GPT-INBOX','draft-001');
  mkdirSync(content,{recursive:true});mkdirSync(assets,{recursive:true});mkdirSync(inbox,{recursive:true});
  writeFileSync(join(client,'publisher-manifest.json'),JSON.stringify({status:'READY',items:[]}));
  const image=Buffer.alloc(512,7),submission=join(inbox,'submission.json'),imagePath=join(inbox,'cover.png');
  writeFileSync(imagePath,image);
  writeFileSync(submission,JSON.stringify({schema_version:1,status:'READY_FOR_REVIEW',content_id:'LP-FB-012',title:'Travel planning',facebook_caption:'Review this draft.',primary_image:'cover.png'}));
  const original=readFileSync(submission,'utf8'),store=new Store(join(root,'db.sqlite'));
  try{
    const workspace=store.saveWorkspace({name:'LP',brand:'LP',content_root:client}),library=new GroupLibrary(store,{roots:[root],snapshotRoot:join(root,'snapshots')});
    const [pending]=library.catalogue(workspace.id);assert.equal(pending.reviewStatus,'PENDING_REVIEW');
    assert.throws(()=>library.rejectGpt(workspace.id,pending.key,'stale-revision'),/已变化/);
    assert.equal(library.rejectGpt(workspace.id,pending.key,pending.revision).status,'REJECTED');
    assert.equal(library.catalogue(workspace.id,'',true).length,0);
    assert.equal(readFileSync(submission,'utf8'),original);assert.deepEqual(readFileSync(imagePath),image);
    const restarted=new GroupLibrary(store,{roots:[root],snapshotRoot:join(root,'snapshots')});assert.equal(restarted.catalogue(workspace.id,'',true).length,0);
    writeFileSync(submission,JSON.stringify({schema_version:1,status:'READY_FOR_REVIEW',content_id:'LP-FB-012',revision_number:2,title:'Travel planning',facebook_caption:'Revised draft.',primary_image:'cover.png',primary_image_sha256:createHash('sha256').update(image).digest('hex')}));
    const [newRevision]=restarted.catalogue(workspace.id,'',true);assert.equal(newRevision.reviewStatus,'PENDING_REVIEW');assert.notEqual(newRevision.revision,pending.revision);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM events WHERE workspace=? AND event='gpt_drive_content_rejected'").get(workspace.id).count,1);
  }finally{store.close();}
});
