import {createHash, randomUUID} from 'node:crypto';
import {realpathSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import {InteractionBudget} from './interaction-budget.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { throw new Error(message); };
const required = (value, label) => typeof value === 'string' && value.trim() ? value.trim() : fail(`${label}不能为空`);

/** One account/content registry for publishing and interaction; never opens a V1 DB. */
export class UnifiedPublisher {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    store.interactionBudget=new InteractionBudget(store);
    if(!this.db.prepare('PRAGMA table_info(facebook_accounts)').all().some(c=>c.name==='publisher_transport'))this.db.exec("ALTER TABLE facebook_accounts ADD COLUMN publisher_transport TEXT NOT NULL DEFAULT 'BROWSER'");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publisher_content_sources (
        workspace TEXT NOT NULL, source_id TEXT NOT NULL, revision TEXT NOT NULL,
        content_id TEXT NOT NULL REFERENCES group_content(id), payload_hash TEXT NOT NULL,
        PRIMARY KEY(workspace,source_id,revision)
      );
      CREATE TABLE IF NOT EXISTS publisher_jobs (
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES facebook_accounts(id),
        content_id TEXT NOT NULL REFERENCES group_content(id),
        snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('DRAFT','READY','PREPARING','SUBMITTING','PUBLISHED','CANCELLED','BLOCKED','UNKNOWN')),
        attempt_id TEXT, evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(workspace,account_id,content_id,snapshot_hash)
      );
      CREATE INDEX IF NOT EXISTS publisher_jobs_scope ON publisher_jobs(workspace,account_id,created_at);
      CREATE TABLE IF NOT EXISTS publisher_browser_locks (
        profile_id TEXT PRIMARY KEY REFERENCES execution_profiles(id),
        job_id TEXT NOT NULL UNIQUE REFERENCES publisher_jobs(id), token TEXT NOT NULL
      );
    `);
    // Recovery is an explicit startup operation, not a constructor side effect.
    // A second reader must never turn a live executor's task into UNKNOWN.
  }

  saveAccount(workspace, input) {
    const current=input.id?this.store.account(workspace,input.id):null;
    const transport=input.publisher_transport||current?.publisher_transport||'BROWSER';
    if(!['API','BROWSER'].includes(transport))fail('发布方式必须为 API 或 BROWSER');
    if(!['PAGE','PROFILE'].includes(input.identity_type))fail('请选择 Page 或个人操作身份');
    if(!/^\d+$/.test(String(input.external_id || '')))fail('请填写已核实的 Facebook 身份 ID');
    let configUrl=input.config_url;
    if(transport==='API') {
      configUrl=configUrl|| (input.id?this.store.account(workspace,input.id).config_url:null);
      configUrl=this.credentialReference(configUrl);
    }
    const account=this.store.saveAccount(workspace, {...input, config_url:configUrl, execution_transport:'BROWSER'});
    this.db.prepare('UPDATE facebook_accounts SET publisher_transport=? WHERE id=? AND workspace=?').run(transport,account.id,workspace);
    return this.store.account(workspace,account.id);
  }

  credentialReference(value) {
    if(!value)fail('API 模式需要现有的本机授权配置文件');
    let path=String(value);if(path.startsWith('file://'))path=fileURLToPath(path);
    if(!isAbsolute(path))fail('API 授权配置必须是本机绝对路径');
    const real=realpathSync(path),info=statSync(real);
    if(!info.isFile()||(info.mode&0o077)!==0)fail('API 授权配置必须是权限为 600 或更严格的本机文件');
    return real;
  }

  switchTransport(workspace,accountId,transport,configUrl) {
    const account=this.store.account(workspace,accountId);
    if(!['API','BROWSER'].includes(transport))fail('发布方式必须为 API 或 BROWSER');
    return this.saveAccount(workspace,{...account,enabled:Boolean(account.enabled),publisher_transport:transport,config_url:configUrl||account.config_url});
  }

  importContent(workspace, input) {
    this.store.requireWorkspace(workspace);
    const sourceId=required(input.source_id,'云端内容编号'), revision=required(input.revision,'云端版本');
    const body=required(input.body,'正文'), title=String(input.title || '').trim();
    if(!Array.isArray(input.media) || input.media.some(x => typeof x !== 'string' || !x.trim()))fail('媒体引用格式无效');
    const media=input.media.map(x=>x.trim()), payloadHash=digest({title,body,media});
    return this.store.tx(()=>{
      const old=this.db.prepare('SELECT * FROM publisher_content_sources WHERE workspace=? AND source_id=? AND revision=?').get(workspace,sourceId,revision);
      if(old){
        if(old.payload_hash!==payloadHash)fail('同一云端版本的内容发生变化，请使用新版本');
        return this.db.prepare('SELECT * FROM group_content WHERE id=? AND workspace=?').get(old.content_id,workspace);
      }
      const content=this.store.createContent(workspace,{title,body,media});
      this.db.prepare('INSERT INTO publisher_content_sources VALUES(?,?,?,?,?)').run(workspace,sourceId,revision,content.id,payloadHash);
      return content;
    });
  }

  context(workspace, accountId) {
    this.store.requireWorkspace(workspace);
    const account=this.store.account(workspace,accountId);
    const profile=this.db.prepare('SELECT * FROM execution_profiles WHERE id=? AND workspace=?').get(account.profile_id,workspace);
    if(!profile)fail('账号浏览器环境不存在');
    if(!['API','BROWSER'].includes(account.publisher_transport))fail('该账号尚未配置发布方式');
    if(!/^\d+$/.test(String(account.external_id || '')))fail('账号身份 ID 未核实');
    return {account,profile};
  }

  createPageJob(workspace, input) {
    const {account,profile}=this.context(workspace,input.account_id);
    if(account.identity_type!=='PAGE')fail('Page 发布需要选择企业 Page 身份');
    const content=this.db.prepare('SELECT * FROM group_content WHERE id=? AND workspace=?').get(input.content_id,workspace);
    if(!content)fail('内容不属于当前客户');
    const snapshot={workspace,accountId:account.id,externalId:account.external_id,identityType:account.identity_type,
      expectedIdentity:account.expected_identity,profileId:profile.id,profileDir:profile.user_data_dir,cdpPort:profile.cdp_port,
      contentId:content.id,title:content.title,body:content.body,media:JSON.parse(content.media_json),contentHash:content.content_hash,
      operation:'FACEBOOK_PAGE_PUBLISH',transport:account.publisher_transport,
      credentialRef:account.publisher_transport==='API'?this.credentialReference(account.config_url):null};
    const fingerprint=digest(snapshot), time=new Date().toISOString();
    return this.store.tx(()=>{
      const prior=this.db.prepare(`SELECT snapshot_json,state FROM publisher_jobs WHERE workspace=? AND account_id=? AND state IN ('PREPARING','SUBMITTING','UNKNOWN','PUBLISHED')`).all(workspace,account.id);
      if(prior.some(row=>{const s=JSON.parse(row.snapshot_json);return s.externalId===snapshot.externalId && s.contentHash===snapshot.contentHash;}))fail('相同目标和内容已有已提交或待核对任务，请先核对历史');
      this.db.prepare(`INSERT OR IGNORE INTO publisher_jobs(id,workspace,account_id,content_id,snapshot_json,snapshot_hash,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'DRAFT',?,?)`)
        .run(randomUUID(),workspace,account.id,content.id,JSON.stringify(snapshot),fingerprint,time,time);
      return this.decode(this.db.prepare('SELECT * FROM publisher_jobs WHERE workspace=? AND account_id=? AND content_id=? AND snapshot_hash=?').get(workspace,account.id,content.id,fingerprint));
    });
  }

  decode(row) { return {...row,snapshot:JSON.parse(row.snapshot_json),evidence:JSON.parse(row.evidence_json)}; }
  job(workspace, id) {
    this.store.requireWorkspace(workspace);
    return this.decode(this.db.prepare('SELECT * FROM publisher_jobs WHERE id=? AND workspace=?').get(id,workspace) || fail('任务不属于当前客户或不存在'));
  }
  list(workspace, accountId, {limit=100,offset=0}={}) {
    this.store.requireWorkspace(workspace);
    if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0)fail('分页参数无效');
    if(accountId)this.store.account(workspace,accountId);
    const rows=accountId
      ? this.db.prepare('SELECT * FROM publisher_jobs WHERE workspace=? AND account_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(workspace,accountId,limit,offset)
      : this.db.prepare('SELECT * FROM publisher_jobs WHERE workspace=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(workspace,limit,offset);
    return rows.map(row=>this.decode(row));
  }
  approve(workspace,id,fingerprint) {
    return this.store.tx(()=>{
      const job=this.job(workspace,id);
      if(job.snapshot_hash!==fingerprint || digest(job.snapshot)!==fingerprint)fail('任务预览已失效');
      this.assertCurrent(job);
      if(job.state!=='DRAFT')fail('只能批准待确认任务');
      this.db.prepare("UPDATE publisher_jobs SET state='READY',updated_at=? WHERE id=?").run(new Date().toISOString(),id);
      return this.job(workspace,id);
    });
  }
  assertCurrent(job) {
    const {account,profile}=this.context(job.workspace,job.account_id),s=job.snapshot;
    if(account.identity_type!==s.identityType || account.external_id!==s.externalId || account.expected_identity!==s.expectedIdentity || profile.id!==s.profileId || profile.user_data_dir!==s.profileDir || profile.cdp_port!==s.cdpPort)fail('账号或浏览器环境已变化，请重新创建任务');
    const content=this.db.prepare('SELECT * FROM group_content WHERE id=? AND workspace=?').get(job.content_id,job.workspace);
    if(!content || content.content_hash!==s.contentHash || content.title!==s.title || content.body!==s.body || digest(JSON.parse(content.media_json))!==digest(s.media))fail('内容版本已变化，请重新创建任务');
    if(digest(s)!==job.snapshot_hash)fail('任务快照已损坏');
    if(s.transport==='API' && this.credentialReference(s.credentialRef)!==s.credentialRef)fail('任务 API 授权配置路径已变化');
  }
  cancel(workspace,id) {
    return this.store.tx(()=>{
      const job=this.job(workspace,id);
      if(!['DRAFT','READY','BLOCKED'].includes(job.state))fail('执行中或结果未知的任务不能直接取消');
      this.db.prepare("UPDATE publisher_jobs SET state='CANCELLED',updated_at=? WHERE id=?").run(new Date().toISOString(),id);
      return this.job(workspace,id);
    });
  }
  recoverAfterShutdown() {
    // Call only after the previous process is confirmed stopped; keep locks.
    return this.db.prepare("UPDATE publisher_jobs SET state='UNKNOWN',updated_at=? WHERE state IN ('PREPARING','SUBMITTING')").run(new Date().toISOString()).changes;
  }
}
