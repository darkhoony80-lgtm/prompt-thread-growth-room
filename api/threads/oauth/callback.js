import {setSession} from '../../../lib-threads-session.js';
function cv(h,n){const x=(h||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(n+'='));return x?decodeURIComponent(x.slice(n.length+1)):''}
export default async function handler(req,res){
  const {code,state,error,error_description}=req.query||{};
  if(error) return res.status(400).send(`Threads OAuth 실패: ${String(error_description||error)}`);
  const expected=cv(req.headers.cookie,'threads_oauth_state');
  if(!code||!state||!expected||state!==expected) return res.status(400).send('Threads OAuth state 검증에 실패했습니다. 다시 연결해 주세요.');
  const appId=process.env.THREADS_APP_ID, appSecret=process.env.THREADS_APP_SECRET;
  if(!appId||!appSecret) return res.status(503).send('Vercel Threads App Secret 설정이 필요합니다.');
  const redirectUri='https://prompt-thread-growth-room.vercel.app/api/threads/oauth/callback';
  const body=new URLSearchParams({client_id:appId,client_secret:appSecret,code:String(code),grant_type:'authorization_code',redirect_uri:redirectUri});
  const r=await fetch('https://graph.threads.net/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const t=await r.json().catch(()=>({}));
  if(!r.ok||!t.access_token||!t.user_id) return res.status(502).send('Threads 토큰 교환 실패. Redirect URL과 Meta 앱 설정을 확인해 주세요.');
  setSession(res,{accessToken:String(t.access_token),userId:String(t.user_id),connectedAt:Date.now()});
  res.redirect(302,'/?threads_oauth=connected#settings');
}
