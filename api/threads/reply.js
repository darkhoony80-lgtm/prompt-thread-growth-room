import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';

function detail(body,stage,status){
  const e=body?.error||body||{};
  return {stage,status,message:e?.message||e?.error_message||'unknown',type:e?.type||null,code:e?.code??null,subcode:e?.error_subcode??null};
}

async function post(path,token,params){
  const body=new URLSearchParams();
  for(const [k,v] of Object.entries(params)){
    if(v===undefined||v===null)continue;
    body.set(k,typeof v==='string'?v:JSON.stringify(v));
  }
  body.set('access_token',token);

  const r=await fetch(`${API}${path}`,{
    method:'POST',
    headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},
    body:body.toString()
  });
  const j=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:j};
}

async function createAttachment(token,replyTo,attachmentText,text){
  const params={
    media_type:'TEXT',
    reply_to_id:replyTo,
    text_attachment:{plaintext:attachmentText}
  };
  if(text)params.text=text;
  return post('/me/threads',token,params);
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});

  const s=await getValidSession(req,res);
  if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});

  const replyTo=String(req.body?.reply_to_id||'').trim();
  const attachmentText=String(req.body?.attachment_text||'').trim();

  if(!replyTo)return res.status(400).json({ok:false,error:'REPLY_TO_ID_REQUIRED'});
  if(!attachmentText)return res.status(400).json({ok:false,error:'ATTACHMENT_TEXT_REQUIRED'});

  let create=await createAttachment(s.accessToken,replyTo,attachmentText,'');
  let fallback=false;

  if(!create.ok){
    console.warn('[THREADS_ATTACHMENT_ONLY_REJECTED]',JSON.stringify(detail(create.body,'CREATE_ATTACHMENT_ONLY',create.status)));
    create=await createAttachment(s.accessToken,replyTo,attachmentText,'Prompt');
    fallback=true;
  }

  if(!create.ok){
    const d=detail(create.body,'CREATE_TEXT_ATTACHMENT_REPLY',create.status);
    console.error('[THREADS_TEXT_ATTACHMENT_CREATE_FAILED]',JSON.stringify({...d,reply_to_id:replyTo,attachment_length:attachmentText.length}));
    return res.status(502).json({ok:false,error:'THREADS_TEXT_ATTACHMENT_CREATE_FAILED',detail:d});
  }

  const creationId=create.body?.id;
  if(!creationId)return res.status(502).json({ok:false,error:'THREADS_REPLY_CREATION_ID_MISSING'});

  const pub=await post('/me/threads_publish',s.accessToken,{creation_id:String(creationId)});
  if(!pub.ok){
    const d=detail(pub.body,'PUBLISH_TEXT_ATTACHMENT_REPLY',pub.status);
    console.error('[THREADS_TEXT_ATTACHMENT_PUBLISH_FAILED]',JSON.stringify({creation_id:String(creationId),...d}));
    return res.status(502).json({ok:false,error:'THREADS_TEXT_ATTACHMENT_PUBLISH_FAILED',detail:d});
  }

  return res.status(200).json({
    ok:true,
    id:pub.body?.id||null,
    reply_to_id:replyTo,
    attachment_length:attachmentText.length,
    fallback_label_used:fallback
  });
}
