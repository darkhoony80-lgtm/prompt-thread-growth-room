import {setSession} from '../../../lib-threads-session.js';

function cv(h,n){
  const x=(h||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(n+'='));
  return x?decodeURIComponent(x.slice(n.length+1)):'';
}

export default async function handler(req,res){
  const {code,state,error,error_description}=req.query||{};
  if(error)return res.status(400).send(`Threads OAuth 실패: ${String(error_description||error)}`);
  const expected=cv(req.headers.cookie,'threads_oauth_state');
  if(!code||!state||!expected||state!==expected)return res.status(400).send('Threads OAuth state 검증에 실패했습니다. 다시 연결해 주세요.');

  const appId=process.env.THREADS_APP_ID,appSecret=process.env.THREADS_APP_SECRET;
  if(!appId||!appSecret)return res.status(503).send('Vercel Threads App Secret 설정이 필요합니다.');

  const redirectUri='https://prompt-thread-growth-room.vercel.app/api/threads/oauth/callback';
  const body=new URLSearchParams({
    client_id:appId,
    client_secret:appSecret,
    code:String(code),
    grant_type:'authorization_code',
    redirect_uri:redirectUri
  });

  const r=await fetch('https://graph.threads.net/oauth/access_token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body
  });
  const shortToken=await r.json().catch(()=>({}));
  if(!r.ok||!shortToken.access_token||!shortToken.user_id){
    return res.status(502).send('Threads 단기 토큰 교환 실패. Redirect URL과 Meta 앱 설정을 확인해 주세요.');
  }

  const u=new URL('https://graph.threads.net/access_token');
  u.searchParams.set('grant_type','th_exchange_token');
  u.searchParams.set('client_secret',appSecret);
  u.searchParams.set('access_token',String(shortToken.access_token));

  const lr=await fetch(u,{headers:{Accept:'application/json'}});
  const longToken=await lr.json().catch(()=>({}));
  if(!lr.ok||!longToken.access_token){
    console.error('[THREADS_LONG_TOKEN_EXCHANGE_FAILED]',JSON.stringify(longToken));
    return res.status(502).send('Threads 장기 토큰 교환에 실패했습니다. 잠시 후 다시 연결해 주세요.');
  }

  const expiresIn=Number(longToken.expires_in)||5184000,now=Date.now();
  setSession(res,{
    accessToken:String(longToken.access_token),
    userId:String(shortToken.user_id),
    tokenType:'long_lived',
    connectedAt:now,
    refreshedAt:now,
    expiresAt:now+expiresIn*1000
  });
  res.redirect(302,'/?threads_oauth=connected#settings');
}
