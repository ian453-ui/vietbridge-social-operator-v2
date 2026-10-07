import {randomUUID} from 'node:crypto';
import {executionScope} from './single-execution-permit.js';
import {boundedDiagnosticCleanup} from './facebook-readonly-diagnostics.js';
const safe=error=>String(error?.message||error).replace(/EAA[A-Za-z0-9_-]+|Bearer\s+\S+/g,'[REDACTED]').slice(0,600);
/** Separate append-only run records. Never calls complete, claim, prepare, submit or permit APIs. */
export class PublisherDiagnostics{
  constructor(executor){this.executor=executor;this.publisher=executor.publisher;this.db=executor.db;this.running=new Map();
    this.db.exec(`CREATE TABLE IF NOT EXISTS publisher_diagnostic_runs(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES publisher_jobs(id),workspace TEXT NOT NULL,scope_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('RUNNING','DONE')),result_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS publisher_diagnostic_single_run ON publisher_diagnostic_runs(job_id) WHERE state='RUNNING';`);
  }
  recover(){this.db.prepare("UPDATE publisher_diagnostic_runs SET state='DONE',result_json=?,updated_at=? WHERE state='RUNNING'").run(JSON.stringify({conclusion:'INCOMPLETE',absenceProven:false,stage:'INTERRUPTED',errors:[{stage:'RECOVERY',error:'SERVICE_INTERRUPTED_DIAGNOSTIC_NO_PLATFORM_WRITE'}]}),new Date().toISOString());}
  view(workspace,id){this.publisher.job(workspace,id);const row=this.db.prepare('SELECT * FROM publisher_diagnostic_runs WHERE workspace=? AND job_id=? ORDER BY created_at DESC LIMIT 1').get(workspace,id);return row?{id:row.id,jobId:row.job_id,state:row.state,scope:JSON.parse(row.scope_json),result:JSON.parse(row.result_json),createdAt:row.created_at,updatedAt:row.updated_at}:{state:'NOT_STARTED'};}
  start(workspace,id,input){
    const job=this.publisher.job(workspace,id),s=job.snapshot;
    if(job.state!=='UNKNOWN'||s.platform!=='facebook'||s.transport!=='BROWSER'||input.snapshot_hash!==job.snapshot_hash)throw Error('只读诊断仅适用完整匹配冻结版本的 Facebook 浏览器 UNKNOWN 任务');
    this.publisher.assertCurrent(job);
    if(this.executor.active.has(s.profileId)||this.db.prepare("SELECT 1 FROM publisher_diagnostic_runs WHERE job_id=? AND state='RUNNING'").get(id))throw Error('此执行环境或任务已有正在进行的操作');
    const release=this.executor.acquireResources(s,{reconcile:true}),runId=randomUUID(),at=new Date().toISOString();this.executor.active.add(s.profileId);
    try{this.db.prepare("INSERT INTO publisher_diagnostic_runs VALUES(?,?,?,?, 'RUNNING',?,?,?)").run(runId,id,workspace,JSON.stringify(executionScope(job)),JSON.stringify({stage:'STARTING',conclusion:'INCOMPLETE',absenceProven:false}),at,at);}catch(error){this.executor.active.delete(s.profileId);release();throw error;}
    const work=this.work(job,runId,release);this.running.set(runId,work);work.then(()=>this.running.delete(runId),()=>this.running.delete(runId));
    return this.view(workspace,id);
  }
  save(runId,result,state='RUNNING'){this.db.prepare('UPDATE publisher_diagnostic_runs SET result_json=?,state=?,updated_at=? WHERE id=?').run(JSON.stringify(result),state,new Date().toISOString(),runId);}
  async work(job,runId,release){let driver,result;
    try{driver=await this.executor.drivers.create(job.snapshot);if(!driver.diagnose)throw Error('此执行器没有只读诊断能力');result=await driver.diagnose(job.snapshot,value=>this.save(runId,value));}
    catch(error){const row=this.db.prepare('SELECT result_json FROM publisher_diagnostic_runs WHERE id=?').get(runId);result={...JSON.parse(row.result_json),conclusion:'BLOCKED',absenceProven:false,stage:'ERROR',errors:[...(JSON.parse(row.result_json).errors||[]),{stage:'DRIVER',error:safe(error)}]};}
    finally{let cleanupFailed=false;try{await boundedDiagnosticCleanup(()=>driver?.closeDiagnostic?driver.closeDiagnostic():driver?.close(),4500);}catch(error){cleanupFailed=true;result={...result,conclusion:'BLOCKED',absenceProven:false,leaseRetained:true,errors:[...(result?.errors||[]),{stage:'DISCONNECT',error:safe(error)}]};}finally{if(!cleanupFailed){try{release();}catch(error){result={...result,conclusion:'BLOCKED',absenceProven:false,errors:[...(result?.errors||[]),{stage:'LEASE',error:safe(error)}]};}this.executor.active.delete(job.snapshot.profileId);}this.save(runId,result,'DONE');}}
  }
}
