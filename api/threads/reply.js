import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';

function detail(body,stage,status){
  const e=body?.error||body||{};
  return {
    stage,
    status,
    message:e?.message||e?.error_message||'unknown',
    type:e?.type||null,
    code:e?.code??null,
    subcode:e?.error_subcode??null
  };
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
    headers:{
      Accept:'application/json',
      'Content-Type':'application/x-www-form-urlencoded'
    },
    body:body.toString()
  });

  const j=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:j};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');

  if(req.method!=='POST'){
    return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  }

  const s=await getValidSession(req,res);
  if(!s?.accessToken){
    return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});
  }

  const replyTo=String(req.body?.reply_to_id||'').trim();
  const attachmentText=String(req.body?.attachment_text||'').trim();

  if(!replyTo){
    return res.status(400).json({ok:false,error:'REPLY_TO_ID_REQUIRED'});
  }
  if(!attachmentText){
    return res.status(400).json({ok:false,error:'ATTACHMENT_TEXT_REQUIRED'});
  }

  /*
   * Threads text replies can be created with reply_to_id.
   * For text posts, auto_publish_text=true publishes the text post
   * during container creation, so do NOT call /me/threads_publish again.
   */
  const create=await post('/me/threads',s.accessToken,{
    media_type:'TEXT',
    text:'📋 프롬프트',
    reply_to_id:replyTo,
    auto_publish_text:'true',
    text_attachment:{
      plaintext:attachmentText
    }
  });

  if(!create.ok){
    const d=detail(create.body,'CREATE_AND_PUBLISH_TEXT_ATTACHMENT_REPLY',create.status);
    console.error('[THREADS_TEXT_ATTACHMENT_REPLY_FAILED]',JSON.stringify({
      ...d,
      reply_to_id:replyTo,
      attachment_length:attachmentText.length
    }));
    return res.status(502).json({
      ok:false,
      error:'THREADS_TEXT_ATTACHMENT_REPLY_FAILED',
      detail:d
    });
  }

  const replyId=create.body?.id;
  if(!replyId){
    return res.status(502).json({
      ok:false,
      error:'THREADS_REPLY_ID_MISSING',
      detail:{
        stage:'CREATE_AND_PUBLISH_TEXT_ATTACHMENT_REPLY',
        message:'Threads가 게시된 답글 ID를 반환하지 않았습니다.'
      }
    });
  }

  console.info('[THREADS_TEXT_ATTACHMENT_REPLY_OK]',JSON.stringify({
    id:String(replyId),
    reply_to_id:replyTo,
    attachment_length:attachmentText.length
  }));

  return res.status(200).json({
    ok:true,
    id:String(replyId),
    reply_to_id:replyTo,
    visible_text:'📋 프롬프트',
    attachment_length:attachmentText.length,
    auto_published:true
  });
}
