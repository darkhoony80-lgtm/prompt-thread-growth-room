import {getValidSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';

async function graph(path,token){
  const separator=path.includes('?')?'&':'?';
  const response=await fetch(`${API}${path}${separator}access_token=${encodeURIComponent(token)}`,{headers:{Accept:'application/json'}});
  const body=await response.json().catch(()=>({}));
  return {ok:response.ok,body};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const session=await getValidSession(req,res);
  if(!session?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});

  const parentId=String(req.query?.parent_id||'').trim();
  const text=String(req.query?.text||'').trim();
  if(!/^\d{5,40}$/.test(parentId)||!text)return res.status(400).json({ok:false,error:'THREADS_REPLY_LOOKUP_INPUT_INVALID'});

  const me=await graph('/me?fields=id,username',session.accessToken);
  if(!me.ok)return res.status(502).json({ok:false,error:'THREADS_ME_FAILED'});
  const username=String(me.body?.username||'').toLowerCase();
  let page=await graph(`/${encodeURIComponent(parentId)}/replies?fields=${encodeURIComponent('id,text,username,permalink')}&limit=100`,session.accessToken);
  for(let count=0;page.ok&&count<5;count++){
    const found=(Array.isArray(page.body?.data)?page.body.data:[]).find(item=>String(item?.username||'').toLowerCase()===username&&String(item?.text||'').trim()===text);
    if(found)return res.status(200).json({ok:true,exists:true,id:String(found.id),permalink:String(found.permalink||'')});
    const next=page.body?.paging?.next;if(!next)break;
    let nextUrl;try{nextUrl=new URL(next)}catch{break}
    if(nextUrl.origin!==new URL(API).origin)break;
    const response=await fetch(nextUrl,{headers:{Accept:'application/json'}});
    page={ok:response.ok,body:await response.json().catch(()=>({}))};
  }
  if(!page.ok)return res.status(502).json({ok:false,error:'THREADS_REPLY_LOOKUP_FAILED'});
  return res.status(200).json({ok:true,exists:false});
}
