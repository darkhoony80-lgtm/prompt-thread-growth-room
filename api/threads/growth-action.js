import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';
async function post(path,token,params={}){
  const body=new URLSearchParams({...params,access_token:token});
  const r=await fetch(`${API}${path}`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
  const json=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:json};
}
function detail(body,stage,status){const e=body?.error||body||{};return {stage,status,message:e?.message||'unknown',type:e?.type||null,code:e?.code??null,subcode:e?.error_subcode??null}}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const s=await getValidSession(req,res);
  if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});
  const threadId=String(req.body?.thread_id||'').trim(),text=String(req.body?.text||'').trim().slice(0,500);
  if(!threadId)return res.status(400).json({ok:false,error:'THREAD_ID_REQUIRED'});
  if(!text)return res.status(400).json({ok:false,error:'REPLY_TEXT_REQUIRED'});
  const reply=await post('/me/threads',s.accessToken,{media_type:'TEXT',text,reply_to_id:threadId,auto_publish_text:'true'});
  if(!reply.ok)return res.status(502).json({ok:false,error:'GROWTH_REPLY_FAILED',detail:detail(reply.body,'REPLY',reply.status)});
  const repost=await post(`/${encodeURIComponent(threadId)}/repost`,s.accessToken,{});
  if(!repost.ok)return res.status(502).json({ok:false,error:'GROWTH_REPOST_FAILED',reply_ok:true,reply_id:reply.body?.id||null,detail:detail(repost.body,'REPOST',repost.status)});
  return res.status(200).json({ok:true,thread_id:threadId,reply_id:reply.body?.id||null,repost_id:repost.body?.id||null});
}
