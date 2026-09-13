import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { initialState } from './domain.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { throw new Error(message); };
export class Store {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT, workspace TEXT, value TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, workspace TEXT, event TEXT, value TEXT, created_at TEXT);
      CREATE TABLE IF NOT EXISTS receipts(task TEXT PRIMARY KEY, workspace TEXT, hash TEXT, outcome TEXT);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, task TEXT, workspace TEXT, intent TEXT, phase TEXT);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, content TEXT, workspace TEXT, body TEXT, hash TEXT);
      CREATE TABLE IF NOT EXISTS facebook_accounts(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, display_name TEXT NOT NULL, identity_type TEXT NOT NULL, external_id TEXT, profile_id TEXT NOT NULL, expected_identity TEXT NOT NULL, session_health TEXT NOT NULL, identity_verified_at TEXT, last_group_sync_at TEXT, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS execution_profiles(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, name TEXT NOT NULL, cdp_port INTEGER NOT NULL UNIQUE, user_data_dir TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'STOPPED', last_error TEXT);
      CREATE TABLE IF NOT EXISTS facebook_groups(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, account_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, external_id TEXT, membership_status TEXT NOT NULL, last_seen_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, tags TEXT, notes TEXT, UNIQUE(account_id,url));
      CREATE TABLE IF NOT EXISTS group_content(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT, body TEXT NOT NULL, media_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS group_jobs(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, account_id TEXT NOT NULL, group_id TEXT NOT NULL, content_id TEXT NOT NULL, expected_identity TEXT NOT NULL, profile_id TEXT NOT NULL, state TEXT NOT NULL, attempt_id TEXT, last_action TEXT, evidence_json TEXT NOT NULL, post_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(account_id,group_id,content_id));
      CREATE TABLE IF NOT EXISTS published_posts(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, account_id TEXT NOT NULL, group_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE, post_url TEXT NOT NULL, observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fb_comments(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, account_id TEXT NOT NULL, post_id TEXT NOT NULL, external_id TEXT, fingerprint TEXT NOT NULL, parent_id TEXT, author TEXT NOT NULL, body TEXT NOT NULL, observed_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, reply_state TEXT NOT NULL DEFAULT 'UNREPLIED', UNIQUE(post_id,fingerprint));
      CREATE TABLE IF NOT EXISTS reply_intents(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, comment_id TEXT NOT NULL, account_id TEXT NOT NULL, body TEXT NOT NULL, body_hash TEXT NOT NULL, state TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(comment_id,body_hash));
    `);
    if (!this.db.prepare('SELECT 1 FROM records LIMIT 1').get()) this.seed();
    this.db.prepare("UPDATE attempts SET phase='UNKNOWN' WHERE phase='SUBMITTED'").run();
    for (const t of this.list('tasks')) if(t.state==='SUBMITTED') { t.state='UNKNOWN'; this.put('tasks',t); }
  }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r=fn();this.db.exec('COMMIT');return r; } catch(e){this.db.exec('ROLLBACK');throw e;} }
  put(kind,x){this.db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?)').run(kind,x.id,x.workspaceId??null,JSON.stringify(x));return x;}
  list(kind,workspace){return (workspace===undefined?this.db.prepare('SELECT value FROM records WHERE kind=?').all(kind):this.db.prepare('SELECT value FROM records WHERE kind=? AND workspace=?').all(kind,workspace)).map(r=>JSON.parse(r.value));}
  get(kind,id,workspace){const x=this.list(kind,workspace).find(x=>x.id===id);return x??fail('对象不属于当前客户或不存在');}
  event(workspace,event,value){this.db.prepare('INSERT INTO events(workspace,event,value,created_at) VALUES(?,?,?,?)').run(workspace,event,JSON.stringify(value),new Date().toISOString());}
  seed(){const s=initialState();this.tx(()=>{for(const kind of ['workspaces','content','tasks','groups','comments','leads']) for(const x of s[kind]) {
    if(kind==='tasks'){const c=s.content.find(c=>c.id===x.contentId);if(c?.workspaceId!==x.workspaceId)x.contentId=s.content.find(c=>c.workspaceId===x.workspaceId).id;x.state='READY';x.identityOk=true;x.executionProfileOk=true;x.revisionValid=true;x.reason='';x.approved=false;x.version=1;}
    this.put(kind,x);
  }});}
  view(workspace){const workspaces=this.list('workspaces');if(!workspace)return {mode:'agency',workspaceId:null,workspaces,content:[],tasks:[],groups:[],comments:[],leads:[],audit:[],summary:workspaces.map(w=>({id:w.id,name:w.name,tasks:this.list('tasks',w.id).length}))};
    if(!workspaces.some(w=>w.id===workspace))fail('客户不存在');
    const out={mode:'workspace',workspaceId:workspace,workspaces};for(const k of ['content','tasks','groups','comments','leads'])out[k]=this.list(k,workspace);out.audit=this.db.prepare('SELECT event,value,created_at FROM events WHERE workspace=? ORDER BY seq DESC LIMIT 50').all(workspace);return out;}
  facebookView(workspace){this.requireWorkspace(workspace);return {accounts:this.rows('facebook_accounts',workspace),profiles:this.rows('execution_profiles',workspace),facebookGroups:this.rows('facebook_groups',workspace),groupContent:this.rows('group_content',workspace).map(x=>({...x,media:JSON.parse(x.media_json)})),groupJobs:this.rows('group_jobs',workspace).map(x=>({...x,evidence:JSON.parse(x.evidence_json)})),publishedPosts:this.rows('published_posts',workspace),facebookComments:this.rows('fb_comments',workspace),replyIntents:this.rows('reply_intents',workspace).map(x=>({...x,evidence:JSON.parse(x.evidence_json)}))};}
  rows(table,workspace){return this.db.prepare(`SELECT * FROM ${table} WHERE workspace=? ORDER BY rowid DESC`).all(workspace).map(x=>({...x,enabled:x.enabled===undefined?undefined:Boolean(x.enabled)}));}
  requireWorkspace(workspace){if(!this.list('workspaces').some(x=>x.id===workspace))fail('客户不存在');}
  saveAccount(workspace,input){this.requireWorkspace(workspace);const id=input.id||randomUUID(),name=String(input.display_name||'').trim(),profileId=String(input.profile_id||'').trim(),expected=String(input.expected_identity||name).trim();if(!name||!profileId||!expected)fail('账号名称、执行环境和预期身份不能为空');const current=input.id?this.db.prepare('SELECT * FROM facebook_accounts WHERE id=? AND workspace=?').get(id,workspace):null;if(input.id&&!current)fail('账号不属于当前客户或不存在');this.tx(()=>{if(!this.db.prepare('SELECT 1 FROM execution_profiles WHERE id=? AND workspace=?').get(profileId,workspace))fail('执行环境不属于当前客户');this.db.prepare(`INSERT OR REPLACE INTO facebook_accounts VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,workspace,name,input.identity_type||'PROFILE',input.external_id||null,profileId,expected,current?.session_health||'UNKNOWN',current?.identity_verified_at||null,current?.last_group_sync_at||null,input.enabled===false?0:1);this.event(workspace,current?'account_updated':'account_created',{id});});return this.db.prepare('SELECT * FROM facebook_accounts WHERE id=?').get(id);}
  saveProfile(workspace,input){this.requireWorkspace(workspace);const id=input.id||randomUUID(),name=String(input.name||'').trim(),port=Number(input.cdp_port);if(!name||!Number.isInteger(port)||port<1024||port>65535)fail('执行环境名称或调试端口无效');const dir=String(input.user_data_dir||'').trim();if(!dir)fail('Chrome 数据目录不能为空');this.db.prepare(`INSERT OR REPLACE INTO execution_profiles(id,workspace,name,cdp_port,user_data_dir,status,last_error) VALUES(?,?,?,?,?,COALESCE((SELECT status FROM execution_profiles WHERE id=?),'STOPPED'),COALESCE((SELECT last_error FROM execution_profiles WHERE id=?),NULL))`).run(id,workspace,name,port,dir,id,id);return this.db.prepare('SELECT * FROM execution_profiles WHERE id=?').get(id);}
  addGroup(workspace,input){this.requireWorkspace(workspace);const account=this.account(workspace,input.account_id),url=normalizeGroupUrl(input.url),id=input.id||randomUUID(),time=new Date().toISOString();this.db.prepare(`INSERT INTO facebook_groups VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,url) DO UPDATE SET name=excluded.name,membership_status='JOINED',last_seen_at=excluded.last_seen_at`).run(id,workspace,account.id,String(input.name||url).trim(),url,groupId(url),'JOINED',time,input.enabled===false?0:1,input.tags||null,input.notes||null);return this.db.prepare('SELECT * FROM facebook_groups WHERE account_id=? AND url=?').get(account.id,url);}
  syncGroups(workspace,accountId,groups){const account=this.account(workspace,accountId),time=new Date().toISOString();return this.tx(()=>{this.db.prepare("UPDATE facebook_groups SET membership_status='STALE' WHERE workspace=? AND account_id=?").run(workspace,accountId);for(const g of groups)this.addGroup(workspace,{...g,account_id:accountId});this.db.prepare("UPDATE facebook_accounts SET last_group_sync_at=?,session_health='HEALTHY',identity_verified_at=? WHERE id=?").run(time,time,account.id);return this.rows('facebook_groups',workspace).filter(x=>x.account_id===accountId);});}
  createContent(workspace,input){this.requireWorkspace(workspace);const body=String(input.body||'').trim(),media=(input.media||[]).map(String);if(!body&&!media.length)fail('正文或媒体至少需要一项');const id=randomUUID(),contentHash=hash({body,media});this.db.prepare('INSERT INTO group_content VALUES(?,?,?,?,?,?,?)').run(id,workspace,String(input.title||'').trim(),body,JSON.stringify(media),contentHash,new Date().toISOString());return this.db.prepare('SELECT * FROM group_content WHERE id=?').get(id);}
  createGroupJobs(workspace,input){const account=this.account(workspace,input.account_id),content=this.db.prepare('SELECT * FROM group_content WHERE id=? AND workspace=?').get(input.content_id,workspace);if(!content)fail('内容不属于当前客户');const ids=[...new Set(input.group_ids||[])];if(!ids.length)fail('至少选择一个群组');return this.tx(()=>ids.map(groupId=>{const group=this.db.prepare('SELECT * FROM facebook_groups WHERE id=? AND workspace=? AND account_id=? AND enabled=1').get(groupId,workspace,account.id);if(!group)fail('群组不属于所选账号或已停用');const id=randomUUID(),time=new Date().toISOString();this.db.prepare(`INSERT OR IGNORE INTO group_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,workspace,account.id,group.id,content.id,account.expected_identity,account.profile_id,'PENDING',null,'任务已创建',JSON.stringify({content_hash:content.content_hash}),null,time,time);return this.db.prepare('SELECT * FROM group_jobs WHERE account_id=? AND group_id=? AND content_id=?').get(account.id,group.id,content.id);}));}
  beginPrepare(workspace,jobId,actualIdentity){return this.tx(()=>{const job=this.job(workspace,jobId),account=this.account(workspace,job.account_id);if(!['PENDING','FAILED','BLOCKED'].includes(job.state))fail('当前任务不能重新准备');if(account.expected_identity!==actualIdentity)fail('实际 Facebook 身份与账号配置不一致，已在写入前阻止');const attempt=randomUUID(),time=new Date().toISOString();this.db.prepare("UPDATE group_jobs SET state='PREPARING',attempt_id=?,last_action='正在准备真实群组编辑器',updated_at=? WHERE id=?").run(attempt,time,jobId);return this.job(workspace,jobId);});}
  finishPrepare(workspace,jobId,evidence){const job=this.job(workspace,jobId);if(job.state!=='PREPARING')fail('任务不在准备状态');this.db.prepare("UPDATE group_jobs SET state='WAITING_FOR_USER',last_action='内容已核对，等待人工最终点击',evidence_json=?,updated_at=? WHERE id=?").run(JSON.stringify(evidence),new Date().toISOString(),jobId);return this.job(workspace,jobId);}
  markUnknown(workspace,jobId,reason){const job=this.job(workspace,jobId);if(!['PREPARING','WAITING_FOR_USER','PROCESSING'].includes(job.state))fail('当前任务不能标记未知');this.db.prepare("UPDATE group_jobs SET state='UNKNOWN',last_action=?,updated_at=? WHERE id=?").run(reason||'提交结果不确定，必须先核对',new Date().toISOString(),jobId);return this.job(workspace,jobId);}
  claimPost(workspace,jobId,url){return this.tx(()=>{const job=this.job(workspace,jobId);if(!['WAITING_FOR_USER','PROCESSING','UNKNOWN'].includes(job.state))fail('当前任务不能登记发布结果');const postUrl=normalizeFacebookUrl(url),id=randomUUID(),time=new Date().toISOString();this.db.prepare('INSERT OR REPLACE INTO published_posts VALUES(?,?,?,?,?,?,?)').run(id,workspace,job.account_id,job.group_id,job.id,postUrl,time);this.db.prepare("UPDATE group_jobs SET state='PUBLISHED',post_url=?,last_action='发布链接已登记，等待或已完成回读',updated_at=? WHERE id=?").run(postUrl,time,job.id);return this.job(workspace,job.id);});}
  upsertComments(workspace,postId,items){const post=this.db.prepare('SELECT * FROM published_posts WHERE id=? AND workspace=?').get(postId,workspace);if(!post)fail('发布记录不属于当前客户');const time=new Date().toISOString();return this.tx(()=>items.map(item=>{const body=String(item.body||'').trim(),author=String(item.author||'').trim();if(!body||!author)fail('评论作者和正文不能为空');const fp=item.external_id||hash([post.post_url,item.parent_id||'',author,body]),id=randomUUID();this.db.prepare(`INSERT INTO fb_comments VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(post_id,fingerprint) DO UPDATE SET last_seen_at=excluded.last_seen_at,body=excluded.body,author=excluded.author`).run(id,workspace,post.account_id,post.id,item.external_id||null,fp,item.parent_id||null,author,body,item.observed_at||time,time,'UNREPLIED');return this.db.prepare('SELECT * FROM fb_comments WHERE post_id=? AND fingerprint=?').get(post.id,fp);}));}
  createReplyIntent(workspace,commentId,body){const comment=this.db.prepare('SELECT * FROM fb_comments WHERE id=? AND workspace=?').get(commentId,workspace);if(!comment)fail('评论不属于当前客户');const text=String(body||'').trim();if(!text)fail('回复不能为空');const digest=hash(text),existing=this.db.prepare('SELECT * FROM reply_intents WHERE comment_id=? AND body_hash=?').get(commentId,digest);if(existing)fail('相同回复已存在，禁止重复发送');const id=randomUUID(),time=new Date().toISOString();this.db.prepare('INSERT INTO reply_intents VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,workspace,commentId,comment.account_id,text,digest,'PENDING',JSON.stringify({}),time,time);return this.db.prepare('SELECT * FROM reply_intents WHERE id=?').get(id);}
  account(workspace,id){return this.db.prepare('SELECT * FROM facebook_accounts WHERE id=? AND workspace=? AND enabled=1').get(id,workspace)||fail('Facebook 账号不属于当前客户或已停用');}
  job(workspace,id){return this.db.prepare('SELECT * FROM group_jobs WHERE id=? AND workspace=?').get(id,workspace)||fail('群组任务不属于当前客户');}
  command(workspace,kind,id,action,input={}){if(!workspace)fail('请先进入客户，Agency 不能执行');return this.tx(()=>{
    const x=this.get(kind,id,workspace);
    if(kind==='content'&&action==='revise'){
      const body=String(input.body??'').trim();if(!body)fail('正文不能为空');
      const revision=randomUUID();this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?)').run(revision,id,workspace,body,hash(body));x.body=body;x.revision=revision;x.hash=hash(body);this.put(kind,x);
      for(const t of this.list('tasks',workspace).filter(t=>t.contentId===id&&!['PUBLISHED','REPLIED','DRAFT_WRITTEN'].includes(t.state))){t.revisionValid=false;t.approved=false;this.put('tasks',t);}
    } else if(kind==='comments'&&action==='reply'){
      if(!input.body?.trim())fail('回复不能为空');if(x.intent==='RISK_QUESTION')fail('具体风险问题需人工审核');
      if(this.list('tasks',workspace).some(t=>t.commentId===id))fail('该评论已有回复任务');
      this.put('tasks',{id:randomUUID(),workspaceId:workspace,commentId:id,body:input.body,platform:'Facebook Group',state:'READY',identityOk:true,executionProfileOk:true,revisionValid:true,approved:false,version:1});x.state='REPLY_DRAFTED';this.put(kind,x);
    } else if(kind==='tasks'){
      if(input.version!==x.version)fail('任务版本已变化，请刷新');
      const c=x.contentId?this.get('content',x.contentId,workspace):null;
      if(action==='approve'){
        if(!['READY','NEEDS_REVIEW'].includes(x.state))fail('当前状态不能重新审批');x.approved=true;x.revisionValid=true;x.scope=hash([c?.hash,x.body,x.platform,workspace]);x.state='READY';
      }else if(action==='prepare'){
        if(x.state!=='READY')fail('任务已执行或待核对，不能重复准备');
        if(!x.identityOk||!x.executionProfileOk)fail('身份或执行环境不匹配，写入前阻止');
        if(!x.approved||!x.revisionValid||x.scope!==hash([c?.hash,x.body,x.platform,workspace]))fail('请审核当前内容版本');
        if(this.list('tasks',workspace).some(t=>t.id!==id&&['COMPOSER_READY','SUBMITTED','UNKNOWN'].includes(t.state)))fail('当前客户执行环境被占用，请先处理活动任务');
        x.attempt=randomUUID();this.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?)').run(x.attempt,id,workspace,x.scope,'PREPARED');x.state='COMPOSER_READY';
      }else if(action==='submit'){
        if(x.state!=='COMPOSER_READY'||!x.revisionValid)fail('必须先完成有效预检');
        this.db.prepare("UPDATE attempts SET phase='SUBMITTED' WHERE id=?").run(x.attempt);x.state='SUBMITTED';
        // Mock adapter stores independent evidence; caller cannot supply a success boolean.
        if(input.simulate!=='unknown')this.db.prepare('INSERT OR REPLACE INTO receipts VALUES(?,?,?,?)').run(id,workspace,x.scope,x.commentId?'REPLIED':x.platform==='公众号'?'DRAFT_WRITTEN':'PUBLISHED');
      }else if(action==='reconcile'){
        if(!['SUBMITTED','UNKNOWN'].includes(x.state))fail('当前状态不能对账');const r=this.db.prepare('SELECT * FROM receipts WHERE task=? AND workspace=?').get(id,workspace);
        x.state=r&&r.hash===x.scope?r.outcome:'UNKNOWN';x.reason=x.state==='UNKNOWN'?'没有足够证据；禁止重新提交':'模拟平台独立回执已核对';
        this.db.prepare('UPDATE attempts SET phase=? WHERE id=?').run(x.state,x.attempt);
      }else if(action==='cancel'){
        if(!['READY','COMPOSER_READY','NEEDS_REVIEW'].includes(x.state))fail('可能已提交，不能取消');x.state='SKIPPED';
      }else fail('不支持的任务操作');
      x.version++;this.put(kind,x);
    }else fail('不支持的操作');
    this.event(workspace,action,{kind,id,state:x.state,revision:x.revision});return x;
  });}
  close(){this.db.close();}
}
function normalizeFacebookUrl(value){const u=new URL(String(value));if(!/(^|\.)facebook\.com$/.test(u.hostname))fail('必须使用 Facebook 链接');u.protocol='https:';u.hash='';return u.toString();}
function normalizeGroupUrl(value){const u=new URL(normalizeFacebookUrl(value));if(!/\/(groups\/[^/?#]+|share\/g\/[^/?#]+)/.test(u.pathname))fail('请输入 Facebook 群组链接');u.search='';return u.toString().replace(/\/$/,'');}
function groupId(url){return new URL(url).pathname.match(/\/groups\/([^/]+)/)?.[1]||null;}
