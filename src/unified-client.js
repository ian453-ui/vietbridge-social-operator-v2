const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const platforms={facebook:'Facebook',xiaohongshu:'小红书',wechat_official_account:'微信公众号草稿',wechat_channels:'视频号'};
const states={DRAFT_WRITTEN:'草稿已写入 · 未发表',PUBLISHED_ID_PENDING:'已确认发表 · 公开 ID 待取得'};
export function executionButton(job) {
  if(job.state!=='READY')return '';
  const allowed=job.canExecute===true;
  const label=allowed?(job.execution?.mode==='SINGLE_USE'?'执行此任务一次':'执行已确认发布'):'当前任务不可执行';
  return `<button data-execute="${esc(job.id)}" ${allowed?'':'disabled'}>${label}</button>${job.execution?.expiresAt?`<small>单次许可有效至 ${esc(job.execution.expiresAt)}</small>`:''}${!allowed&&job.execution?.reason?`<p>${esc(job.execution.reason)}</p>`:''}`;
}
export function unifiedPublisherView(workspace,account,contents=[],profiles=[],accounts=[]) {
  if(!workspace)return '<section class="panel empty">请选择客户与运营账号。</section>';
  const manager=`<section class="panel" id="unified-account-manager" data-workspace="${esc(workspace)}"><details><summary>配置当前客户的平台账号（使用现有授权）</summary>
    <form id="unified-account-form"><label>平台<select name="platform">${Object.entries(platforms).filter(([p])=>p!=='facebook').map(([p,name])=>`<option value="${p}">${name}</option>`).join('')}</select></label>
    <label>账号记录<select name="id"><option value="">新增账号</option>${accounts.filter(a=>a.platform!=='facebook').map(a=>`<option value="${esc(a.id)}">${esc(a.display_name)} · ${esc(platforms[a.platform])}</option>`).join('')}</select></label>
    <label>显示名称<input name="display_name" required></label><label>已核实的平台身份<input name="external_id" required placeholder="小红书 username:名称；公众号 App ID；视频号实际 ID"></label>
    <label>实际显示身份<input name="expected_identity" required></label><label>专用执行环境<select name="profile_id">${profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
    <label>现有公众号授权文件<input name="config_url" placeholder="本机私有文件绝对路径；不能填写凭据值"></label>
    <label>已有小红书 MCP 端点<input name="mcp_endpoint" placeholder="http://127.0.0.1:18060/mcp"></label>
    <label>已有公众号连接器入口<input name="connector_entry" placeholder="本机 JS 绝对路径"></label>
    <label>视频号合集（可选）<input name="collection"></label><label><input type="checkbox" name="profile_identity_confirmed">我已在此视频号专用窗口核实上述身份；界面无身份文本时使用此确认</label>
    <button ${profiles.length?'':'disabled'}>保存平台账号</button><p>Facebook 账号继续在“账号与授权”配置。这里登记已有连接，不创建凭据；先在账号与授权配置专用执行环境。</p>
    </form></details><p id="unified-account-status" role="status"></p></section>`;
  if(!account)return manager+'<section class="panel empty">请选择或配置当前客户的操作账号。</section>';
  return manager+`<section class="panel" id="unified-publisher" data-workspace="${esc(workspace)}" data-account="${esc(account.id)}" data-platform="${esc(account.platform||'facebook')}">
    <h2>发布</h2><p>当前操作身份：${esc(account.display_name)}。内容库由当前客户的账号共享，任务按操作账号记录。</p>
    <button id="unified-inspect-account">只读核对当前账号与连接</button>
    ${!account.platform||account.platform==='facebook'?`<label>新任务发布方式<select id="unified-transport"><option value="BROWSER" ${account.publisher_transport!=='API'?'selected':''}>浏览器</option><option value="API" ${account.publisher_transport==='API'?'selected':''}>API</option></select></label>
    <label>现有 API 授权配置文件地址（切换 API 时使用）<input id="unified-credential-ref" placeholder="本机绝对路径；不要填写 token 或密码"></label><button id="unified-switch-transport">保存发布方式</button>`:`<p>${esc(platforms[account.platform])} · ${esc(account.publisher_transport)}${account.platform==='wechat_official_account'?' · 仅入草稿，不公开发表':''}</p>`}
    <p>先核对冻结版本并确认，再明确执行发布。提交结果不明确时先核对，不会自动换模式重发。</p>
    <form id="unified-content-form"><h3>接入云端内容版本</h3>
      <label>云端内容编号<input name="source_id" required></label><label>版本<input name="revision" required></label>
      <label>标题<input name="title"></label><label>正文<textarea name="body" required></textarea></label>
      <label>媒体引用（每行一个）<textarea name="media"></textarea></label><button>保存内容版本</button>
    </form>
    <button type="button" id="unified-recommend-next">推荐下一篇未发布内容</button><label>选择共享内容<select id="unified-content">${contents.map(c=>`<option value="${esc(c.id)}">${esc(c.title||c.id)}</option>`).join('')}</select></label>
    <label>本平台标题<input id="unified-payload-title"></label><label>本平台正文／公众号 Markdown<textarea id="unified-payload-body"></textarea></label><label>话题（每行一个，不带 #）<textarea id="unified-payload-tags"></textarea></label><label>公众号作者<input id="unified-payload-author" value="驻越经营实录"></label>
    <button id="unified-create" ${(!account.platform||account.platform==='facebook')&&account.identity_type!=='PAGE'||!contents.length?'disabled':''}>创建${account.platform==='wechat_official_account'?'草稿':'发布'}预览</button>
    <label><input type="checkbox" id="unified-all-accounts">查看当前客户全部账号的任务</label>
    <p id="unified-status" role="status"></p><div id="unified-jobs"></div>
  </section>`;
}

