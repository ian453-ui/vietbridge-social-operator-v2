import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {groupNameMatches} from './group-filters.js';

const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const execFileAsync=promisify(execFile);
export class FacebookBrowser {
  constructor(store){this.store=store;this.processes=new Map();this.activeProfiles=new Set();this.manualWatchers=new Set();}
  async launch(workspace,profileId){const p=this.profile(workspace,profileId);if(await cdpReady(p.cdp_port)){if(!await portMatchesProfile(p))throw new Error('调试端口被另一个 Chrome 数据目录占用；请关闭旧窗口或更换端口，不能复用其他账号会话');await this.openFacebook(p);return {status:'READY',cdp_port:p.cdp_port};}const child=spawn(CHROME,[`--remote-debugging-port=${p.cdp_port}`,`--user-data-dir=${p.user_data_dir}`,'--no-first-run','https://www.facebook.com/groups/joins/'],{detached:true,stdio:'ignore'});child.unref();this.processes.set(profileId,child.pid);for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,250));if(await cdpReady(p.cdp_port)){if(!await portMatchesProfile(p))throw new Error('Chrome 已启动但端口与数据目录不匹配；已停止授权');this.store.db.prepare("UPDATE execution_profiles SET status='READY',last_error=NULL WHERE id=?").run(profileId);return {status:'READY',cdp_port:p.cdp_port};}}this.store.db.prepare("UPDATE execution_profiles SET status='BLOCKED',last_error='Chrome CDP 未就绪' WHERE id=?").run(profileId);throw new Error('Chrome 未能启动；请检查执行环境或手动关闭同目录的 Chrome');}
  async openFacebook(profile){const {chromium}=await import('playwright-core');const browser=await chromium.connectOverCDP(`http://127.0.0.1:${profile.cdp_port}`,{noDefaults:true,timeout:15000});try{const context=browser.contexts()[0];if(!context)throw Error('Chrome 没有可连接的会话');const page=context.pages().find(p=>p.url().startsWith('https://www.facebook.com/'))||await context.newPage();if(!page.url().startsWith('https://www.facebook.com/'))await page.goto('https://www.facebook.com/',{waitUntil:'domcontentloaded',timeout:30000});await page.bringToFront();}finally{await browser.close();}}
  async inspect(workspace,accountId){
    const account=this.store.account(workspace,accountId),profile=this.profile(workspace,account.profile_id);
    const {browser,page}=await this.page(profile);
    try{
      await page.goto('https://www.facebook.com/me',{waitUntil:'domcontentloaded',timeout:45000});
      await page.locator('h1,input[name="email"],[aria-label="Your profile"]').first().waitFor({state:'visible',timeout:15000}).catch(()=>{});
      const url=page.url(),title=await page.title(),body=await page.locator('body').innerText().catch(()=>'');
      if(await page.locator('input[name="email"],input[name="pass"]').count()||/login|checkpoint/i.test(url)||/Log in to Facebook|登录 Facebook/i.test(body)){
        this.health(account.id,'LOGIN_REQUIRED',false);return {healthy:false,actualIdentity:null,url,title,blocker:'FACEBOOK_LOGIN_REQUIRED'};
      }
      // The /me link in the account menu identifies the current actor. The
      // first h1 can be "Manage Page", or a page being viewed by a different actor.
      const identity=await currentActorName(page);
      const externalId=profileIdFromUrl(url);
      if(!identity||!externalId){this.health(account.id,'IDENTITY_UNVERIFIED',false);return {healthy:false,actualIdentity:identity||null,url,title,blocker:'FACEBOOK_IDENTITY_NOT_OBSERVABLE'};}
      const matches=identityMatches(identity,externalId,account);
      if(matches&&!account.external_id)this.store.db.prepare('UPDATE facebook_accounts SET external_id=? WHERE id=?').run(externalId,account.id);
      this.health(account.id,matches?'HEALTHY':'WRONG_IDENTITY',matches);
      return {healthy:matches,actualIdentity:identity,externalId,url,title,identityEvidence:'CURRENT_ACTOR_MENU_AND_ME_URL',blocker:matches?null:'WRONG_IDENTITY'};
    }finally{await browser.close();}
  }
  async discoverGroups(workspace,accountId){
    const account=this.store.account(workspace,accountId),profile=this.profile(workspace,account.profile_id);
    const checked=await this.inspect(workspace,accountId);
    if(!checked.healthy){
      if(checked.blocker==='WRONG_IDENTITY')throw new Error(`请在 V2 专用 Chrome 从“${checked.actualIdentity}”切换为企业 Page“${account.expected_identity}”，再同步群组`);
      if(checked.blocker==='FACEBOOK_LOGIN_REQUIRED')throw new Error('V2 专用 Chrome 尚未登录 Facebook；请先登录，再切换为企业 Page 后同步。V1 API 授权不等于 V2 浏览器登录。');
      throw new Error('Facebook 身份尚未加载或无法核验，请在 V2 专用 Chrome 打开企业 Page 后重试');
    }
    const {browser,page}=await this.page(profile);
    try{
      await page.goto('https://www.facebook.com/groups/joins/',{waitUntil:'domcontentloaded',timeout:45000});
      const actor=await currentActorName(page);
      if(!actor)throw new Error('群组页面的当前身份尚未加载，无法安全同步；原群组记录未改动');
      if(actor!==checked.actualIdentity)throw new Error('同步前 Facebook 身份发生变化；已停止，原群组记录未改动');
      await page.locator('a[href*="/groups/"]').first().waitFor({state:'visible',timeout:15000}).catch(()=>{});
      let previous=0,stable=0;
      for(let i=0;i<30&&stable<5;i++){
        await page.mouse.wheel(0,1600);
        await page.waitForTimeout(500);
        const count=await page.locator('a[href*="/groups/"]').count();
        stable=count>previous?0:stable+1;
        previous=Math.max(previous,count);
      }
      const links=await page.locator('a[href*="/groups/"]').evaluateAll(es=>es.map(a=>({name:(a.textContent||'').trim(),url:a.href})));
      const groups=normalizeGroupLinks(links);
      if(!groups.length)throw new Error('企业 Page 的“你的群组”中未识别到群组；请确认该 Page 已加入群组，或手工添加链接。原群组记录未删除。');
      return {identity:checked.actualIdentity,groups};
    }finally{await browser.close();}
  }
  async searchGroupTopics(workspace,accountId,input={}){
    const account=this.store.account(workspace,accountId),profile=this.profile(workspace,account.profile_id),policy=this.store.engagementPolicy(workspace,account.id);
    if(!policy)throw new Error('请先保存主题与额度规则');
    if(policy.paused||(policy.cooldown_until&&policy.cooldown_until>new Date().toISOString()))throw new Error('账号已暂停或处于冷却期，不能启动搜索');
    const groupIds=[...new Set(input.group_ids||[])].slice(0,5),topics=[...new Set((input.topics||policy.topics).map(String).map(x=>x.trim()).filter(Boolean))].slice(0,5);
    if(!groupIds.length||!topics.length)throw new Error('请选择白名单群组并配置至少一个主题');
    const groups=groupIds.map(id=>this.store.db.prepare('SELECT * FROM facebook_groups WHERE id=? AND workspace=? AND account_id=? AND enabled=1').get(id,workspace,account.id)||(()=>{throw new Error('搜索范围包含未授权或已停用群组')})());
    if(this.activeProfiles.has(profile.id))throw new Error('该 Facebook 执行环境正在执行其他任务');
    this.activeProfiles.add(profile.id);let browser;
    try{
      let checked=await this.inspect(workspace,account.id);if(!checked.healthy&&checked.blocker==='FACEBOOK_IDENTITY_NOT_OBSERVABLE'){await new Promise(r=>setTimeout(r,1000));checked=await this.inspect(workspace,account.id)}if(!checked.healthy)throw new Error(`Facebook 身份核验失败（${checked.blocker||'UNKNOWN'}），主题雷达已停止`);
      let page;({browser,page}=await this.page(profile));const found=[];
      for(const group of groups)for(const topic of topics){
        const url=`${group.url}/search/?q=${encodeURIComponent(topic)}`;await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
        if(!page.url().includes(new URL(group.url).pathname))throw new Error('Facebook 未停留在白名单群组，主题雷达已停止');
        if(/checkpoint|login/i.test(page.url()))throw new Error('Facebook 要求重新登录或安全验证，主题雷达已停止');
        await page.locator('div[role="article"]').first().waitFor({state:'visible',timeout:12000}).catch(()=>{});
        const pageText=await page.locator('body').innerText();
        if(/temporarily blocked|try again later|security check|暂时封锁|稍后再试|安全验证/i.test(pageText))throw new Error('Facebook 访问受限，搜索已停止');
        if(await currentActorName(page)!==checked.actualIdentity)throw new Error('搜索过程中身份发生变化或无法确认，已停止');
        const raw=await page.locator('div[role="article"]').evaluateAll(nodes=>nodes.slice(0,12).map(node=>({body:(node.innerText||'').trim(),links:[...node.querySelectorAll('a[href]')].map(a=>({url:a.href,text:(a.textContent||'').trim()}))})));
        found.push(...normalizeRadarResults(raw,group,topic,10));
        if(!raw.length&&!/no results|没有找到|找不到结果|无搜索结果/i.test(pageText))throw new Error('无法识别搜索结果页面，不能将读取失败当作零结果');
      }
      const unique=[...new Map(found.map(x=>[x.external_id,x])).values()],stored=this.store.ingestRadarPosts(workspace,account.id,unique),candidates=this.store.buildEngagementCandidates(workspace,account.id);
      return {identity:checked.actualIdentity,groups:groups.length,topics:topics.length,found:unique.length,stored:stored.length,candidates:candidates.length,limited:true};
    }finally{await browser?.close().catch(()=>{});this.activeProfiles.delete(profile.id);}
  }
  async scanProactiveEngagement(workspace,accountId){
    const account=this.store.account(workspace,accountId),settings=this.store.proactiveSettings(workspace,account.id);
    if(!settings?.enabled||!settings.global_enabled||!settings.account_enabled)throw new Error('主动互动 GLOBAL 或 ACCOUNT 开关未开启');
    const groups=this.store.db.prepare("SELECT * FROM facebook_groups WHERE workspace=? AND account_id=? AND enabled=1 AND membership_status='JOINED' AND proactive_engagement_enabled=1 ORDER BY name").all(workspace,account.id);
    if(!groups.length)throw new Error('没有已加入且开启主动互动的群组');
    const profile=this.profile(workspace,account.profile_id);if(this.activeProfiles.has(profile.id))throw new Error('该 Facebook 执行环境正在执行其他任务');
    this.activeProfiles.add(profile.id);let browser;
    try{
      const checked=await this.inspect(workspace,account.id);if(!checked.healthy)throw new Error(`Facebook 身份核验失败（${checked.blocker||'UNKNOWN'}），主动扫描已停止`);
      let page;({browser,page}=await this.page(profile));const found=[];let observed=0,unreadableTime=0;
      for(const group of groups){
        await page.goto(group.url+'?sorting_setting=CHRONOLOGICAL',{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(1200);
        await assertSafeFacebookPage(page,group.url);
        const actor=await currentActorName(page);if(!identityMatches(actor,checked.externalId,account))throw new Error('扫描过程中 Facebook 身份发生变化，已停止');
        await page.locator('div[role="article"]').first().waitFor({state:'visible',timeout:12000}).catch(()=>{});
        await page.locator('a[href*="/posts/"],a[href*="/permalink/"],a[href*="set=gm."]').first().waitFor({state:'visible',timeout:8000}).catch(()=>{});
        const raw=await page.evaluate(({max,groupId})=>{
          const canonicalPostLink=url=>{try{const parsed=new URL(url),direct=parsed.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/);if(direct)return direct[1]===groupId?`https://www.facebook.com/groups/${direct[1]}/posts/${direct[2]}/`:null;const photo=parsed.pathname==='/photo/'&&parsed.searchParams.get('set')?.match(/^gm\.(\d+)$/),photoGroup=parsed.searchParams.get('idorvanity');return photo&&photoGroup===groupId?`https://www.facebook.com/groups/${photoGroup}/posts/${photo[1]}/`:null}catch{return null}};
          const rows=[],seen=new Set(),anchors=[...document.querySelectorAll('a[href]')].filter(a=>canonicalPostLink(a.href));
          for(const anchor of anchors){
            const permalink=canonicalPostLink(anchor.href);if(!permalink||seen.has(permalink))continue;
            let card=anchor;
            for(let i=0;i<18&&card;i++,card=card.parentElement){
              const text=(card.innerText||'').replace(/\s+/g,' ').trim();
              if(text.length>8000)break;
              const hasAuthor=[...card.querySelectorAll('a[href]')].some(a=>new URL(a.href).pathname.startsWith(`/groups/${groupId}/user/`));
              if(hasAuthor&&text.length>=40){break;}
            }
            const text=(card?.innerText||'').trim(),links=[...(card?.querySelectorAll('a[href]')||[])].map(a=>({url:a.href,text:(a.innerText||a.textContent||'').trim(),label:a.getAttribute('aria-label')}));
            if(!text||!links.some(link=>canonicalPostLink(link.url)===permalink))continue;
            const markers=[...(card.querySelectorAll('abbr,time,[data-utime],[aria-label],[title]'))].flatMap(node=>[node.getAttribute('data-utime'),node.getAttribute('datetime'),node.getAttribute('aria-label'),node.getAttribute('title'),node.textContent]).map(x=>(x||'').trim()).filter(Boolean);
            const postLinks=links.filter(link=>canonicalPostLink(link.url)===permalink);
            rows.push({body:text,links,time:card.querySelector('abbr[data-utime]')?.getAttribute('data-utime')||card.querySelector('time[datetime]')?.getAttribute('datetime')||null,times:[...postLinks.flatMap(a=>[a.label,a.text]),...markers]});seen.add(permalink);
            if(rows.length>=max)break;
          }
          return rows;
        },{max:settings.max_posts_per_group,groupId:new URL(group.url).pathname.match(/^\/groups\/([^/]+)/)?.[1]||''});
        const readAt=Date.now();observed+=raw.length;
        if(!raw.length)throw new Error('未识别到带有稳定群组帖子链接和正文的帖子；页面内容可能尚未加载或 Facebook 页面结构已变化，不能将读取失败当作零结果');
        unreadableTime+=raw.filter(row=>!proactivePublishedAt(row,readAt)).length;
        found.push(...normalizeProactiveResults(raw,group,settings.lookback_hours,readAt));
      }
      const stored=this.store.ingestEngagementPosts(workspace,account.id,found),ranked=this.store.rankedEngagementCandidates(workspace,account.id);
      return {identity:checked.actualIdentity,groups:groups.length,observed,unreadableTime,scanned:found.length,candidates:ranked.length,items:ranked};
    }catch(error){if(/checkpoint|login challenge|temporarily blocked|suspicious activity|安全验证|访问受限/i.test(String(error)))this.store.saveProactiveSettings(workspace,{...settings,account_id:account.id,account_enabled:false});throw error}
    finally{await browser?.close().catch(()=>{});this.activeProfiles.delete(profile.id);}
  }
  async executeProactiveEngagement(workspace,postId,replyBody){
    const post=this.store.proactivePost(workspace,postId),account=this.store.account(workspace,post.account_id),profile=this.profile(workspace,account.profile_id),group=this.store.db.prepare('SELECT * FROM facebook_groups WHERE id=? AND workspace=?').get(post.group_id,workspace);
    if(!post.permalink)throw new Error('帖子没有稳定 permalink，不能执行写操作');if(this.activeProfiles.has(profile.id))throw new Error('该 Facebook 执行环境正在执行其他任务');
    this.activeProfiles.add(profile.id);let browser,plan,currentAction,submitted=false;
    try{
      const checked=await this.inspect(workspace,account.id);if(!checked.healthy)throw new Error('Facebook 身份核验失败，主动互动已停止');
      let page;({browser,page}=await this.page(profile));await page.goto(post.permalink,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(1000);await assertSafeFacebookPage(page,group.url);
      const actor=await currentActorName(page);if(!identityMatches(actor,checked.externalId,account))throw new Error('写入前 Facebook 身份发生变化，已阻止操作');
      const body=normalize(await page.locator('body').innerText());if(!body.includes(normalize(post.body).slice(0,Math.min(45,normalize(post.body).length))))throw new Error('帖子正文回读不匹配，已阻止操作');
      const settings=this.store.proactiveSettings(workspace,account.id),effective=effectiveAction(post.proposed_action,settings),likeButton=page.getByRole('button',{name:/^(Like|点赞|赞|Thích|Unlike|取消赞|Bỏ thích)$/i}).first(),commentBox=page.locator('[role="textbox"][contenteditable="true"]').last();
      if(effective.includes('LIKE')&&!await likeButton.count())throw new Error('未找到稳定的点赞按钮，未执行任何写操作');
      if(effective.includes('REPLY')&&!await commentBox.count())throw new Error('未找到稳定的评论输入框，未执行任何写操作');
      plan=this.store.reserveProactivePost(workspace,post.id,replyBody);const results=[];
      for(const action of plan.actions){currentAction=action;submitted=false;
        if(action.action_type==='LIKE'){const label=await likeButton.getAttribute('aria-label')||await likeButton.innerText();if(!/Unlike|取消赞|Bỏ thích/i.test(label)){submitted=true;await likeButton.click({timeout:10000});}}
        else {await commentBox.fill(replyBody);const actual=normalize(await commentBox.textContent());if(actual!==normalize(replyBody))throw new Error('回复文本完整性核对失败');submitted=true;await commentBox.press('Enter');}
        await page.waitForTimeout(1500);const fresh=await browser.contexts()[0].newPage();let evidence;try{await fresh.goto(post.permalink,{waitUntil:'domcontentloaded',timeout:45000});await fresh.waitForTimeout(900);evidence=await proactiveReadback(fresh,action.action_type,replyBody)}finally{await fresh.close().catch(()=>{})}
        if(!evidence.readback_verified)throw new Error('Facebook 写操作后未获得独立页面回读');results.push(this.store.finishProactiveAction(workspace,action.id,evidence));currentAction=null;
      }
      return {decision:plan.decision,actions:results};
    }catch(error){
      if(currentAction)return this.store.markProactiveUnknown(workspace,currentAction.id,String(error));
      if(/checkpoint|login challenge|temporarily blocked|suspicious activity|安全验证|访问受限/i.test(String(error))){const settings=this.store.proactiveSettings(workspace,account.id);this.store.saveProactiveSettings(workspace,{...settings,account_id:account.id,account_enabled:false})}
      throw error;
    }finally{await browser?.close().catch(()=>{});this.activeProfiles.delete(profile.id);}
  }
  async prepareJob(workspace,jobId){const job=this.store.job(workspace,jobId),account=this.store.account(workspace,job.account_id),profile=this.profile(workspace,job.profile_id),group=this.store.db.prepare('SELECT * FROM facebook_groups WHERE id=?').get(job.group_id),content=this.store.db.prepare('SELECT * FROM group_content WHERE id=?').get(job.content_id);const checked=await this.inspect(workspace,account.id);this.store.beginPrepare(workspace,job.id,checked.actualIdentity);let browser;try{let page;({browser,page}=await this.page(profile));await page.goto(group.url,{waitUntil:'domcontentloaded',timeout:45000});if(!page.url().includes(new URL(group.url).pathname))throw new Error('Facebook 未停留在目标群组，已阻止写入');await page.waitForTimeout(1000);const preexisting=await groupPostCandidates(page,group.url,content.body,account.expected_identity);if(preexisting.length)throw new Error('目标群组已有相同正文帖子，请先核对，禁止重复准备');const {dialog,box}=await openPostComposer(page);await box.fill(content.body,{timeout:10000});const actual=await box.textContent();if(normalize(actual)!==normalize(content.body))throw new Error('正文完整性核对失败，已阻止提交');const media=JSON.parse(content.media_json);if(media.length){const input=dialog.locator('input[type=file]').last();if(!await input.count())throw new Error('未找到媒体附件入口');await input.setInputFiles(media);await page.waitForTimeout(1000);}const evidence={target_url:page.url(),group_name:group.name,actual_identity:checked.actualIdentity,text_hash:content.content_hash,media_count:media.length,prepared_at:new Date().toISOString(),human_final_click_required:true,preexisting_post_urls:preexisting};this.store.finishPrepare(workspace,job.id,evidence);setTimeout(()=>this.watchManualPost(workspace,job.id).catch(()=>{}),0).unref();return evidence;}catch(error){if(this.store.job(workspace,job.id).state==='PREPARING')this.store.failBeforeSubmit(workspace,job.id,String(error));throw error;}finally{await browser?.close().catch(()=>{});}}
  async watchManualPost(workspace,jobId){
    if(this.manualWatchers.has(jobId))return;this.manualWatchers.add(jobId);
    const job=this.store.job(workspace,jobId),account=this.store.account(workspace,job.account_id),profile=this.profile(workspace,job.profile_id),group=this.store.db.prepare('SELECT * FROM facebook_groups WHERE id=? AND workspace=?').get(job.group_id,workspace),content=this.store.db.prepare('SELECT * FROM group_content WHERE id=? AND workspace=?').get(job.content_id,workspace);
    let browser;
    try{const session=await this.page(profile);browser=session.browser;const page=session.page,deadline=Date.now()+180000;
      while(Date.now()<deadline&&this.store.job(workspace,jobId).state==='WAITING_FOR_USER'){
        if(page.url().startsWith(group.url)){
          const baseline=new Set(JSON.parse(this.store.job(workspace,jobId).evidence_json||'{}').preexisting_post_urls||[]);
          const urls=(await groupPostCandidates(page,group.url,content.body,account.expected_identity)).filter(url=>!baseline.has(url));
          if(urls.length===1&&await this.verifyGroupPost(browser,urls[0],group,content,account)){
            this.store.claimPost(workspace,jobId,urls[0],{method:'MANUAL_POST_BROWSER_READBACK',checked_at:new Date().toISOString()});return;
          }
        }
        await new Promise(r=>setTimeout(r,4000));
      }
    }finally{await browser?.close().catch(()=>{});this.manualWatchers.delete(jobId);}
  }
  async reconcileJob(workspace,jobId,suppliedUrl){
    const job=this.store.job(workspace,jobId);
    if(job.state==='PUBLISHED'&&JSON.parse(job.evidence_json||'{}').readback)return job;
    if(!['WAITING_FOR_USER','UNKNOWN','FAILED','PUBLISHED'].includes(job.state))throw new Error('当前任务尚未进入可核对状态');
    const account=this.store.account(workspace,job.account_id),profile=this.profile(workspace,job.profile_id),group=this.store.db.prepare('SELECT * FROM facebook_groups WHERE id=? AND workspace=?').get(job.group_id,workspace),content=this.store.db.prepare('SELECT * FROM group_content WHERE id=? AND workspace=?').get(job.content_id,workspace);
    let browser,page;
    try{const session=await this.page(profile);browser=session.browser;page=await browser.contexts()[0].newPage();
      let urls;
      if(suppliedUrl||job.post_url){
        const input=String(suppliedUrl||job.post_url).trim();
        const provided=new URL(input);
        if(provided.protocol!=='https:'||!/(^|\.)facebook\.com$/.test(provided.hostname))throw new Error('请粘贴 Facebook 帖子的完整 https 链接');
        await page.goto(input,{waitUntil:'domcontentloaded',timeout:45000});
        urls=[canonicalGroupPostUrl(page.url(),group.url)];
      }else{
        const baseline=JSON.parse(job.evidence_json||'{}').preexisting_post_urls||[];
        await page.goto(group.url,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(1500);
        urls=(await groupPostCandidates(page,group.url,content.body,account.expected_identity)).filter(url=>!baseline.includes(url));
      }
      if(urls.length!==1)throw new Error(urls.length?'发现多个相似帖子，请粘贴准确帖子链接逐一核对':'群组当前可见页面未找到匹配帖子；可能仍在审核、未发布或被隐藏。任务保持待核对，绝不会自动重发');
      if(!await this.verifyGroupPost(browser,urls[0],group,content,account))throw new Error('帖子链接与群组、作者或正文不一致；未更改任务状态');
      return this.store.claimPost(workspace,jobId,urls[0],{method:'MANUAL_POST_BROWSER_READBACK',checked_at:new Date().toISOString()});
    }finally{await page?.close().catch(()=>{});await browser?.close().catch(()=>{});}
  }
  async verifyGroupPost(browser,url,group,content,account){
    const page=await browser.contexts()[0].newPage();
    try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(1000);
      if(canonicalGroupPostUrl(page.url(),group.url)!==url)return false;
      const body=normalize(await page.locator('body').innerText());
      const expected=normalize(content.body),opening=expected.slice(0,Math.min(70,expected.length));
      const authorLink=account.external_id?await page.locator(`a[href*="/user/${account.external_id}"]`).count():0;
      return Boolean(opening&&body.includes(opening)&&body.includes(normalize(account.expected_identity))&&(!account.external_id||authorLink>0));
    }catch{return false;}finally{await page.close().catch(()=>{});}
  }
  enqueueJobs(workspace,jobIds,filters={}){
    const jobs=[...new Set(jobIds)].map(id=>this.store.job(workspace,id));
    if(!jobs.length)throw new Error('没有可自动发布的新任务');
    if(jobs.some(j=>!['PENDING','FAILED','BLOCKED'].includes(j.state)||this.store.db.prepare('SELECT 1 FROM publication_intents WHERE job_id=? LIMIT 1').get(j.id)))throw new Error('只能发布未提交过的任务；已提交或结果不确定的任务必须先核对');
    if(jobs.some(j=>{const group=this.store.db.prepare('SELECT name FROM facebook_groups WHERE id=? AND workspace=?').get(j.group_id,workspace);return !group||!groupNameMatches(group.name,filters)}))throw new Error('任务包含被当前群组名称筛选排除的群组，已阻止发布');
    const profileIds=[...new Set(jobs.map(j=>j.profile_id))];
    if(profileIds.some(id=>this.activeProfiles.has(id)))throw new Error('该 Facebook 执行环境已有自动发布队列，请等待完成');
    profileIds.forEach(id=>this.activeProfiles.add(id));
    void this.runQueue(workspace,jobs,profileIds);
    return {accepted:jobs.length,job_ids:jobs.map(j=>j.id)};
  }
  async runQueue(workspace,jobs,profileIds){
    try{for(let index=0;index<jobs.length;index++){try{await this.publishJob(workspace,jobs[index].id)}catch(error){
      for(const remaining of jobs.slice(index+1))this.store.blockUnstarted(workspace,remaining.id,`同批前序任务失败，尚未提交：${String(error.message||error)}`);
      break;
    }}}
    finally{profileIds.forEach(id=>this.activeProfiles.delete(id));}
  }
  async publishJob(workspace,jobId){
    const job=this.store.job(workspace,jobId),account=this.store.account(workspace,job.account_id),profile=this.profile(workspace,job.profile_id);
    const group=this.store.db.prepare('SELECT * FROM facebook_groups WHERE id=? AND workspace=?').get(job.group_id,workspace);
    const content=this.store.db.prepare('SELECT * FROM group_content WHERE id=? AND workspace=?').get(job.content_id,workspace);
    let submitted=false,browser;
    try{
      const checked=await this.inspect(workspace,account.id),verifiedAccount=this.store.account(workspace,account.id);
      if(!checked.healthy)throw new Error('Facebook 发布身份核验失败，自动发布已停止');
      this.store.beginPrepare(workspace,job.id,checked.actualIdentity);
      let page;({browser,page}=await this.page(profile));await page.bringToFront();
      await page.goto(group.url,{waitUntil:'domcontentloaded',timeout:45000});
      if(!page.url().includes(new URL(group.url).pathname))throw new Error('Facebook 未停留在目标群组，已阻止提交');
      const actor=await currentActorName(page);if(!identityMatches(actor,verifiedAccount.external_id,verifiedAccount))throw new Error('提交前 Facebook 身份发生变化，已阻止提交');
      const preexisting=await groupPostCandidates(page,group.url,content.body,verifiedAccount.expected_identity);
      if(preexisting.length)throw new Error('目标群组已有相同正文帖子；自动发布已停止，请先核对');
      const {dialog,box}=await openPostComposer(page);await box.fill(content.body,{timeout:10000});
      const actual=await box.textContent();if(normalize(actual)!==normalize(content.body))throw new Error('正文完整性核对失败，已阻止提交');
      const media=JSON.parse(content.media_json);if(media.length){const input=dialog.locator('input[type=file]').last();if(!await input.count())throw new Error('未找到媒体附件入口');await input.setInputFiles(media);await page.waitForTimeout(Math.min(15000,2000+media.length*1500));}
      const snapshot={target_url:page.url(),group_name:group.name,actual_identity:actor,text_hash:content.content_hash,media_count:media.length,prepared_at:new Date().toISOString(),automatic:true,preexisting_post_urls:preexisting};
      this.store.finishPrepare(workspace,job.id,snapshot);
      const publish=dialog.getByRole('button',{name:/^(发布|Post)$/i}).last();await publish.waitFor({state:'visible',timeout:15000});if(await publish.isDisabled())throw new Error('Facebook 发布按钮不可用，媒体可能仍在处理');
      this.store.beginSubmit(workspace,job.id,snapshot);submitted=true;await publish.click({timeout:15000});
      await dialog.waitFor({state:'hidden',timeout:30000}).catch(()=>{});
      const postUrl=await findPublishedPostUrl(page,group.url,content.body,45000,verifiedAccount);
      if(!postUrl||!await this.verifyGroupPost(browser,postUrl,group,content,verifiedAccount))throw new Error('Facebook 已接收提交，但尚未独立回读到匹配帖子；任务已转为待核对，禁止自动重发');
      return this.store.claimPost(workspace,job.id,postUrl,{method:'AUTO_POST_BROWSER_READBACK',checked_at:new Date().toISOString()});
    }catch(error){
      const current=this.store.job(workspace,job.id);
      if(submitted||current.state==='PROCESSING')this.store.markUnknown(workspace,job.id,String(error));
      else if(['PREPARING','WAITING_FOR_USER'].includes(current.state))this.store.failBeforeSubmit(workspace,job.id,String(error));
      else if(current.state==='PENDING')this.store.blockUnstarted(workspace,job.id,String(error));
      throw error;
    }finally{await browser?.close().catch(()=>{});}
  }
  health(accountId,status,verified){this.store.db.prepare('UPDATE facebook_accounts SET session_health=?,identity_verified_at=? WHERE id=?').run(status,verified?new Date().toISOString():null,accountId);}
  profile(workspace,id){return this.store.db.prepare('SELECT * FROM execution_profiles WHERE id=? AND workspace=?').get(id,workspace)||(()=>{throw new Error('执行环境不存在')})();}
  async page(profile){if(!await cdpReady(profile.cdp_port))throw new Error('执行环境未连接，请到“账号与设置”启动 Chrome');if(!await portMatchesProfile(profile))throw Error('调试端口不属于当前客户的 Chrome 数据目录；已阻止跨账号操作');const {chromium}=await import('playwright-core');const browser=await chromium.connectOverCDP(`http://127.0.0.1:${profile.cdp_port}`,{noDefaults:true,timeout:15000});try{const context=browser.contexts()[0];if(!context)throw new Error('Chrome 没有可连接的会话');const page=context.pages().find(p=>/^https:\/\/(www\.)?facebook\.com\//.test(p.url()))||await context.newPage();await page.bringToFront();return {browser,page};}catch(error){await browser.close();throw error;}}
}
export function postComposer(page){
  // Facebook nests a second role=dialog around the "Create post" heading.
  // The last dialog is that header, not the modal containing the editor.
  const dialog=page.locator('[role="dialog"][aria-modal="true"]').last();
  const box=dialog.locator('[role="textbox"][contenteditable="true"]').last();
  return {dialog,box};
}
async function openPostComposer(page){
  const trigger=page.getByRole('button',{name:/写点什么|Write something|Viết gì đó/i}).first();
  await trigger.waitFor({state:'visible',timeout:15000});
  // domcontentloaded precedes Facebook's client-side hydration. Clicking the
  // placeholder immediately can open an editor that is replaced seconds later.
  await page.waitForTimeout(1500);
  for(let attempt=0;attempt<2;attempt++){
    const current=postComposer(page);
    if(await current.box.isVisible().catch(()=>false))return current;
    if(attempt){const close=current.dialog.getByRole('button',{name:/Close composer dialog|关闭/i});if(await close.count())await close.click().catch(()=>{});}
    await trigger.click({timeout:15000});
    const opened=postComposer(page);
    if(await opened.box.waitFor({state:'visible',timeout:10000}).then(()=>true).catch(()=>false)){
      await page.waitForTimeout(500);
      if(await opened.box.isVisible().catch(()=>false))return opened;
    }
  }
  throw new Error('Facebook Create post 编辑器未稳定加载；未提交，可安全重试');
}
export function chromeCommandMatchesProfile(command,profile){
  const args=String(command||'').trim();
  return args.startsWith(`${CHROME} `)&&args.includes(`--remote-debugging-port=${profile.cdp_port} `)&&
    (args.includes(`--user-data-dir=${profile.user_data_dir} `)||args.endsWith(`--user-data-dir=${profile.user_data_dir}`));
}
async function portMatchesProfile(profile){try{const {stdout}=await execFileAsync('/usr/sbin/lsof',['-t','-nP',`-iTCP:${profile.cdp_port}`,'-sTCP:LISTEN'],{timeout:3000});const pid=stdout.trim().split(/\s+/)[0];if(!/^\d+$/.test(pid))return false;const process=await execFileAsync('/bin/ps',['-p',pid,'-o','command='],{timeout:3000});return chromeCommandMatchesProfile(process.stdout,profile);}catch{return false;}}
function normalize(x){return String(x||'').replace(/\s+/g,' ').trim();}
export function profileIdFromUrl(value){try{const u=new URL(value);if(!/^(www\.)?facebook\.com$/.test(u.hostname))return null;return u.pathname==='/profile.php'?u.searchParams.get('id'):null;}catch{return null;}}
export function identityMatches(name,id,account){return normalize(name)===normalize(account.expected_identity)&&Boolean(id)&&(!account.external_id||String(account.external_id)===String(id));}
async function currentActorName(page){
  const trigger=page.getByRole('button',{name:/^(Your profile|你的个人主页|你的个人资料|你的主页|账户|账号|Trang cá nhân của bạn|Hồ sơ của bạn|Tài khoản)$/i}).first();
  if(!await trigger.waitFor({state:'visible',timeout:15000}).then(()=>true).catch(()=>false))return '';
  const opened=await trigger.getAttribute('aria-expanded')!=='true';
  try{
    if(opened)await trigger.click();
    const me=page.getByRole('dialog').locator('a[href="/me/"],a[href="/me"],a[href="https://www.facebook.com/me/"],a[href="https://www.facebook.com/me"]').first();
    await me.waitFor({state:'visible',timeout:15000});
    return normalize(await me.innerText());
  }catch{return '';}finally{if(opened)await trigger.click().catch(()=>{});}
}
async function findPublishedPostUrl(page,groupUrl,body,timeout,account){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    const urls=await groupPostCandidates(page,groupUrl,body,account.expected_identity);
    if(urls.length===1)return urls[0];
    await page.waitForTimeout(2000);await page.reload({waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
  }
  return null;
}
export function canonicalGroupPostUrl(value,groupUrl){
  const url=new URL(String(value)),group=new URL(groupUrl);
  let match=url.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/);
  if(!match&&/^\/photo\/?$/.test(url.pathname)){const photo=url.searchParams.get('set')?.match(/^gm\.(\d+)$/),photoGroup=url.searchParams.get('idorvanity');if(photo&&photoGroup)match=[null,photoGroup,photo[1]];}
  if(!match&&url.pathname==='/story.php'){const story=url.searchParams.get('story_fbid'),storyGroup=url.searchParams.get('id');if(/^\d+$/.test(story||'')&&storyGroup)match=[null,storyGroup,story];}
  if(url.protocol!=='https:'||!/(^|\.)facebook\.com$/.test(url.hostname)||!match)throw new Error('请提供目标 Facebook 群组的帖子链接（帖子、permalink 或照片链接）');
  const groupId=group.pathname.match(/^\/groups\/([^/]+)/)?.[1];
  if(/^\d+$/.test(groupId||'')&&match[1]!==groupId)throw new Error('帖子链接不属于目标群组');
  return `https://www.facebook.com/groups/${match[1]}/posts/${match[2]}/`;
}
export async function groupPostCandidates(page,groupUrl,body,author){
  const prefix=normalize(body).slice(0,Math.min(55,normalize(body).length));
  if(!prefix)return [];
  const groupId=new URL(groupUrl).pathname.match(/^\/groups\/([^/]+)/)?.[1]||'';
  const links=await page.evaluate(({prefix,author,groupId})=>{
    const result=[];
    for(const anchor of document.querySelectorAll('a[href]')){
      let url;try{url=new URL(anchor.href);}catch{continue;}
      let postId='',postGroup='';
      const direct=url.pathname.match(/^\/groups\/([^/]+)\/posts\/(\d+)\/?$/);
      if(direct){postGroup=direct[1];postId=direct[2];}
      else if(url.pathname==='/photo/'&&/^gm\.\d+$/.test(url.searchParams.get('set')||'')){
        postId=url.searchParams.get('set').slice(3);postGroup=url.searchParams.get('idorvanity')||groupId;
      }
      if(!postId||(/^\d+$/.test(groupId)&&postGroup!==groupId))continue;
      let node=anchor,matched=false;
      for(let i=0;i<18&&node;i++,node=node.parentElement){
        const text=(node.innerText||'').replace(/\s+/g,' ').trim();
        if(text.length>8000)break;
        if(text.includes(prefix)&&text.includes(author)){matched=true;break;}
      }
      if(matched)result.push(`https://www.facebook.com/groups/${postGroup}/posts/${postId}/`);
    }
    return [...new Set(result)];
  },{prefix,author,groupId});
  return links;
}
export function normalizeGroupLinks(links){const seen=new Set();return links.map(x=>({name:normalize(x.name),url:String(x.url).split(/[?#]/)[0].replace(/\/$/,'')})).filter(x=>{const m=x.url.match(/^https:\/\/(?:www\.)?facebook\.com\/groups\/([^/]+)$/);return x.name&&m&&!['joins','feed','discover','create','notifications','search','your_groups'].includes(m[1])&&!seen.has(x.url)&&seen.add(x.url);});}
export function normalizeRadarResults(rows,group,topic,limit=10){const seen=new Set(),groupPath=new URL(group.url).pathname.replace(/\/$/,'');return rows.map(row=>{const link=(row.links||[]).map(x=>String(x.url||'').split('?')[0]).find(url=>{try{return new URL(url).pathname.startsWith(groupPath+'/posts/')}catch{return false}});if(!link)return null;const externalId=new URL(link).pathname.match(/\/posts\/([^/]+)/)?.[1],body=normalize(row.body),author=normalize((row.links||[]).find(x=>x.text&&!String(x.url).includes('/posts/'))?.text)||'Facebook 用户';return externalId&&body?{group_id:group.id,external_id:externalId,permalink:link,author,body:body.slice(0,4000),topic}:null}).filter(x=>x&&!seen.has(x.external_id)&&seen.add(x.external_id)).slice(0,Math.min(10,limit));}
export function parseFacebookPostTime(value,now=Date.now()){
  const text=normalize(value).toLowerCase();if(!text)return null;
  const numeric=Number(text);let timestamp;
  if(/^\d{10,13}$/.test(text)&&Number.isFinite(numeric))timestamp=text.length<=10?numeric*1000:numeric;
  else if(/^\d{4}-\d{2}-\d{2}t.*(?:z|[+-]\d{2}:?\d{2})$/i.test(text))timestamp=Date.parse(text);
  else if(/^(just now|刚刚|剛剛|vừa xong)$/.test(text))timestamp=now;
  else {
    const relative=text.match(/^(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|秒钟?|分鐘|分钟|小时|小時|天|giây|phút|giờ|ngày)(?:\s*(ago|前|trước))?$/i);
    if(!relative)return null;
    const unit=relative[2],seconds=/^(s|seconds?|secs?|秒钟?|giây)$/.test(unit)?1:/^(m|minutes?|mins?|分鐘|分钟|phút)$/.test(unit)?60:/^(h|hours?|hrs?|小时|小時|giờ)$/.test(unit)?3600:86400;
    timestamp=now-Number(relative[1])*seconds*1000;
  }
  return Number.isFinite(timestamp)&&timestamp>0&&timestamp<=now+60000?new Date(timestamp).toISOString():null;
}
function proactivePublishedAt(row,now){return [row.time,...(row.times||[])].map(value=>parseFacebookPostTime(value,now)).find(Boolean)||null;}
export function normalizeProactiveResults(rows,group,lookbackHours=24,now=Date.now()){
  const seen=new Set(),cutoff=now-lookbackHours*3600000;
  return rows.flatMap(row=>{
    const link=(row.links||[]).map(x=>String(x.url||'')).find(value=>{try{canonicalGroupPostUrl(value,group.url);return true}catch{return false}});
    if(!link)return [];
    let permalink;try{permalink=canonicalGroupPostUrl(link,group.url)}catch{return []}
    const externalId=new URL(permalink).pathname.match(/\/posts\/(\d+)/)?.[1],body=normalize(row.body),publishedAt=proactivePublishedAt(row,now);
    if(!publishedAt||Date.parse(publishedAt)<cutoff||!externalId||!body||seen.has(externalId))return [];
    seen.add(externalId);
    const author=normalize((row.links||[]).find(x=>x.text&&!/\/(posts|permalink)\//.test(String(x.url)))?.text)||'Facebook 用户';
    return [{group_id:group.id,external_id:externalId,permalink,author,body:body.slice(0,4000),published_at:publishedAt}];
  });
}

async function assertSafeFacebookPage(page,groupUrl){const target=new URL(groupUrl),current=new URL(page.url());if(!/^(www\.)?facebook\.com$/.test(current.hostname)||!(/^(www\.)?facebook\.com$/.test(target.hostname))||current.pathname.match(/^\/groups\/([^/]+)/)?.[1]!==target.pathname.match(/^\/groups\/([^/]+)/)?.[1])throw new Error('Facebook 未停留在授权群组，已停止');const body=await page.locator('body').innerText();if(/checkpoint|login challenge|temporarily blocked|suspicious activity|security check|安全验证|可疑活动|暂时封锁|访问受限/i.test(page.url()+' '+body))throw new Error('Facebook checkpoint 或访问限制，已暂停账号自动化');}
function effectiveAction(action,settings){let out=action;if(out.includes('LIKE')&&!settings?.auto_like)out=out==='LIKE_AND_REPLY'?'REPLY_ONLY':'SKIP';if(out.includes('REPLY')&&!settings?.auto_reply)out=out==='LIKE_AND_REPLY'?'LIKE_ONLY':'SKIP';if(out==='SKIP')throw new Error('当前自动开关没有允许的动作');return out;}
async function proactiveReadback(page,action,replyBody){let liked=true,replied=true;if(action.includes('LIKE')){const unlike=page.getByRole('button',{name:/^(Unlike|取消赞|Bỏ thích)$/i}).first();liked=Boolean(await unlike.count())}if(action.includes('REPLY')){const expected=normalize(replyBody);replied=await page.locator('div[role="article"]').evaluateAll((nodes,text)=>nodes.some(node=>(node.innerText||'').replace(/\s+/g,' ').includes(text)),expected)}return {readback_verified:liked&&replied,liked,replied,checked_at:new Date().toISOString(),method:'FRESH_POST_BROWSER_READBACK'};}
function cdpReady(port){return new Promise(resolve=>{const req=request({host:'127.0.0.1',port,path:'/json/version',timeout:500},res=>{res.resume();resolve(res.statusCode===200)});req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false)});req.end();});}
