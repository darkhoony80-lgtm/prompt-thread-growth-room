import crypto from 'node:crypto';

const COOKIE='pt_threads_session';
const DAY=24*60*60*1000;
const REFRESH_BEFORE=7*DAY;

function key(){return crypto.createHash('sha256').update(String(process.env.THREADS_APP_SECRET||'')).digest()}
function b64(buf){return Buffer.from(buf).toString('base64url')}
function ub64(s){return Buffer.from(String(s||''),'base64url')}

export function encodeSession(data){
  if(!process.env.THREADS_APP_SECRET)throw new Error('THREADS_APP_SECRET_NOT_CONFIGURED');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const raw=Buffer.from(JSON.stringify(data));
  const enc=Buffer.concat([cipher.update(raw),cipher.final()]);
  return [b64(iv),b64(cipher.getAuthTag()),b64(enc)].join('.');
}

export function decodeSession(req){
  try{
    const raw=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));
    if(!raw)return null;
    const val=decodeURIComponent(raw.slice(COOKIE.length+1)),[a,b,c]=val.split('.');
    const decipher=crypto.createDecipheriv('aes-256-gcm',key(),ub64(a));
    decipher.setAuthTag(ub64(b));
    return JSON.parse(Buffer.concat([decipher.update(ub64(c)),decipher.final()]).toString('utf8'));
  }catch{return null}
}

export function setSession(res,data){
  const now=Date.now();
  const requested=data?.expiresAt?Math.floor((Number(data.expiresAt)-now)/1000):60*60*24*60;
  const maxAge=Math.max(60*60*24,Math.min(60*60*24*60,requested||60*60*24*60));
  res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(encodeSession(data))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

export function clearSession(res){
  res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

async function refreshLongLived(session){
  const u=new URL('https://graph.threads.net/refresh_access_token');
  u.searchParams.set('grant_type','th_refresh_token');
  u.searchParams.set('access_token',session.accessToken);
  const r=await fetch(u,{headers:{Accept:'application/json'}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j?.access_token){
    const e=new Error(j?.error?.message||'THREADS_TOKEN_REFRESH_FAILED');
    e.status=r.status;
    throw e;
  }
  const expiresIn=Number(j.expires_in)||5184000;
  return {...session,accessToken:String(j.access_token),tokenType:'long_lived',expiresAt:Date.now()+expiresIn*1000,refreshedAt:Date.now()};
}

export async function getValidSession(req,res){
  const s=decodeSession(req);
  if(!s?.accessToken||!s?.userId)return null;
  const expiresAt=Number(s.expiresAt)||0;
  const expired=expiresAt>0&&expiresAt<=Date.now();
  const shouldRefresh=s.tokenType==='long_lived'&&(!expiresAt||expiresAt-Date.now()<=REFRESH_BEFORE);
  if(!shouldRefresh){
    if(expired){clearSession(res);return null}
    return s;
  }
  try{
    const fresh=await refreshLongLived(s);
    setSession(res,fresh);
    return fresh;
  }catch(e){
    console.error('[THREADS_TOKEN_REFRESH_FAILED]',JSON.stringify({message:e?.message||String(e),status:e?.status||null,expiresAt:expiresAt||null}));
    if(expired){clearSession(res);return null}
    return s;
  }
}
