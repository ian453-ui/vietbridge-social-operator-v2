import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Store} from './store.js';
import {FacebookBrowser} from './facebook-browser.js';
const root=dirname(fileURLToPath(import.meta.url));
export function createApp(dbPath=join(homedir(),'Library/Application Support/VietBridgeSocialOperatorV2/mock.sqlite')){
 const store=new Store(dbPath),token=randomUUID(),facebook=new FacebookBrowser(store);
 const server=createServer(async(req,res)=>{try{
  const origin=`http://${req.headers.host}`;
  if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||''))throw Error('无效主机');
  const url=new URL(req.url,origin);
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'&&['/','/client.js','/styles.css'].includes(url.pathname)){
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');return res.end(await readFile(join(root,name)));
  }
  if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{...store.view(url.searchParams.get('workspace')),token});
  if(req.method==='GET'&&url.pathname==='/api/facebook')return send(res,200,store.facebookView(url.searchParams.get('workspace')));
  if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,version:'2.1.0-alpha.1',mode:'local-real-integration',persistent:true,v1Url:'http://127.0.0.1:17880/'});
  if(req.method==='POST'){
   if(req.headers.origin!==origin||req.headers['x-local-token']!==token||req.headers['content-type']!=='application/json')throw Error('本地请求验证失败，请刷新页面');
   let raw='';for await(const c of req){raw+=c;if(raw.length>100000)throw Error('请求过大');}const input=JSON.parse(raw||'{}');
   const m=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/(tasks|content|comments)\/([^/]+)\/(\w+)$/);
   if(m)return send(res,200,store.command(m[1],m[2],m[3],m[4],input));
   const ws=decodeURIComponent(url.pathname.match(/^\/api\/workspaces\/([^/]+)\//)?.[1]||'');
   if(url.pathname.endsWith('/profiles'))return send(res,200,store.saveProfile(ws,input));
   if(url.pathname.endsWith('/accounts'))return send(res,200,store.saveAccount(ws,input));
   if(url.pathname.endsWith('/groups/manual'))return send(res,200,store.addGroup(ws,input));
   if(url.pathname.endsWith('/content'))return send(res,200,store.createContent(ws,input));
   if(url.pathname.endsWith('/group-jobs'))return send(res,201,store.createGroupJobs(ws,input));
   if(url.pathname.endsWith('/reply-intents'))return send(res,201,store.createReplyIntent(ws,input.comment_id,input.body));
   let x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/profiles\/([^/]+)\/launch$/);if(x)return send(res,200,await facebook.launch(decodeURIComponent(x[1]),decodeURIComponent(x[2])));
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/accounts\/([^/]+)\/inspect$/);if(x)return send(res,200,await facebook.inspect(decodeURIComponent(x[1]),decodeURIComponent(x[2])));
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/accounts\/([^/]+)\/sync-groups$/);if(x){const result=await facebook.discoverGroups(decodeURIComponent(x[1]),decodeURIComponent(x[2]));return send(res,200,{...result,groups:store.syncGroups(decodeURIComponent(x[1]),decodeURIComponent(x[2]),result.groups)});}
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/group-jobs\/([^/]+)\/prepare$/);if(x)return send(res,200,await facebook.prepareJob(decodeURIComponent(x[1]),decodeURIComponent(x[2])));
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/group-jobs\/([^/]+)\/claim$/);if(x)return send(res,200,store.claimPost(decodeURIComponent(x[1]),decodeURIComponent(x[2]),input.post_url));
   x=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/posts\/([^/]+)\/comments$/);if(x)return send(res,200,store.upsertComments(decodeURIComponent(x[1]),decodeURIComponent(x[2]),input.comments||[]));
  }
  send(res,404,{error:'NOT_FOUND'});
 }catch(e){send(res,409,{error:e.message});}});
 server.on('close',()=>store.close());return server;
}
function send(res,status,x){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(x));}
if(process.argv[1]===fileURLToPath(import.meta.url))createApp().listen(17882,'127.0.0.1',()=>console.log('V2 Mock http://127.0.0.1:17882'));
