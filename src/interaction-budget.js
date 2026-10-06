import {randomUUID} from 'node:crypto';

export function interactionTarget(url,fallback) {
  try{const u=new URL(url);const post=u.pathname.match(/\/(?:posts|permalink)\/(\d+)/)?.[1]||u.searchParams.get('story_fbid');return post?`post:${post}`:u.origin+u.pathname.replace(/\/$/,'');}catch{return String(fallback);}
}
/** Both discovery strategies reserve this ledger inside the Store transaction. */
export class InteractionBudget {
  constructor(store){this.store=store;this.db=store.db;this.db.exec(`CREATE TABLE IF NOT EXISTS interaction_budget(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,account_id TEXT NOT NULL,group_id TEXT,author_key TEXT,target TEXT NOT NULL,operation TEXT NOT NULL,owner TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(workspace,account_id,target,operation));CREATE INDEX IF NOT EXISTS interaction_budget_scope ON interaction_budget(workspace,account_id,state,created_at);`);}
  status(workspace,accountId){const policy=this.store.engagementPolicy(workspace,accountId),since=new Date(Date.now()-86400000).toISOString(),used=this.db.prepare("SELECT count(*) n FROM interaction_budget WHERE workspace=? AND account_id=? AND operation='REPLY' AND state IN ('RESERVED','CONSUMED') AND created_at>=?").get(workspace,accountId,since).n;return {used,dailyLimit:policy?.daily_reply_limit||12,remaining:Math.max(0,(policy?.daily_reply_limit||12)-used)};}
  reserve({workspace,accountId,groupId,author,target,operation='REPLY',owner}){
    const old=this.db.prepare('SELECT * FROM interaction_budget WHERE workspace=? AND account_id=? AND target=? AND operation=?').get(workspace,accountId,target,operation);
    if(old&&old.state!=='RELEASED')throw Error('同一账号已在其他互动入口处理或预留此目标');
    if(operation==='REPLY'){
      const status=this.status(workspace,accountId),policy=this.store.engagementPolicy(workspace,accountId);
      if(policy?.paused||policy?.cooldown_until>new Date().toISOString())throw Error('该账号互动已暂停或处于冷却期');
      if(!status.remaining)throw Error('账号共同回复额度已用完');
      const since=new Date(Date.now()-86400000).toISOString(),week=new Date(Date.now()-7*86400000).toISOString();
      const group=this.db.prepare("SELECT count(*) n FROM interaction_budget WHERE workspace=? AND account_id=? AND group_id=? AND operation='REPLY' AND state IN ('RESERVED','CONSUMED') AND created_at>=?").get(workspace,accountId,groupId,since).n;
      const byAuthor=this.db.prepare("SELECT count(*) n FROM interaction_budget WHERE workspace=? AND account_id=? AND author_key=? AND operation='REPLY' AND state IN ('RESERVED','CONSUMED') AND created_at>=?").get(workspace,accountId,author,week).n;
      if(group>=(policy?.group_daily_limit||3))throw Error('群组共同回复额度已用完');
      if(byAuthor>=(policy?.author_weekly_limit||2))throw Error('作者共同互动额度已用完');
    }
    this.db.prepare(`INSERT INTO interaction_budget VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace,account_id,target,operation) DO UPDATE SET owner=excluded.owner,state='RESERVED',created_at=excluded.created_at WHERE interaction_budget.state='RELEASED'`).run(randomUUID(),workspace,accountId,groupId||null,author||'',target,operation,owner,'RESERVED',new Date().toISOString());
  }
  finish(owner,state){if(!['CONSUMED','RELEASED'].includes(state))throw Error('互动额度状态无效');this.db.prepare("UPDATE interaction_budget SET state=? WHERE owner=? AND state='RESERVED'").run(state,owner);}
}
