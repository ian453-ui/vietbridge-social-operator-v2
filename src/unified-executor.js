import {randomUUID,createHash} from 'node:crypto';
import {realpathSync,statSync,existsSync,mkdirSync,copyFileSync,chmodSync} from 'node:fs';
import {dirname,join,relative,extname} from 'node:path';
import {hashFile} from './publisher-core/file-hash.ts';

const safeError=error=>String(error?.message||error).replace(/EAA[A-Za-z0-9_-]+|Bearer\s+\S+/g,'[REDACTED]').slice(0,800);
const pending=new Set(['PREPARING','SUBMITTING','UNKNOWN']);

export class UnifiedExecutor {
  constructor(publisher,{resources,drivers,enabled=false,mediaRoots=[],snapshotRoot}={}) {
    this.publisher=publisher;this.db=publisher.db;this.resources=resources;this.drivers=drivers;this.enabled=enabled;
    this.mediaRoots=mediaRoots;this.snapshotRoot=snapshotRoot;
    this.active=new Set();
    this.db.exec(`CREATE TABLE IF NOT EXISTS publisher_submit_intents(job_id TEXT PRIMARY KEY REFERENCES publisher_jobs(id),attempt_id TEXT NOT NULL,transport TEXT NOT NULL,snapshot_hash TEXT NOT NULL,prepared_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publisher_submit_receipts(job_id TEXT PRIMARY KEY REFERENCES publisher_jobs(id),platform_id TEXT NOT NULL,platform_url TEXT NOT NULL,evidence_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publisher_job_assets(job_id TEXT NOT NULL REFERENCES publisher_jobs(id),ordinal INTEGER NOT NULL,path TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(job_id,ordinal));`);
  }
  freezeMedia(job) {
    const old=this.db.prepare('SELECT * FROM publisher_job_assets WHERE job_id=? ORDER BY ordinal').all(job.id);
    if(old.length) {
      if(old.length!==job.snapshot.media.length)throw Error('媒体快照不完整');
      for(const asset of old)if(hashFile(asset.path).sha256!==asset.sha256)throw Error('媒体快照已变化');
      return old.map(x=>x.path);
    }
    const assets=job.snapshot.media.map((value,ordinal)=>{
      const source=realpathSync(value);
      const roots=(typeof this.mediaRoots==='function'?this.mediaRoots(job):this.mediaRoots).filter(existsSync).map(path=>realpathSync(path));
      if(!roots.some(root=>{const rel=relative(root,source);return rel&&!rel.startsWith('..')&&!rel.startsWith('/');}))throw Error('媒体不属于已配置客户内容目录');
      const ext=extname(source).toLowerCase();if(!['.png','.jpg','.jpeg','.webp','.mp4'].includes(ext))throw Error('媒体格式不支持');
      const meta=hashFile(source),h=meta.header;
      const valid=ext==='.png'?h.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['.jpg','.jpeg'].includes(ext)?h[0]===255&&h[1]===216&&h[2]===255:ext==='.webp'?h.toString('ascii',0,4)==='RIFF'&&h.toString('ascii',8,12)==='WEBP':h.toString('ascii',4,8)==='ftyp';
      if(!valid||!meta.sizeBytes)throw Error('媒体文件签名无效');
      const directory=join(this.snapshotRoot,job.id);mkdirSync(directory,{recursive:true,mode:0o700});
      const path=join(directory,ordinal+ext);copyFileSync(source,path);chmodSync(path,0o600);
      if(hashFile(path).sha256!==meta.sha256)throw Error('媒体在冻结期间发生变化');
      return {ordinal,path,sha256:meta.sha256,size:meta.sizeBytes};
    });
    this.publisher.store.tx(()=>{for(const a of assets)this.db.prepare('INSERT INTO publisher_job_assets VALUES(?,?,?,?,?)').run(job.id,a.ordinal,a.path,a.sha256,a.size);});
    return assets.map(x=>x.path);
  }
  approve(workspace,id,hash) {
    const job=this.publisher.job(workspace,id);if(job.state!=='DRAFT')throw Error('只能批准待确认任务');
    if(job.snapshot_hash!==hash)throw Error('预览版本已失效');
    this.freezeMedia(job);
    return this.publisher.approve(workspace,id,hash);
  }
  reopen(workspace,id){
    return this.publisher.store.tx(()=>{
      const job=this.publisher.job(workspace,id);
      if(job.state!=='BLOCKED'||this.db.prepare('SELECT 1 FROM publisher_submit_intents WHERE job_id=?').get(id))throw Error('只有确认未提交的阻断任务可以重新审核');
      this.publisher.assertCurrent(job);
      this.db.prepare("UPDATE publisher_jobs SET state='DRAFT',updated_at=? WHERE id=?").run(new Date().toISOString(),id);
      return this.publisher.job(workspace,id);
    });
  }
  profilePending(profileId) {
    return Boolean(this.db.prepare("SELECT 1 FROM publisher_jobs WHERE json_extract(snapshot_json,'$.profileId')=? AND state IN ('PREPARING','SUBMITTING','UNKNOWN') LIMIT 1").get(profileId));
  }
  claim(workspace,id) {
    return this.publisher.store.tx(()=>{
      const job=this.publisher.job(workspace,id);if(job.state!=='READY')throw Error('只有确认后的任务可执行；未知结果必须核对');
      this.publisher.assertCurrent(job);
      const duplicate=this.db.prepare(`SELECT id FROM publisher_jobs WHERE workspace=? AND id<>? AND json_extract(snapshot_json,'$.externalId')=? AND json_extract(snapshot_json,'$.contentHash')=? AND state IN ('PREPARING','SUBMITTING','UNKNOWN','PUBLISHED') LIMIT 1`).get(workspace,id,job.snapshot.externalId,job.snapshot.contentHash);
      if(duplicate)throw Error('同一身份与内容已有提交或待核对任务，不能切换模式重发');
      this.db.prepare("UPDATE publisher_jobs SET state='PREPARING',attempt_id=?,updated_at=? WHERE id=? AND state='READY'").run(randomUUID(),new Date().toISOString(),id);
      return this.publisher.job(workspace,id);
    });
  }
  async execute(workspace,id) {
    if(!this.enabled)throw Error('验收模式未开启真实提交');
    const initial=this.publisher.job(workspace,id),profile=initial.snapshot.profileId;
    if(this.active.has(profile))throw Error('该浏览器账号正在执行任务');
    this.active.add(profile);let job,driver,release;
    try {
      job=this.claim(workspace,id);
      const resources=this.resources; if(!resources)throw Error('缺少统一浏览器互斥配置');
      release=resources.acquire(job.snapshot.profileDir,'operator:'+profile,()=>this.profilePending(profile)||this.drivers.pending?.(profile));
      const assets=this.db.prepare('SELECT * FROM publisher_job_assets WHERE job_id=? ORDER BY ordinal').all(id);
      if(assets.length!==job.snapshot.media.length)throw Error('未保存批准时的媒体快照');
      for(const asset of assets)if(hashFile(asset.path).sha256!==asset.sha256)throw Error('已批准媒体发生变化');
      driver=await this.drivers.create(job.snapshot);
      const prepared=await driver.prepare(job.snapshot,assets.map(x=>x.path));
      this.publisher.assertCurrent(job);
      this.publisher.store.tx(()=>{
        this.db.prepare('INSERT INTO publisher_submit_intents VALUES(?,?,?,?,?,?)').run(id,job.attempt_id,job.snapshot.transport,job.snapshot_hash,JSON.stringify(prepared),new Date().toISOString());
        this.db.prepare("UPDATE publisher_jobs SET state='SUBMITTING',updated_at=? WHERE id=? AND state='PREPARING'").run(new Date().toISOString(),id);
      });
      const receipt=await driver.submit();
      if(receipt?.id)this.db.prepare('INSERT INTO publisher_submit_receipts VALUES(?,?,?,?,?)').run(id,String(receipt.id),String(receipt.url||''),JSON.stringify({accepted:true,transport:job.snapshot.transport}),new Date().toISOString());
      const evidence=await driver.readback(job.snapshot,receipt);
      this.complete(workspace,id,evidence);
    } catch(error) {
      if(job){const current=this.publisher.job(workspace,id);if(['PREPARING','SUBMITTING'].includes(current.state))this.db.prepare('UPDATE publisher_jobs SET state=?,evidence_json=?,updated_at=? WHERE id=?').run(current.state==='SUBMITTING'?'UNKNOWN':'BLOCKED',JSON.stringify({error:safeError(error)}),new Date().toISOString(),id);}
      throw Error(safeError(error));
    } finally {
      try{await driver?.close();}finally{try{release?.();}finally{this.active.delete(profile);}}
    }
    return this.publisher.job(workspace,id);
  }
  complete(workspace,id,evidence) {
    const job=this.publisher.job(workspace,id);
    if(!['SUBMITTING','UNKNOWN'].includes(job.state))throw Error('任务不在可核对状态');
    if(!evidence?.verified||!evidence.id||evidence.pageId!==job.snapshot.externalId||evidence.contentHash!==job.snapshot.contentHash)throw Error('没有完整的平台身份与内容回读证据');
    this.db.prepare("UPDATE publisher_jobs SET state='PUBLISHED',evidence_json=?,updated_at=? WHERE id=?").run(JSON.stringify(evidence),new Date().toISOString(),id);
  }
  async reconcile(workspace,id,input={}) {
    const job=this.publisher.job(workspace,id);if(job.state!=='UNKNOWN')throw Error('任务当前不需要核对');
    if(this.active.has(job.snapshot.profileId))throw Error('该账号正在执行任务');
    this.active.add(job.snapshot.profileId);let driver,release;
    try {
      release=this.resources.acquire(job.snapshot.profileDir,'operator:'+job.snapshot.profileId,()=>this.profilePending(job.snapshot.profileId)||this.drivers.pending?.(job.snapshot.profileId),{reconcile:true});
      driver=await this.drivers.create(job.snapshot);
      let receipt=this.db.prepare('SELECT platform_id AS id,platform_url AS url FROM publisher_submit_receipts WHERE job_id=?').get(id);
      if(!receipt&&input.platform_id){if(!/^\d+(?:_\d+)?$/.test(String(input.platform_id)))throw Error('平台作品 ID 格式无效');receipt={id:String(input.platform_id),url:''};}
      this.complete(workspace,id,await driver.readback(job.snapshot,receipt));
      return this.publisher.job(workspace,id);
    }finally{try{await driver?.close();}finally{try{release?.();}finally{this.active.delete(job.snapshot.profileId);}}}
  }
}
