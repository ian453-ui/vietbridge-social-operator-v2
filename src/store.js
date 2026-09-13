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
