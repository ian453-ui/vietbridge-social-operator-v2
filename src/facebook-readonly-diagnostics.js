import {createHash} from 'node:crypto';
const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
const hash=value=>createHash('sha256').update(normalize(value)).digest('hex');
export function safeDiagnosticUrl(value){try{const u=new URL(value);if(u.protocol!=='https:'||!['www.facebook.com','facebook.com','business.facebook.com'].includes(u.hostname))return null;for(const [key,value] of [...u.searchParams])if(!(['asset_id','id'].includes(key)&&/^\d+$/.test(value)||['tab','content_tab','section','view'].includes(key)&&/^[a-z_]{1,40}$/i.test(value)))u.searchParams.delete(key);u.username='';u.password='';u.hash='';return u.href;}catch{return null;}}
export function diagnosticLink(value,asset){try{const u=new URL(value),safe=safeDiagnosticUrl(value);return safe&&u.protocol==='https:'&&u.hostname==='business.facebook.com'&&!u.username&&!u.password&&!u.hash&&u.searchParams.get('asset_id')===asset&&[...u.searchParams].every(([k,v])=>['asset_id','id'].includes(k)&&/^\d+$/.test(v)||['tab','content_tab','section','view'].includes(k)&&/^[a-z_]{1,40}$/i.test(v))&&/^\/latest\/(home|content|posts)(\/|$)/.test(u.pathname)&&!/(composer|create|edit|settings|inbox)/i.test(u.pathname)?safe:null;}catch{return null;}}
export async function boundedDiagnosticCleanup(fn,timeout=1500){let timer;try{return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DIAGNOSTIC_CLEANUP_TIMEOUT')),timeout);})]);}finally{clearTimeout(timer);}}
export function classifyDiagnosticView(url,label=''){const text=url+' '+label;return /scheduled|排程|已安排|已排期|đã lên lịch/i.test(text)?'SCHEDULED':/draft|草稿|bản nháp/i.test(text)?'DRAFT':/published|已发布|已发表|đã đăng/i.test(text)?'PUBLISHED':'OTHER';}
// Read-only DOM extraction: no clicks, fill, trial, submit, network fetch or login secrets.
export async function readDiagnosticPage(page,caption){
  return page.evaluate(({caption})=>{
    const norm=x=>String(x||'').replace(/\s+/g,' ').trim(),visible=e=>Boolean(e.getClientRects().length),body=document.body?.innerText||'';
    const grids=[...document.querySelectorAll('[role="grid"],table')].filter(visible),rows=grids.flatMap(grid=>[...grid.querySelectorAll('[role="row"],tr')]).filter(visible).slice(0,100);
    const links=[...document.querySelectorAll('a[href]')].filter(visible).map(a=>({url:a.href,label:norm(a.innerText).slice(0,80)}));
    const candidates=rows.map(row=>{const text=norm(row.innerText),exact=[row,...row.querySelectorAll('div,span,p')].some(e=>norm(e.innerText)===norm(caption));return {text:text.slice(0,16000),exact,fullBodyContained:text.includes(norm(caption)),links:[...row.querySelectorAll('a[href]')].map(a=>a.href),itemLabel:row.querySelector('[role="checkbox"]')?.getAttribute('aria-label')||''};});
    const editor=document.querySelector('[contenteditable="true"]');
    return {title:document.title.slice(0,120),links,candidates,gridLabels:grids.map(g=>g.getAttribute('aria-label')||''),activeTabs:[...document.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(visible).map(e=>norm(e.innerText).slice(0,80)),gridCount:grids.length,rowCount:rows.length,rowsCapped:rows.length>=100,busy:Boolean(document.querySelector('[aria-busy="true"],[role="progressbar"]')),blocked:/checkpoint|login/i.test(location.href)||Boolean(document.querySelector('input[name="pass"]')),emptyNotice:/No posts|No content|没有帖子|暂无|Không có bài viết/i.test(body),filters:[...document.querySelectorAll('select,[role="combobox"]')].filter(visible).map(e=>norm(e.innerText).slice(0,120)).slice(0,8),pagination:[...document.querySelectorAll('button,[role="button"]')].filter(visible).map(e=>norm(e.innerText)||e.getAttribute('aria-label')||'').filter(t=>/next|previous|more|下一|上一|更多|tiếp|trước/i.test(t)).slice(0,12),composerBodyMatches:editor?norm(editor.innerText)===norm(caption):null};
  },{caption});
}
export async function runFacebookDiagnostic({context,snapshot,identity,progress=()=>{},budgetMs=60000,stepMs=8000}){
  const report={conclusion:'INCOMPLETE',absenceProven:false,identity:null,scene:[],views:[],errors:[],coverage:{required:['PUBLISHED','DRAFT','SCHEDULED'],observed:[],exhaustive:false,singlePass:true},startedAt:new Date().toISOString()},owned=[];let aborted=false;
  const deadline=Date.now()+budgetMs;
  const step=async fn=>{if(aborted||Date.now()>=deadline)throw Error('DIAGNOSTIC_TIME_BUDGET');let timer;try{return await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>{aborted=true;reject(Error('DIAGNOSTIC_STEP_TIMEOUT'));},Math.min(stepMs,deadline-Date.now()));})]);}finally{clearTimeout(timer);}};
  const queue=[],seen=new Set();
  function capture(url,data,scene=false){
    const safe=safeDiagnosticUrl(url),pathView=classifyDiagnosticView(safe?new URL(safe).pathname:''),domView=classifyDiagnosticView('',[...(data.gridLabels||[]),...(data.activeTabs||[])].join(' ')),mismatch=pathView!=='OTHER'&&domView!=='OTHER'&&pathView!==domView,view=mismatch?'OTHER':domView!=='OTHER'?domView:pathView,asset=safe&&new URL(safe).searchParams.get('asset_id');
    const record={url:safe,title:data.title,view,viewMismatch:mismatch,activeTabs:data.activeTabs,asset,observedAt:new Date().toISOString(),gridCount:data.gridCount,rowCount:data.rowCount,loading:data.busy,filters:data.filters,pagination:data.pagination,rowsCapped:data.rowsCapped,emptyNotice:data.emptyNotice,composerBodyMatches:data.composerBodyMatches,candidates:[]};
    if(!scene&&asset===snapshot.targetPageId){record.candidates=(data.candidates||[]).map(row=>({normalizedSha256:hash(row.text),textExcerpt:normalize(row.text).slice(0,160),exactBody:row.exact,fullBodyContained:row.fullBodyContained,approvedBodySha256:row.exact?hash(snapshot.body):null,ids:[...new Set([...(row.links||[]).flatMap(link=>{const safe=safeDiagnosticUrl(link);return safe?(new URL(safe).pathname.match(/\/(?:posts|videos)\/(\d+)/)?.slice(1)||[]):[];}),...(row.itemLabel?.match(/(?:Select item with id|选择.*?id)\s*(\d+)/i)?.slice(1)||[])])]}));report.views.push(record);if(view!=='OTHER')report.coverage.observed=[...new Set([...report.coverage.observed,view])];}
    else report.scene.push({...record,candidates:[]});
    for(const link of data.links||[]){const allowed=diagnosticLink(link.url,snapshot.targetPageId);if(allowed&&!seen.has(allowed)&&!queue.some(x=>x.url===allowed))queue.push({url:allowed,view:classifyDiagnosticView(allowed,link.label)});}
    return record;
  }
  try{
    // Save all preexisting page evidence before identity/navigation. Never close or navigate them.
    const existing=context.pages();report.existingPages=existing.map(page=>safeDiagnosticUrl(page.url())).filter(Boolean);report.coverage.sceneCapped=existing.length>12;
    progress({...report,stage:'SCENE'});
    for(const page of existing.slice(0,12)){const url=page.url();if(!safeDiagnosticUrl(url))continue;try{capture(url,await step(()=>readDiagnosticPage(page,snapshot.body)),true);}catch(error){report.errors.push({stage:'SCENE',url:safeDiagnosticUrl(url),error:error.message});if(aborted)throw error;}}
    progress({...report,stage:'IDENTITY'});report.identity=await step(identity);
    if(!report.identity?.healthy||report.identity.externalId!==snapshot.operatorActorId||report.identity.targetPageId!==snapshot.targetPageId)throw Error('DIAGNOSTIC_IDENTITY_MISMATCH');
    report.identityVerified=true;
    let visits=0;
    while(queue.length&&visits<5){
      const next=queue.shift();if(seen.has(next.url))continue;seen.add(next.url);visits++;
      progress({...report,stage:'OBSERVE',currentUrl:next.url});
      const page=await step(async()=>{const p=await context.newPage();owned.push(p);if(aborted){await boundedDiagnosticCleanup(()=>p.close()).catch(()=>{});throw Error('DIAGNOSTIC_ABORTED_NEW_PAGE');}return p;});
      try{await step(()=>page.goto(next.url,{waitUntil:'domcontentloaded',timeout:7000}));if(!diagnosticLink(page.url(),snapshot.targetPageId))throw Error('DIAGNOSTIC_REDIRECT_OUTSIDE_TARGET');const data=await step(()=>readDiagnosticPage(page,snapshot.body));if(data.blocked)throw Error('DIAGNOSTIC_ACCESS_BLOCKED');capture(page.url(),data);}
      catch(error){report.errors.push({stage:'OBSERVE',url:next.url,error:error.message});if(aborted)throw error;}
      finally{await boundedDiagnosticCleanup(()=>page.close()).catch(error=>report.errors.push({stage:'CLEANUP',error:error.message}));}
    }
    report.matches=report.views.filter(view=>view.view!=='OTHER'&&!view.loading).flatMap(view=>view.candidates.filter(c=>c.exactBody&&c.ids.length).map(candidate=>({view:view.view,url:view.url,...candidate})));
    if(report.matches.length)report.conclusion='MATCH';
    else if(!report.views.length)report.conclusion='BLOCKED';
    else if(report.errors.length||report.coverage.sceneCapped||report.views.some(v=>v.loading||v.rowsCapped||!v.gridCount||v.viewMismatch||v.view==='OTHER')||report.coverage.required.some(v=>!report.coverage.observed.includes(v)))report.conclusion='INCOMPLETE';
    else report.conclusion='NOT_FOUND_IN_OBSERVED_RANGE';
    if(!report.views.length)report.errors.push({stage:'DISCOVERY',error:'NO_OBSERVED_ALLOWED_BUSINESS_ASSET_LINKS_OR_READABLE_VIEWS'});
  }catch(error){report.errors.push({stage:'RUN',error:error.message});report.conclusion=report.identityVerified?'INCOMPLETE':'BLOCKED';}
  finally{aborted=true;const cleanupDeadline=Date.now()+5000;for(const page of owned){try{await boundedDiagnosticCleanup(()=>page.close(),Math.max(1,Math.min(1500,cleanupDeadline-Date.now())));}catch(error){report.errors.push({stage:'CLEANUP',error:error.message});if(report.conclusion!=='MATCH')report.conclusion='INCOMPLETE';}}report.finishedAt=new Date().toISOString();progress({...report,stage:'FINISHED'});}
  return report;
}