export async function mountUnifiedPublisher({workspace,account,token,executionEnabled=false,onChanged,contents=[],accounts=[]}) {
  const manager=document.getElementById('unified-account-manager'),form=manager?.querySelector('#unified-account-form');
  if(manager?.dataset.workspace===workspace&&form){
    const status=manager.querySelector('#unified-account-status');
    form.elements.id.onchange=()=>{const a=accounts.find(a=>a.id===form.elements.id.value);if(!a){form.reset();return;}for(const key of ['platform','display_name','external_id','expected_identity','profile_id','config_url'])form.elements[key].value=a[key]||'';for(const key of ['mcp_endpoint','connector_entry','collection'])form.elements[key].value=a.publisher_options?.[key]||'';form.elements.profile_identity_confirmed.checked=a.publisher_options?.profile_identity_confirmed===true;};
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;
      try{const input=Object.fromEntries(new FormData(form));if(!input.id)delete input.id;
        const fields=input.platform==='xiaohongshu'?['mcp_endpoint']:input.platform==='wechat_official_account'?['connector_entry']:['collection'];
        input.publisher_options=Object.fromEntries(fields.filter(k=>input[k]).map(k=>[k,input[k]]));if(input.platform==='wechat_channels')input.publisher_options.profile_identity_confirmed=form.elements.profile_identity_confirmed.checked;
        const response=await fetch(`/api/unified/workspaces/${encodeURIComponent(workspace)}/accounts`,{method:'POST',headers:{'content-type':'application/json','x-local-token':token},body:JSON.stringify(input)}),value=await response.json();if(!response.ok)throw Error(value.error||'保存失败');
        if(manager.isConnected)await onChanged();
      }catch(error){if(manager.isConnected)status.textContent=error.message;}finally{if(button.isConnected)button.disabled=false;}
    };
  }
  const root=document.getElementById('unified-publisher');
  if(!account||!root||root.dataset.workspace!==workspace||root.dataset.account!==account.id)return;
  const status=root.querySelector('#unified-status'),jobs=root.querySelector('#unified-jobs');
  const prefix=`/api/unified/workspaces/${encodeURIComponent(workspace)}`;
  async function request(path,input) {
    const response=await fetch(prefix+path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-local-token':token},body:JSON.stringify(input)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data;
  }
  async function run(button,fn,{enableAfter=true}={}) {
    button.disabled=true;try{await fn();}catch(error){if(root.isConnected)status.textContent=error.message;}finally{if(button.isConnected&&enableAfter)button.disabled=false;}
  }
  let revision=0;
  root.querySelector('#unified-inspect-account').onclick=event=>run(event.currentTarget,async()=>{const result=await request(`/accounts/${encodeURIComponent(account.id)}/inspect`,{});if(root.isConnected)status.textContent=result.healthy?'已核实当前平台身份：'+result.externalId+(result.identityEvidence?' · '+result.identityEvidence:''):result.reason||'需检查登录或连接';});
  async function loadJobs() {
    const requestRevision=++revision,all=root.querySelector('#unified-all-accounts').checked;
    const result=await request('/jobs'+(all?'':'?accountId='+encodeURIComponent(account.id)));
    if(!root.isConnected||requestRevision!==revision)return;
    jobs.innerHTML=result.jobs.map(job=>`<article class="panel"><b>${esc(job.snapshot.title||job.content_id)} · ${esc(states[job.state]||job.state)}</b>
      <p>${esc(platforms[job.snapshot.platform||'facebook'])} · ${esc(job.snapshot.expectedIdentity)} · ${esc(job.snapshot.externalId)} · ${esc(job.snapshot.transport)}</p>
      <details><summary>核对冻结正文与媒体</summary><pre>${esc(job.snapshot.body)}</pre><pre>${esc(job.snapshot.media.join('\n'))}</pre></details>
      ${job.state==='DRAFT'?`<button data-approve="${esc(job.id)}">确认此版本</button>`:''}
      ${executionButton(job)}
      ${job.state==='UNKNOWN'?`<label>平台作品 ID（缺回执时填写）<input data-platform-id="${esc(job.id)}"></label><button data-reconcile="${esc(job.id)}">只读核对平台结果</button>`:''}
      ${job.state==='UNKNOWN'&&job.evidence.stage==='PREPARING'&&!job.evidence.submissionIntent?`<button data-resolve-preparation="${esc(job.id)}">人工核对准备中断（没有最终提交）</button>`:''}
      ${job.state==='BLOCKED'?`<button data-reopen="${esc(job.id)}">修复条件后重新审核</button>`:''}
      ${job.evidence.url?`<a target="_blank" rel="noopener" href="${esc(job.evidence.url)}">查看平台作品</a>`:''}
      ${job.evidence.error?`<p>${esc(job.evidence.error)}</p>`:''}
      ${['DRAFT','READY','BLOCKED'].includes(job.state)?`<button data-cancel="${esc(job.id)}">取消任务</button>`:''}
      </article>`).join('')||'<p>当前范围没有发布任务。</p>';
    jobs.querySelectorAll('[data-approve]').forEach(button=>button.onclick=()=>run(button,async()=>{
      const job=result.jobs.find(j=>j.id===button.dataset.approve);
      await request(`/jobs/${encodeURIComponent(job.id)}/approve`,{snapshot_hash:job.snapshot_hash});await loadJobs();
    }));
    jobs.querySelectorAll('[data-cancel]').forEach(button=>button.onclick=()=>run(button,async()=>{
      await request(`/jobs/${encodeURIComponent(button.dataset.cancel)}/cancel`,{});await loadJobs();
    }));
    jobs.querySelectorAll('[data-resolve-preparation]').forEach(button=>button.onclick=()=>run(button,async()=>{if(!window.confirm('准备上传可能已产生临时对象。确认已检查现场，并仅恢复到阻断待审核状态？不会删除平台数据或自动重试。'))return;await request(`/jobs/${encodeURIComponent(button.dataset.resolvePreparation)}/resolve-preparation`,{acknowledge_preparation_effects:true});await loadJobs();}));
    for(const action of ['execute','reconcile','reopen'])jobs.querySelectorAll(`[data-${action}]`).forEach(button=>button.onclick=()=>run(button,async()=>{
      const id=button.dataset[action];
      const job=result.jobs.find(j=>j.id===id);
      if(action==='execute'&&!window.confirm(`确认用此任务冻结的账号、模式与内容${job.snapshot.platform==='wechat_official_account'?'写入公众号草稿（不公开发表）':'发布到 '+(platforms[job.snapshot.platform||'facebook'])}？`))return;
      const input=action==='reconcile'?{platform_id:root.querySelector(`[data-platform-id="${id}"]`)?.value||undefined}:{};
      try {await request(`/jobs/${encodeURIComponent(id)}/${action}`,input);}finally{await loadJobs();}
    },{enableAfter:action!=='execute'}));
  }
  root.querySelector('#unified-all-accounts').onchange=()=>loadJobs().catch(e=>{if(root.isConnected)status.textContent=e.message;});
  if(root.querySelector('#unified-switch-transport'))root.querySelector('#unified-switch-transport').onclick=event=>run(event.currentTarget,async()=>{
    await request(`/accounts/${encodeURIComponent(account.id)}/transport`,{transport:root.querySelector('#unified-transport').value,config_url:root.querySelector('#unified-credential-ref').value||undefined});
    if(root.isConnected)await onChanged();
  });
  root.querySelector('#unified-content-form').onsubmit=event=>{
    event.preventDefault();const form=event.currentTarget,input=Object.fromEntries(new FormData(form));input.media=input.media.split('\n').map(x=>x.trim()).filter(Boolean);
    run(form.querySelector('button'),async()=>{await request('/content',input);if(root.isConnected)await onChanged();});
  };
  const select=root.querySelector('#unified-content');
  const fillPayload=()=>{const content=contents.find(c=>c.id===select.value),p=content?.platform_payloads?.[account.platform]||content||{};root.querySelector('#unified-payload-title').value=p.title||'';root.querySelector('#unified-payload-body').value=p.body||'';root.querySelector('#unified-payload-tags').value=(p.tags||[]).join('\n');root.querySelector('#unified-payload-author').value=p.author||'驻越经营实录';};select.onchange=fillPayload;fillPayload();
  let publicationStates;
  const recommend=async(auto=false)=>{const result=await request('/accounts/'+encodeURIComponent(account.id)+'/content-status');if(!root.isConnected)return;publicationStates=result.states;for(const option of select.options){const row=contents.find(c=>c.id===option.value),states=publicationStates[option.value]||[];option.textContent=(row?.title||option.value)+(states.includes('PUBLISHED')?' · 已发布':states.includes('DRAFT_WRITTEN')?' · 草稿已写入':states.includes('PUBLISHED_ID_PENDING')?' · 列表已确认/ID待核对':states.some(s=>['PREPARING','SUBMITTING','UNKNOWN','READY'].includes(s))?' · 执行中/待核对':' · 无已确认发布记录');}if(auto&&select.dataset.userPicked)return;const next=[...contents].sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),'zh',{numeric:true})).find(c=>!(publicationStates[c.id]||[]).some(s=>['PUBLISHED','DRAFT_WRITTEN','PUBLISHED_ID_PENDING','PREPARING','SUBMITTING','UNKNOWN','READY'].includes(s)));if(next){select.value=next.id;fillPayload();}else if(!auto)status.textContent='没有可推荐的未发布内容；已发布项仍可手工选择。';};
  select.addEventListener('change',()=>select.dataset.userPicked='true');
  root.querySelectorAll('#unified-payload-title,#unified-payload-body,#unified-payload-tags,#unified-payload-author').forEach(input=>input.addEventListener('input',()=>select.dataset.userPicked='true'));
  
  root.querySelector('#unified-recommend-next').onclick=event=>run(event.currentTarget,()=>recommend());
  recommend(true).catch(error=>{if(root.isConnected)status.textContent=error.message;});
  root.querySelector('#unified-create').onclick=event=>run(event.currentTarget,async()=>{
    await request('/jobs',{account_id:account.id,content_id:select.value,payload:{title:root.querySelector('#unified-payload-title').value,body:root.querySelector('#unified-payload-body').value,tags:root.querySelector('#unified-payload-tags').value.split('\n').map(s=>s.trim()).filter(Boolean),author:root.querySelector('#unified-payload-author').value}});await loadJobs();
  });
  await loadJobs();
}
