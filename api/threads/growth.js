import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';
const MAX_AGE_MS=24*60*60*1000;

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

  const fields='id,text,username,timestamp,permalink,media_type,topic_tag';
  const combos=[
    ['TAG','RECENT'],['TAG','TOP'],['KEYWORD','RECENT'],['KEYWORD','TOP']
  ];

  const results={};
  for(const [mode,type] of combos){
    const r=await graphGet(`/keyword_search?q=${encodeURIComponent(q)}&search_type=${type}&search_mode=${mode}&fields=${encodeURIComponent(fields)}&limit=50`,s.accessToken);
    results[`${mode}_${type}`]={
      ok:r.ok,status:r.status,
      data:Array.isArray(r.body?.data)?r.body.data:[],
      error:r.ok?null:detail(r.body,`${mode}_${type}`,r.status)
    };
  }

  const primary=results.TAG_RECENT;
  if(!primary.ok){
    return res.status(502).json({
      ok:false,error:'THREADS_KEYWORD_SEARCH_FAILED',
      detail:primary.error,
      four_way:Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{ok:v.ok,status:v.status,count:v.data.length,error:v.error}]))
    });
  }

  const mine=String(me.body?.username||'').toLowerCase();
  const now=Date.now();
  const raw=primary.data;
  let mineExcluded=0,timeExcluded=0,invalidIdExcluded=0;
  const items=raw
    .filter(x=>{
      if(String(x?.username||'').toLowerCase()===mine){mineExcluded++;return false}
      const ts=Date.parse(String(x?.timestamp||''));
      if(!Number.isFinite(ts)||now-ts>MAX_AGE_MS){timeExcluded++;return false}
      return true;
    })
    .map(x=>({
      id:String(x.id||''),text:String(x.text||''),username:x.username||null,
      timestamp:x.timestamp||null,permalink:x.permalink||null,
      media_type:x.media_type||null,topic_tag:x.topic_tag||null,matched_query:q
    }))
    .filter(x=>{if(!x.id){invalidIdExcluded++;return false}return true});

  const fourWay=Object.fromEntries(Object.entries(results).map(([k,v])=>[
    k,{ok:v.ok,status:v.status,count:v.data.length,error:v.error,
       first:v.data[0]?{
         username:v.data[0].username||null,
         timestamp:v.data[0].timestamp||null,
         topic_tag:v.data[0].topic_tag||null,
         text:String(v.data[0].text||'').slice(0,100)
       }:null}
  ]));

  return res.status(200).json({
    ok:true,q,count:items.length,items,
    diagnostic:{
      search_mode:'TAG',search_type:'RECENT',
      raw_count:raw.length,mine_excluded:mineExcluded,time_excluded:timeExcluded,
      invalid_id_excluded:invalidIdExcluded,final_count:items.length,
      four_way:fourWay
    }
  });
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
