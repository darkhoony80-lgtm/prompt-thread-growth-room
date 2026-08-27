/* Growth Engine V3. Filename kept for existing index.html include. */
(function(){
const CATS={AI_PROMPT:'AI 프롬프트',AI_TIP:'쿠팡파트너스',FOOD_PICK:'오늘 뭐 먹지?',HOT_ISSUE:'🔥 오늘의 핫이슈'};
const Q='pt_queue_v3',F='pt_feedback_v3',P='pt_published_v3',D='pt_drafts_v6',FH='pt_food_history_v1',IGC='pt_instagram_carousels_v1',CM='pt_content_masters_v1';
const PILLARS=['AI_TIP','AI_PROMPT','FOOD_PICK','HOT_ISSUE'];
const PLATFORM_LIMITS={threads:{maxMedia:20},instagram:{maxMedia:10},facebook:{maxMedia:10},youtube:{maxMedia:1}};
const SOCIAL_AUTOMATION='pt_social_reply_automation_v1';
const PROMPT_CATEGORIES=['AI_TIP','AI_PROMPT'];
const PLATFORM_BODY_CTA={
 threads:'링크/추가 내용은 첫 댓글에 남겨둘게 👇',
 instagram:'필요하면 댓글 남겨줘. DM으로 보내줄게 💌'
};
let candidates=[null,null,null,null];
let instagramCarousel=null,instagramPublishing=false,instagramModalOpen=false;
function read(k,d=[]){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d))}catch{return d}}
function write(k,v){localStorage.setItem(k,JSON.stringify(v))}
function masterRecords(){const value=read(CM,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function mediaId(prefix='media'){return `${prefix}_${globalThis.crypto?.randomUUID?.()||`${Date.now()}_${Math.random().toString(36).slice(2)}`}`}
function masterKey(i){return String(candidates[i]?.id||`${PILLARS[i]}-${i}`)}
function ensureMaster(i){
 const x=candidates[i];if(!x)return null;
 const key=masterKey(i),records=masterRecords();
 if(records[key]){
  const master=records[key];
  if(!String(master.master_body||'').trim()){
   master.master_body=String(master.threads_body_override||master.instagram_caption_override||x.body||'');
   master.updated_at=Date.now();records[key]=master;write(CM,records);
  }
  return master;
 }
 const media=[];
 if(x.image_url)media.push({id:mediaId('legacy'),type:'image',source:'ai',url:x.image_url,previewUrl:x.image_url,order:0,status:'ready',mime_type:/\.jpe?g(?:$|\?)/i.test(x.image_url)?'image/jpeg':'image/png'});
 const master={version:1,content_id:key,content_type:PILLARS[i],title:x.topic||x.category_label||'',master_body:x.body||'',threads_body_override:'',instagram_caption_override:'',reply_prompt:x.reply_prompt||'',topic_tag:x.topic_tag||'',topic_tag_verified:x.topic_tag_verified===true,media,status:{threads:'draft',instagram:'draft',facebook:'draft',youtube:'draft'},updated_at:Date.now()};
 records[key]=master;write(CM,records);return master;
}
function saveMaster(i,master){if(!master)return;master.media=(master.media||[]).map((m,order)=>({...m,order}));master.updated_at=Date.now();const records=masterRecords();records[master.content_id]=master;write(CM,records)}
function cleanMediaItem(item,order){return {id:String(item.id),type:item.type,source:item.source,url:String(item.url),previewUrl:String(item.previewUrl||item.url),order,status:'ready',mime_type:String(item.mime_type||''),size:Number(item.size)||0,duration:Number(item.duration)||0}}
function snapshotMaster(i){syncDraft(i);const m=ensureMaster(i);return JSON.parse(JSON.stringify({...m,media:(m.media||[]).map(cleanMediaItem)}))}
function appendMasterMedia(i,item){const m=ensureMaster(i);if(!m||!item?.url)return;const url=String(item.url);if(m.media.some(v=>v.id===item.id||v.url===url))return;m.media.push(cleanMediaItem({...item,id:item.id||mediaId(item.source||'media')},m.media.length));saveMaster(i,m);renderMedia(i)}
function removeMasterMedia(i,id){const m=ensureMaster(i);if(!m)return;m.media=m.media.filter(v=>v.id!==id);saveMaster(i,m);renderMedia(i)}
function moveMasterMedia(i,id,direction){const m=ensureMaster(i);if(!m)return;const from=m.media.findIndex(v=>v.id===id),to=from+direction;if(from<0||to<0||to>=m.media.length)return;[m.media[from],m.media[to]]=[m.media[to],m.media[from]];saveMaster(i,m);renderMedia(i)}
function instagramRecords(){const value=read(IGC,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function instagramRecord(id){return instagramRecords()[String(id||'')]||null}
function persistInstagramCarousel(state=instagramCarousel){
 if(!state?.candidateId||!state?.plan)return;
 const records=instagramRecords(),now=Date.now(),previous=records[state.candidateId]||{};
 records[state.candidateId]={
  version:1,content_id:state.candidateId,content_type:state.candidate.category,
  candidate:state.candidate,plan:state.plan,
  images:state.images.map((url,index)=>({order:index+1,url:url||null,variation:state.variations[index]||1})),
  cut_images:(state.cutImages||[]).map((item,index)=>({order:index+1,cut_id:item?.cut_id||null,url:item?.url||null})),
  caption:state.caption,reply_prompt:state.replyPrompt||'',
  status:state.recordStatus||(state.published?'published':state.generating?'generating':state.images.filter(Boolean).length===state.plan.slide_count?'ready':'incomplete'),
  generated_at:state.generatedAt||previous.generated_at||null,created_at:previous.created_at||state.createdAt||now,updated_at:now,
  request_id:state.requestId,media_id:state.mediaId||previous.media_id||null,published_at:state.publishedAt||previous.published_at||null,
  prompt_store_status:state.promptStoreStatus||previous.prompt_store_status||null,
  prompt_store_error:state.promptStoreError||null
 };
 write(IGC,records);
}
function restoreInstagramCarousel(record,index,candidate){
 const plan=record?.plan,items=Array.isArray(record?.images)?record.images.slice().sort((a,b)=>Number(a.order)-Number(b.order)):[],cutItems=Array.isArray(record?.cut_images)?record.cut_images.slice().sort((a,b)=>Number(a.order)-Number(b.order)):[];
 if(!plan||!Array.isArray(plan.slides)||plan.slides.length<2||plan.slides.length>5)return null;
 if(candidate?.category==='AI_TIP'&&(plan.format!=='cut_composed_webtoon'||!Array.isArray(plan.cuts)||plan.cuts.length<4))return null;
 return {
  candidate:record.candidate||candidate,candidateId:record.content_id,plan,caption:String(record.caption||plan.caption||''),
  replyPrompt:String(record.reply_prompt??record.candidate?.reply_prompt??candidate?.reply_prompt??''),
  images:new Array(plan.slide_count).fill(null).map((_,i)=>items[i]?.url||null),
  cutImages:new Array(Number(plan.total_cuts)||0).fill(null).map((_,i)=>cutItems[i]?.url?{cut_id:cutItems[i].cut_id,url:cutItems[i].url}:null),
  variations:new Array(plan.slide_count).fill(1).map((_,i)=>Number(items[i]?.variation)||1),selected:0,
  status:record.status==='published'?'Instagram 게시 완료':'게시 전 검토',generating:false,published:record.status==='published',
  mediaId:record.media_id||null,publishedAt:record.published_at||null,generatedAt:record.generated_at||null,
  promptStoreStatus:record.prompt_store_status||null,promptStoreError:record.prompt_store_error||null,
  createdAt:record.created_at||Date.now(),requestId:record.request_id||instagramRequestId(),candidateIndex:index
 };
}
function apiError(j,fallback='REQUEST_FAILED'){
 const d=j?.detail;
 if(typeof d==='string'&&d)return d;
 if(d&&typeof d==='object')return [d.stage,d.message,d.status?`HTTP ${d.status}`:''].filter(Boolean).join(' · ');
 return j?.message||j?.error||fallback;
}
function draftSafe(x){
 if(!x)return null;
 const v={...x};
 delete v.base_image;
 delete v.final_image;
 return v;
}
function saveDrafts(){write(D,candidates.map(draftSafe))}
function restoreDrafts(){
 const saved=read(D,[null,null,null,null]);
 if(!Array.isArray(saved))return;
 candidates=PILLARS.map((p,i)=>saved[i]?.category===p?saved[i]:null);
}
function syncDraft(i){
 const x=candidates[i];if(!x)return;
 const pillar=PILLARS[i],aiThumbnail=['AI_PROMPT','AI_TIP'].includes(pillar),oldBody=x.body||'',oldReply=x.reply_prompt||'',oldTopicTag=String(x.topic_tag||'').replace(/^#+/,'').trim().slice(0,80),nextTopicTag=topicTag(i),nextBody=body(i),nextReply=aiThumbnail?replyPrompt(i):'';
 x.body=nextBody;x.topic_tag=nextTopicTag;if(oldTopicTag!==nextTopicTag)x.topic_tag_verified=false;if(aiThumbnail)x.reply_prompt=nextReply;
 if(x.final_image&&((aiThumbnail&&oldBody!==nextBody)||(pillar==='AI_PROMPT'&&oldReply!==nextReply)))x.thumbnail_dirty=true;
 const master=ensureMaster(i);
 if(master){master.master_body=nextBody;master.reply_prompt=aiThumbnail?nextReply:master.reply_prompt||'';master.topic_tag=nextTopicTag;master.topic_tag_verified=x.topic_tag_verified===true;saveMaster(i,master)}
 saveDrafts();
}
function withoutLegacyPromptCta(value){
 return String(value||'').split(/\r?\n/).filter(line=>{
  const text=line.trim();
  return !(
   /^프롬프트는\s*첫\s*댓글/i.test(text)||
   /프롬프트.*(?:댓글.*(?:남겨|달면|달아|저요)|DM.*(?:보내|전송))/i.test(text)||
   /댓글.*(?:남겨|달면|달아|저요).*프롬프트/i.test(text)
  );
 }).join('\n').trim();
}
function withPlatformBodyCta(value,contentType,platform){
 if(!PROMPT_CATEGORIES.includes(contentType))return String(value||'').trim();
 const body=withoutLegacyPromptCta(value);
 return [body,PLATFORM_BODY_CTA[platform]].filter(Boolean).join('\n\n');
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fb(x,kind){const a=read(F);a.unshift({kind,category:x.category,topic:x.topic,hook:x.hook,at:Date.now()});write(F,a.slice(0,80))}
function body(i){return document.getElementById(`v3body-${i}`)?.value.trim()||candidates[i]?.body||''}
function replyPrompt(i){return document.getElementById(`v3reply-${i}`)?.value.trim()||candidates[i]?.reply_prompt||''}
function topicTag(i){return String(document.getElementById(`v3topic-${i}`)?.value||candidates[i]?.topic_tag||'').replace(/^#+/,'').trim().slice(0,80)}
async function verifyTopicCandidates(x){
 const list=[...(x?.topic_tag_candidates||[]),x?.topic_tag].map(v=>String(v||'').replace(/^#+/,'').trim()).filter(Boolean);
 const unique=[...new Set(list)].slice(0,3);
 x.topic_tag_verified=false;
 x.topic_tag_search_available=true;
 for(const q of unique){
  try{
   const r=await fetch('/api/threads/publish?mode=topic-search&q='+encodeURIComponent(q),{cache:'no-store'});
   const j=await r.json().catch(()=>({}));
   if(!r.ok){x.topic_tag_search_available=false;continue}
   if(j.matched){x.topic_tag=q;x.topic_tag_verified=true;return}
  }catch{x.topic_tag_search_available=false}
 }
 if(!x.topic_tag&&unique[0])x.topic_tag=unique[0];
}
async function perf(){try{const r=await fetch('/api/threads/my-posts',{cache:'no-store'}),j=await r.json();if(!r.ok)return '';const meta=new Map(read(P).map(x=>[String(x.thread_id),x]));return (j.items||[]).map(p=>{const m=meta.get(String(p.id));if(!m)return null;const s=p.insights||{};return `${m.category}/${m.hook}:views=${s.views??'-'},likes=${s.likes??'-'},replies=${s.replies??'-'},reposts=${s.reposts??'-'},quotes=${s.quotes??'-'},shares=${s.shares??'-'}`}).filter(Boolean).slice(0,10).join(' | ')}catch{return ''}}
function recentHotIssues(){
 return read(P)
  .filter(x=>x?.category==='HOT_ISSUE')
  .slice(0,20)
  .map(x=>({
   topic:String(x?.topic||'').trim().slice(0,140),
   hook:String(x?.hook||'').trim().slice(0,80),
   published_at:Number(x?.published_at)||0
  }))
  .filter(x=>x.topic||x.hook);
}
function recentAiTips(){
 const seen=new Set(),rows=[...read(P),...read(F)];
 return rows.filter(x=>x?.category==='AI_TIP').map(x=>({
  topic:String(x?.topic||'').trim().slice(0,100),
  hook:String(x?.hook||'').trim().slice(0,40)
 })).filter(x=>{
  const key=`${x.topic}|${x.hook}`.toLocaleLowerCase('ko-KR');
  if(!x.topic||seen.has(key))return false;
  seen.add(key);return true;
 }).slice(0,12);
}

restoreDrafts();

function ensure(){
 const old=document.getElementById('autoV1');if(old)old.remove();
 const old3=document.getElementById('autoV3');if(old3)old3.remove();
 const dash=document.getElementById('dashboard');if(!dash||document.getElementById('autoV5'))return;
 dash.insertAdjacentHTML('afterbegin',`<div class="card" id="autoV5" style="margin-bottom:12px"><div class="section"><div><b>✨ 게시물 성장 엔진</b><p class="mut">필요한 콘텐츠만 독립 호출합니다. 생성 → 검토/수정 → 이미지 생성 → 최종 확인 → 게시 순서입니다.</p></div></div><div id="v3status" class="mut" style="margin-bottom:10px"></div><div id="v3list" class="post-list"></div></div>`);
 const cal=document.getElementById('calendar');if(cal)cal.innerHTML=`<div class="section"><div><b>발행 대기함</b><p class="mut">이미지를 직접 확인하고 👍한 게시물만 저장됩니다.</p></div><span class="badge" id="v3qcount">0</span></div><div id="v3queue" class="post-list"></div>`;
 patchReplies();render();renderQueue();
}
async function generatePillar(i,mood='RANDOM'){
 const pillar=PILLARS[i],b=document.getElementById(`v3gen-${i}`),s=document.getElementById('v3status');
 if(!b)return;b.disabled=true;const old=b.textContent;b.textContent='생성 중…';
 s.textContent=pillar==='HOT_ISSUE'?'오늘 뉴스를 검색하고 핫이슈를 고르는 중입니다.':pillar==='FOOD_PICK'?'전국 실제 맛집을 검색하고 오늘의 메뉴를 고르는 중입니다.':'이 섹션만 집중해서 콘텐츠를 만드는 중입니다.';
 try{
  const feedback=read(F).filter(x=>x.category===pillar).slice(0,20).map(x=>`${x.kind}:${x.topic}:${x.hook}`).join(' | ');
  const performance=await perf();
  const recentFood=pillar==='FOOD_PICK'?read(FH,[]).slice(0,8):[];
  const recentHot=pillar==='HOT_ISSUE'?recentHotIssues():[];
  const recentAi=pillar==='AI_TIP'?recentAiTips():[];
   const r=await fetch('/api/content-router?action=generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pillar,feedback,performance,recentFood,recentHotIssues:recentHot,recentAiTips:recentAi,mood:pillar==='AI_PROMPT'?mood:'RANDOM'})});
  const text=await r.text();let j;try{j=JSON.parse(text)}catch{throw new Error(text.slice(0,180)||`HTTP ${r.status}`)}
  if(!r.ok)throw new Error(j.detail||j.error||'GENERATE_FAILED');
  candidates[i]=j.item;
  await verifyTopicCandidates(candidates[i]);
   if(pillar==='FOOD_PICK'&&j.item?.topic){
    const h=read(FH,[]);
    h.unshift({topic:String(j.item.topic).trim(),at:Date.now()});
    const seen=new Set(),dedup=[];
    for(const row of h){
     const k=String(row?.topic||'').trim().toLowerCase();
     if(!k||seen.has(k))continue;
     seen.add(k);dedup.push(row);
     if(dedup.length>=12)break;
    }
    write(FH,dedup);
   }
   saveDrafts();render();s.textContent=`${CATS[pillar]} 생성 완료 · 다른 섹션은 호출하지 않았습니다.`;
 }catch(e){s.textContent='';alert(`${CATS[pillar]} 생성 실패: `+e.message)}
 finally{const nb=document.getElementById(`v3gen-${i}`);if(nb){nb.disabled=false;nb.textContent=pillar==='AI_PROMPT'?'🎲 랜덤':(candidates[i]?'🔄 다시 생성':'✨ 생성')}}
}
function emptyCard(pillar,i){
 const desc={AI_TIP:'쿠팡파트너스 게시물과 제휴 링크 전달을 관리',AI_PROMPT:'저장하고 싶은 상세 영문 프롬프트',FOOD_PICK:'점심·저녁·술안주를 실제 전국 맛집으로 추천',HOT_ISSUE:'오늘 실제 뉴스에서 가장 강한 이슈 하나'}[pillar];
 return `<article class="card" id="v3card-${i}"><div class="post-meta"><span class="badge">${esc(CATS[pillar])}</span></div><h3 style="margin:10px 0 6px">${esc(CATS[pillar])}</h3><p class="mut">${esc(desc)}</p>${pillar==='AI_PROMPT'?`<div style="display:flex;gap:6px;flex-wrap:wrap">
<button class="btn p" id="v3gen-${i}" onclick="PostAuto.generate(${i},'RANDOM')">🎲 랜덤</button>
<button class="btn" onclick="PostAuto.generate(${i},'HAPPY')">😊 행복</button>
<button class="btn" onclick="PostAuto.generate(${i},'LOVE')">❤️ 사랑</button>
<button class="btn" onclick="PostAuto.generate(${i},'COMIC')">😂 코믹</button>
<button class="btn" onclick="PostAuto.generate(${i},'HORROR')">👻 공포</button>
<button class="btn" onclick="PostAuto.generate(${i},'FANTASY')">🧚 판타지</button>
</div>`:`<button class="btn p" id="v3gen-${i}" onclick="PostAuto.generate(${i})">✨ 생성</button>`}</article>`;
}
function mediaEditorHtml(i,master){
 return `<section class="cm-editor"><div class="section"><div><b>공통 미디어</b><p class="mut">현재 배열 순서가 Threads와 Instagram의 실제 게시 순서입니다. 직접 추가한 미디어와 AI 이미지 스토리는 삭제·이동 전까지 그대로 유지됩니다.</p></div><label class="btn">사진/영상 추가<input type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime" multiple hidden onchange="PostAuto.addMedia(${i},this.files);this.value=''" /></label></div><div id="v3media-${i}" class="cm-media"></div></section>`;
}
function render(){
 const box=document.getElementById('v3list');if(!box)return;
 box.innerHTML=PILLARS.map((pillar,i)=>{const x=candidates[i];if(!x)return emptyCard(pillar,i);const master=ensureMaster(i);return `<article class="card" id="v3card-${i}"><div class="post-meta"><span class="badge">${esc(CATS[pillar]||x.category_label)}</span><span class="badge">Content Master</span><span class="mut">총점 ${x.score?.total||0}</span></div><div class="v3grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,430px);gap:18px;align-items:start"><div><div style="display:flex;justify-content:flex-end;gap:8px;align-items:center">${pillar==='AI_PROMPT'?`<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button class="btn" id="v3gen-${i}" onclick="PostAuto.generate(${i},'RANDOM')">🎲 랜덤</button><button class="btn" onclick="PostAuto.generate(${i},'HAPPY')">😊 행복</button><button class="btn" onclick="PostAuto.generate(${i},'LOVE')">❤️ 사랑</button><button class="btn" onclick="PostAuto.generate(${i},'COMIC')">😂 코믹</button><button class="btn" onclick="PostAuto.generate(${i},'HORROR')">👻 공포</button><button class="btn" onclick="PostAuto.generate(${i},'FANTASY')">🧚 판타지</button></div>`:`<button class="btn" id="v3gen-${i}" onclick="PostAuto.generate(${i})">🔄 다시 생성</button>`}</div><label class="mut">공통 본문</label><textarea id="v3body-${i}" maxlength="500" oninput="PostAuto.save(${i})" class="cm-body">${esc(master.master_body)}</textarea>${['AI_PROMPT','AI_TIP'].includes(pillar)?`<label class="mut" style="display:block;margin-top:10px">댓글 및 답장 입력</label><textarea id="v3reply-${i}" oninput="PostAuto.save(${i})" class="cm-reply" placeholder="예: https://link.coupang.com/a/...">${esc(master.reply_prompt||'')}</textarea><p class="mut">Threads 첫 댓글 · Instagram 자동 답장/DM · Facebook 댓글 답장 · YouTube 첫 댓글+답장에 사용됩니다.</p>`:''}<p class="mut">소재 · ${esc(x.topic)}</p><p class="mut">추천 이유 · ${esc(x.reason)}</p>${x.source_notes?.length?`<p class="mut">검증 메모 · ${esc(x.source_notes.join(' / '))}</p>`:''}<div style="margin:10px 0"><label class="mut">🏷 Threads 추천 Topic ${x.topic_tag_verified?'· TAG 검색 확인 ✅':(x.topic_tag_search_available===false?'· 검색 확인 불가':'· 추천값')}</label><input id="v3topic-${i}" maxlength="80" oninput="PostAuto.save(${i})" value="${esc(master.topic_tag||'')}" placeholder="예: AI 이미지" class="cm-input"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn p" onclick="PostAuto.image(${i})">🖼 AI 이미지 추가</button><button class="btn" onclick="PostAuto.reimage(${i})">🔄 AI 이미지 추가 생성</button><button class="btn" onclick="PostAuto.instagram(${i})">AI 이미지 스토리 만들기</button><button class="btn" onclick="PostAuto.variant(${i})">다른 버전</button><button class="btn" onclick="PostAuto.keep(${i})">👍 발행 대기</button><button class="btn p" onclick="PostAuto.now(${i})">Threads 게시</button><button class="btn p" onclick="PostAuto.instagramMasterPublish(${i})">Instagram 게시</button><button class="btn p" onclick="PostAuto.facebookPublish(${i})">Facebook 게시</button><button class="btn p" onclick="PostAuto.youtubePublish(${i})">YouTube 게시</button><button class="btn" onclick="PostAuto.no(${i})">👎 비우기</button></div></div><div>${mediaEditorHtml(i,master)}</div></div></article>`}).join('');
 if(!document.getElementById('v3css'))document.head.insertAdjacentHTML('beforeend',`<style id="v3css">@media(max-width:900px){.v3grid{grid-template-columns:1fr!important}}.cm-body,.cm-reply,.cm-input{width:100%;margin-top:5px;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:12px;line-height:1.55}.cm-body{min-height:190px}.cm-reply{min-height:150px}.cm-editor{border:1px solid var(--l);border-radius:12px;padding:12px}.cm-media{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:10px 0}.cm-item{position:relative;border:1px solid var(--l);border-radius:10px;padding:6px;background:#090b0f}.cm-item img,.cm-item video{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:7px;display:block}.cm-item-actions{display:flex;gap:4px;margin-top:5px}.cm-item-actions .btn{padding:5px 8px}.cm-kind{position:absolute;top:10px;left:10px;background:#090b0fdd;border-radius:10px;padding:3px 6px;font-size:10px}</style>`);
 candidates.forEach((x,i)=>{if(x)renderMedia(i)});
}
function renderMedia(i){
 const box=document.getElementById(`v3media-${i}`),master=ensureMaster(i);if(!box||!master)return;
 box.innerHTML=master.media.length?master.media.map((m,index)=>`<div class="cm-item"><span class="cm-kind">${index+1} · ${m.source==='ai'?'AI':'업로드'} ${m.type==='video'?'영상':'사진'}</span>${m.type==='video'?`<video src="${esc(m.previewUrl||m.url)}" controls preload="metadata"></video>`:`<img src="${esc(m.previewUrl||m.url)}" alt="${index+1}번 미디어">`}<div class="cm-item-actions"><button class="btn" onclick="PostAuto.moveMedia(${i},'${esc(m.id)}',-1)" ${index===0?'disabled':''}>←</button><button class="btn" onclick="PostAuto.moveMedia(${i},'${esc(m.id)}',1)" ${index===master.media.length-1?'disabled':''}>→</button><button class="btn" onclick="PostAuto.removeMedia(${i},'${esc(m.id)}')">삭제</button></div></div>`).join(''):'<div class="card empty"><div><b>미디어 없음</b>AI 이미지 생성 전에도 사진이나 영상을 추가할 수 있습니다.</div></div>';
}
async function videoDuration(file){
 return new Promise((resolve,reject)=>{const video=document.createElement('video'),url=URL.createObjectURL(file);video.preload='metadata';video.onloadedmetadata=()=>{const value=Number(video.duration)||0;URL.revokeObjectURL(url);resolve(value)};video.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('영상 정보를 읽지 못했습니다.'))};video.src=url});
}
function validateLocalMedia(file){
 const type=String(file?.type||'').toLowerCase();
 if(type==='image/jpeg'){if(file.size>8*1024*1024)throw new Error(`${file.name}: JPEG 이미지는 8MB 이하여야 합니다.`);return 'image'}
 if(type==='video/mp4'||type==='video/quicktime'){if(file.size>1024*1024*1024)throw new Error(`${file.name}: 영상은 1GB 이하여야 합니다.`);return 'video'}
 throw new Error(`${file?.name||'파일'}: JPEG/PNG 사진 또는 MP4/MOV 영상만 추가할 수 있습니다.`);
}
async function pngToJpeg(file){
 const mime=String(file?.type||'').toLowerCase();
 if(mime!=='image/png')return file;
 if(file.size>20*1024*1024)throw new Error(`${file.name}: PNG 이미지는 20MB 이하여야 합니다.`);
 const url=URL.createObjectURL(file);
 try{
  const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`${file.name}: PNG 이미지를 읽지 못했습니다.`));img.src=url});
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error(`${file.name}: 이미지 변환을 시작하지 못했습니다.`);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
  if(!blob)throw new Error(`${file.name}: JPEG 변환에 실패했습니다.`);
  const name=String(file.name||'image.png').replace(/\.png$/i,'')+'.jpg';
  return new File([blob],name,{type:'image/jpeg',lastModified:file.lastModified||Date.now()});
 }finally{URL.revokeObjectURL(url)}
}
async function uploadLocalMedia(file,i,type){
 const safe=String(file.name||`${type}-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g,'-').slice(-100);
 const pathname=`content-master/${masterKey(i)}/${Date.now()}-${safe}`;
 const mod=await import('https://esm.sh/@vercel/blob@2.8.0/client?bundle');
 return mod.uploadPresigned(pathname,file,{access:'public',handleUploadUrl:'/api/content-router?action=media_upload',contentType:file.type,multipart:file.size>5*1024*1024});
}
async function addLocalMedia(i,fileList){
 const files=Array.from(fileList||[]);if(!files.length)return;
 const status=document.getElementById('v3status');
 for(const original of files){
  try{
   if(status&&String(original?.type||'').toLowerCase()==='image/png')status.textContent=`${original.name} JPEG 변환 중…`;
   const file=await pngToJpeg(original),type=validateLocalMedia(file);
   if(status)status.textContent=`${file.name} 업로드 중…`;
   const duration=type==='video'?await videoDuration(file):0;
   const blob=await uploadLocalMedia(file,i,type);
   appendMasterMedia(i,{id:mediaId('upload'),type,source:'upload',url:blob.url,previewUrl:blob.url,mime_type:file.type,size:file.size,duration});
  }catch(e){alert('미디어 추가 실패: '+e.message)}
 }
 if(status)status.textContent='공통 미디어 저장 완료';
}
function preview(i){const x=candidates[i],b=document.getElementById(`v3img-${i}`),src=x?.final_image||x?.image_url;if(!src){b.innerHTML='<span class="mut">이미지를 생성한 뒤 직접 확인하세요.</span>';return}b.innerHTML=`<div><img src="${src}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:11px;display:block"><p class="mut" style="margin:8px 2px 0">최종 썸네일 미리보기 · 확인 후 채택/게시</p></div>`}
async function makeImage(i,redo=false){
 const x=candidates[i],box=document.getElementById('v3status');if(!x)return;if(box)box.textContent='Gemini 이미지 생성 중…';x.variation=redo?(x.variation||1)+1:(x.variation||1);x.body=body(i);if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i]))x.reply_prompt=replyPrompt(i);
 try{
  const imageCandidate={...x};delete imageCandidate.hook;delete imageCandidate.hook_candidates;
  const r=await fetch('/api/content-router?action=image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate:imageCandidate,variation:x.variation})}),j=await r.json();
  if(!r.ok)throw new Error(apiError(j,'IMAGE_FAILED'));
  const generated=`data:${j.mime_type};base64,${j.data}`;
  x.base_image=null;
  x.final_image=generated;
  x.image_url=null;
  x.thumbnail_hook=String(j.thumbnail_hook||'').trim();
  x.thumbnail_dirty=false;
  const url=await upload(i);appendMasterMedia(i,{id:mediaId('ai'),type:'image',source:'ai',url,previewUrl:url,mime_type:'image/jpeg'});saveDrafts();if(box)box.textContent='AI 이미지가 공통 미디어에 추가되었습니다.';
 }catch(e){if(box)box.textContent='이미지 생성 실패';alert('이미지 생성 실패: '+e.message)}
}
function instagramCandidate(i){
 const x=candidates[i];if(!x)return null;
 syncDraft(i);
 const source={
  category:PILLARS[i],topic:x.topic||'',body:body(i),reply_prompt:['AI_PROMPT','AI_TIP'].includes(PILLARS[i])?replyPrompt(i):'',
  image_brief:x.image_brief||'',source_notes:Array.isArray(x.source_notes)?x.source_notes:[]
 };
 return source.body?source:null;
}
function ensureInstagramModal(){
 if(document.getElementById('instagramCarouselModal'))return;
 document.body.insertAdjacentHTML('beforeend',`<div id="instagramCarouselModal" class="ig-modal" hidden><div class="ig-dialog"><div class="section"><div><b>Instagram 캐러셀</b><p class="mut" id="igCarouselStatus">준비 중</p></div><button class="btn" onclick="PostAuto.instagramClose()">닫기</button></div><div id="igCarouselBody"></div></div></div>`);
 if(!document.getElementById('instagramCarouselCss'))document.head.insertAdjacentHTML('beforeend',`<style id="instagramCarouselCss">
 .ig-modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.82);padding:24px;overflow:auto}.ig-dialog{max-width:1120px;margin:0 auto;background:#10141a;border:1px solid var(--l);border-radius:16px;padding:18px;box-shadow:0 24px 80px #000}.ig-preview-grid{display:grid;grid-template-columns:minmax(300px,520px) 1fr;gap:18px}.ig-main-image{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:13px;border:1px solid var(--l);background:#090b0f}.ig-thumbs{display:grid;grid-template-columns:repeat(5,minmax(70px,1fr));gap:8px;margin-top:10px}.ig-thumb{position:relative;padding:0;border:2px solid transparent;border-radius:10px;overflow:hidden;background:#090b0f;cursor:pointer}.ig-thumb.on{border-color:var(--a)}.ig-thumb img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block}.ig-thumb span{position:absolute;top:5px;left:5px;background:#090b0fd9;border-radius:12px;padding:3px 7px;font-size:10px}.ig-caption,.ig-prompt{width:100%;resize:vertical;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:12px;line-height:1.55}.ig-caption{min-height:220px}.ig-prompt{min-height:180px}.ig-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}@media(max-width:820px){.ig-modal{padding:10px}.ig-preview-grid{grid-template-columns:1fr}.ig-thumbs{grid-template-columns:repeat(5,1fr)}}
</style>`);
}
function instagramRequestId(){
 const random=globalThis.crypto?.randomUUID?.().replace(/-/g,'')||`${Date.now()}${Math.random().toString(36).slice(2)}`;
 return `ig_${random}`.slice(0,100);
}
function renderInstagramCarousel(){
 ensureInstagramModal();
 const modal=document.getElementById('instagramCarouselModal'),status=document.getElementById('igCarouselStatus'),box=document.getElementById('igCarouselBody');
 if(!instagramCarousel||!instagramModalOpen){modal.hidden=true;return}
 modal.hidden=false;status.textContent=instagramCarousel.status||'준비 중';
 const state=instagramCarousel,plan=state.plan;
 if(!plan){box.innerHTML='<div class="card empty"><div><b>스토리보드 생성 중</b>Instagram 전용 흐름과 캡션을 준비하고 있습니다.</div></div>';return}
 const selected=Math.max(0,Math.min(state.selected||0,plan.slides.length-1)),image=state.images[selected];
 const thumbs=plan.slides.map((slide,index)=>`<button class="ig-thumb ${index===selected?'on':''}" onclick="PostAuto.instagramSelect(${index})" title="${esc(slide.role)}"><span>${index+1}/${plan.slide_count}</span>${state.images[index]?`<img src="${esc(state.images[index])}" alt="${index+1}번 캐러셀 이미지">`:'<div style="aspect-ratio:4/5;display:grid;place-items:center;color:var(--m)">생성 중</div>'}</button>`).join('');
 box.innerHTML=`<div class="ig-preview-grid"><div>${image?`<img class="ig-main-image" src="${esc(image)}" alt="확대된 ${selected+1}번 이미지 스토리">`:'<div class="ig-main-image" style="display:grid;place-items:center;color:var(--m)">이미지 준비 중</div>'}<div class="ig-thumbs">${thumbs}</div><p class="mut">${selected+1}/${plan.slide_count} · ${esc(plan.slides[selected]?.role||'')}</p><p>${esc(plan.slides[selected]?.message||'')}</p></div><div><span class="badge">${esc(CATS[plan.category]||plan.category)}</span><h3>AI 이미지 스토리 만들기</h3><p class="mut">본문을 요약 복사하지 않고 호기심의 순서를 먼저 설계합니다. 생성 결과는 Content Master 공통 미디어 끝에 추가되어 Threads와 Instagram에서 함께 사용할 수 있습니다.</p><div class="ig-actions"><button class="btn" onclick="PostAuto.instagramRegenerate()" ${state.generating||instagramPublishing?'disabled':''}>${selected+1}번 이미지 추가 생성</button><button class="btn" onclick="PostAuto.instagramRegenerateAll()" ${state.generating||instagramPublishing?'disabled':''}>새 스토리 추가 생성</button></div><p class="mut">직접 추가한 사진·영상과 현재 미디어 순서는 변경하지 않습니다.</p></div></div>`;
}
async function instagramApi(action,payload){
 const r=await fetch(`/api/content-router?action=${encodeURIComponent(action)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(apiError(j,action.toUpperCase()+'_FAILED'));
 return j;
}
async function generateInstagramSlide(index){
 const state=instagramCarousel,slide=state?.plan?.slides?.[index];if(!state||!slide)return;
 const variation=state.variations[index]||1;
 const payload=state.candidate.category==='AI_TIP'
  ?{candidate:state.candidate,candidate_id:state.candidateId,plan:state.plan,slide,mode:'compose',cut_images:slide.cut_ids.map(id=>state.cutImages.find(item=>item?.cut_id===id)).filter(Boolean)}
  :{candidate:state.candidate,candidate_id:state.candidateId,plan:state.plan,slide,variation};
 const j=await instagramApi('instagram_carousel_image',payload);
 if(state!==instagramCarousel)return;
 state.images[index]=j.url;
 appendMasterMedia(state.candidateIndex,{id:mediaId('ig-ai'),type:'image',source:'ai',url:j.url,previewUrl:j.url,mime_type:'image/jpeg'});
 persistInstagramCarousel(state);
}
async function generateAiTipCuts(state){
 for(let index=0;index<state.plan.cuts.length;index++){
  if(state!==instagramCarousel)return;
  const cut=state.plan.cuts[index];if(state.cutImages[index]?.url)continue;
  state.status=`웹툰 컷 생성 중 ${index+1}/${state.plan.total_cuts}`;renderInstagramCarousel();
  const j=await instagramApi('instagram_carousel_image',{candidate:state.candidate,candidate_id:state.candidateId,plan:state.plan,cut,mode:'cut',variation:1});
  state.cutImages[index]={cut_id:j.cut_id,url:j.url};persistInstagramCarousel(state);
 }
}
async function completeInstagramCarousel(state,createPlan=false){
 try{
  if(createPlan||!state.plan){
   const prepared=await instagramApi('instagram_carousel_prepare',{candidate:state.candidate});
   if(state!==instagramCarousel)return;
    state.plan=prepared.plan;state.caption=prepared.plan.caption;state.images=new Array(prepared.plan.slide_count).fill(null);state.cutImages=new Array(Number(prepared.plan.total_cuts)||0).fill(null);state.variations=new Array(prepared.plan.slide_count).fill(1);persistInstagramCarousel(state);
  }
  if(state.candidate.category==='AI_TIP')await generateAiTipCuts(state);
  for(let index=0;index<state.plan.slide_count;index++){
   if(state!==instagramCarousel)return;
   if(state.images[index])continue;
   state.status=`이미지 준비 중 ${index+1}/${state.plan.slide_count}`;state.selected=index;renderInstagramCarousel();
   await generateInstagramSlide(index);renderInstagramCarousel();
  }
  state.selected=0;state.status='게시 전 검토';state.recordStatus='ready';state.generatedAt=Date.now();
 }catch(e){if(state===instagramCarousel){state.status='Instagram 캐러셀 생성 실패';state.recordStatus=state.plan?'incomplete':'prepare_failed';alert('Instagram 캐러셀 생성 실패: '+e.message)}}
 finally{state.generating=false;persistInstagramCarousel(state);if(state===instagramCarousel)renderInstagramCarousel()}
}
async function openInstagramCarousel(i){
 if(instagramPublishing)return;
 const candidate=instagramCandidate(i);if(!candidate)return alert('Instagram 캐러셀을 만들 본문이 필요합니다.');
 const candidateId=candidates[i]?.id||`candidate-${i}`;instagramModalOpen=true;
 if(instagramCarousel?.candidateId===candidateId){renderInstagramCarousel();return}
 const restored=restoreInstagramCarousel(instagramRecord(candidateId),i,candidate);
 if(restored){
  instagramCarousel=restored;renderInstagramCarousel();
  if(restored.images.filter(Boolean).length<restored.plan.slide_count&&!restored.published){restored.generating=true;restored.recordStatus='generating';await completeInstagramCarousel(restored,false)}
  return;
 }
 const state={candidate,candidateId,plan:null,caption:'',replyPrompt:candidate.reply_prompt||'',images:[],cutImages:[],variations:[],selected:0,status:'스토리보드 생성 중…',generating:true,published:false,requestId:instagramRequestId(),candidateIndex:i,createdAt:Date.now(),recordStatus:'generating'};
 instagramCarousel=state;renderInstagramCarousel();await completeInstagramCarousel(state,true);
}
function selectInstagramSlide(index){if(!instagramCarousel)return;instagramCarousel.selected=index;renderInstagramCarousel()}
function setInstagramCaption(value){if(!instagramCarousel||instagramCarousel.published)return;instagramCarousel.caption=String(value).slice(0,2200);persistInstagramCarousel()}
function setInstagramReplyPrompt(value){if(!instagramCarousel||instagramCarousel.published||!['AI_TIP','AI_PROMPT'].includes(instagramCarousel.candidate.category))return;instagramCarousel.replyPrompt=String(value);persistInstagramCarousel()}
function closeInstagramCarousel(){instagramModalOpen=false;renderInstagramCarousel()}
async function regenerateInstagramSlide(){
 const state=instagramCarousel,index=state?.selected||0;if(!state||state.generating||instagramPublishing)return;
 state.generating=true;state.recordStatus='generating';state.variations[index]=(state.variations[index]||1)+1;state.status=`${index+1}번 이미지 다시 생성 중…`;renderInstagramCarousel();
 try{await generateInstagramSlide(index);state.status='게시 전 검토';state.recordStatus='ready'}catch(e){state.status='이미지 다시 생성 실패';state.recordStatus='ready';alert('이미지 다시 생성 실패: '+e.message)}
 finally{state.generating=false;persistInstagramCarousel(state);renderInstagramCarousel()}
}
async function regenerateInstagramCarousel(){
 const state=instagramCarousel;if(!state||state.generating||instagramPublishing)return;
 if(!confirm(`새 이미지 시리즈를 Content Master 끝에 추가할까요? 기존 미디어는 유지됩니다.`))return;
 const candidate=instagramCandidate(state.candidateIndex);if(!candidate)return alert('Instagram 캐러셀을 다시 만들 본문이 필요합니다.');
 const replacement={candidate,candidateId:state.candidateId,plan:null,caption:'',replyPrompt:state.replyPrompt||candidate.reply_prompt||'',images:[],cutImages:[],variations:[],selected:0,status:'스토리보드 생성 중…',generating:true,published:false,requestId:instagramRequestId(),candidateIndex:state.candidateIndex,createdAt:Date.now(),recordStatus:'generating'};
 instagramCarousel=replacement;renderInstagramCarousel();await completeInstagramCarousel(replacement,true);
}
async function publishInstagramCarousel(){
 const state=instagramCarousel;if(!state||instagramPublishing||state.published)return;
 const caption=withPlatformBodyCta(document.getElementById('igCarouselCaption')?.value||state.caption,state.candidate.category,'instagram');
 const replyPromptValue=['AI_TIP','AI_PROMPT'].includes(state.candidate.category)?String(document.getElementById('igCarouselReplyPrompt')?.value??state.replyPrompt??'').trim():'';
 if(!caption)return alert('Instagram 캡션을 입력해 주세요.');
 if(['AI_TIP','AI_PROMPT'].includes(state.candidate.category)&&!replyPromptValue)return alert('DM으로 보낼 복붙용 프롬프트를 입력해 주세요.');
 if(state.images.filter(Boolean).length!==state.plan.slide_count)return alert('모든 캐러셀 이미지가 준비된 뒤 게시할 수 있습니다.');
 if(!confirm(`${state.plan.slide_count}장의 캐러셀을 @voara.lab에 게시할까요?\n\n이 작업은 실제 Instagram 게시입니다.`))return;
 state.caption=caption;state.replyPrompt=replyPromptValue;instagramPublishing=true;state.recordStatus='publishing';state.status='Instagram 컨테이너 생성 및 게시 중…';persistInstagramCarousel(state);renderInstagramCarousel();
 try{
  const j=await instagramApi('instagram_carousel_publish',{image_urls:state.images,caption:state.caption,request_id:state.requestId,content_id:state.candidateId,content_type:state.candidate.category,reply_prompt:state.replyPrompt});
  state.published=true;state.mediaId=j.media_id;state.publishedAt=j.published_at||new Date().toISOString();state.recordStatus='published';
  state.promptStoreStatus=j.prompt_stored===true?'stored':j.prompt_stored===false?'failed':j.prompt_store_skipped?'skipped':null;
  state.promptStoreError=j.prompt_store_error||null;
  state.status=state.promptStoreStatus==='failed'?'Instagram 게시 완료 / 프롬프트 저장 실패':'Instagram 게시 완료';
  alert(state.promptStoreStatus==='failed'?'Instagram 게시 완료 / 프롬프트 저장 실패':'Instagram 게시 완료 ✅');
 }catch(e){state.recordStatus='ready';state.status='Instagram 게시 실패';alert('Instagram 게시에 실패했습니다: '+e.message)}
 finally{instagramPublishing=false;persistInstagramCarousel(state);renderInstagramCarousel()}
}
async function retryInstagramPromptStore(){
 const state=instagramCarousel;if(!state?.published||!state.mediaId||state.promptStoreStatus!=='failed')return;
 state.status='프롬프트 저장 재시도 중…';renderInstagramCarousel();
 try{
  await instagramApi('instagram_prompt_store',{instagram_media_id:state.mediaId,content_id:state.candidateId,content_type:state.candidate.category,reply_prompt:state.replyPrompt||'',instagram_caption:state.caption,published_at:state.publishedAt});
  state.promptStoreStatus='stored';state.promptStoreError=null;state.status='Instagram 게시 완료 / 프롬프트 저장 완료';
 }catch(e){state.promptStoreStatus='failed';state.promptStoreError=e.message;state.status='Instagram 게시 완료 / 프롬프트 저장 실패';alert('프롬프트 저장 재시도 실패: '+e.message)}
 finally{persistInstagramCarousel(state);renderInstagramCarousel()}
}
async function followerBaseline(){
 try{
  const r=await fetch('/api/threads/my-posts?mode=account',{cache:'no-store'}),j=await r.json();
  const n=j?.account?.insights?.followers_count;
  return Number.isFinite(Number(n))?Number(n):null;
 }catch{return null}
}
async function publishFirstReply(parentId,text){
 if(!parentId||!text?.trim())return {ok:true,skipped:true};
 const r=await fetch('/api/threads/reply',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({reply_to_id:String(parentId),text:text.trim()})
 });
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(apiError(j,'FIRST_REPLY_FAILED'));
 return j;
}
function threadsAdapter(snapshot){
 const text=withPlatformBodyCta(snapshot.master_body,snapshot.content_type,'threads'),media=snapshot.media.map(({type,url})=>({type,url}));
 if(!text)throw new Error('Threads 본문을 입력해 주세요.');if(text.length>500)throw new Error(`Threads 본문은 500자 이하입니다. 현재 ${text.length}자입니다.`);if(media.length>PLATFORM_LIMITS.threads.maxMedia)throw new Error(`Threads 미디어는 최대 ${PLATFORM_LIMITS.threads.maxMedia}개입니다.`);
 return {text,media,topic_tag:snapshot.topic_tag,topic_tag_verified:snapshot.topic_tag_verified===true,reply_prompt:snapshot.reply_prompt||''};
}
function instagramAdapter(snapshot){
 const caption=withPlatformBodyCta(snapshot.master_body,snapshot.content_type,'instagram'),media=snapshot.media.map(m=>({type:m.type,url:m.url,mime_type:m.mime_type,duration:m.duration||0}));
 if(!caption)throw new Error('Instagram 캡션을 입력해 주세요.');if(caption.length>2200)throw new Error(`Instagram 캡션은 2200자 이하입니다. 현재 ${caption.length}자입니다.`);if(!media.length)throw new Error('Instagram 게시에는 미디어가 필요합니다.');if(media.length>PLATFORM_LIMITS.instagram.maxMedia)throw new Error(`Instagram 미디어는 최대 ${PLATFORM_LIMITS.instagram.maxMedia}개입니다.`);
 for(const item of media){if(item.type==='image'&&item.mime_type&&item.mime_type!=='image/jpeg')throw new Error('Instagram 이미지 게시에는 JPEG 미디어만 사용할 수 있습니다.');if(item.type==='video'&&item.duration&&(item.duration<3||item.duration>900))throw new Error('Instagram 영상은 3초 이상 15분 이하여야 합니다.')}
 return {media,caption,request_id:instagramRequestId(),content_id:snapshot.content_id,content_type:snapshot.content_type,reply_prompt:snapshot.reply_prompt||''};
}
function facebookAdapter(snapshot){
 const message=String(snapshot.master_body||'').trim(),media=snapshot.media.map(m=>({type:m.type,url:m.url,mime_type:m.mime_type}));
 if(!message)throw new Error('Facebook 본문을 입력해 주세요.');
 if(media.length>PLATFORM_LIMITS.facebook.maxMedia)throw new Error(`Facebook 미디어는 최대 ${PLATFORM_LIMITS.facebook.maxMedia}개입니다.`);
 if(media.some(item=>!['image','video'].includes(item.type)))throw new Error('Facebook에서 지원하지 않는 미디어 형식이 포함되어 있습니다.');
 const videos=media.filter(item=>item.type==='video'),images=media.filter(item=>item.type==='image');
 if(videos.length>1)throw new Error('Facebook 영상 게시에는 영상 1개만 사용할 수 있습니다.');
 // Graph API Page 게시에서는 혼합 캐러셀을 만들지 않고 영상이 있으면 영상을 대표 미디어로 게시한다.
 const selected=videos.length?[videos[0]]:images;
 return {message,media:selected,reply_text:String(snapshot.reply_prompt||'').trim(),omitted_images:videos.length?images.length:0};
}
async function upload(i){const x=candidates[i];if(x.image_url&&!x.final_image)return x.image_url;if(!x.final_image)throw new Error('최종 이미지를 먼저 확인해 주세요.');const r=await fetch('/api/content-router?action=store-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate_id:x.id,data_url:x.final_image,convert_jpeg:true})}),j=await r.json();if(!r.ok)throw new Error(apiError(j,'IMAGE_UPLOAD_FAILED'));x.image_url=j.url;return j.url}
async function keep(i){const x=candidates[i];if(!x?.final_image&&!x?.image_url)return alert('먼저 이미지를 생성해서 최종 썸네일을 확인해 주세요.');try{syncDraft(i);if(x.thumbnail_dirty)return alert('이미지에 반영되는 내용을 수정했어요. 이미지 다시 생성을 눌러 최종 썸네일을 확인해 주세요.');const url=await upload(i),v={...x,image_url:url,kept_at:Date.now()};delete v.base_image;delete v.final_image;const a=read(Q);a.unshift(v);write(Q,a);fb(x,'LIKE');renderQueue();alert('이미지 포함 발행 대기 저장 완료 ✅')}catch(e){alert('저장 실패: '+e.message)}}
async function now(i){
 const x=candidates[i];if(!x)return;
 try{
  const snapshot=snapshotMaster(i),payload=threadsAdapter(snapshot);
  if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i])&&!payload.reply_prompt)return alert('댓글 및 답장 내용을 입력해 주세요.');
  if(!confirm(`Content Master snapshot 그대로 Threads에 게시할까요?\n\n${x.topic||x.category_label||''}`))return;

  const r=await fetch('/api/threads/publish',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(apiError(j,'PUBLISH_FAILED'));

  let replyMessage='';
  if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i])){
   try{
    await publishFirstReply(j.id,payload.reply_prompt);
    replyMessage='\n댓글 및 답장 내용도 첫 일반 댓글로 게시 완료 ✅';
   }catch(e){
    replyMessage=`\n본문은 게시됐지만 첫 댓글 게시 실패: ${e.message}`;
   }
  }

  fb(x,'PUBLISHED');
  const master=ensureMaster(i);master.status.threads='published';saveMaster(i,master);
  const follower_at_publish=await followerBaseline();const a=read(P);a.unshift({thread_id:j.id,category:x.category,topic:x.topic,topic_tag:payload.topic_tag,hook:x.hook,published_at:Date.now(),image_url:payload.media[0]?.url||null,media:payload.media,follower_at_publish});write(P,a.slice(0,100));
  alert('Threads 게시 완료 ✅'+replyMessage);
 }catch(e){alert('게시 실패: '+e.message)}
}
async function publishInstagramMaster(i){
 const x=candidates[i];if(!x||instagramPublishing)return;
 try{
  const snapshot=snapshotMaster(i),payload=instagramAdapter(snapshot);
  if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i])&&!payload.reply_prompt)return alert('DM으로 보낼 댓글 및 답장 내용을 입력해 주세요.');
  if(!confirm(`현재 Content Master snapshot의 미디어 ${payload.media.length}개를 @voara.lab에 게시할까요?\n\n이 작업은 실제 Instagram 게시입니다.`))return;
  instagramPublishing=true;const j=await instagramApi('instagram_carousel_publish',payload);
  const master=ensureMaster(i);master.status.instagram='published';saveMaster(i,master);
  alert(j.prompt_stored===false?'Instagram 게시 완료 / 프롬프트 저장 실패':'Instagram 게시 완료 ✅');
 }catch(e){alert('Instagram 게시 실패: '+e.message)}finally{instagramPublishing=false}
}
async function publishFacebookMaster(i){
 const x=candidates[i];if(!x)return;
 try{
  const snapshot=snapshotMaster(i),payload=facebookAdapter(snapshot);
  if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i])&&!payload.reply_text)return alert('댓글 및 답장 내용을 입력해 주세요.');
  const videoCount=payload.media.filter(item=>item.type==='video').length,imageCount=payload.media.filter(item=>item.type==='image').length;
  const mediaText=videoCount?`영상 ${videoCount}개와 `:(imageCount?`사진 ${imageCount}개와 `:'');
  const omitted=payload.omitted_images?`\n영상 게시를 위해 사진 ${payload.omitted_images}장은 Facebook에서 제외됩니다.`:'';
  if(!confirm(`Voara.lab Facebook 페이지에 ${mediaText}현재 본문을 게시할까요?${omitted}\n\n이 작업은 실제 Facebook 게시입니다.`))return;
  const r=await fetch('/api/content-router?action=facebook_publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(apiError(j,'FACEBOOK_PUBLISH_FAILED'));
  const master=ensureMaster(i);master.status.facebook='published';master.facebook_post_id=j.post_id;saveMaster(i,master);
  if(payload.reply_text)registerSocialAutomation({platform:'facebook',id:j.post_id,reply_text:payload.reply_text,content_id:snapshot.content_id});
  alert('Facebook 게시 완료 ✅'+(payload.reply_text?'\n댓글 자동답장 대상에 등록했습니다.':''));
 }catch(e){alert('Facebook 게시 실패: '+e.message)}
}
function youtubeOptions(){
 return {
  paid_promotion:document.getElementById('youtubePaidPromotion')?.checked!==false,
  synthetic_media:document.getElementById('youtubeSyntheticMedia')?.checked!==false
 };
}
function youtubeAdapter(snapshot){
 const videos=snapshot.media.filter(m=>m.type==='video');
 if(videos.length!==1)throw new Error('YouTube 자동 게시에는 영상 1개가 필요합니다.');
 const title=String(snapshot.title||snapshot.master_body||'VOARA 영상').replace(/\s+/g,' ').trim().slice(0,100);
 const description=String(snapshot.master_body||'').trim();
 if(!description)throw new Error('YouTube 설명에 사용할 본문을 입력해 주세요.');
 return {video_url:videos[0].url,title,description,reply_text:String(snapshot.reply_prompt||'').trim(),...youtubeOptions()};
}
async function publishYoutubeMaster(i){
 const x=candidates[i];if(!x)return;
 try{
  const snapshot=snapshotMaster(i),payload=youtubeAdapter(snapshot);
  if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i])&&!payload.reply_text)return alert('댓글 및 답장 내용을 입력해 주세요.');
  if(!confirm(`YouTube에 영상을 게시할까요?\n\n유료 프로모션: ${payload.paid_promotion?'예':'아니요'}\nAI 사용/합성 콘텐츠: ${payload.synthetic_media?'예':'아니요'}\n\n게시 후 첫 댓글과 새 댓글 답장에도 입력 내용을 사용합니다.`))return;
  const r=await fetch('/api/content-router?action=youtube_publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(apiError(j,'YOUTUBE_PUBLISH_FAILED'));
  const master=ensureMaster(i);master.status.youtube='published';master.youtube_video_id=j.video_id;saveMaster(i,master);
  if(payload.reply_text)registerSocialAutomation({platform:'youtube',id:j.video_id,reply_text:payload.reply_text,content_id:snapshot.content_id});
  alert('YouTube 게시 완료 ✅'+(j.first_comment_error?`\n첫 댓글 실패: ${j.first_comment_error}`:'\n첫 댓글 등록 완료 ✅'));
 }catch(e){alert('YouTube 게시 실패: '+e.message)}
}
function socialAutomationRecords(){const x=read(SOCIAL_AUTOMATION,[]);return Array.isArray(x)?x:[]}
function registerSocialAutomation(entry){
 const rows=socialAutomationRecords(),key=`${entry.platform}:${entry.id}`;const next={...entry,key,updated_at:Date.now()};
 const idx=rows.findIndex(x=>x.key===key);if(idx>=0)rows[idx]=next;else rows.unshift(next);write(SOCIAL_AUTOMATION,rows.slice(0,200));
}
let socialSyncRunning=false;
async function socialAutomationTick(){
 if(socialSyncRunning)return;socialSyncRunning=true;
 try{
  const rows=socialAutomationRecords();
  for(const row of rows){
   try{
    const action=row.platform==='facebook'?'facebook_comment_sync':row.platform==='youtube'?'youtube_comment_sync':'';if(!action)continue;
    await fetch(`/api/content-router?action=${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row.platform==='facebook'?{post_id:row.id,reply_text:row.reply_text}:{video_id:row.id,reply_text:row.reply_text})});
   }catch{}
  }
 }finally{socialSyncRunning=false}
}
async function variant(i){const x=candidates[i];try{x.body=body(i);if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i]))x.reply_prompt=replyPrompt(i);const r=await fetch('/api/content-router?action=variant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate:x})}),j=await r.json();if(!r.ok)throw new Error(j.detail||j.error);candidates[i]=j.item;candidates[i].variation=1;const master=ensureMaster(i);master.master_body=j.item.body||master.master_body;if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i]))master.reply_prompt=j.item.reply_prompt||master.reply_prompt;saveMaster(i,master);fb(x,'VARIANT');saveDrafts();render()}catch(e){alert('다른 버전 실패: '+e.message)}}
function no(i){if(candidates[i])fb(candidates[i],'DISLIKE');candidates[i]=null;saveDrafts();render()}
function renderQueue(){const a=read(Q),n=document.getElementById('v3qcount'),b=document.getElementById('v3queue');if(n)n.textContent=a.length;if(!b)return;b.innerHTML=a.length?a.map((x,i)=>`<article class="card"><div style="display:grid;grid-template-columns:150px 1fr;gap:14px"><img src="${esc(x.image_url)}" style="width:150px;aspect-ratio:4/5;object-fit:cover;border-radius:10px"><div><span class="badge">${esc(CATS[x.category]||x.category_label)}</span><h3>${esc(x.topic||x.category_label||'')}</h3><div class="post-text">${esc(x.body)}</div><div style="margin-top:10px;display:flex;gap:8px"><button class="btn p" onclick="PostAuto.publishQueue(${i})">🚀 지금 게시</button><button class="btn" onclick="PostAuto.drop(${i})">제거</button></div></div></div></article>`).join(''):'<div class="card empty"><div><b>발행 대기 없음</b>이미지를 확인하고 👍한 게시물이 여기에 쌓입니다.</div></div>'}
async function publishQueue(i){const a=read(Q),x=a[i];if(!x||!confirm(`"${x.topic||x.category_label||''}" 지금 게시할까요?`))return;const text=withPlatformBodyCta(x.body,x.category,'threads'),r=await fetch('/api/threads/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,image_url:x.image_url,topic_tag:String(x.topic_tag||'').replace(/^#+/,'').trim(),topic_tag_verified:x.topic_tag_verified===true})}),j=await r.json();if(!r.ok)return alert('게시 실패: '+(j.detail||j.error));const follower_at_publish=await followerBaseline();const p=read(P);p.unshift({thread_id:j.id,category:x.category,topic:x.topic,topic_tag:String(x.topic_tag||'').replace(/^#+/,'').trim(),hook:x.hook,published_at:Date.now(),image_url:x.image_url,follower_at_publish});write(P,p.slice(0,100));fb(x,'PUBLISHED');a.splice(i,1);write(Q,a);renderQueue();alert('게시 완료 ✅')}
function drop(i){const a=read(Q);a.splice(i,1);write(Q,a);renderQueue()}
function patchReplies(){
 const desc=document.querySelector('#replies .section p.mut');if(desc)desc.textContent='게시물 날짜 제한 없이 전체 원본 게시물의 댓글을 확인합니다. 미응답은 API에 무리 없이 순차 답장합니다.';
 if(typeof updateBatchButton==='function')updateBatchButton=function(){const items=Array.isArray(window._replyItems)?window._replyItems:[],eligible=items.filter(x=>!x.review_required&&!x.already_replied),n=eligible.length,b=document.getElementById('batchReply'),note=document.getElementById('batchNote');b.disabled=!n||window._replyHistoryAvailable===false||window._batchRunning;b.textContent=window._batchRunning?'일괄 답장 처리 중…':(n?`일괄 승인 후 답장 (${n})`:'일괄 승인 후 답장');note.textContent=`전체 이력 미응답 ${eligible.length}개 · 한 개씩 순차 처리합니다.`};
 const b=document.getElementById('batchReply');if(!b)return;b.onclick=async()=>{if(window._batchRunning||window._replyHistoryAvailable===false)return;const all=window._replyItems||[],targets=[];all.forEach((x,i)=>{if(x.review_required||x.already_replied)return;const text=document.getElementById(`replyText-${i}`)?.value.trim();if(text)targets.push({i,id:x.id,text})});if(!targets.length||!confirm(`${targets.length}개 미응답 댓글을 순차 답장할까요?`))return;window._batchRunning=true;updateBatchButton();let ok=0,fail=0;for(let n=0;n<targets.length;n++){const t=targets[n];b.textContent=`일괄 답장 ${n+1}/${targets.length}`;try{await postReply(t.id,t.text);markReplyDone(t.i,t.id,t.text);ok++}catch{fail++}if(n<targets.length-1)await new Promise(r=>setTimeout(r,500))}window._batchRunning=false;updateBatchButton();alert(`완료 · 성공 ${ok} / 실패 ${fail}`);await syncReplies(currentPostIds).catch(()=>{})};
 setTimeout(()=>{try{updateBatchButton()}catch{}},100);
}
window.PostAuto={generate:generatePillar,image:i=>makeImage(i,false),reimage:i=>makeImage(i,true),keep,now,variant,no,drop,publishQueue,save:syncDraft,addMedia:addLocalMedia,removeMedia:removeMasterMedia,moveMedia:moveMasterMedia,instagram:openInstagramCarousel,instagramSelect:selectInstagramSlide,instagramCaption:setInstagramCaption,instagramReplyPrompt:setInstagramReplyPrompt,instagramClose:closeInstagramCarousel,instagramRegenerate:regenerateInstagramSlide,instagramRegenerateAll:regenerateInstagramCarousel,instagramPublish:publishInstagramCarousel,instagramMasterPublish:publishInstagramMaster,facebookPublish:publishFacebookMaster,youtubePublish:publishYoutubeMaster,instagramPromptStoreRetry:retryInstagramPromptStore};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensure);else ensure();
setTimeout(()=>socialAutomationTick(),12000);setInterval(()=>socialAutomationTick(),90000);
})();
