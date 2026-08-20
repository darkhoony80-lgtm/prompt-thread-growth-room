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
  const text=String(req.body?.text||'').trim();
  const attachmentText=String(req.body?.attachment_text||'').trim();

  if(!replyTo){
    return res.status(400).json({ok:false,error:'REPLY_TO_ID_REQUIRED'});
  }

  /*
   * IMPORTANT: This endpoint serves TWO existing reply flows.
   *
   * 1) Prompt auto-comment:
   *    attachment_text -> visible "📋 프롬프트" + text_attachment
   *
   * 2) Comment management:
   *    text -> ordinary visible Threads text reply
   *
   * Keep the two payloads separate so fixing comment replies does not
   * break the existing prompt auto-comment feature.
   */
  const isAttachmentReply=Boolean(attachmentText);

  if(!isAttachmentReply&&!text){
    return res.status(400).json({ok:false,error:'REPLY_TEXT_REQUIRED'});
  }

  const createParams=isAttachmentReply
    ? {
        media_type:'TEXT',
        text:'📋 프롬프트',
        reply_to_id:replyTo,
        auto_publish_text:'true',
        text_attachment:{
          plaintext:attachmentText
        }
      }
    : {
        media_type:'TEXT',
        text,
        reply_to_id:replyTo,
        auto_publish_text:'true'
      };

  const create=await post('/me/threads',s.accessToken,createParams);

  if(!create.ok){
    const stage=isAttachmentReply?'CREATE_AND_PUBLISH_TEXT_ATTACHMENT_REPLY':'CREATE_AND_PUBLISH_TEXT_REPLY';
    const d=detail(create.body,stage,create.status);
    console.error(isAttachmentReply?'[THREADS_TEXT_ATTACHMENT_REPLY_FAILED]':'[THREADS_TEXT_REPLY_FAILED]',JSON.stringify({
      ...d,
      reply_to_id:replyTo,
      text_length:isAttachmentReply?attachmentText.length:text.length
    }));
    return res.status(502).json({
      ok:false,
      error:isAttachmentReply?'THREADS_TEXT_ATTACHMENT_REPLY_FAILED':'THREADS_TEXT_REPLY_FAILED',
      detail:d
    });
  }

  const replyId=create.body?.id;
  if(!replyId){
    return res.status(502).json({
      ok:false,
      error:'THREADS_REPLY_ID_MISSING',
      detail:{
        stage:isAttachmentReply?'CREATE_AND_PUBLISH_TEXT_ATTACHMENT_REPLY':'CREATE_AND_PUBLISH_TEXT_REPLY',
        message:'Threads가 게시된 답글 ID를 반환하지 않았습니다.'
      }
    });
  }

  console.info(isAttachmentReply?'[THREADS_TEXT_ATTACHMENT_REPLY_OK]':'[THREADS_TEXT_REPLY_OK]',JSON.stringify({
    id:String(replyId),
    reply_to_id:replyTo,
    text_length:isAttachmentReply?attachmentText.length:text.length
  }));

  return res.status(200).json({
    ok:true,
    id:String(replyId),
    reply_to_id:replyTo,
    mode:isAttachmentReply?'text_attachment':'text',
    visible_text:isAttachmentReply?'📋 프롬프트':text,
    ...(isAttachmentReply?{attachment_length:attachmentText.length}:{text_length:text.length}),
    auto_published:true
  });
}
