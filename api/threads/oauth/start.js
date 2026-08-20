import crypto from 'node:crypto';
export default function handler(req,res){
  const appId=process.env.THREADS_APP_ID;if(!appId)return res.status(503).json({ok:false,error:'THREADS_APP_ID_NOT_CONFIGURED'});
  const redirectUri='https://prompt-thread-growth-room.vercel.app/api/threads/oauth/callback';
  const state=crypto.randomBytes(24).toString('hex');
  res.setHeader('Set-Cookie',`threads_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  const u=new URL('https://threads.net/oauth/authorize');
  u.searchParams.set('client_id',appId);u.searchParams.set('redirect_uri',redirectUri);u.searchParams.set('scope',['threads_basic','threads_content_publish','threads_read_replies','threads_manage_replies','threads_manage_insights','threads_keyword_search'].join(','));u.searchParams.set('response_type','code');u.searchParams.set('state',state);res.redirect(302,u.toString());
}
