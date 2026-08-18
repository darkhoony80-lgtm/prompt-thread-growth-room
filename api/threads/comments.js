import {decodeSession} from '../../lib-threads-session.js';

const API='https://graph.threads.net/v1.0';
const MAX_REPLY_HISTORY_PAGES=10;

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

function errorOf(body){
  const e=body?.error||body||{};
  return {message:e.message||'unknown',type:e.type||null,code:e.code??null,subcode:e.error_subcode??null};
}

function relationId(v){
  if(v==null)return null;
  if(typeof v==='string'||typeof v==='number')return String(v);
  if(v?.id)return String(v.id);
  if(v?.data?.id)return String(v.data.id);
  return null;
}

async function collectMyReplyTargets(token){
  const targets=new Map();
  const fields='id,text,timestamp,replied_to';
  let page=await graph(`/me/replies?fields=${encodeURIComponent(fields)}&limit=50`,token);
  let pages=0;

  while(page.ok && pages<MAX_REPLY_HISTORY_PAGES){
    pages++;
    for(const x of (Array.isArray(page.body?.data)?page.body.data:[])){
      const targetId=relationId(x?.replied_to);
      if(!targetId||targets.has(targetId))continue;
      targets.set(targetId,{
        id:x?.id?String(x.id):null,
        text:x?.text||'',
        timestamp:x?.timestamp||null
      });
    }

    const next=page.body?.paging?.next;
    if(!next)break;
    page=await graphNext(next,token);
  }

  return {
    ok:page.ok||pages>0,
    pages,
    targets,
    error:page.ok?null:errorOf(page.body)
  };
}

function classify(text=''){
  const t=String(text).trim().toLowerCase();
  if(/(광고|홍보|대출|투자|텔레그램|카톡|오픈채팅|http:\/\/|https:\/\/)/.test(t))return 'SPAM';
  if(/(씨발|시발|병신|개새|꺼져|좆|ㅅㅂ)/.test(t))return 'ABUSE';
  if(/[?？]|어디|어떻게|뭐야|무엇|알려|가능/.test(t))return 'QUESTION';
  if(/스하리/.test(t))return 'STHARI';
  if(/반하리/.test(t))return 'BANHARI';
  if(/또하리/.test(t))return 'TTOHARI';
  if(/고마|감사|예쁘|멋지|좋네|좋다|최고/.test(t))return 'COMPLIMENT';
  if(/안녕|반가|하이|ㅎㅇ/.test(t))return 'GREETING';
  if(t.length<=2)return 'SHORT';
  return 'NORMAL';
}

const pools={
  STHARI:['스하리 좋아요 😆🙌','스하리 가자아 😎✨','스하리 확인했어요 😄🔥','응응 스하리 좋지 😆💚'],
  BANHARI:['반하리 완료 😆🙌','나도 반하리 😄✨','반하리 반가워요 😎💚','응응 반하리 갑니다 😆🔥'],
  TTOHARI:['또하리 환영 😆✨','또하리 좋아요 😄🙌','응응 또하리 가자 😎🔥','또 놀러와요 😆💚'],
  COMPLIMENT:['고마워요 😆🫶','좋게 봐줘서 고마워요 😄✨','나도 고마워요 🙌💚','고마워요 다음 것도 재밌게 올릴게요 😎✨'],
  GREETING:['반가워요 😆🙌','오늘도 반가워요 😄✨','어서와요 😎💚','놀러와줘서 반가워요 😆🔥'],
  SHORT:['응응 😆🙌','좋아요 😄✨','고마워요 😎💚','반가워요 😆🫶'],
  NORMAL:['고마워요 😆🙌','응응 좋아요 😄✨','반가워요 😎💚','좋지요 😆🔥','오늘도 놀러와줘요 😄🫶','나도 고마워요 🙌✨'],
  QUESTION:['응응 확인해볼게요 😄🙌','좋은 질문이에요 😆✨','응응 알려드릴게요 😎💚','맞아요 이 부분 많이 궁금해하시더라고요 😄🔥']
};

function suggestion(type,id){
  const a=pools[type]||pools.NORMAL;
  let n=0;
  for(const c of String(id))n=(n*31+c.charCodeAt(0))>>>0;
  return a[n%a.length];
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});

  const s=decodeSession(req);
  if(!s?.accessToken)return res.status(401).json({ok:false,error:'THREADS_NOT_CONNECTED'});

  const raw=String(req.query.post_ids||'');
  const postIds=[...new Set(raw.split(',').map(x=>x.trim()).filter(Boolean))].slice(0,10);
  if(!postIds.length)return res.status(400).json({ok:false,error:'POST_IDS_REQUIRED'});

  const me=await graph('/me?fields=id,username',s.accessToken);
  if(!me.ok)return res.status(502).json({ok:false,error:'THREADS_ME_FAILED',detail:errorOf(me.body)});

  const replyHistory=await collectMyReplyTargets(s.accessToken);
  const mine=String(me.body.username||'').toLowerCase();
  const items=[];
  const failures=[];

  for(const postId of postIds){
    const r=await graph(`/${encodeURIComponent(postId)}/replies?fields=${encodeURIComponent('id,text,username,timestamp,permalink')}&limit=100`,s.accessToken);
    if(!r.ok){
      failures.push({post_id:postId,error:errorOf(r.body)});
      continue;
    }

    for(const x of (Array.isArray(r.body?.data)?r.body.data:[])){
      if(String(x.username||'').toLowerCase()===mine)continue;

      const id=String(x.id||'');
      const type=classify(x.text||'');
      const myReply=replyHistory.targets.get(id)||null;

      items.push({
        id,
        post_id:postId,
        text:x.text||'',
        username:x.username||null,
        timestamp:x.timestamp||null,
        permalink:x.permalink||null,
        category:type,
        review_required:type==='SPAM'||type==='ABUSE',
        already_replied:Boolean(myReply),
        my_reply:myReply,
        suggestion:type==='SPAM'||type==='ABUSE'?'':suggestion(type,id)
      });
    }
  }

  items.sort((a,b)=>String(b.timestamp||'').localeCompare(String(a.timestamp||'')));

  const unanswered=items.filter(x=>!x.review_required&&!x.already_replied).length;
  const reviewRequired=items.filter(x=>x.review_required&&!x.already_replied).length;
  const replied=items.filter(x=>x.already_replied).length;

  return res.status(200).json({
    ok:true,
    account:{username:me.body.username||null},
    count:items.length,
    unanswered_count:unanswered,
    replied_count:replied,
    review_count:reviewRequired,
    reply_history_available:replyHistory.ok,
    reply_history_pages:replyHistory.pages,
    reply_history_error:replyHistory.ok?null:replyHistory.error,
    failures,
    items
  });
}
