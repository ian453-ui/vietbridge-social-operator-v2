import {createServer} from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Store} from './store.js';
import {FacebookBrowser} from './facebook-browser.js';
import {cloudRuntime} from './cloud-runtime.js';
import {PublisherAccess,loginPage} from './publisher-access.js';
const runtime=cloudRuntime();
const GroupLibrary=runtime&&!runtime.executionConnected?null:(await import('./library.js')).GroupLibrary;
import {FacebookEngagement,apiEnabled} from './facebook-engagement.js';
import {PublicationVerifier} from './publication-verifier.js';
import {PublisherIntegration,integrationOptions,validateIntegrationPaths,scopeFingerprint} from './publisher-integration.js';
import {UnifiedPublisher} from './unified-publisher.js';
import {unifiedRoute} from './unified-http.js';
import {publisherAutomationCapabilities} from './publisher-automation.js';
import {UnifiedExecutor} from './unified-executor.js';
import {PublisherDiagnostics} from './publisher-diagnostics.js';
import {unifiedDrivers} from './unified-drivers.js';
import {BrowserResources} from './browser-resources.js';
import {ScanScheduler} from './scan-scheduler.js';
const root=dirname(fileURLToPath(import.meta.url));
const execFileAsync=promisify(execFile);
export function createApp(dbPath=join(runtime?.dataDir||join(homedir(),'Library/Application Support/VietBridgeSocialOperatorV2'),'mock.sqlite'),options={}){
 const publisherOptions=options.unified?null:(options.publisher||integrationOptions());
 if(publisherOptions)validateIntegrationPaths(dbPath,publisherOptions);
 const cloud=options.cloud||runtime,localExecution=!cloud||cloud.executionConnected===true;
 const store=new Store(dbPath,{seedDemo:!options.unified}),token=randomUUID(),facebook=new FacebookBrowser(store),engagement=new FacebookEngagement(store),library=localExecution?new GroupLibrary(store,options.library):null,verifier=new PublicationVerifier(options.verifier);
 const access=cloud?new PublisherAccess(cloud):null;
 const unified=options.unified?new UnifiedPublisher(store):null;
 if(unified&&options.recoverStartup)unified.recoverAfterShutdown();
 const executionEnabled=options.executionEnabled===true;
 const executor=unified?new UnifiedExecutor(unified,{resources:options.resources||new BrowserResources(join(dirname(dbPath),'browser-resource-locks')),drivers:options.drivers||unifiedDrivers(facebook),enabled:executionEnabled,snapshotRoot:join(dirname(dbPath),'publisher-media-snapshots'),mediaRoots:job=>{
  const workspace=store.list('workspaces').find(w=>w.id===job.workspace),roots=job.workspace==='ws-vietbridge'?(library?.roots||[]):workspace?.content_root?[workspace.content_root]:[];
  const imported=library&&store.db.prepare('SELECT 1 FROM group_library_imports WHERE workspace=? AND content_id=?').get(job.workspace,job.content_id);
  return imported?roots.concat(job.snapshot.media.map(path=>dirname(path))):roots;
 }}):null;
 if(unified)facebook.resources=executor.resources;
 if(unified){executor.diagnostics=new PublisherDiagnostics(executor);if(options.recoverStartup)executor.diagnostics.recover();}
 const scheduler=unified&&options.scanScheduler?new ScanScheduler(store,facebook).start():null;
 const publisher=publisherOptions?new PublisherIntegration(store,{...publisherOptions,operatorDbPath:dbPath}):null;
 if(publisher)facebook.resources=publisher.resources;
 const server=createServer(async(req,res)=>{try{
  const loopback=/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'');
  const origin=cloud&&!(cloud.executionConnected&&loopback)?cloud.origin:`http://${req.headers.host}`;
  if(cloud){if(req.headers.host!==cloud.host&&!(cloud.executionConnected&&loopback))throw Error('无效主机');}
  else if(!loopback)throw Error('无效主机');
  const url=new URL(req.url,origin);
  let principal=null;
  if(access){
   res.setHeader('Cache-Control','no-store');
   res.setHeader('Content-Security-Policy',"default-src 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'");
   if(req.method==='GET'&&url.pathname==='/login'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(loginPage);}
   if(req.method==='POST'&&url.pathname==='/auth/login'){if(req.headers.origin!==origin)return send(res,403,{error:'登录来源无效'});let raw='';for await(const c of req){raw+=c;if(raw.length>4096)return send(res,413,{error:'请求过大'});}const input=new URLSearchParams(raw);try{const session=access.login(input.get('username'),input.get('password'));res.setHeader('Set-Cookie','publisher_session='+session+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+(origin.startsWith('https:')?'; Secure':''));res.writeHead(303,{Location:'/'});return res.end();}catch{res.writeHead(401,{'Content-Type':'text/html; charset=utf-8'});return res.end('<p>登录未成功，请检查用户名或密码；频繁尝试时请稍后重试。</p><a href="/login">返回登录</a>');}}
   principal=access.authenticate(req);if(!principal){if(req.method==='GET'&&url.pathname==='/'){res.writeHead(303,{Location:'/login'});return res.end();}return send(res,401,{error:'请登录 Publisher',login:'/login'});}
   if(!access.authorizeApp(principal,req.method,url))return send(res,403,{error:'应用未获此客户或操作的权限'});
   if(req.method==='GET'&&url.pathname==='/api/access/tokens')return send(res,200,{tokens:access.list(),user:access.data.user});
  }
  const publisherContext=()=>publisher.context(url.searchParams.get('workspace')||'',url.searchParams.get('accountId')||'');
  const requestVerifier=()=>publisher?new PublicationVerifier({scoped:true,fetch:(path,init)=>publisher.fetch(publisherContext(),path,init)}):verifier;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(unified&&req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,version:'2.3.0-alpha.2',mode:'publisher-unified',head:/^[a-f0-9]{40}$/.test(process.env.PUBLISHER_BUILD_HEAD||'')?process.env.PUBLISHER_BUILD_HEAD:null,executionEnabled,scanSchedulerEnabled:Boolean(scheduler),persistent:true});
  if(unified&&req.method==='GET'&&url.pathname==='/api/automation/capabilities')return send(res,200,{...publisherAutomationCapabilities,scoped_execution:{supported:true,global_execution_enabled:executionEnabled,capability_path:'/api/unified/workspaces/<workspace>/jobs/<job_id>/execution-capability',grant_interface:'local administration only',requires_explicit_user_authorization:true},operations:{...publisherAutomationCapabilities.operations,submit_platform_task:{supported:executionEnabled,requires_explicit_user_authorization:true},submit_to_facebook:{supported:executionEnabled,reason:executionEnabled?'requires approved task and explicit submit action':'global submission disabled; consult the exact job execution-capability'}}});
  if(req.method==='GET'&&url.pathname==='/api/publisher-integration'){
   if(!publisher)return send(res,200,{enabled:false,error:'发布模块未配置'});
   try{await publisher.ready;const c=publisherContext();return send(res,200,{enabled:true,ready:true,workspace:c.id,accountId:c.operatorAccountId,platforms:c.platforms,scopeFingerprint:scopeFingerprint(c),executionEnabled:publisherOptions.workerEnabled===true});}catch(e){return send(res,200,{enabled:true,ready:false,error:e.message});}
  }
  if(url.pathname==='/publisher'||url.pathname.startsWith('/publisher/')){
   if(!publisher)return send(res,503,{error:'发布模块未配置'});
   if(req.method!=='GET'&&req.method!=='HEAD'&&(req.headers.origin!==origin||req.headers['x-local-token']!==token))return send(res,403,{error:'统一入口请求验证失败'});
   const nonce=randomUUID(),context={...publisherContext(),nonce};req.url=url.pathname.slice('/publisher'.length)+url.search;if(req.url.startsWith('?'))req.url='/'+req.url;if(!req.url)req.url='/';
   res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'; base-uri 'none'`);
   return await publisher.dispatch(req,res,context);
  }
  if(cloud){
   res.setHeader('Content-Security-Policy',"default-src 'self'; object-src 'none'; frame-ancestors 'none'");
   const localOnly=/^\/api\/(group-library|local\/pick-path)/.test(url.pathname)||req.method==='POST'&&url.pathname.endsWith('/proactive/scan')||req.method==='POST'&&/\/(profiles|accounts|library|inbox|group-jobs|reply-intents|posts|content)(\/|$)|\/radar\/search$|\/reserve$/.test(url.pathname);
   if(localOnly&&!localExecution)return send(res,409,{error:'云端执行器尚未连接，此操作暂不可用'});
   if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,mode:localExecution?'mac-tunnel':'cloud-control-plane',persistent:true,executionConnected:localExecution});
  }
  if(req.method==='GET'&&['/','/client.js','/unified-client.js','/publisher-form-state.js','/group-selection.js','/group-filters.js','/publisher-access-ui.js','/publication-selection.js','/styles.css'].includes(url.pathname)){
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');return res.end(await readFile(join(root,name)));
  }
  if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{...store.view(url.searchParams.get('workspace')),token,unified:Boolean(unified),executionEnabled,integrationAcceptance:Boolean(unified&&!executionEnabled||publisher&&publisherOptions.workerEnabled!==true)});
  if(unified&&req.method==='GET'&&url.pathname.startsWith('/api/unified/')){const result=await unifiedRoute(unified,req.method,url,{},executor);if(result)return send(res,result.status,result.body);}
  if(req.method==='GET'&&url.pathname==='/api/facebook'){const view=store.facebookView(url.searchParams.get('workspace'));return send(res,200,{...view,...(unified?unified.accountsView(url.searchParams.get('workspace')):{}),groupContent:view.groupContent.map(c=>({...c,library_source:library?store.db.prepare("SELECT article_id,version,json_extract(source_json,'$.selection_revision') AS revision FROM group_library_imports WHERE content_id=? AND workspace=?").get(c.id,c.workspace)||null:null,platform_payloads:unified?.contentVariants(c.id)||{}})),sharedInteractionQuota:unified&&view.selectedAccountId?store.interactionBudget.status(url.searchParams.get('workspace'),view.selectedAccountId):null,runtimeMode:cloud?.mode||'local',executionConnected:localExecution,accounts:view.accounts.map(account=>({...account,api_enabled:apiEnabled(account)})),recommendedProfileDir:join(homedir(),'Library/Application Support/VietBridgeSocialOperatorV2/chrome-profiles',url.searchParams.get('workspace'))});}
  if(unified&&url.pathname.startsWith('/api/publication-verification')){
   if(req.method!=='GET')return send(res,409,{error:'统一版本的平台独立核对尚未接入，不会调用旧发布服务'});
   if(url.pathname!=='/api/publication-verification')return send(res,200,{supported:false,reason:'此平台尚未接入统一版本'});
   const rows=unified.list(url.searchParams.get('workspace')||'',url.searchParams.get('accountId')||null).map(job=>({job_id:job.id,article_id:job.content_id,title:job.snapshot.title,platform:job.snapshot.platform||'facebook',platform_name:job.snapshot.platform||'Facebook',account_id:job.account_id,local_state:job.state,verification_status:['PUBLISHED','PUBLISHED_ID_PENDING'].includes(job.state)?'VERIFIED_PUBLISHED':job.state==='DRAFT_WRITTEN'?'VERIFIED_DRAFT':job.state==='UNKNOWN'?'RECONCILE_PENDING':'NOT_VERIFIED',label:job.state==='PUBLISHED'?'已确认发布':job.state==='PUBLISHED_ID_PENDING'?'已确认发表，公开ID待取得':job.state==='DRAFT_WRITTEN'?'草稿已写入，未发表':job.state==='UNKNOWN'?'待平台核对':'未核对',detail:'统一任务记录；只有独立平台回读才能确认发布',updated_at:job.updated_at,can_verify:false}));
   return send(res,200,{rows,summary:{total:rows.length,published:rows.filter(x=>x.verification_status==='VERIFIED_PUBLISHED').length,drafts:rows.filter(x=>x.verification_status==='VERIFIED_DRAFT').length,pending:rows.filter(x=>x.verification_status==='RECONCILE_PENDING').length,not_published:0,deleted:0}});
  }
  if(req.method==='GET'&&url.pathname==='/api/publication-verification')return send(res,200,await requestVerifier().list());
  if(req.method==='GET'&&url.pathname==='/api/publication-verification/wechat-browser')return send(res,200,await requestVerifier().wechatBrowserStatus());
  if(req.method==='GET'&&url.pathname==='/api/group-library')return send(res,200,{items:library.catalogue(url.searchParams.get('workspace'),url.searchParams.get('q'),url.searchParams.get('refresh')==='1')});
  if(req.method==='GET'&&['/api/group-library/media','/api/group-library/content-media'].includes(url.pathname)){
   const asset=url.pathname.endsWith('/content-media')?library.contentMedia(url.searchParams.get('workspace'),url.searchParams.get('contentId'),url.searchParams.get('index'),url.searchParams.get('platform')):library.media(url.searchParams.get('workspace'),url.searchParams.get('key'),url.searchParams.get('index'),url.searchParams.get('revision'));
   const ext=asset.path.split('.').at(-1).toLowerCase(),mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4'}[ext];
   if(!mime)throw Error('媒体格式不支持');res.setHeader('Content-Type',mime);return res.end(await readFile(asset.path));
  }
  if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,version:'2.1.0-alpha.1',mode:'local-real-integration',persistent:true,v1Url:'http://127.0.0.1:17880/'});
  if(req.method==='POST'){
   if((principal?.type!=='app'&&(req.headers.origin!==origin||req.headers['x-local-token']!==token)||principal?.type==='app'&&req.headers.origin&&req.headers.origin!==origin)||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))throw Error('本地请求验证失败，请刷新页面');
   if((unified&&!executionEnabled||publisher&&publisherOptions.workerEnabled!==true)&&(/\/group-jobs\/auto-publish$|\/group-jobs\/[^/]+\/prepare$|\/engagement\/candidates\/[^/]+\/reserve$|\/proactive\/posts\/[^/]+\/execute$/.test(url.pathname)))return send(res,409,{error:'验收模式不执行真实社媒提交；请使用只读扫描和任务预览'});
   const input=await readRequestJson(req);
   if(access&&url.pathname==='/api/access/password'){access.changePassword(input.current_password,input.new_password);res.setHeader('Set-Cookie','publisher_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{changed:true,login:'/login'});}
   if(access&&url.pathname==='/api/access/tokens'){for(const ws of input.workspaces||[])store.requireWorkspace(ws);return send(res,201,access.createToken(input));}
   if(access&&url.pathname==='/api/access/tokens/revoke'){access.revoke(input.id);return send(res,200,{revoked:true});}
   if(access&&url.pathname==='/api/access/logout'){access.logout(req);res.setHeader('Set-Cookie','publisher_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{logout:true});}
   if(unified&&url.pathname.startsWith('/api/unified/')){const result=await unifiedRoute(unified,req.method,url,input,executor);if(result)return send(res,result.status,result.body);}
   if(url.pathname==='/api/workspaces')return send(res,input.id?200:201,store.saveWorkspace(input));
   if(url.pathname==='/api/local/pick-path'){
    const kind=String(input.kind||'');if(!['config','profile'].includes(kind))throw Error('无效的选择类型');
    const script=kind==='config'?'POSIX path of (choose file with prompt "选择本机 Facebook 配置文件")':'POSIX path of (choose folder with prompt "选择本机 Chrome 数据目录")';
    try{const {stdout}=await execFileAsync('/usr/bin/osascript',['-e',script],{timeout:120000});return send(res,200,{path:stdout.trim().replace(/\/$/,'')});}
    catch(error){if(String(error.stderr||error.message).includes('-128'))throw Error('已取消文件选择');throw Error('本机文件选择器无法打开；请检查 Finder/自动化权限，或手工填写绝对路径');}
   }
   if(url.pathname==='/api/publication-verification/verify')return send(res,200,await requestVerifier().verify(String(input.job_id||'')));
   if(url.pathname==='/api/publication-verification/refresh-platform')return send(res,200,await requestVerifier().refreshPlatform(String(input.platform||''),String(input.article_id||'')));
   if(url.pathname==='/api/publication-verification/wechat-browser/launch')return send(res,200,await requestVerifier().launchWechatBrowser());
   if(url.pathname==='/api/publication-verification/wechat-browser/read')return send(res,200,await requestVerifier().readWechatBrowser());
   const m=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/(tasks|content|comments)\/([^/]+)\/(\w+)$/);
   if(m)return send(res,200,store.command(m[1],m[2],m[3],m[4],input));
   const ws=decodeURIComponent(url.pathname.match(/^\/api\/workspaces\/([^/]+)\//)?.[1]||'');
   if(url.pathname.endsWith('/library/import'))return send(res,201,{contents:library.import(ws,input.selections)});
   if(url.pathname.endsWith('/library/approve-gpt'))return send(res,200,library.approveGpt(ws,input.key,input.revision));
   if(url.pathname.endsWith('/library/reject-gpt'))return send(res,200,library.rejectGpt(ws,input.key,input.revision,input.reason));
   if(url.pathname.endsWith('/profiles'))return send(res,200,store.saveProfile(ws,input));
   if(url.pathname.endsWith('/accounts/import-local'))return send(res,200,await importLocalAccount(input.config_url));
   if(url.pathname.endsWith('/accounts'))return send(res,200,unified?unified.saveAccount(ws,input):store.saveAccount(ws,input));
   if(url.pathname.endsWith('/accounts/select'))return send(res,200,store.selectAccount(ws,input.id));
   if(url.pathname.endsWith('/groups/manual'))return send(res,200,store.addGroup(ws,input));
   if(url.pathname.endsWith('/content'))return send(res,200,store.createContent(ws,input));
   if(url.pathname.endsWith('/group-jobs'))return send(res,201,store.createGroupJobs(ws,input));
   if(url.pathname.endsWith('/group-jobs/auto-publish'))return send(res,202,facebook.enqueueJobs(ws,input.job_ids||[],{include:input.group_name_include,exclude:input.group_name_exclude}));
   if(url.pathname.endsWith('/reply-intents'))return send(res,201,store.createReplyIntent(ws,input.comment_id,input.body));
   if(url.pathname.endsWith('/inbox/sync'))return send(res,200,await (unified?facebook.syncBrowserInbox(ws,input.account_id):engagement.sync(ws,input.account_id)));
   if(url.pathname.endsWith('/engagement/policy'))return send(res,200,store.saveEngagementPolicy(ws,input));
   if(url.pathname.endsWith('/proactive/settings'))return send(res,200,store.saveProactiveSettings(ws,input));
   if(url.pathname.endsWith('/proactive/groups/toggle-bulk'))return send(res,200,{groups:store.setGroupProactiveBulk(ws,input.account_id,input.changes)});
   if(url.pathname.endsWith('/proactive/groups/toggle'))return send(res,200,store.setGroupProactive(ws,input.group_id,input.enabled));
   if(url.pathname.endsWith('/proactive/scan'))return send(res,200,await facebook.scanProactiveEngagement(ws,input.account_id));
   if(url.pathname.endsWith('/engagement/candidates/build'))return send(res,200,{candidates:store.buildEngagementCandidates(ws,input.account_id),quota:store.quotaStatus(ws,input.account_id)});
   if(url.pathname.endsWith('/engagement/radar/search'))return send(res,200,await facebook.searchGroupTopics(ws,input.account_id,input));
   let quota=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/engagement\/candidates\/([^/]+)\/reserve$/);if(quota){const workspace=decodeURIComponent(quota[1]),id=decodeURIComponent(quota[2]),candidate=store.engagementCandidate(workspace,id),comment=store.comment(workspace,candidate.comment_id),source=store.db.prepare('SELECT job_id FROM published_posts WHERE id=? AND workspace=?').get(comment.post_id,workspace);return send(res,200,source?.job_id.startsWith('radar-group:')?await facebook.replyRadarCandidate(workspace,id):await (unified?facebook.replyInboxCandidate(workspace,id):engagement.autoReply(workspace,id)));}
   const candidateReadback=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/engagement\/candidates\/([^/]+)\/reconcile$/);if(candidateReadback)return send(res,200,await facebook.reconcileThemeReply(decodeURIComponent(candidateReadback[1]),decodeURIComponent(candidateReadback[2])));
   quota=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/engagement\/reservations\/([^/]+)\/release$/);if(quota)return send(res,200,store.releaseQuota(decodeURIComponent(quota[1]),decodeURIComponent(quota[2]),input.reason));
   let proactive=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/proactive\/posts\/([^/]+)\/execute$/);if(proactive)return send(res,200,await facebook.executeProactiveEngagement(decodeURIComponent(proactive[1]),decodeURIComponent(proactive[2]),input.reply_body));
   proactive=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/proactive\/posts\/([^/]+)\/fact-sources$/);if(proactive)return send(res,200,store.addFactSource(decodeURIComponent(proactive[1]),decodeURIComponent(proactive[2]),input));
   proactive=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/proactive\/actions\/([^/]+)\/reconcile$/);if(proactive)return send(res,200,await facebook.reconcileProactiveBrowser(decodeURIComponent(proactive[1]),decodeURIComponent(proactive[2])));
   let reply=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/reply-intents\/([^/]+)\/preflight$/);if(reply)return send(res,200,await engagement.preflightReply(decodeURIComponent(reply[1]),decodeURIComponent(reply[2])));
   let x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/profiles\/([^/]+)\/launch$/);if(x)return send(res,200,await facebook.launch(decodeURIComponent(x[1]),decodeURIComponent(x[2])));
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/accounts\/([^/]+)\/inspect$/);if(x)return send(res,200,await facebook.inspect(decodeURIComponent(x[1]),decodeURIComponent(x[2])));
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/accounts\/([^/]+)\/sync-groups$/);if(x){const result=await facebook.discoverGroups(decodeURIComponent(x[1]),decodeURIComponent(x[2]));return send(res,200,{...result,groups:store.syncGroups(decodeURIComponent(x[1]),decodeURIComponent(x[2]),result.groups)});}
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/group-jobs\/([^/]+)\/prepare$/);if(x)return send(res,200,await facebook.prepareJob(decodeURIComponent(x[1]),decodeURIComponent(x[2])));
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/group-jobs\/([^/]+)\/claim$/);if(x)return send(res,200,await facebook.reconcileJob(decodeURIComponent(x[1]),decodeURIComponent(x[2]),input.post_url));
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/posts\/([^/]+)\/comments$/);if(x)return send(res,200,store.upsertComments(decodeURIComponent(x[1]),decodeURIComponent(x[2]),input.comments||[]));
  }
  send(res,404,{error:'NOT_FOUND'});
 }catch(e){send(res,409,{error:e.message});}});
 server.on('close',()=>{const finish=()=>{publisher?.close();store.close();server.emit('storage-closed');};if(scheduler)scheduler.stop().then(finish);else finish();});return server;
}
function send(res,status,x){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(x));}
async function importLocalAccount(value){const text=String(value||'').trim();if(!text)throw Error('请填写本地配置文件地址');if(/^[a-z][a-z0-9+.-]*:/i.test(text)&&!text.startsWith('file://'))throw Error('账号配置只允许本地文件地址');const requested=text.startsWith('file://')?fileURLToPath(text):text,path=await realpath(requested),info=await stat(path);if(!info.isFile())throw Error('本地账号配置地址不是文件');if(/\.(rtf|docx?)$/i.test(path))throw Error('富文本不能作为账号配置；请选择纯文本 .env 或 .json 文件');if((info.mode&0o077)!==0)throw Error('本地账号配置文件权限过宽，请设为仅当前用户可读写（600）');const raw=await readFile(path,'utf8');let data={};if(path.endsWith('.json'))data=JSON.parse(raw);else for(const line of raw.split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m)data[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2')}if(!data.FB_PAGE_ID&&!data.FB_ACCOUNT_NAME&&!data.FB_PAGE_NAME)throw Error('配置文件没有可识别的 Facebook 账号字段');return {config_url:path,display_name:data.FB_ACCOUNT_NAME||data.FB_PAGE_NAME||'',expected_identity:data.FB_EXPECTED_IDENTITY||data.FB_PAGE_NAME||'',external_id:data.FB_BROWSER_PAGE_ID||'',operator_actor_id:data.FB_BROWSER_PAGE_ID||'',target_page_id:data.FB_PAGE_ID||''};}
if(process.argv[1]===fileURLToPath(import.meta.url))createApp().listen(Number(process.env.PORT||17882),runtime&&!runtime.executionConnected?'0.0.0.0':'127.0.0.1',()=>console.log(runtime?.executionConnected?'VietBridge authenticated Mac Tunnel ready':runtime?'VietBridge cloud control plane ready':'V2 http://127.0.0.1:17882'));

async function readRequestJson(req){const parts=[];let bytes=0;for await(const chunk of req){const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=part.length;if(bytes>100000)throw Error('请求过大');parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}catch{throw Error('JSON 请求格式无效');}}
