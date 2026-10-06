const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function unifiedPublisherView(workspace,account,contents=[]) {
  if(!workspace||!account)return '<section class="panel empty">请选择客户与运营账号。</section>';
  return `<section class="panel" id="unified-publisher" data-workspace="${esc(workspace)}" data-account="${esc(account.id)}">
    <h2>发布</h2><p>当前操作身份：${esc(account.display_name)}。内容库由当前客户的账号共享，任务按操作账号记录。</p>
    <label>新任务发布方式<select id="unified-transport"><option value="BROWSER" ${account.publisher_transport!=='API'?'selected':''}>浏览器</option><option value="API" ${account.publisher_transport==='API'?'selected':''}>API</option></select></label>
    <label>现有 API 授权配置文件地址（切换 API 时使用）<input id="unified-credential-ref" placeholder="本机绝对路径；不要填写 token 或密码"></label><button id="unified-switch-transport">保存发布方式</button>
    <p>先核对冻结版本并确认，再明确执行发布。提交结果不明确时先核对，不会自动换模式重发。</p>
    <form id="unified-content-form"><h3>接入云端内容版本</h3>
      <label>云端内容编号<input name="source_id" required></label><label>版本<input name="revision" required></label>
      <label>标题<input name="title"></label><label>正文<textarea name="body" required></textarea></label>
      <label>媒体引用（每行一个）<textarea name="media"></textarea></label><button>保存内容版本</button>
    </form>
    <label>选择共享内容<select id="unified-content">${contents.map(c=>`<option value="${esc(c.id)}">${esc(c.title||c.id)}</option>`).join('')}</select></label>
    <button id="unified-create" ${account.identity_type!=='PAGE'||!contents.length?'disabled':''}>创建 Page 发布预览</button>
    <label><input type="checkbox" id="unified-all-accounts">查看当前客户全部账号的任务</label>
    <p id="unified-status" role="status"></p><div id="unified-jobs"></div>
  </section>`;
}

export async function mountUnifiedPublisher({workspace,account,token,executionEnabled=false,onChanged}) {
  const root=document.getElementById('unified-publisher');
  if(!root||root.dataset.workspace!==workspace||root.dataset.account!==account.id)return;
  const status=root.querySelector('#unified-status'),jobs=root.querySelector('#unified-jobs');
  const prefix=`/api/unified/workspaces/${encodeURIComponent(workspace)}`;
  async function request(path,input) {
    const response=await fetch(prefix+path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-local-token':token},body:JSON.stringify(input)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data;
  }
  async function run(button,fn) {
    button.disabled=true;try{await fn();}catch(error){if(root.isConnected)status.textContent=error.message;}finally{if(button.isConnected)button.disabled=false;}
  }
  let revision=0;
  async function loadJobs() {
    const requestRevision=++revision,all=root.querySelector('#unified-all-accounts').checked;
    const result=await request('/jobs'+(all?'':'?accountId='+encodeURIComponent(account.id)));
    if(!root.isConnected||requestRevision!==revision)return;
    jobs.innerHTML=result.jobs.map(job=>`<article class="panel"><b>${esc(job.snapshot.title||job.content_id)} · ${esc(job.state)}</b>
      <p>${esc(job.snapshot.expectedIdentity)} · ${esc(job.snapshot.externalId)} · ${esc(job.snapshot.transport)}</p>
      <details><summary>核对冻结正文与媒体</summary><pre>${esc(job.snapshot.body)}</pre><pre>${esc(job.snapshot.media.join('\n'))}</pre></details>
      ${job.state==='DRAFT'?`<button data-approve="${esc(job.id)}">确认此版本</button>`:''}
      ${job.state==='READY'?`<button data-execute="${esc(job.id)}" ${executionEnabled?'':'disabled'}>${executionEnabled?'执行已确认发布':'验收模式：不提交'}</button>`:''}
      ${job.state==='UNKNOWN'?`<label>平台作品 ID（缺回执时填写）<input data-platform-id="${esc(job.id)}"></label><button data-reconcile="${esc(job.id)}">只读核对平台结果</button>`:''}
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
    for(const action of ['execute','reconcile','reopen'])jobs.querySelectorAll(`[data-${action}]`).forEach(button=>button.onclick=()=>run(button,async()=>{
      const id=button.dataset[action];
      if(action==='execute'&&!window.confirm('确认用此任务冻结的账号、模式与内容发布到 Facebook？'))return;
      const input=action==='reconcile'?{platform_id:root.querySelector(`[data-platform-id="${id}"]`)?.value||undefined}:{};
      try {await request(`/jobs/${encodeURIComponent(id)}/${action}`,input);}finally{await loadJobs();}
    }));
  }
  root.querySelector('#unified-all-accounts').onchange=()=>loadJobs().catch(e=>{if(root.isConnected)status.textContent=e.message;});
  root.querySelector('#unified-switch-transport').onclick=event=>run(event.currentTarget,async()=>{
    await request(`/accounts/${encodeURIComponent(account.id)}/transport`,{transport:root.querySelector('#unified-transport').value,config_url:root.querySelector('#unified-credential-ref').value||undefined});
    if(root.isConnected)await onChanged();
  });
  root.querySelector('#unified-content-form').onsubmit=event=>{
    event.preventDefault();const form=event.currentTarget,input=Object.fromEntries(new FormData(form));input.media=input.media.split('\n').map(x=>x.trim()).filter(Boolean);
    run(form.querySelector('button'),async()=>{await request('/content',input);if(root.isConnected)await onChanged();});
  };
  root.querySelector('#unified-create').onclick=event=>run(event.currentTarget,async()=>{
    await request('/jobs',{account_id:account.id,content_id:root.querySelector('#unified-content').value});await loadJobs();
  });
  await loadJobs();
}
