import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';

async function graphGet(path,token){
  const sep=path.includes('?')?'&':'?';
  const r=await fetch(`${API}${path}${sep}access_token=${encodeURIComponent(token)}`,{headers:{Accept:'application/json'}});
  const body=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body};
}
async function graphPost(path,token,params={}){
  const body=new URLSearchParams({...params,access_token:token});
  const r=await fetch(`${API}${path}`,{
    method:'POST',
    headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},
    body:body.toString()
  });
  const json=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body:json};
}
function detail(body,stage,status){
  const e=body?.error||body||{};
  return {stage:stage||null,status:status||null,message:e?.message||'unknown',type:e?.type||null,code:e?.code??null,subcode:e?.error_subcode??null};
}

async function handleSearch(req,res,s){
  const q=String(req.query?.q||'').trim().slice(0,80);
  if(!q)return res.status(400).json({ok:false,error:'QUERY_REQUIRED'});

  const me=await graphGet('/me?fields=id,username',s.accessToken);
  if(!me.ok)return res.status(502).json({ok:false,error:'THREADS_ME_FAILED',detail:detail(me.body,'ME',me.status)});

  const fields='id,text,username,timestamp,permalink,media_type';
  let mode='TAG';
  let search=await graphGet(`/keyword_search?q=${encodeURIComponent(q)}&search_type=RECENT&search_mode=TAG&fields=${encodeURIComponent(fields)}&limit=50`,s.accessToken);
  if(!search.ok){
    return res.status(502).json({
      ok:false,error:'THREADS_KEYWORD_SEARCH_FAILED',
      detail:detail(search.body,'TAG_SEARCH',search.status),
      hint:search.status===403?'Threads 계정을 다시 연결해 threads_keyword_search 권한을 승인해 주세요.':null
    });
  }

  if(!Array.isArray(search.body?.data)||search.body.data.length===0){
    mode='KEYWORD';
    search=await graphGet(`/keyword_search?q=${encodeURIComponent(q)}&search_type=RECENT&search_mode=KEYWORD&fields=${encodeURIComponent(fields)}&limit=50`,s.accessToken);
    if(!search.ok){
      return res.status(502).json({
        ok:false,error:'THREADS_KEYWORD_SEARCH_FAILED',
        detail:detail(search.body,'KEYWORD_SEARCH',search.status)
      });
    }
  }

  const mine=String(me.body?.username||'').toLowerCase();
  const items=(Array.isArray(search.body?.data)?search.body.data:[])
    .filter(x=>String(x?.username||'').toLowerCase()!==mine)
    .map(x=>({
      id:String(x.id||''),text:String(x.text||''),username:x.username||null,
      timestamp:x.timestamp||null,permalink:x.permalink||null,
      media_type:x.media_type||null,matched_query:q
    }))
    .filter(x=>x.id);

  return res.status(200).json({ok:true,q,mode,count:items.length,items});
}

async function handleAction(req,res,s){
  const threadId=String(req.body?.thread_id||'').trim();
  const text=String(req.body?.text||'').trim().slice(0,500);
  if(!threadId)return res.status(400).json({ok:false,error:'THREAD_ID_REQUIRED'});
  if(!text)return res.status(400).json({ok:false,error:'REPLY_TEXT_REQUIRED'});

  const reply=await graphPost('/me/threads',s.accessToken,{
    media_type:'TEXT',text,reply_to_id:threadId,auto_publish_text:'true'
  });
  if(!reply.ok){
    return res.status(502).json({ok:false,error:'GROWTH_REPLY_FAILED',detail:detail(reply.body,'REPLY',reply.status)});
  }

  const repost=await graphPost(`/${encodeURIComponent(threadId)}/repost`,s.accessToken,{});
  if(!repost.ok){
    return res.status(502).json({
      ok:false,error:'GROWTH_REPOST_FAILED',
      reply_ok:true,reply_id:reply.body?.id||null,
      detail:detail(repost.body,'REPOST',repost.status)
    });
  }

  return res.status(200).json({
    ok:true,thread_id:threadId,
    reply_id:reply.body?.id||null,repost_id:repost.body?.id||null
  });
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET' && req.method!=='POST'){
    return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  }
  const s=await getValidSession(req,res);
  if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});
  return req.method==='GET' ? handleSearch(req,res,s) : handleAction(req,res,s);
}
