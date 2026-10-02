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
import {cloudRuntime,authenticate} from './cloud-runtime.js';
const runtime=cloudRuntime();
const GroupLibrary=runtime?null:(await import('./library.js')).GroupLibrary;
import {FacebookEngagement,apiEnabled} from './facebook-engagement.js';
import {PublicationVerifier} from './publication-verifier.js';
const root=dirname(fileURLToPath(import.meta.url));
const execFileAsync=promisify(execFile);
export function createApp(dbPath=join(runtime?.dataDir||join(homedir(),'Library/Application Support/VietBridgeSocialOperatorV2'),'mock.sqlite'),options={}){
 const cloud=options.cloud||runtime;
 const store=new Store(dbPath),token=randomUUID(),facebook=new FacebookBrowser(store),engagement=new FacebookEngagement(store),library=cloud?null:new GroupLibrary(store,options.library),verifier=new PublicationVerifier(options.verifier);
 const server=createServer(async(req,res)=>{try{
  const origin=cloud?cloud.origin:`http://${req.headers.host}`;
  if(cloud){if(req.headers.host!==cloud.host)throw Error('无效主机');if(!authenticate(req,res,cloud))return;}
  else if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||''))throw Error('无效主机');
  const url=new URL(req.url,origin);
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(cloud){
   res.setHeader('Content-Security-Policy',"default-src 'self'; object-src 'none'; frame-ancestors 'none'");
   const localOnly=/^\/api\/(group-library|local\/pick-path)/.test(url.pathname)||req.method==='POST'&&url.pathname.endsWith('/proactive/scan')||req.method==='POST'&&/\/(profiles|accounts|library|inbox|group-jobs|reply-intents|posts|content)(\/|$)|\/radar\/search$|\/reserve$/.test(url.pathname);
   if(localOnly)return send(res,409,{error:'云端执行器尚未连接，此操作暂不可用'});
   if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,mode:'cloud-control-plane',persistent:true,executionConnected:false});
  }
  if(req.method==='GET'&&['/','/client.js','/group-filters.js','/styles.css'].includes(url.pathname)){
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');return res.end(await readFile(join(root,name)));
  }
  if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{...store.view(url.searchParams.get('workspace')),token});
  if(req.method==='GET'&&url.pathname==='/api/facebook'){const view=store.facebookView(url.searchParams.get('workspace'));return send(res,200,{...view,accounts:view.accounts.map(account=>({...account,api_enabled:apiEnabled(account)})),recommendedProfileDir:join(homedir(),'Library/Application Support/VietBridgeSocialOperatorV2/chrome-profiles',url.searchParams.get('workspace'))});}
  if(req.method==='GET'&&url.pathname==='/api/publication-verification')return send(res,200,await verifier.list());
  if(req.method==='GET'&&url.pathname==='/api/publication-verification/wechat-browser')return send(res,200,await verifier.wechatBrowserStatus());
  if(req.method==='GET'&&url.pathname==='/api/group-library')return send(res,200,{items:library.catalogue(url.searchParams.get('workspace'),url.searchParams.get('q'),url.searchParams.get('refresh')==='1')});
  if(req.method==='GET'&&url.pathname==='/api/group-library/media'){
   const asset=library.media(url.searchParams.get('workspace'),url.searchParams.get('key'),url.searchParams.get('index'),url.searchParams.get('revision'));
   const ext=asset.path.split('.').at(-1).toLowerCase(),mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4'}[ext];
   if(!mime)throw Error('媒体格式不支持');res.setHeader('Content-Type',mime);return res.end(await readFile(asset.path));
  }
  if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,version:'2.1.0-alpha.1',mode:'local-real-integration',persistent:true,v1Url:'http://127.0.0.1:17880/'});
  if(req.method==='POST'){
   if(req.headers.origin!==origin||req.headers['x-local-token']!==token||req.headers['content-type']!=='application/json')throw Error('本地请求验证失败，请刷新页面');
   let raw='';for await(const c of req){raw+=c;if(raw.length>100000)throw Error('请求过大');}const input=JSON.parse(raw||'{}');
   if(url.pathname==='/api/workspaces')return send(res,input.id?200:201,store.saveWorkspace(input));
   if(url.pathname==='/api/local/pick-path'){
    const kind=String(input.kind||'');if(!['config','profile'].includes(kind))throw Error('无效的选择类型');
    const script=kind==='config'?'POSIX path of (choose file with prompt "选择本机 Facebook 配置文件")':'POSIX path of (choose folder with prompt "选择本机 Chrome 数据目录")';
    try{const {stdout}=await execFileAsync('/usr/bin/osascript',['-e',script],{timeout:120000});return send(res,200,{path:stdout.trim().replace(/\/$/,'')});}
    catch(error){if(String(error.stderr||error.message).includes('-128'))throw Error('已取消文件选择');throw Error('本机文件选择器无法打开；请检查 Finder/自动化权限，或手工填写绝对路径');}
   }
   if(url.pathname==='/api/publication-verification/verify')return send(res,200,await verifier.verify(String(input.job_id||'')));
   if(url.pathname==='/api/publication-verification/refresh-platform')return send(res,200,await verifier.refreshPlatform(String(input.platform||''),String(input.article_id||'')));
   if(url.pathname==='/api/publication-verification/wechat-browser/launch')return send(res,200,await verifier.launchWechatBrowser());
   if(url.pathname==='/api/publication-verification/wechat-browser/read')return send(res,200,await verifier.readWechatBrowser());
   const m=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/(tasks|content|comments)\/([^/]+)\/(\w+)$/);
   if(m)return send(res,200,store.command(m[1],m[2],m[3],m[4],input));
   const ws=decodeURIComponent(url.pathname.match(/^\/api\/workspaces\/([^/]+)\//)?.[1]||'');
   if(url.pathname.endsWith('/library/import'))return send(res,201,{contents:library.import(ws,input.selections)});
   if(url.pathname.endsWith('/library/approve-gpt'))return send(res,200,library.approveGpt(ws,input.key,input.revision));
   if(url.pathname.endsWith('/library/reject-gpt'))return send(res,200,library.rejectGpt(ws,input.key,input.revision,input.reason));
   if(url.pathname.endsWith('/profiles'))return send(res,200,store.saveProfile(ws,input));
   if(url.pathname.endsWith('/accounts/import-local'))return send(res,200,await importLocalAccount(input.config_url));
   if(url.pathname.endsWith('/accounts'))return send(res,200,store.saveAccount(ws,input));
   if(url.pathname.endsWith('/accounts/select'))return send(res,200,store.selectAccount(ws,input.id));
   if(url.pathname.endsWith('/groups/manual'))return send(res,200,store.addGroup(ws,input));
   if(url.pathname.endsWith('/content'))return send(res,200,store.createContent(ws,input));
   if(url.pathname.endsWith('/group-jobs'))return send(res,201,store.createGroupJobs(ws,input));
   if(url.pathname.endsWith('/group-jobs/auto-publish'))return send(res,202,facebook.enqueueJobs(ws,input.job_ids||[],{include:input.group_name_include,exclude:input.group_name_exclude}));
   if(url.pathname.endsWith('/reply-intents'))return send(res,201,store.createReplyIntent(ws,input.comment_id,input.body));
   if(url.pathname.endsWith('/inbox/sync'))return send(res,200,await engagement.sync(ws,input.account_id));
   if(url.pathname.endsWith('/engagement/policy'))return send(res,200,store.saveEngagementPolicy(ws,input));
   if(url.pathname.endsWith('/proactive/settings'))return send(res,200,store.saveProactiveSettings(ws,input));
   if(url.pathname.endsWith('/proactive/groups/toggle'))return send(res,200,store.setGroupProactive(ws,input.group_id,input.enabled));
   if(url.pathname.endsWith('/proactive/scan'))return send(res,200,await facebook.scanProactiveEngagement(ws,input.account_id));
   if(url.pathname.endsWith('/engagement/candidates/build'))return send(res,200,{candidates:store.buildEngagementCandidates(ws,input.account_id),quota:store.quotaStatus(ws,input.account_id)});
   if(url.pathname.endsWith('/engagement/radar/search'))return send(res,200,await facebook.searchGroupTopics(ws,input.account_id,input));
   let quota=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/engagement\/candidates\/([^/]+)\/reserve$/);if(quota)return send(res,200,await engagement.autoReply(decodeURIComponent(quota[1]),decodeURIComponent(quota[2])));
   quota=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/engagement\/reservations\/([^/]+)\/release$/);if(quota)return send(res,200,store.releaseQuota(decodeURIComponent(quota[1]),decodeURIComponent(quota[2]),input.reason));
   let proactive=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/proactive\/posts\/([^/]+)\/execute$/);if(proactive)return send(res,200,await facebook.executeProactiveEngagement(decodeURIComponent(proactive[1]),decodeURIComponent(proactive[2]),input.reply_body));
   proactive=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/proactive\/posts\/([^/]+)\/fact-sources$/);if(proactive)return send(res,200,store.addFactSource(decodeURIComponent(proactive[1]),decodeURIComponent(proactive[2]),input));
   proactive=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/proactive\/actions\/([^/]+)\/reconcile$/);if(proactive)return send(res,200,store.reconcileProactiveAction(decodeURIComponent(proactive[1]),decodeURIComponent(proactive[2]),input));
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
 server.on('close',()=>store.close());return server;
}
function send(res,status,x){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(x));}
async function importLocalAccount(value){const text=String(value||'').trim();if(!text)throw Error('请填写本地配置文件地址');if(/^[a-z][a-z0-9+.-]*:/i.test(text)&&!text.startsWith('file://'))throw Error('账号配置只允许本地文件地址');const requested=text.startsWith('file://')?fileURLToPath(text):text,path=await realpath(requested),info=await stat(path);if(!info.isFile())throw Error('本地账号配置地址不是文件');if(/\.(rtf|docx?)$/i.test(path))throw Error('富文本不能作为账号配置；请选择纯文本 .env 或 .json 文件');if((info.mode&0o077)!==0)throw Error('本地账号配置文件权限过宽，请设为仅当前用户可读写（600）');const raw=await readFile(path,'utf8');let data={};if(path.endsWith('.json'))data=JSON.parse(raw);else for(const line of raw.split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m)data[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2')}if(!data.FB_PAGE_ID&&!data.FB_ACCOUNT_NAME&&!data.FB_PAGE_NAME)throw Error('配置文件没有可识别的 Facebook 账号字段');return {config_url:path,display_name:data.FB_ACCOUNT_NAME||data.FB_PAGE_NAME||'',expected_identity:data.FB_EXPECTED_IDENTITY||data.FB_PAGE_NAME||'',external_id:data.FB_PAGE_ID||''};}
if(process.argv[1]===fileURLToPath(import.meta.url))createApp().listen(Number(process.env.PORT||17882),runtime?'0.0.0.0':'127.0.0.1',()=>console.log(runtime?'VietBridge cloud control plane ready':'V2 http://127.0.0.1:17882'));
