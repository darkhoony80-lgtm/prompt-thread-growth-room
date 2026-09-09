import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});

  const session=await getValidSession(req,res);
  if(!session?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});

  const id=String(req.query?.id||'').trim();
  if(!/^\d{5,40}$/.test(id))return res.status(400).json({ok:false,error:'THREADS_POST_ID_INVALID'});

  const url=new URL(`${API}/${encodeURIComponent(id)}`);
  url.searchParams.set('fields','id,permalink');
  url.searchParams.set('access_token',session.accessToken);
  const response=await fetch(url,{headers:{Accept:'application/json'}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String(body?.error?.message||'THREADS_PERMALINK_LOOKUP_FAILED').slice(0,300);
    return res.status(502).json({ok:false,error:'THREADS_PERMALINK_LOOKUP_FAILED',detail:message});
  }
  const permalink=String(body?.permalink||'').trim();
  if(!/^https:\/\/(?:www\.)?threads\.(?:net|com)\//i.test(permalink)){
    return res.status(502).json({ok:false,error:'THREADS_PERMALINK_MISSING'});
  }
  return res.status(200).json({ok:true,id:String(body?.id||id),permalink});
}
