import {ContentLibrary,clientPublicPayload} from '../../Publisher-P0/src/content-library.ts';
import {homedir} from 'node:os';
import {join,basename,resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,statSync,realpathSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readGptDriveInbox,approveGptDriveItem} from './gpt-drive-inbox.js';

const digest=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export class GroupLibrary {
  constructor(store,{roots,snapshotRoot,library,gptInboxBase}={}){
    this.store=store;
    const socialRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),drive=dirname(socialRoot);
    this.roots=(roots||[join(socialRoot,'Content-Library'),join(drive,'VietBridge-Enterprise-Training')]).map(resolvePath=>resolve(resolvePath));
    this.gptInboxBase=gptInboxBase===undefined?(process.env.GPT_INBOX_BASE|| (roots?null:join(homedir(),'My Drive/Codex/VietBridge-GPT-Inbox'))):gptInboxBase;
    if(this.gptInboxBase&&!this.gptInboxBase.startsWith('/'))throw new Error('GPT_INBOX_BASE 必须为绝对路径');
    this.library=library||new ContentLibrary({roots:this.roots});
    this.cache=new Map();
    this.snapshotRoot=snapshotRoot||join(homedir(),'Library/Application Support/VietBridgeSocialOperatorV2/content-snapshots');
    store.db.exec(`CREATE TABLE IF NOT EXISTS group_library_imports(content_id TEXT PRIMARY KEY,workspace TEXT NOT NULL,article_id TEXT NOT NULL,version TEXT NOT NULL,source_root TEXT NOT NULL,fingerprint TEXT NOT NULL,source_json TEXT NOT NULL,UNIQUE(workspace,fingerprint))`);
    store.db.exec(`CREATE TABLE IF NOT EXISTS gpt_inbox_decisions(workspace TEXT NOT NULL,item_key TEXT NOT NULL,revision TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT,decided_at TEXT NOT NULL,PRIMARY KEY(workspace,item_key,revision))`);
  }
  authorize(workspace){this.store.requireWorkspace(workspace);if(workspace==='ws-vietbridge')return;this.clientRoot(workspace);}
  clientRoot(workspace){
    const row=this.store.list('workspaces').find(w=>w.id===workspace);
    const configured=String(row?.content_root||'');
    const clients=join(this.roots[0],'clients');
    if(!configured||!existsSync(configured))throw new Error('该客户尚未配置已同步的本机内容目录');
    const root=realpathSync(configured),base=realpathSync(clients),rel=relative(base,root);
    if(!rel||rel.startsWith('..')||rel.startsWith('/'))throw new Error('客户内容目录必须位于独立的 clients 资源库下');
    return root;
  }
  inboxRoot(root){return this.gptInboxBase?join(this.gptInboxBase,basename(root)):join(root,'GPT-INBOX');}
  allowed(path){const real=realpathSync(path);if(!this.roots.some(root=>{if(!existsSync(root))return false;const rel=relative(realpathSync(root),real);return rel&&!rel.startsWith('..')&&!rel.startsWith('/');}))throw new Error('资料不在企业培训资料库内');return real;}
  items(workspace,{refresh=false}={}){
    this.authorize(workspace);
    const cached=this.cache.get(workspace);
    if(!refresh&&cached&&Date.now()-cached.at<(workspace==='ws-vietbridge'?300000:15000)&&cacheAssetsCurrent(cached.items))return cached.items;
    if(workspace!=='ws-vietbridge'){
      const items=this.clientItems(workspace);
      this.cache.set(workspace,{at:Date.now(),items});
      return items;
    }
    const items=this.library.index().flatMap(p=>{
      const payloadPath=p.payloads.facebook;
      const body=payloadPath?readFileSync(this.allowed(payloadPath),'utf8').trim():'';
      const videos=p.assets.filter(a=>a.role==='video');
      const assets=(p.contentType==='video'?videos:p.assets.filter(a=>['cover','gallery_image'].includes(a.role))).sort((a,b)=>a.ordinal-b.ordinal);
      if(!body||!assets.length||videos.length>1)return [];
      // Selection includes completed Page material: group destination history
      // is independent and must not inherit V1 Page publication status.
      const metadata=assets.map(a=>{const path=this.allowed(a.path),s=statSync(path),sha256=createHash('sha256').update(readFileSync(path)).digest('hex');return {path,role:a.role,size:s.size,mtime:s.mtimeMs,sha256,revision:sha256,sourceDriveId:a.sourceDriveId};});
      const key=digest([p.articleId,p.packageRoot,p.version]);
      return [{key,revision:digest([body,metadata]),articleId:p.articleId,version:p.version,title:p.title,contentType:p.contentType,body,assets:metadata,packageRoot:p.packageRoot}];
    });
    this.cache.set(workspace,{at:Date.now(),items});
    return items;
  }
  clientItems(workspace){
    const root=this.clientRoot(workspace),manifestPath=join(root,'publisher-manifest.json');
    if(!existsSync(manifestPath))throw new Error('客户资源库缺少 publisher-manifest.json');
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
    if(!Array.isArray(manifest.items))throw new Error('客户内容清单格式无效');
    const approved=manifest.items.map(entry=>{
      const id=String(entry.content_id||''),contentPath=join(root,'READY/content',id+'.md');
      if(!/^[A-Z0-9-]+$/.test(id)||!existsSync(contentPath))throw new Error('客户内容文档缺失或编号无效：'+id);
      const source=readFileSync(contentPath,'utf8');
      const {body:publicBody,title}=clientPublicPayload(source);
      const media=entry.primary_image?[entry.primary_image]:[entry.cover||entry.asset_cover_path,entry.infographic||entry.asset_infographic_path];
      const hasCover=Boolean(media[0]),missingAssets=[];
      const assets=media.filter(Boolean).flatMap((name,i)=>{
        const path=resolve(root,String(name)),rel=relative(root,path);
        if(rel.startsWith('..')||rel.startsWith('/')||!existsSync(path)||!realpathSync(path).startsWith(realpathSync(root)+'/')){missingAssets.push(String(name));return [];}
        const s=statSync(path),sha256=createHash('sha256').update(readFileSync(path)).digest('hex');
        return [{path,role:i===0?'cover':'gallery_image',size:s.size,mtime:s.mtimeMs,sha256,revision:sha256}];
      });
      const documentStat=statSync(contentPath),manifestStat=statSync(manifestPath);
      const qaReady=String(manifest.status||'')==='READY'&&String(entry.status||'')==='READY';
      return {key:digest([workspace,id]),revision:digest([source,assets.map(a=>a.sha256)]),articleId:id,version:'client-current',title:title||String(entry.title||id),contentType:'image_text',body:publicBody,assets,packageRoot:root,sourcePath:contentPath,sourceMtime:documentStat.mtimeMs,sourceSize:documentStat.size,manifestPath,manifestMtime:manifestStat.mtimeMs,ready:Boolean(publicBody&&hasCover&&!missingAssets.length&&qaReady),blockingReason:!qaReady?'内容包尚未标记 READY':!hasCover?'缺少主图引用':missingAssets.length?'清单引用的图片文件不存在':publicBody?'':'缺少已批准的 Facebook 公开正文'};
    });
    const rejected=this.store.db.prepare("SELECT item_key,revision FROM gpt_inbox_decisions WHERE workspace=? AND decision='REJECTED'").all(workspace);
    const rejectedKeys=new Set(rejected.map(item=>`${item.item_key}:${item.revision}`));
    const inbox=readGptDriveInbox(root,manifest,this.inboxRoot(root)).filter(item=>!rejectedKeys.has(`${item.key}:${item.revision}`));
    return [...inbox,...approved];
  }
  approveGpt(workspace,key,revision){
    if(workspace==='ws-vietbridge')throw new Error('请先选择独立客户；默认企业资料库不接收 GPT Drive 投稿');
    const root=this.clientRoot(workspace),item=this.items(workspace,{refresh:true}).find(p=>p.key===key);
    if(!item||item.revision!==revision)throw new Error('待审核内容已变化，请刷新后重新查看');
    const result=approveGptDriveItem(root,item,this.inboxRoot(root));
    this.cache.delete(workspace);
    this.store.event(workspace,'gpt_drive_content_approved',result);
    return result;
  }
  rejectGpt(workspace,key,revision,reason=''){
    this.authorize(workspace);if(workspace==='ws-vietbridge')throw new Error('默认企业资料库不接收 GPT Drive 投稿');
    const item=this.items(workspace,{refresh:true}).find(p=>p.key===key);
    if(!item||item.revision!==revision)throw new Error('待审核内容已变化，请刷新后重新查看');
    if(item.reviewStatus!=='PENDING_REVIEW'||item.ready!==false)throw new Error('该内容当前不能拒绝');
    const note=String(reason||'').trim().slice(0,500),decidedAt=new Date().toISOString();
    this.store.db.prepare(`INSERT INTO gpt_inbox_decisions(workspace,item_key,revision,decision,reason,decided_at) VALUES(?,?,?,'REJECTED',?,?) ON CONFLICT(workspace,item_key,revision) DO UPDATE SET decision='REJECTED',reason=excluded.reason,decided_at=excluded.decided_at`).run(workspace,item.key,item.revision,note||null,decidedAt);
    this.store.event(workspace,'gpt_drive_content_rejected',{article_id:item.articleId,revision:item.revision,reason:note||null});
    this.cache.delete(workspace);
    return {article_id:item.articleId,revision:item.revision,status:'REJECTED'};
  }
  catalogue(workspace,query='',refresh=false){const q=String(query??'').toLowerCase().trim();return this.items(workspace,{refresh}).filter(p=>!q||`${p.articleId} ${p.title} ${p.body}`.toLowerCase().includes(q)).map(p=>({...p,assets:p.assets.map(a=>({name:basename(a.path),role:a.role,size:a.size,revision:a.revision,sourceDriveId:a.sourceDriveId}))}));}
  media(workspace,key,index,revision){const p=this.items(workspace).find(p=>p.key===key);if(!p||p.revision!==revision)throw new Error('资料版本已变化，请刷新资料库');const asset=p.assets[Number(index)];if(!asset)throw new Error('媒体不存在');return asset;}
  import(workspace,selections){
    this.authorize(workspace);if(!Array.isArray(selections)||!selections.length||selections.length>20)throw new Error('请选择 1–20 篇资料');
    const all=this.items(workspace),chosen=selections.map(s=>{const p=all.find(p=>p.key===s.key);if(!p||p.revision!==s.revision)throw new Error('所选资料版本已变化，请刷新后重新预览');if(p.ready===false)throw new Error(p.articleId+'：'+p.blockingReason);return p;});
    if(new Set(chosen.map(p=>p.articleId)).size!==chosen.length)throw new Error('同一内容编号只能选择一个图文或视频版本');
    const frozen=chosen.map(p=>{
      const assets=p.assets.map(a=>({...a,sha256:createHash('sha256').update(readFileSync(a.path)).digest('hex')}));
      const fingerprint=digest([p.articleId,p.version,p.body,assets.map(a=>a.sha256)]);
      const dir=join(this.snapshotRoot,fingerprint);mkdirSync(dir,{recursive:true});
      const media=assets.map((a,i)=>{const destination=join(dir,`${String(i+1).padStart(2,'0')}-${basename(a.path)}`);if(!existsSync(destination))copyFileSync(a.path,destination);if(createHash('sha256').update(readFileSync(destination)).digest('hex')!==a.sha256)throw new Error('冻结素材哈希不一致，已阻止导入');return destination;});
      return {p,assets,fingerprint,media};
    });
    return this.store.tx(()=>frozen.map(({p,assets,fingerprint,media})=>{
      const previous=this.store.db.prepare('SELECT content_id FROM group_library_imports WHERE workspace=? AND fingerprint=?').get(workspace,fingerprint);
      if(previous)return this.store.db.prepare('SELECT * FROM group_content WHERE id=? AND workspace=?').get(previous.content_id,workspace);
      const content=this.store.createContent(workspace,{title:`${p.articleId} · ${p.title} · ${p.version}`,body:p.body,media});
      this.store.db.prepare('INSERT INTO group_library_imports VALUES(?,?,?,?,?,?,?)').run(content.id,workspace,p.articleId,p.version,p.packageRoot,fingerprint,JSON.stringify({selection_revision:p.revision,assets}));
      this.store.event(workspace,'enterprise_library_imported',{content_id:content.id,article_id:p.articleId,version:p.version,fingerprint});
      return content;
    }));
  }
}

function cacheAssetsCurrent(items){
  try{return items.every(item=>(!item.sourcePath||(()=>{const s=statSync(item.sourcePath);return s.size===item.sourceSize&&s.mtimeMs===item.sourceMtime;})())&&(!item.manifestPath||statSync(item.manifestPath).mtimeMs===item.manifestMtime)&&item.assets.every(asset=>{const s=statSync(asset.path);return s.size===asset.size&&s.mtimeMs===asset.mtime;}));}
  catch{return false;}
}
