/** Authenticated parent server calls this only after Host/auth/Origin/CSRF validation. */
export function unifiedRoute(publisher, method, url, input={},executor=null) {
  const preparation=url.pathname.match(/^\/api\/unified\/workspaces\/([^/]+)\/jobs\/([^/]+)\/resolve-preparation$/);
  if(preparation){if(method!=='POST')return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};if(!executor)throw Error('执行器未接入');return executor.resolvePreparation(decodeURIComponent(preparation[1]),decodeURIComponent(preparation[2]),input).then(body=>({status:200,body}));}
  const inspect=url.pathname.match(/^\/api\/unified\/workspaces\/([^/]+)\/accounts\/([^/]+)\/inspect$/);
  if(inspect){if(method!=='POST')return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};if(!executor)throw Error('执行器未接入');return executor.inspectAccount(decodeURIComponent(inspect[1]),decodeURIComponent(inspect[2])).then(body=>({status:200,body}));}
  const accounts=url.pathname.match(/^\/api\/unified\/workspaces\/([^/]+)\/accounts(?:\/(select))?$/);
  if(accounts){const workspace=decodeURIComponent(accounts[1]);if(method==='GET'&&!accounts[2])return {status:200,body:publisher.accountsView(workspace)};if(method==='POST')return {status:accounts[2]?200:201,body:accounts[2]?publisher.selectAccount(workspace,input.id):publisher.saveAccount(workspace,input)};return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};}
  const execute=url.pathname.match(/^\/api\/unified\/workspaces\/([^/]+)\/jobs\/([^/]+)\/(execute|reconcile|reopen)$/);
  if(execute){if(method!=='POST')return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};if(!executor)throw Error('执行器未接入');return Promise.resolve(executor[execute[3]](decodeURIComponent(execute[1]),decodeURIComponent(execute[2]),input)).then(body=>({status:200,body}));}
  const transport=url.pathname.match(/^\/api\/unified\/workspaces\/([^/]+)\/accounts\/([^/]+)\/transport$/);
  if(transport)return method==='POST'?{status:200,body:publisher.switchTransport(decodeURIComponent(transport[1]),decodeURIComponent(transport[2]),input.transport,input.config_url)}:{status:405,body:{error:'METHOD_NOT_ALLOWED'}};
  const route=url.pathname.match(/^\/api\/unified\/workspaces\/([^/]+)\/(content|jobs)(?:\/([^/]+)\/(approve|cancel))?$/);
  if(!route)return null;
  const workspace=decodeURIComponent(route[1]),kind=route[2],id=route[3]&&decodeURIComponent(route[3]),action=route[4];
  if(method==='GET' && kind==='jobs' && !id) {
    const limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):100;
    const offset=url.searchParams.has('offset')?Number(url.searchParams.get('offset')):0;
    return {status:200,body:{jobs:publisher.list(workspace,url.searchParams.get('accountId')||null,{limit,offset})}};
  }
  if(method==='POST' && kind==='content' && !id)return {status:201,body:publisher.importContent(workspace,input)};
  if(method==='POST' && kind==='jobs' && !id)return {status:201,body:publisher.createPageJob(workspace,input)};
  if(method==='POST' && kind==='jobs' && id && action==='approve')return {status:200,body:(executor||publisher).approve(workspace,id,input.snapshot_hash)};
  if(method==='POST' && kind==='jobs' && id && action==='cancel')return {status:200,body:publisher.cancel(workspace,id)};
  return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
}
