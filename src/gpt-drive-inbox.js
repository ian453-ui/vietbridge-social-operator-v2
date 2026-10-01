import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,realpathSync,statSync,copyFileSync,writeFileSync,renameSync} from 'node:fs';
import {basename,extname,join,relative,resolve} from 'node:path';

const hash=value=>createHash('sha256').update(value).digest('hex');
const within=(path,root)=>{const rel=relative(realpathSync(root),realpathSync(path));return Boolean(rel&&!rel.startsWith('..')&&!rel.startsWith('/'))};
const contentId=value=>/^[A-Z][A-Z0-9-]{3,80}$/.test(String(value||''));
const imageExt=new Set(['.png','.jpg','.jpeg','.webp']);

export function readGptDriveInbox(root,manifest,inboxRoot){
  const inbox=inboxRoot||join(root,'GPT-INBOX');
  if(!existsSync(inbox))return [];
  const existing=new Map((manifest.items||[]).map(item=>[item.content_id,item]));
  const candidates=readdirSync(inbox,{withFileTypes:true}).filter(entry=>entry.isDirectory()).flatMap(entry=>{
    const folder=join(inbox,entry.name),file=join(folder,'submission.json');
    if(!existsSync(file))return [];
    let parsedId,revisionNumber=1;
    try{
      if(!within(folder,inbox)||!within(file,folder)||statSync(file).size>100000)throw Error('提交文件路径或大小无效');
      const source=readFileSync(file,'utf8'),submission=JSON.parse(source);
      if(submission.schema_version!==1||submission.status!=='READY_FOR_REVIEW')throw Error('提交状态或格式版本无效');
      const id=String(submission.content_id||''),title=String(submission.title||'').trim(),body=String(submission.facebook_caption||'').trim();
      if(!contentId(id)||!title||title.length>200||/[\r\n]/.test(title)||!body||body.length>20000||/Visual package only|Use the approved.*body|BODY_INFOGRAPHIC_PLACEHOLDER/i.test(body))throw Error('内容编号、标题或 Facebook 正文无效');
      parsedId=id;
      revisionNumber=submission.revision_number??1;
      if(!Number.isSafeInteger(revisionNumber)||revisionNumber<1)throw Error('稿件版本号必须为正整数');
      const name=String(submission.primary_image||''),path=resolve(folder,name),ext=extname(name).toLowerCase();
      if(!name||!imageExt.has(ext)||!existsSync(path)||!within(path,folder))throw Error('主图缺失、格式不支持或不在提交目录内');
      const stat=statSync(path);if(!stat.isFile()||stat.size<100||stat.size>20000000)throw Error('主图大小无效');
      const imageHash=hash(readFileSync(path)),revision=hash(JSON.stringify([id,title,body,imageHash]));
      if((revisionNumber>1||submission.primary_image_sha256!==undefined)&&submission.primary_image_sha256!==imageHash)throw Error('新版主图尚未同步完成或校验失败');
      const collision=existing.has(id);
      return [{key:hash([folder,id].join('|')),revision,articleId:id,version:'gpt-drive-'+revision.slice(0,12),revisionNumber,title,contentType:'image_text',body,
        assets:[{path,role:'cover',size:stat.size,mtime:stat.mtimeMs,sha256:imageHash,revision:imageHash}],packageRoot:folder,
        ready:false,reviewStatus:collision?'UPDATE_AVAILABLE':'PENDING_REVIEW',blockingReason:collision?'检测到新版；已入库版本与现有发布任务保持不变。如需作为新内容入库，请使用新编号':'待您审核正文与主图',sourcePath:file}];
    }catch(error){return [{key:hash(folder),revision:'invalid',articleId:parsedId||entry.name,revisionNumber:Number.isSafeInteger(revisionNumber)&&revisionNumber>0?revisionNumber:Number.MAX_SAFE_INTEGER,version:'gpt-drive-invalid',title:entry.name,contentType:'image_text',body:'',assets:[],packageRoot:folder,ready:false,reviewStatus:'INVALID',blockingReason:String(error.message||error)}];}
  });
  const groups=new Map();
  for(const item of candidates){const group=groups.get(item.articleId)||[];group.push(item);groups.set(item.articleId,group);}
  return [...groups.values()].flatMap(group=>{
    const latest=Math.max(...group.map(item=>item.revisionNumber));
    const versions=group.filter(item=>item.revisionNumber===latest).sort((a,b)=>a.packageRoot.localeCompare(b.packageRoot));
    const invalid=versions.find(item=>item.reviewStatus==='INVALID');
    if(invalid)return [invalid];
    const item=versions[0];
    if(new Set(versions.map(row=>row.revision)).size>1)return [{...item,reviewStatus:'VERSION_CONFLICT',blockingReason:'同一版本号存在不同内容，请为新版增加 revision_number'}];
    if(existing.get(item.articleId)?.gpt_source_revision===item.revision)return [];
    return [item];
  });
}

export function approveGptDriveItem(root,item,inboxRoot){
  if(item.reviewStatus!=='PENDING_REVIEW'||item.ready!==false)throw Error('该内容不能审核通过');
  const manifestPath=join(root,'publisher-manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(manifest.status!=='READY'||!Array.isArray(manifest.items))throw Error('客户资料库清单尚未就绪');
  if((manifest.items||[]).some(entry=>entry.content_id===item.articleId))throw Error('内容编号已存在，不能覆盖原版本');
  const current=readGptDriveInbox(root,manifest,inboxRoot).find(entry=>entry.key===item.key);
  if(!current||current.revision!==item.revision)throw Error('Drive 内容已改变，请刷新后重新审核');
  const extension=extname(item.assets[0].path).toLowerCase(),assetName=`${item.articleId}_gpt_${item.revision.slice(0,12)}${extension}`;
  const assetRel=`READY/assets/${assetName}`,assetPath=join(root,assetRel),contentRel=`READY/content/${item.articleId}.md`,contentPath=join(root,contentRel);
  const publicBody=`# ${item.title}\n\n${item.body}\n`;
  if(existsSync(assetPath)&&hash(readFileSync(assetPath))!==item.assets[0].sha256)throw Error('目标主图与本次审核版本冲突');
  if(existsSync(contentPath)&&readFileSync(contentPath,'utf8')!==publicBody)throw Error('目标正文与本次审核版本冲突');
  if(!existsSync(assetPath))copyFileSync(item.assets[0].path,assetPath);
  if(hash(readFileSync(assetPath))!==item.assets[0].sha256)throw Error('主图复制后校验失败');
  if(!existsSync(contentPath))writeFileSync(contentPath,publicBody,{flag:'wx'});
  manifest.items.push({content_id:item.articleId,title:item.title,status:'READY',body_source:contentRel,primary_image:assetRel,publish_channel:'facebook',gpt_source_revision:item.revision,reviewed_at:new Date().toISOString(),reviewed_by:'user_local_ui'});
  const temp=join(root,`.publisher-manifest.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  renameSync(temp,manifestPath);
  return {article_id:item.articleId,revision:item.revision};
}
