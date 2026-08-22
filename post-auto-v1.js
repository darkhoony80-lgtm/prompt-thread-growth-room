/* Growth Engine V3. Filename kept for existing index.html include. */
(function(){
const CATS={AI_PROMPT:'AI 프롬프트',AI_TIP:'AI 활용 팁',FOOD_PICK:'오늘 뭐 먹지?',HOT_ISSUE:'🔥 오늘의 핫이슈'};
const Q='pt_queue_v3',F='pt_feedback_v3',P='pt_published_v3',D='pt_drafts_v6',FH='pt_food_history_v1',IGC='pt_instagram_carousels_v1';
const PILLARS=['AI_TIP','AI_PROMPT','FOOD_PICK','HOT_ISSUE'];
let candidates=[null,null,null,null];
let instagramCarousel=null,instagramPublishing=false,instagramModalOpen=false;
function read(k,d=[]){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d))}catch{return d}}
function write(k,v){localStorage.setItem(k,JSON.stringify(v))}
function instagramRecords(){const value=read(IGC,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function instagramRecord(id){return instagramRecords()[String(id||'')]||null}
function persistInstagramCarousel(state=instagramCarousel){
 if(!state?.candidateId||!state?.plan)return;
 const records=instagramRecords(),now=Date.now(),previous=records[state.candidateId]||{};
 records[state.candidateId]={
  version:1,content_id:state.candidateId,content_type:state.candidate.category,
  candidate:state.candidate,plan:state.plan,
  images:state.images.map((url,index)=>({order:index+1,url:url||null,variation:state.variations[index]||1})),
  caption:state.caption,reply_prompt:state.candidate.reply_prompt||'',
  status:state.recordStatus||(state.published?'published':state.generating?'generating':state.images.filter(Boolean).length===state.plan.slide_count?'ready':'incomplete'),
  generated_at:state.generatedAt||previous.generated_at||null,created_at:previous.created_at||state.createdAt||now,updated_at:now,
  request_id:state.requestId,media_id:state.mediaId||previous.media_id||null,published_at:state.publishedAt||previous.published_at||null,
  prompt_store_status:state.promptStoreStatus||previous.prompt_store_status||null,
  prompt_store_error:state.promptStoreError||null
 };
 write(IGC,records);
}
function restoreInstagramCarousel(record,index,candidate){
 const plan=record?.plan,items=Array.isArray(record?.images)?record.images.slice().sort((a,b)=>Number(a.order)-Number(b.order)):[];
 if(!plan||!Array.isArray(plan.slides)||plan.slides.length<3||plan.slides.length>5)return null;
 return {
  candidate:record.candidate||candidate,candidateId:record.content_id,plan,caption:String(record.caption||plan.caption||''),
  images:new Array(plan.slide_count).fill(null).map((_,i)=>items[i]?.url||null),
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
 saveDrafts();
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
   const r=await fetch('/api/content-router?action=generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pillar,feedback,performance,recentFood,recentHotIssues:recentHot,mood:pillar==='AI_PROMPT'?mood:'RANDOM'})});
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
 const desc={AI_TIP:'짧고 낯선 전문 명령어 + 영어 사용 예시',AI_PROMPT:'저장하고 싶은 상세 영문 프롬프트',FOOD_PICK:'점심·저녁·술안주를 실제 전국 맛집으로 추천',HOT_ISSUE:'오늘 실제 뉴스에서 가장 강한 이슈 하나'}[pillar];
 return `<article class="card" id="v3card-${i}"><div class="post-meta"><span class="badge">${esc(CATS[pillar])}</span></div><h3 style="margin:10px 0 6px">${esc(CATS[pillar])}</h3><p class="mut">${esc(desc)}</p>${pillar==='AI_PROMPT'?`<div style="display:flex;gap:6px;flex-wrap:wrap">
<button class="btn p" id="v3gen-${i}" onclick="PostAuto.generate(${i},'RANDOM')">🎲 랜덤</button>
<button class="btn" onclick="PostAuto.generate(${i},'HAPPY')">😊 행복</button>
<button class="btn" onclick="PostAuto.generate(${i},'LOVE')">❤️ 사랑</button>
<button class="btn" onclick="PostAuto.generate(${i},'COMIC')">😂 코믹</button>
<button class="btn" onclick="PostAuto.generate(${i},'HORROR')">👻 공포</button>
<button class="btn" onclick="PostAuto.generate(${i},'FANTASY')">🧚 판타지</button>
</div>`:`<button class="btn p" id="v3gen-${i}" onclick="PostAuto.generate(${i})">✨ 생성</button>`}</article>`;
}
function render(){
 const box=document.getElementById('v3list');if(!box)return;
 box.innerHTML=PILLARS.map((pillar,i)=>{const x=candidates[i];if(!x)return emptyCard(pillar,i);return `<article class="card" id="v3card-${i}"><div class="post-meta"><span class="badge">${esc(x.category_label||CATS[pillar])}</span><span class="badge">4:5 이미지 검수</span><span class="mut">총점 ${x.score?.total||0}</span></div><div class="v3grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,380px);gap:18px;align-items:start"><div><div style="display:flex;justify-content:flex-end;gap:8px;align-items:center">${pillar==='AI_PROMPT'?`<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
<button class="btn" id="v3gen-${i}" onclick="PostAuto.generate(${i},'RANDOM')">🎲 랜덤</button>
<button class="btn" onclick="PostAuto.generate(${i},'HAPPY')">😊 행복</button>
<button class="btn" onclick="PostAuto.generate(${i},'LOVE')">❤️ 사랑</button>
<button class="btn" onclick="PostAuto.generate(${i},'COMIC')">😂 코믹</button>
<button class="btn" onclick="PostAuto.generate(${i},'HORROR')">👻 공포</button>
<button class="btn" onclick="PostAuto.generate(${i},'FANTASY')">🧚 판타지</button>
</div>`:`<button class="btn" id="v3gen-${i}" onclick="PostAuto.generate(${i})">🔄 다시 생성</button>`}</div><label class="mut">본문</label><textarea id="v3body-${i}" maxlength="500" oninput="PostAuto.save(${i})" style="width:100%;min-height:190px;margin-top:5px;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:12px;line-height:1.55">${esc(x.body)}</textarea>${['AI_PROMPT','AI_TIP'].includes(pillar)?`<label class="mut" style="display:block;margin-top:10px">첫 댓글 · 복붙용 프롬프트</label><textarea id="v3reply-${i}" oninput="PostAuto.save(${i})" style="width:100%;min-height:150px;margin-top:5px;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:12px;line-height:1.55">${esc(x.reply_prompt||'')}</textarea><p class="mut">본문에는 설명만, 실제 복붙용 프롬프트는 이 칸에만 저장됩니다.</p>`:'' }<p class="mut">소재 · ${esc(x.topic)}</p><p class="mut">추천 이유 · ${esc(x.reason)}</p>${x.source_notes?.length?`<p class="mut">검증 메모 · ${esc(x.source_notes.join(' / '))}</p>`:''}<div style="margin:10px 0"><label class="mut">🏷 Threads 추천 Topic ${x.topic_tag_verified?'· TAG 검색 확인 ✅':(x.topic_tag_search_available===false?'· 검색 확인 불가':'· 추천값')}</label><input id="v3topic-${i}" maxlength="80" oninput="PostAuto.save(${i})" value="${esc(x.topic_tag||'')}" placeholder="예: AI 이미지" style="width:100%;margin-top:5px;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:10px 11px"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn p" onclick="PostAuto.image(${i})">🖼 이미지 생성</button><button class="btn" onclick="PostAuto.reimage(${i})">🔄 이미지 다시 생성</button><button class="btn" onclick="PostAuto.variant(${i})">다른 버전</button><button class="btn" onclick="PostAuto.keep(${i})">👍 발행 대기</button><button class="btn p" onclick="PostAuto.now(${i})">🚀 즉시 게시</button><button class="btn" onclick="PostAuto.no(${i})">👎 비우기</button></div></div><div id="v3img-${i}" class="card" style="padding:10px;min-height:270px;display:grid;place-items:center"><span class="mut">이미지를 생성한 뒤 직접 확인하세요.</span></div></div></article>`}).join('');
 if(!document.getElementById('v3css'))document.head.insertAdjacentHTML('beforeend','<style id="v3css">@media(max-width:900px){.v3grid{grid-template-columns:1fr!important}}</style>');
 candidates.forEach((x,i)=>{
  if(x?.image_url||x?.final_image)preview(i);
  const card=document.getElementById(`v3card-${i}`),buttons=card?.querySelectorAll('button');
  const actionRow=buttons?.length?buttons[buttons.length-1].parentElement:null;
  if(actionRow&&!actionRow.querySelector('.instagram-carousel-button')){
   actionRow.insertAdjacentHTML('beforeend',`<button class="btn instagram-carousel-button" onclick="PostAuto.instagram(${i})">Instagram 캐러셀 만들기</button>`);
  }
 });
}
function preview(i){const x=candidates[i],b=document.getElementById(`v3img-${i}`),src=x?.final_image||x?.image_url;if(!src){b.innerHTML='<span class="mut">이미지를 생성한 뒤 직접 확인하세요.</span>';return}b.innerHTML=`<div><img src="${src}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:11px;display:block"><p class="mut" style="margin:8px 2px 0">최종 썸네일 미리보기 · 확인 후 채택/게시</p></div>`}
async function makeImage(i,redo=false){
 const x=candidates[i],box=document.getElementById(`v3img-${i}`);if(!x)return;box.innerHTML='<span class="mut">Gemini 이미지 생성 중…</span>';x.variation=redo?(x.variation||1)+1:(x.variation||1);x.body=body(i);if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i]))x.reply_prompt=replyPrompt(i);
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
  await upload(i);saveDrafts();preview(i);
 }catch(e){box.innerHTML='<span class="mut">이미지 생성 실패</span>';alert('이미지 생성 실패: '+e.message)}
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
.ig-modal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.82);padding:24px;overflow:auto}.ig-dialog{max-width:1120px;margin:0 auto;background:#10141a;border:1px solid var(--l);border-radius:16px;padding:18px;box-shadow:0 24px 80px #000}.ig-preview-grid{display:grid;grid-template-columns:minmax(300px,520px) 1fr;gap:18px}.ig-main-image{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:13px;border:1px solid var(--l);background:#090b0f}.ig-thumbs{display:grid;grid-template-columns:repeat(5,minmax(70px,1fr));gap:8px;margin-top:10px}.ig-thumb{position:relative;padding:0;border:2px solid transparent;border-radius:10px;overflow:hidden;background:#090b0f;cursor:pointer}.ig-thumb.on{border-color:var(--a)}.ig-thumb img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block}.ig-thumb span{position:absolute;top:5px;left:5px;background:#090b0fd9;border-radius:12px;padding:3px 7px;font-size:10px}.ig-caption{width:100%;min-height:260px;resize:vertical;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:12px;line-height:1.55}.ig-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}@media(max-width:820px){.ig-modal{padding:10px}.ig-preview-grid{grid-template-columns:1fr}.ig-thumbs{grid-template-columns:repeat(5,1fr)}}
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
 box.innerHTML=`<div class="ig-preview-grid"><div>${image?`<img class="ig-main-image" src="${esc(image)}" alt="확대된 ${selected+1}번 캐러셀 이미지">`:'<div class="ig-main-image" style="display:grid;place-items:center;color:var(--m)">이미지 준비 중</div>'}<div class="ig-thumbs">${thumbs}</div><p class="mut">${selected+1}/${plan.slide_count} · ${esc(plan.slides[selected]?.role||'')}</p><p>${esc(plan.slides[selected]?.message||'')}</p></div><div><span class="badge">${esc(CATS[plan.category]||plan.category)}</span><h3>Instagram 전용 캡션</h3><textarea id="igCarouselCaption" class="ig-caption" maxlength="2200" oninput="PostAuto.instagramCaption(this.value)" ${state.published?'disabled':''}>${esc(state.caption)}</textarea><p class="mut">게시 전에 자유롭게 수정할 수 있습니다. ${state.caption.length}/2200자</p><div class="ig-actions"><button class="btn" onclick="PostAuto.instagramRegenerate()" ${state.generating||instagramPublishing||state.published?'disabled':''}>${selected+1}번 이미지 다시 생성</button><button class="btn" onclick="PostAuto.instagramRegenerateAll()" ${state.generating||instagramPublishing||state.published?'disabled':''}>캐러셀 전체 다시 생성</button><button class="btn p" onclick="PostAuto.instagramPublish()" ${state.images.filter(Boolean).length!==plan.slide_count||state.generating||instagramPublishing||state.published?'disabled':''}>${instagramPublishing?'Instagram 게시 중…':state.published?'Instagram 게시 완료':'Instagram 게시'}</button>${state.published&&state.promptStoreStatus==='failed'?'<button class="btn" onclick="PostAuto.instagramPromptStoreRetry()">프롬프트 저장 재시도</button>':''}</div><p class="mut">${state.promptStoreStatus==='failed'?'Instagram 게시 완료 / 프롬프트 저장 실패 · 게시물을 다시 올리지 않고 저장만 재시도할 수 있습니다.':'게시 버튼을 직접 누르고 최종 확인한 경우에만 Instagram에 게시됩니다. Threads 게시와는 독립입니다.'}</p></div></div>`;
}
async function instagramApi(action,payload){
 const r=await fetch(`/api/content-router?action=${encodeURIComponent(action)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(apiError(j,action.toUpperCase()+'_FAILED'));
 return j;
}
async function generateInstagramSlide(index){
 const state=instagramCarousel,slide=state?.plan?.slides?.[index];if(!state||!slide)return;
 const variation=state.variations[index]||1;
 const j=await instagramApi('instagram_carousel_image',{candidate:state.candidate,candidate_id:state.candidateId,plan:state.plan,slide,variation});
 if(state!==instagramCarousel)return;
 state.images[index]=j.url;
 persistInstagramCarousel(state);
}
async function completeInstagramCarousel(state,createPlan=false){
 try{
  if(createPlan||!state.plan){
   const prepared=await instagramApi('instagram_carousel_prepare',{candidate:state.candidate});
   if(state!==instagramCarousel)return;
   state.plan=prepared.plan;state.caption=prepared.plan.caption;state.images=new Array(prepared.plan.slide_count).fill(null);state.variations=new Array(prepared.plan.slide_count).fill(1);persistInstagramCarousel(state);
  }
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
 const state={candidate,candidateId,plan:null,caption:'',images:[],variations:[],selected:0,status:'스토리보드 생성 중…',generating:true,published:false,requestId:instagramRequestId(),candidateIndex:i,createdAt:Date.now(),recordStatus:'generating'};
 instagramCarousel=state;renderInstagramCarousel();await completeInstagramCarousel(state,true);
}
function selectInstagramSlide(index){if(!instagramCarousel)return;instagramCarousel.selected=index;renderInstagramCarousel()}
function setInstagramCaption(value){if(!instagramCarousel||instagramCarousel.published)return;instagramCarousel.caption=String(value).slice(0,2200);persistInstagramCarousel()}
function closeInstagramCarousel(){instagramModalOpen=false;renderInstagramCarousel()}
async function regenerateInstagramSlide(){
 const state=instagramCarousel,index=state?.selected||0;if(!state||state.generating||instagramPublishing||state.published)return;
 state.generating=true;state.recordStatus='generating';state.variations[index]=(state.variations[index]||1)+1;state.status=`${index+1}번 이미지 다시 생성 중…`;renderInstagramCarousel();
 try{await generateInstagramSlide(index);state.status='게시 전 검토';state.recordStatus='ready'}catch(e){state.status='이미지 다시 생성 실패';state.recordStatus='ready';alert('이미지 다시 생성 실패: '+e.message)}
 finally{state.generating=false;persistInstagramCarousel(state);renderInstagramCarousel()}
}
async function regenerateInstagramCarousel(){
 const state=instagramCarousel;if(!state||state.generating||instagramPublishing||state.published)return;
 if(!confirm(`기존 ${state.plan.slide_count}장의 이미지는 교체됩니다. 캐러셀 전체를 다시 생성하시겠습니까?`))return;
 const candidate=instagramCandidate(state.candidateIndex);if(!candidate)return alert('Instagram 캐러셀을 다시 만들 본문이 필요합니다.');
 const replacement={candidate,candidateId:state.candidateId,plan:null,caption:'',images:[],variations:[],selected:0,status:'스토리보드 생성 중…',generating:true,published:false,requestId:instagramRequestId(),candidateIndex:state.candidateIndex,createdAt:Date.now(),recordStatus:'generating'};
 instagramCarousel=replacement;renderInstagramCarousel();await completeInstagramCarousel(replacement,true);
}
async function publishInstagramCarousel(){
 const state=instagramCarousel;if(!state||instagramPublishing||state.published)return;
 const caption=String(document.getElementById('igCarouselCaption')?.value||state.caption).trim();
 if(!caption)return alert('Instagram 캡션을 입력해 주세요.');
 if(state.images.filter(Boolean).length!==state.plan.slide_count)return alert('모든 캐러셀 이미지가 준비된 뒤 게시할 수 있습니다.');
 if(!confirm(`${state.plan.slide_count}장의 캐러셀을 @voara.lab에 게시할까요?\n\n이 작업은 실제 Instagram 게시입니다.`))return;
 state.caption=caption;instagramPublishing=true;state.recordStatus='publishing';state.status='Instagram 컨테이너 생성 및 게시 중…';persistInstagramCarousel(state);renderInstagramCarousel();
 try{
  const j=await instagramApi('instagram_carousel_publish',{image_urls:state.images,caption:state.caption,request_id:state.requestId,content_id:state.candidateId,content_type:state.candidate.category,reply_prompt:state.candidate.reply_prompt||''});
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
  await instagramApi('instagram_prompt_store',{instagram_media_id:state.mediaId,content_id:state.candidateId,content_type:state.candidate.category,reply_prompt:state.candidate.reply_prompt||'',instagram_caption:state.caption,published_at:state.publishedAt});
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
  body:JSON.stringify({reply_to_id:String(parentId),attachment_text:text.trim()})
 });
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(apiError(j,'FIRST_REPLY_FAILED'));
 return j;
}
async function upload(i){const x=candidates[i];if(x.image_url&&!x.final_image)return x.image_url;if(!x.final_image)throw new Error('최종 이미지를 먼저 확인해 주세요.');const r=await fetch('/api/content-router?action=store-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate_id:x.id,data_url:x.final_image})}),j=await r.json();if(!r.ok)throw new Error(apiError(j,'IMAGE_UPLOAD_FAILED'));x.image_url=j.url;return j.url}
async function keep(i){const x=candidates[i];if(!x?.final_image&&!x?.image_url)return alert('먼저 이미지를 생성해서 최종 썸네일을 확인해 주세요.');try{syncDraft(i);if(x.thumbnail_dirty)return alert('이미지에 반영되는 내용을 수정했어요. 이미지 다시 생성을 눌러 최종 썸네일을 확인해 주세요.');const url=await upload(i),v={...x,image_url:url,kept_at:Date.now()};delete v.base_image;delete v.final_image;const a=read(Q);a.unshift(v);write(Q,a);fb(x,'LIKE');renderQueue();alert('이미지 포함 발행 대기 저장 완료 ✅')}catch(e){alert('저장 실패: '+e.message)}}
async function now(i){
 const x=candidates[i];if(!x?.final_image&&!x?.image_url)return alert('즉시 게시 전에 이미지를 생성해서 직접 확인해 주세요.');
 try{
  syncDraft(i);
   if(x.thumbnail_dirty)return alert('이미지에 반영되는 내용을 수정했어요. 이미지 다시 생성을 눌러 최종 썸네일을 확인해 주세요.');
  if(!confirm(`지금 보이는 이미지와 본문 그대로 게시할까요?\n\n${x.topic||x.category_label||''}`))return;

  const url=await upload(i);
  const text=body(i);
  if(text.length>500)return alert(`본문이 ${text.length}자예요. Threads 본문은 500자 이하로 줄여 주세요.`);
  if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i])&&!replyPrompt(i))return alert('첫 댓글용 영문 프롬프트가 비어 있어요. AI 프롬프트를 다시 생성해 주세요.');

  const r=await fetch('/api/threads/publish',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({text,image_url:url,topic_tag:topicTag(i),topic_tag_verified:x.topic_tag_verified===true})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(apiError(j,'PUBLISH_FAILED'));

  let replyMessage='';
  if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i])){
   try{
    await publishFirstReply(j.id,replyPrompt(i));
    replyMessage='\n프롬프트도 첫 댓글 텍스트 첨부로 게시 완료 ✅';
   }catch(e){
    replyMessage=`\n본문은 게시됐지만 첫 댓글 첨부 실패: ${e.message}`;
   }
  }

  fb(x,'PUBLISHED');
  const follower_at_publish=await followerBaseline();const a=read(P);a.unshift({thread_id:j.id,category:x.category,topic:x.topic,topic_tag:topicTag(i),hook:x.hook,published_at:Date.now(),image_url:url,follower_at_publish});write(P,a.slice(0,100));
  alert('Threads 게시 완료 ✅'+replyMessage);
 }catch(e){alert('게시 실패: '+e.message)}
}
async function variant(i){const x=candidates[i];try{x.body=body(i);if(['AI_PROMPT','AI_TIP'].includes(PILLARS[i]))x.reply_prompt=replyPrompt(i);const r=await fetch('/api/content-router?action=variant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate:x})}),j=await r.json();if(!r.ok)throw new Error(j.detail||j.error);candidates[i]=j.item;candidates[i].variation=1;fb(x,'VARIANT');saveDrafts();render()}catch(e){alert('다른 버전 실패: '+e.message)}}
function no(i){if(candidates[i])fb(candidates[i],'DISLIKE');candidates[i]=null;saveDrafts();render()}
function renderQueue(){const a=read(Q),n=document.getElementById('v3qcount'),b=document.getElementById('v3queue');if(n)n.textContent=a.length;if(!b)return;b.innerHTML=a.length?a.map((x,i)=>`<article class="card"><div style="display:grid;grid-template-columns:150px 1fr;gap:14px"><img src="${esc(x.image_url)}" style="width:150px;aspect-ratio:4/5;object-fit:cover;border-radius:10px"><div><span class="badge">${esc(x.category_label||CATS[x.category])}</span><h3>${esc(x.topic||x.category_label||'')}</h3><div class="post-text">${esc(x.body)}</div><div style="margin-top:10px;display:flex;gap:8px"><button class="btn p" onclick="PostAuto.publishQueue(${i})">🚀 지금 게시</button><button class="btn" onclick="PostAuto.drop(${i})">제거</button></div></div></div></article>`).join(''):'<div class="card empty"><div><b>발행 대기 없음</b>이미지를 확인하고 👍한 게시물이 여기에 쌓입니다.</div></div>'}
async function publishQueue(i){const a=read(Q),x=a[i];if(!x||!confirm(`"${x.topic||x.category_label||''}" 지금 게시할까요?`))return;const r=await fetch('/api/threads/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:x.body,image_url:x.image_url,topic_tag:String(x.topic_tag||'').replace(/^#+/,'').trim(),topic_tag_verified:x.topic_tag_verified===true})}),j=await r.json();if(!r.ok)return alert('게시 실패: '+(j.detail||j.error));const follower_at_publish=await followerBaseline();const p=read(P);p.unshift({thread_id:j.id,category:x.category,topic:x.topic,topic_tag:String(x.topic_tag||'').replace(/^#+/,'').trim(),hook:x.hook,published_at:Date.now(),image_url:x.image_url,follower_at_publish});write(P,p.slice(0,100));fb(x,'PUBLISHED');a.splice(i,1);write(Q,a);renderQueue();alert('게시 완료 ✅')}
function drop(i){const a=read(Q);a.splice(i,1);write(Q,a);renderQueue()}
function patchReplies(){
 const desc=document.querySelector('#replies .section p.mut');if(desc)desc.textContent='최근 2일 댓글만 표시합니다. 미응답 전체를 API에 무리 없이 천천히 순차 답장합니다.';
 if(typeof updateBatchButton==='function')updateBatchButton=function(){const items=Array.isArray(window._replyItems)?window._replyItems:[],eligible=items.filter(x=>!x.review_required&&!x.already_replied),n=eligible.length,b=document.getElementById('batchReply'),note=document.getElementById('batchNote');b.disabled=!n||window._replyHistoryAvailable===false||window._batchRunning;b.textContent=window._batchRunning?'일괄 답장 처리 중…':(n?`일괄 승인 후 답장 (${n})`:'일괄 승인 후 답장');note.textContent=`최근 2일 미응답 ${eligible.length}개 · 한 개씩 순차 처리합니다.`};
 const b=document.getElementById('batchReply');if(!b)return;b.onclick=async()=>{if(window._batchRunning||window._replyHistoryAvailable===false)return;const all=window._replyItems||[],targets=[];all.forEach((x,i)=>{if(x.review_required||x.already_replied)return;const text=document.getElementById(`replyText-${i}`)?.value.trim();if(text)targets.push({i,id:x.id,text})});if(!targets.length||!confirm(`${targets.length}개 미응답 댓글을 순차 답장할까요?`))return;window._batchRunning=true;updateBatchButton();let ok=0,fail=0;for(let n=0;n<targets.length;n++){const t=targets[n];b.textContent=`일괄 답장 ${n+1}/${targets.length}`;try{await postReply(t.id,t.text);markReplyDone(t.i,t.id,t.text);ok++}catch{fail++}if(n<targets.length-1)await new Promise(r=>setTimeout(r,500))}window._batchRunning=false;updateBatchButton();alert(`완료 · 성공 ${ok} / 실패 ${fail}`);await syncReplies(currentPostIds).catch(()=>{})};
 setTimeout(()=>{try{updateBatchButton()}catch{}},100);
}
window.PostAuto={generate:generatePillar,image:i=>makeImage(i,false),reimage:i=>makeImage(i,true),keep,now,variant,no,drop,publishQueue,save:syncDraft,instagram:openInstagramCarousel,instagramSelect:selectInstagramSlide,instagramCaption:setInstagramCaption,instagramClose:closeInstagramCarousel,instagramRegenerate:regenerateInstagramSlide,instagramRegenerateAll:regenerateInstagramCarousel,instagramPublish:publishInstagramCarousel,instagramPromptStoreRetry:retryInstagramPromptStore};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensure);else ensure();
})();
