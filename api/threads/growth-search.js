import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';
const MAX_AGE_MS=24*60*60*1000;

async function graph(path,token){
  const sep=path.includes('?')?'&':'?';
  const r=await fetch(`${API}${path}${sep}access_token=${encodeURIComponent(token)}`,{headers:{Accept:'application/json'}});
  const body=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body};
}
function detail(body){const e=body?.error||body||{};return {message:e?.message||'unknown',type:e?.type||null,code:e?.code??null,subcode:e?.error_subcode??null}}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const s=await getValidSession(req,res);
  if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});
  const q=String(req.query?.q||'').trim().slice(0,80);
  if(!q)return res.status(400).json({ok:false,error:'QUERY_REQUIRED'});
  const me=await graph('/me?fields=id,username',s.accessToken);
  if(!me.ok)return res.status(502).json({ok:false,error:'THREADS_ME_FAILED',detail:detail(me.body)});
  const fields='id,text,username,timestamp,permalink,media_type';
  const search=await graph(`/keyword_search?q=${encodeURIComponent(q)}&search_type=RECENT&fields=${encodeURIComponent(fields)}&limit=50`,s.accessToken);
  if(!search.ok)return res.status(502).json({ok:false,error:'THREADS_KEYWORD_SEARCH_FAILED',detail:detail(search.body),hint:search.status===403?'Threads 계정을 다시 연결해 threads_keyword_search 권한을 승인해 주세요.':null});
  const mine=String(me.body?.username||'').toLowerCase(),now=Date.now();
  const items=(Array.isArray(search.body?.data)?search.body.data:[]).filter(x=>{
    if(String(x?.username||'').toLowerCase()===mine)return false;
    const ts=Date.parse(String(x?.timestamp||''));
    return Number.isFinite(ts)&&now-ts<=MAX_AGE_MS;
  }).map(x=>({id:String(x.id||''),text:String(x.text||''),username:x.username||null,timestamp:x.timestamp||null,permalink:x.permalink||null,media_type:x.media_type||null,matched_query:q})).filter(x=>x.id);
  return res.status(200).json({ok:true,q,count:items.length,items});
}
