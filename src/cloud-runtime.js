import {timingSafeEqual,createHash} from 'node:crypto';
export function cloudRuntime(env=process.env){
 if(env.PUBLISHER_MODE!=='cloud')return null;
 const origin=new URL(env.PUBLIC_ORIGIN||'');
 if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('PUBLIC_ORIGIN 必须是 HTTPS 站点根地址');
 const password=env.ADMIN_PASSWORD||'';
 if(password.length<24)throw Error('ADMIN_PASSWORD 至少24个字符');
 if(!env.DATA_DIR?.startsWith('/'))throw Error('DATA_DIR 必须为绝对路径');
 return {origin:origin.origin,host:origin.host,password,user:env.ADMIN_USER||'admin',dataDir:env.DATA_DIR};
}
const digest=x=>createHash('sha256').update(x).digest();
export function authenticate(req,res,config){
 let decoded='';try{if(req.headers.authorization?.startsWith('Basic '))decoded=Buffer.from(req.headers.authorization.slice(6),'base64').toString('utf8')}catch{}
 if(timingSafeEqual(digest(decoded),digest(config.user+':'+config.password)))return true;
 res.writeHead(401,{'WWW-Authenticate':'Basic realm="VietBridge", charset="UTF-8"','Cache-Control':'no-store'});
 res.end('请登录 VietBridge 管理后台');return false;
}
