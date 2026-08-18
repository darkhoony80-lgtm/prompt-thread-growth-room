import crypto from 'node:crypto';

const COOKIE='pt_threads_session';
function key(){return crypto.createHash('sha256').update(String(process.env.THREADS_APP_SECRET||'')).digest()}
function b64(buf){return Buffer.from(buf).toString('base64url')}
function ub64(s){return Buffer.from(String(s||''),'base64url')}
export function encodeSession(data){
  if(!process.env.THREADS_APP_SECRET) throw new Error('THREADS_APP_SECRET_NOT_CONFIGURED');
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const raw=Buffer.from(JSON.stringify(data));
  const enc=Buffer.concat([cipher.update(raw),cipher.final()]);
  return [b64(iv),b64(cipher.getAuthTag()),b64(enc)].join('.');
}
export function decodeSession(req){
  try{
    const raw=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));
    if(!raw) return null;
    const val=decodeURIComponent(raw.slice(COOKIE.length+1)); const [a,b,c]=val.split('.');
    const decipher=crypto.createDecipheriv('aes-256-gcm',key(),ub64(a)); decipher.setAuthTag(ub64(b));
    return JSON.parse(Buffer.concat([decipher.update(ub64(c)),decipher.final()]).toString('utf8'));
  }catch{return null}
}
export function setSession(res,data){
  const maxAge=60*60*24*30;
  res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(encodeSession(data))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}
export function clearSession(res){res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`)}
