import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {initialState,switchWorkspace,canExecute,reconcile,injectScenario} from "./domain.js";

const root=dirname(fileURLToPath(import.meta.url));
let state=initialState();
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||"/","http://127.0.0.1");
  if(req.method==="GET"&&url.pathname==="/")return file(res,"index.html","text/html; charset=utf-8");
  if(req.method==="GET"&&url.pathname==="/app.js")return file(res,"app.js","text/javascript; charset=utf-8");
  if(req.method==="GET"&&url.pathname==="/styles.css")return file(res,"styles.css","text/css; charset=utf-8");
  if(req.method==="GET"&&url.pathname==="/api/state")return json(res,200,state);
  if(req.method==="POST"&&url.pathname==="/api/reset"){state=initialState();return json(res,200,state)}
  if(req.method==="POST"&&url.pathname==="/api/context"){const b=await body(req);if(b.mode==="agency"){state.mode="agency";state.workspaceId=null;state.route="today";return json(res,200,{ok:true,state})}const out=switchWorkspace(state,b.workspaceId);return json(res,out.ok?200:409,{...out,state})}
  if(req.method==="POST"&&url.pathname==="/api/route"){const b=await body(req);state.route=String(b.route||"today");return json(res,200,{ok:true,state})}
  if(req.method==="POST"&&url.pathname==="/api/scenario"){const b=await body(req);const task=injectScenario(state,String(b.scenario));return json(res,200,{ok:true,task,state})}
  const exec=url.pathname.match(/^\/api\/tasks\/([^/]+)\/execute$/);if(req.method==="POST"&&exec){const task=state.tasks.find(t=>t.id===exec[1]);if(!task)return json(res,404,{error:"任务不存在"});const out=canExecute(state,task);if(out.ok){task.state="COMPOSER_READY";task.reason="Mock Composer 已准备；Facebook Group 仍需人工最终点击"}return json(res,out.ok?200:409,{...out,task,state})}
  const rec=url.pathname.match(/^\/api\/tasks\/([^/]+)\/reconcile$/);if(req.method==="POST"&&rec){const b=await body(req);const out=reconcile(state,rec[1],Boolean(b.found));return json(res,out.ok?200:409,{...out,state})}
  return json(res,404,{error:"NOT_FOUND"});
});
async function file(res,name,type){try{const data=await readFile(resolve(root,name));res.writeHead(200,{"content-type":type,"cache-control":"no-store","x-content-type-options":"nosniff"});res.end(data)}catch{json(res,404,{error:"NOT_FOUND"})}}
async function body(req){let text="";for await(const c of req){text+=c;if(text.length>1_000_000)throw Error("请求过大")}return JSON.parse(text||"{}")}
function json(res,status,value){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(value))}
export function start(port=Number(process.env.SOCIAL_OPERATOR_V2_PORT||17882)){return new Promise(resolveStart=>server.listen(port,"127.0.0.1",()=>resolveStart(server)))}
if(process.argv[1]===fileURLToPath(import.meta.url)){await start();console.log("VietBridge Social Operator V2: http://127.0.0.1:17882")}
