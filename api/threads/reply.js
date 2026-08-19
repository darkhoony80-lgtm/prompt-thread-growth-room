import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';

function detail(body,stage,status){
  const e=body?.error||body||{};
  return {stage,status,message:e?.message||e?.error_message||'unknown',type:e?.type||null,code:e?.code??null,subcode:e?.error_subcode??null};
}
async function post(path,token,params){
  const body=new URLSearchParams({...params,access_token:token});
  const r=await fetch(`${API}${path}`,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
  const j=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:j};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const s=await getValidSession(req,res);
  if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});

  const replyTo=String(req.body?.reply_to_id||'').trim();
  const text=String(req.body?.text||'').trim();
  if(!replyTo)return res.status(400).json({ok:false,error:'REPLY_TO_ID_REQUIRED'});
  if(!text)return res.status(400).json({ok:false,error:'TEXT_REQUIRED'});
  if(text.length>500)return res.status(400).json({ok:false,error:'TEXT_TOO_LONG',detail:{stage:'VALIDATION',message:`첫 댓글 프롬프트가 ${text.length}자입니다. 500자 이하로 줄여 주세요.`}});

  const create=await post('/me/threads',s.accessToken,{media_type:'TEXT',text,reply_to_id:replyTo});
  if(!create.ok){
    const d=detail(create.body,'CREATE_REPLY',create.status);
    console.error('[THREADS_REPLY_CREATE_FAILED]',JSON.stringify({...d,reply_to_id:replyTo,text_length:text.length}));
    return res.status(502).json({ok:false,error:'THREADS_REPLY_CREATE_FAILED',detail:d});
  }
  const creationId=create.body?.id;
  if(!creationId)return res.status(502).json({ok:false,error:'THREADS_REPLY_CREATION_ID_MISSING'});

  const pub=await post('/me/threads_publish',s.accessToken,{creation_id:String(creationId)});
  if(!pub.ok){
    const d=detail(pub.body,'PUBLISH_REPLY',pub.status);
    console.error('[THREADS_REPLY_PUBLISH_FAILED]',JSON.stringify({creation_id:String(creationId),...d}));
    return res.status(502).json({ok:false,error:'THREADS_REPLY_PUBLISH_FAILED',detail:d});
  }
  return res.status(200).json({ok:true,id:pub.body?.id||null,reply_to_id:replyTo});
}
