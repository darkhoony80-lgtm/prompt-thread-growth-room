import {decodeSession} from '../../lib-threads-session.js';
const API='https://graph.threads.net/v1.0';
async function post(path,token,params){
  const body=new URLSearchParams({...params,access_token:token});
  const r=await fetch(`${API}${path}`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
  const j=await r.json().catch(()=>({}));return {ok:r.ok,status:r.status,body:j};
}
function err(body){const e=body?.error||body||{};return {message:e.message||'unknown',type:e.type||null,code:e.code??null,subcode:e.error_subcode??null}}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const s=decodeSession(req);
  if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});
  const text=String(req.body?.text||'').trim();
  if(!text)return res.status(400).json({ok:false,error:'TEXT_REQUIRED'});
  if(text.length>500)return res.status(400).json({ok:false,error:'TEXT_TOO_LONG'});
  const imageUrl=String(req.body?.image_url||'').trim();
  const params=imageUrl?{media_type:'IMAGE',image_url:imageUrl,text}:{media_type:'TEXT',text};
  const create=await post('/me/threads',s.accessToken,params);
  if(!create.ok)return res.status(502).json({ok:false,error:'THREADS_CREATE_FAILED',detail:err(create.body)});
  const creationId=create.body?.id;
  if(!creationId)return res.status(502).json({ok:false,error:'THREADS_CREATION_ID_MISSING'});
  const pub=await post('/me/threads_publish',s.accessToken,{creation_id:String(creationId)});
  if(!pub.ok)return res.status(502).json({ok:false,error:'THREADS_PUBLISH_FAILED',detail:err(pub.body)});
  return res.status(200).json({ok:true,id:pub.body?.id||null});
}
