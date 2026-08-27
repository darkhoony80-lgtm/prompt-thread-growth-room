import {decodeSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';
const HISTORY_PAGE_SIZE=50;
const POST_PAGE_SIZE=50;
const REPLY_PAGE_SIZE=100;
// Safety ceilings prevent a damaged paging cursor from looping forever while still allowing deep account history scans.
const MAX_HISTORY_PAGES=200;
const MAX_POST_PAGES=200;
const MAX_REPLY_PAGES_PER_POST=100;
const MAX_POSTS_TO_CHECK=5000;

async function graph(path,token){const sep=path.includes('?')?'&':'?';const r=await fetch(`${API}${path}${sep}access_token=${encodeURIComponent(token)}`,{headers:{Accept:'application/json'}});const body=await r.json().catch(()=>({}));return {ok:r.ok,body}}
async function next(url,token){const u=new URL(url);if(!u.searchParams.has('access_token'))u.searchParams.set('access_token',token);const r=await fetch(u,{headers:{Accept:'application/json'}});const body=await r.json().catch(()=>({}));return {ok:r.ok,body}}
function rel(v){if(v==null)return null;if(typeof v==='string'||typeof v==='number')return String(v);return v?.id?String(v.id):v?.data?.id?String(v.data.id):null}
async function history(token){
 const map=new Map(),ownReplyIds=new Set();
 let p=await graph(`/me/replies?fields=${encodeURIComponent('id,text,timestamp,replied_to')}&limit=${HISTORY_PAGE_SIZE}`,token),pages=0;
 while(p.ok&&pages<MAX_HISTORY_PAGES){
  pages++;
  for(const x of (p.body?.data||[])){
   if(x?.id)ownReplyIds.add(String(x.id));
   const id=rel(x?.replied_to);if(id&&!map.has(id))map.set(id,{id:x?.id||null,text:x?.text||'',timestamp:x?.timestamp||null});
  }
  const n=p.body?.paging?.next;if(!n)break;p=await next(n,token);
 }
 return {ok:p.ok||pages>0,pages,map,ownReplyIds,truncated:pages>=MAX_HISTORY_PAGES&&Boolean(p.body?.paging?.next)};
}
function obj(v){return Boolean(v&&(typeof v!=='object'||Object.keys(v).length))}
function ownerId(v){if(v==null)return null;if(typeof v==='string'||typeof v==='number')return String(v);return v?.id?String(v.id):v?.user_id?String(v.user_id):null}
async function discoverPosts(token,me,h,seedIds=[]){
 const ids=[],seen=new Set(),seed=[...new Set(seedIds.map(String).filter(Boolean))];
 for(const id of seed){seen.add(id);ids.push(id)}
 const uid=String(me?.id||''),uname=String(me?.username||'').toLowerCase();
 const fields='id,owner,username,media_type,is_quote_post,quoted_post,reposted_post,has_replies,timestamp';
 let p=await graph(`/me/threads?fields=${encodeURIComponent(fields)}&limit=${POST_PAGE_SIZE}`,token),pages=0,sourceCount=0;
 while(p.ok&&pages<MAX_POST_PAGES&&ids.length<MAX_POSTS_TO_CHECK){
  pages++;
  for(const x of (p.body?.data||[])){
   sourceCount++;
   const id=String(x?.id||'');if(!id||seen.has(id))continue;
   const oid=ownerId(x?.owner),username=String(x?.username||'').toLowerCase();
   if(!((oid&&uid&&oid===uid)||(username&&uname&&username===uname)))continue;
   if(String(x?.media_type||'').toUpperCase()==='REPOST_FACADE'||obj(x?.reposted_post))continue;
   if(Boolean(x?.is_quote_post||obj(x?.quoted_post)))continue;
   if(h?.ownReplyIds?.has(id))continue;
   if(!x?.has_replies)continue;
   seen.add(id);ids.push(id);
   if(ids.length>=MAX_POSTS_TO_CHECK)break;
  }
  if(ids.length>=MAX_POSTS_TO_CHECK)break;
  const n=p.body?.paging?.next;if(!n)break;p=await next(n,token);
 }
 return {ids,pages,sourceCount,ok:p.ok||pages>0,truncated:pages>=MAX_POST_PAGES&&Boolean(p.body?.paging?.next)};
}
function type(text=''){const t=String(text).trim().toLowerCase();if(/(광고|홍보|대출|투자|텔레그램|카톡|오픈채팅|http:\/\/|https:\/\/)/.test(t))return 'SPAM';if(/(씨발|시발|병신|개새|꺼져|좆|ㅅㅂ)/.test(t))return 'ABUSE';if(/[?？]|어디|어떻게|뭐야|무엇|알려|가능/.test(t))return 'QUESTION';if(/스하리/.test(t))return 'STHARI';if(/반하리/.test(t))return 'BANHARI';if(/또하리/.test(t))return 'TTOHARI';if(/고마|감사|예쁘|멋지|좋네|좋다|최고/.test(t))return 'COMPLIMENT';if(/안녕|반가|하이|ㅎㅇ/.test(t))return 'GREETING';if(t.length<=2)return 'SHORT';return 'NORMAL'}
const pools={STHARI:['스하리 좋아요 😆🙌','스하리 가자아 😎✨','스하리 확인했어요 😄🔥'],BANHARI:['반하리 완료 😆🙌','나도 반하리 😄✨','반하리 반가워요 😎💚'],TTOHARI:['또하리 환영 😆✨','또하리 좋아요 😄🙌','또 놀러와요 😆💚'],COMPLIMENT:['고마워요 😆🫶','좋게 봐줘서 고마워요 😄✨','나도 고마워요 🙌💚'],GREETING:['반가워요 😆🙌','오늘도 반가워요 😄✨','어서와요 😎💚'],SHORT:['응응 😆🙌','좋아요 😄✨','고마워요 😎💚'],NORMAL:['고마워요 😆🙌','응응 좋아요 😄✨','반가워요 😎💚','좋지요 😆🔥'],QUESTION:['응응 확인해볼게요 😄🙌','좋은 질문이에요 😆✨','맞아요 이 부분 많이 궁금해하시더라고요 😄🔥']};
function suggestion(t,id){const a=pools[t]||pools.NORMAL;let n=0;for(const c of String(id))n=(n*31+c.charCodeAt(0))>>>0;return a[n%a.length]}

async function collectPostReplies(postId,token){
 const rows=[];let pages=0;
 let r=await graph(`/${encodeURIComponent(postId)}/replies?fields=${encodeURIComponent('id,text,username,timestamp,permalink')}&limit=${REPLY_PAGE_SIZE}`,token);
 if(!r.ok)return {ok:false,rows,pages};
 while(r.ok&&pages<MAX_REPLY_PAGES_PER_POST){
  pages++;
  rows.push(...(Array.isArray(r.body?.data)?r.body.data:[]));
  const n=r.body?.paging?.next;if(!n)break;r=await next(n,token);
 }
 return {ok:r.ok||pages>0,rows,pages,truncated:pages>=MAX_REPLY_PAGES_PER_POST&&Boolean(r.body?.paging?.next)};
}

export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
 const s=decodeSession(req);
 if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});

 const seedIds=[...new Set(String(req.query.post_ids||'').split(',').map(x=>x.trim()).filter(Boolean))].slice(0,50);
 const me=await graph('/me?fields=id,username',s.accessToken);
 if(!me.ok)return res.status(502).json({ok:false,error:'THREADS_ME_FAILED'});

 const h=await history(s.accessToken);
 const discovered=await discoverPosts(s.accessToken,me.body,h,seedIds);
 if(!discovered.ids.length)return res.status(200).json({
  ok:true,scope:'all_history',count:0,unanswered_count:0,replied_count:0,review_count:0,
  reply_history_available:h.ok,reply_history_pages:h.pages,posts_checked:0,post_pages_scanned:discovered.pages,failures:[],items:[],truncated:Boolean(h.truncated||discovered.truncated)
 });

 const mine=String(me.body.username||'').toLowerCase(),items=[],failures=[],seenReplies=new Set();let replyPagesScanned=0,truncated=Boolean(h.truncated||discovered.truncated);
 for(const postId of discovered.ids){
  const result=await collectPostReplies(postId,s.accessToken);replyPagesScanned+=result.pages||0;if(result.truncated)truncated=true;
  if(!result.ok){failures.push(postId);continue}
  for(const x of result.rows){
   if(String(x.username||'').toLowerCase()===mine)continue;
   const id=String(x.id||'');if(!id||seenReplies.has(id))continue;seenReplies.add(id);
   const t=type(x.text||''),my=h.map.get(id)||null;
   items.push({
    id,post_id:postId,text:x.text||'',username:x.username||null,timestamp:x.timestamp||null,
    permalink:x.permalink||null,category:t,review_required:t==='SPAM'||t==='ABUSE',
    already_replied:Boolean(my),my_reply:my,suggestion:t==='SPAM'||t==='ABUSE'?'':suggestion(t,id)
   });
  }
 }
 items.sort((a,b)=>Date.parse(b.timestamp||0)-Date.parse(a.timestamp||0));
 return res.status(200).json({
  ok:true,scope:'all_history',count:items.length,
  unanswered_count:items.filter(x=>!x.review_required&&!x.already_replied).length,
  replied_count:items.filter(x=>x.already_replied).length,
  review_count:items.filter(x=>x.review_required&&!x.already_replied).length,
  reply_history_available:h.ok,reply_history_pages:h.pages,
  posts_checked:discovered.ids.length,post_pages_scanned:discovered.pages,reply_pages_scanned:replyPagesScanned,post_source_count:discovered.sourceCount,
  failures,truncated,items
 });
}
