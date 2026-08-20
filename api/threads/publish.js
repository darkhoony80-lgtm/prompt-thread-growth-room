import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';
const WAIT_MS=1000;
const MAX_STATUS_CHECKS=15;

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

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
  const body=new URLSearchParams({...params,access_token:token});
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

async function get(path,token){
  const u=new URL(`${API}${path}`);
  u.searchParams.set('access_token',token);
  const r=await fetch(u,{headers:{Accept:'application/json'}});
  const j=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:j};
}

async function waitUntilReady(containerId,token){
  let last=null;
  for(let i=0;i<MAX_STATUS_CHECKS;i++){
    const r=await get(`/${encodeURIComponent(containerId)}?fields=id,status,error_message`,token);
    if(!r.ok){
      return {ok:false,detail:detail(r.body,'STATUS_CHECK',r.status)};
    }

    const status=String(r.body?.status||'').toUpperCase();
    last={status,error_message:r.body?.error_message||null};

    if(status==='FINISHED'||status==='PUBLISHED'){
      return {ok:true,status};
    }
    if(status==='ERROR'||status==='EXPIRED'){
      return {
        ok:false,
        detail:{
          stage:'MEDIA_PROCESSING',
          status:200,
          message:r.body?.error_message||`Container ${status}`,
          container_status:status
        }
      };
    }
    await sleep(WAIT_MS);
  }

  return {
    ok:false,
    retryable:true,
    detail:{
      stage:'MEDIA_PROCESSING',
      status:202,
      message:'이미지 처리가 아직 끝나지 않았습니다. 잠시 후 다시 게시해 주세요.',
      container_status:last?.status||'IN_PROGRESS'
    }
  };
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');

  const s=await getValidSession(req,res);
  if(!s?.accessToken){
    return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});
  }

  if(req.method==='GET'&&String(req.query?.mode||'')==='topic-search'){
    const q=String(req.query?.q||'').replace(/^#+/,'').trim().slice(0,80);
    if(!q)return res.status(400).json({ok:false,error:'TOPIC_QUERY_REQUIRED'});
    const search=await get(`/keyword_search?q=${encodeURIComponent(q)}&search_type=TOP&search_mode=TAG&fields=${encodeURIComponent('id,text,timestamp')}&limit=5`,s.accessToken);
    if(!search.ok){
      const d=detail(search.body,'TOPIC_TAG_SEARCH',search.status);
      console.warn('[THREADS_TOPIC_SEARCH_FAILED]',JSON.stringify({...d,q}));
      return res.status(502).json({ok:false,error:'THREADS_TOPIC_SEARCH_FAILED',detail:d,q});
    }
    const items=Array.isArray(search.body?.data)?search.body.data:[];
    return res.status(200).json({ok:true,q,matched:items.length>0,count:items.length,items});
  }

  if(req.method!=='POST'){
    return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  }

  const text=String(req.body?.text||'').trim();
  const imageUrl=String(req.body?.image_url||'').trim();
  const topicTagVerified=req.body?.topic_tag_verified===true;
  const topicTag=topicTagVerified
    ?String(req.body?.topic_tag||'').replace(/^#+/,'').trim().slice(0,80)
    :'';

  if(!text)return res.status(400).json({ok:false,error:'TEXT_REQUIRED'});
  if(text.length>500){
    return res.status(400).json({
      ok:false,
      error:'TEXT_TOO_LONG',
      detail:{
        stage:'VALIDATION',
        message:`본문이 ${text.length}자입니다. Threads 게시 한도 500자 이하로 줄여 주세요.`,
        length:text.length
      }
    });
  }
  if(!imageUrl){
    return res.status(400).json({ok:false,error:'APPROVED_IMAGE_REQUIRED'});
  }

  // 1) Create image container.
  const createParams={
    media_type:'IMAGE',
    image_url:imageUrl,
    text
  };
  if(topicTag)createParams.topic_tag=topicTag;

  const create=await post('/me/threads',s.accessToken,createParams);

  if(!create.ok){
    const d=detail(create.body,'CREATE_CONTAINER',create.status);
    console.error('[THREADS_CREATE_FAILED]',JSON.stringify({...d,image_url:imageUrl,text_length:text.length}));
    return res.status(502).json({
      ok:false,
      error:'THREADS_CREATE_FAILED',
      detail:d
    });
  }

  const creationId=create.body?.id;
  if(!creationId){
    return res.status(502).json({
      ok:false,
      error:'THREADS_CREATION_ID_MISSING',
      detail:{stage:'CREATE_CONTAINER',message:'Threads가 creation_id를 반환하지 않았습니다.'}
    });
  }

  // 2) Meta fetches/processes the public image asynchronously.
  //    Do not publish before the container reaches FINISHED.
  const ready=await waitUntilReady(String(creationId),s.accessToken);
  if(!ready.ok){
    console.error('[THREADS_CONTAINER_NOT_READY]',JSON.stringify({
      creation_id:String(creationId),
      ...ready.detail
    }));
    return res.status(ready.retryable?409:502).json({
      ok:false,
      error:ready.retryable?'THREADS_MEDIA_PROCESSING':'THREADS_MEDIA_FAILED',
      creation_id:String(creationId),
      detail:ready.detail
    });
  }

  // 3) Publish only after media is ready.
  const pub=await post('/me/threads_publish',s.accessToken,{
    creation_id:String(creationId)
  });

  if(!pub.ok){
    const d=detail(pub.body,'PUBLISH_CONTAINER',pub.status);
    console.error('[THREADS_PUBLISH_FAILED]',JSON.stringify({creation_id:String(creationId),...d}));
    return res.status(502).json({
      ok:false,
      error:'THREADS_PUBLISH_FAILED',
      creation_id:String(creationId),
      detail:d
    });
  }

  return res.status(200).json({
    ok:true,
    id:pub.body?.id||null,
    creation_id:String(creationId),
    image_url:imageUrl,
    topic_tag:topicTag||null,
    text_length:text.length
  });
}
