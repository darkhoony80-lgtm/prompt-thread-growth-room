import {decodeSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';
const TARGET_POSTS=10;
const PAGE_SIZE=50;
const MAX_THREAD_PAGES=10;
const MAX_REPLY_PAGES=10;

async function graph(path,token){
  const sep=path.includes('?')?'&':'?';
  const r=await fetch(`${API}${path}${sep}access_token=${encodeURIComponent(token)}`,{headers:{Accept:'application/json'}});
  const body=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body};
}

async function graphNext(nextUrl,token){
  const u=new URL(nextUrl);
  if(!u.searchParams.has('access_token'))u.searchParams.set('access_token',token);
  const r=await fetch(u.toString(),{headers:{Accept:'application/json'}});
  const body=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,body};
}

function err(body){const e=body?.error||body||{};return {message:e.message||'unknown',type:e.type||null,code:e.code??null,subcode:e.error_subcode??null}}
function ownerId(owner){if(owner==null)return null;if(typeof owner==='string'||typeof owner==='number')return String(owner);return owner?.id?String(owner.id):owner?.user_id?String(owner.user_id):null}
function hasObject(v){return Boolean(v && (typeof v!=='object'||Object.keys(v).length))}

async function getPostInsights(postId,token){
  const metrics='views,likes,replies,reposts,quotes,shares';
  const r=await graph(`/${encodeURIComponent(postId)}/insights?metric=${encodeURIComponent(metrics)}`,token);
  if(!r.ok)return {ok:false,metrics:{views:null,likes:null,replies:null,reposts:null,quotes:null,shares:null},error:err(r.body)};
  const out={views:null,likes:null,replies:null,reposts:null,quotes:null,shares:null};
  for(const m of (Array.isArray(r.body?.data)?r.body.data:[])){
    if(!(m?.name in out))continue;
    const v=m?.total_value?.value ?? m?.values?.[0]?.value;
    out[m.name]=Number.isFinite(Number(v))?Number(v):null;
  }
  return {ok:true,metrics:out,error:null};
}

async function collectReplyIds(token){
  const ids=new Set();
  let page=await graph(`/me/replies?fields=${encodeURIComponent('id')}&limit=${PAGE_SIZE}`,token);
  let pages=0;
  while(page.ok && pages<MAX_REPLY_PAGES){
    pages++;
    for(const x of (Array.isArray(page.body?.data)?page.body.data:[])){
      if(x?.id)ids.add(String(x.id));
    }
    const next=page.body?.paging?.next;
    if(!next)break;
    page=await graphNext(next,token);
  }
  return {ok:page.ok||pages>0,ids,pages,error:page.ok?null:err(page.body)};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const s=decodeSession(req);
  if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});

  const me=await graph('/me?fields=id,username',s.accessToken);
  if(!me.ok)return res.status(502).json({ok:false,error:'THREADS_ME_FAILED',detail:err(me.body)});

  const replyScan=await collectReplyIds(s.accessToken);
  if(!replyScan.ok)return res.status(502).json({ok:false,error:'THREADS_REPLIES_FAILED',detail:replyScan.error});

  const uid=String(me.body.id||s.userId||'');
  const uname=String(me.body.username||'').toLowerCase();
  const fields='id,media_product_type,media_type,media_url,permalink,owner,username,text,timestamp,shortcode,thumbnail_url,children,is_quote_post,quoted_post,reposted_post,has_replies,alt_text,link_attachment_url';

  let page=await graph(`/me/threads?fields=${encodeURIComponent(fields)}&limit=${PAGE_SIZE}`,s.accessToken);
  if(!page.ok)return res.status(502).json({ok:false,error:'THREADS_LIST_FAILED',detail:err(page.body)});

  const excluded={repost:0,quote:0,reply:0,external:0,duplicate:0};
  const myPosts=[];
  const seen=new Set();
  let pagesScanned=0;
  let sourceCount=0;

  while(page.ok && pagesScanned<MAX_THREAD_PAGES && myPosts.length<TARGET_POSTS){
    pagesScanned++;
    const source=Array.isArray(page.body?.data)?page.body.data:[];
    sourceCount+=source.length;

    for(const x of source){
      const id=String(x?.id||'');
      if(!id)continue;
      if(seen.has(id)){excluded.duplicate++;continue}
      seen.add(id);

      const oid=ownerId(x.owner), username=String(x.username||'').toLowerCase();
      const mine=(oid&&uid&&oid===uid)||(username&&uname&&username===uname);
      if(!mine){excluded.external++;continue}

      const repostFacade=String(x.media_type||'').toUpperCase()==='REPOST_FACADE';
      const repostObject=hasObject(x.reposted_post);
      if(repostFacade||repostObject){excluded.repost++;continue}

      if(Boolean(x.is_quote_post||hasObject(x.quoted_post))){excluded.quote++;continue}

      if(replyScan.ids.has(id)){excluded.reply++;continue}

      myPosts.push({
        id,
        media_type:x.media_type||null,
        media_product_type:x.media_product_type||null,
        text:x.text||'',
        timestamp:x.timestamp||null,
        permalink:x.permalink||null,
        media_url:x.media_url||null,
        thumbnail_url:x.thumbnail_url||null,
        shortcode:x.shortcode||null,
        has_replies:Boolean(x.has_replies),
        username:x.username||me.body.username||null
      });
      if(myPosts.length>=TARGET_POSTS)break;
    }

    if(myPosts.length>=TARGET_POSTS)break;
    const next=page.body?.paging?.next;
    if(!next)break;
    page=await graphNext(next,s.accessToken);
    if(!page.ok)return res.status(502).json({ok:false,error:'THREADS_PAGING_FAILED',detail:err(page.body)});
  }

  const insightResults=await Promise.all(myPosts.map(p=>getPostInsights(p.id,s.accessToken)));
  let insightFailures=0;
  myPosts.forEach((p,i)=>{p.insights=insightResults[i].metrics;if(!insightResults[i].ok)insightFailures++});

  const totals={views:0,likes:0,replies:0,reposts:0,quotes:0,shares:0};
  const available={views:0,likes:0,replies:0,reposts:0,quotes:0,shares:0};
  for(const p of myPosts){
    for(const k of Object.keys(totals)){
      const v=p.insights?.[k];
      if(v!==null && v!==undefined){totals[k]+=Number(v)||0;available[k]++}
    }
  }
  const bestPost=myPosts.filter(p=>p.insights?.views!==null && p.insights?.views!==undefined).sort((a,b)=>(b.insights.views||0)-(a.insights.views||0))[0]||null;

  const summary={
    source_count:sourceCount,
    pages_scanned:pagesScanned,
    reply_pages_scanned:replyScan.pages,
    my_posts:myPosts.length,
    target_posts:TARGET_POSTS,
    excluded,
    insight_failures:insightFailures,
    insight_totals:totals,
    insight_available:available,
    best_post_id:bestPost?.id||null
  };

  console.log('[MY_POSTS_SUMMARY]',JSON.stringify(summary));
  for(const p of myPosts)console.log('[MY_POST_CONFIRMED]',JSON.stringify({id:p.id,media_type:p.media_type,text_preview:p.text.slice(0,120),timestamp:p.timestamp,permalink:p.permalink,insights:p.insights}));
  return res.status(200).json({ok:true,account:{id:uid,username:me.body.username||null},summary,best_post:bestPost,items:myPosts});
}
