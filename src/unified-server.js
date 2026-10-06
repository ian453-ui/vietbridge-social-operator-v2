import {isAbsolute,basename,dirname,join} from 'node:path';
import {existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from './server.js';
import {cloudRuntime} from './cloud-runtime.js';
import {BrowserResources} from './browser-resources.js';

// Explicit opt-in. Never reuse a legacy publisher/operator database by default.
const path=process.argv[2];
if(!path||!isAbsolute(path)||basename(path)!=='publisher-unified.sqlite')throw Error('请指定新的绝对路径 publisher-unified.sqlite');
if(existsSync(path)) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publisher_jobs'").get())throw Error('此文件不是统一版本数据库，不能复用旧运行数据库');
    if(!db.prepare("SELECT sql FROM sqlite_master WHERE name='publisher_jobs'").get().sql.includes('DRAFT_WRITTEN'))throw Error('此文件属于旧 Facebook 阶段 schema；请使用独立新目录，旧文件保留，不做原地迁移');
  } finally {db.close();}
}
if(cloudRuntime()?.mode!=='mac-tunnel')throw Error('统一入口需要已认证的 mac-tunnel 模式');
const release=new BrowserResources(join(dirname(path),'service-locks')).acquire(path,'unified-service',()=>false,{reconcile:true});
let server;
try{server=createApp(path,{unified:true,recoverStartup:true,executionEnabled:process.env.PUBLISHER_ENABLE_EXECUTION==='1',scanScheduler:process.env.PUBLISHER_ENABLE_SCAN_SCHEDULER==='1',library:{roots:process.env.CONTENT_ROOTS_JSON?JSON.parse(process.env.CONTENT_ROOTS_JSON):undefined,gptInboxBase:process.env.GPT_INBOX_BASE}});}catch(error){release();throw error;}
server.on('storage-closed',release);
server.on('error',()=>server.close());
server.listen(Number(process.env.PORT||17882),'127.0.0.1',()=>console.log('VietBridge unified authenticated service ready'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
