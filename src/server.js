import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Store} from './store.js';
const root=dirname(fileURLToPath(import.meta.url));
export function createApp(dbPath=join(homedir(),'Library/Application Support/VietBridgeSocialOperatorV2/mock.sqlite')){
 const store=new Store(dbPath),token=randomUUID();
 const server=createServer(async(req,res)=>{try{
  const origin=`http://${req.headers.host}`;
  if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||''))throw Error('无效主机');
  const url=new URL(req.url,origin);
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'&&['/','/client.js','/styles.css'].includes(url.pathname)){
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1);res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');return res.end(await readFile(join(root,name)));
  }
  if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{...store.view(url.searchParams.get('workspace')),token});
  if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,version:'2.0.0-prototype.2',mode:'mock',persistent:true});
  if(req.method==='POST'){
   if(req.headers.origin!==origin||req.headers['x-local-token']!==token||req.headers['content-type']!=='application/json')throw Error('本地请求验证失败，请刷新页面');
   let raw='';for await(const c of req){raw+=c;if(raw.length>100000)throw Error('请求过大');}const input=JSON.parse(raw||'{}');
   const m=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/(tasks|content|comments)\/([^/]+)\/(\w+)$/);
   if(m)return send(res,200,store.command(m[1],m[2],m[3],m[4],input));
  }
  send(res,404,{error:'NOT_FOUND'});
 }catch(e){send(res,409,{error:e.message});}});
 server.on('close',()=>store.close());return server;
}
function send(res,status,x){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(x));}
if(process.argv[1]===fileURLToPath(import.meta.url))createApp().listen(17882,'127.0.0.1',()=>console.log('V2 Mock http://127.0.0.1:17882'));
