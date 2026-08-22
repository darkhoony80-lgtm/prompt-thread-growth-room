/* Growth Engine V3. Filename kept for existing index.html include. */
(function(){
const CATS={AI_PROMPT:'AI 프롬프트',AI_TIP:'AI 활용 팁',FOOD_PICK:'오늘 뭐 먹지?',HOT_ISSUE:'🔥 오늘의 핫이슈'};
const Q='pt_queue_v3',F='pt_feedback_v3',P='pt_published_v3',D='pt_drafts_v6',FH='pt_food_history_v1';
const PILLARS=['AI_TIP','AI_PROMPT','FOOD_PICK','HOT_ISSUE'];
let candidates=[null,null,null,null];
function read(k,d=[]){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d))}catch{return d}}
function write(k,v){localStorage.setItem(k,JSON.stringify(v))}
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
 candidates.forEach((x,i)=>{if(x?.image_url||x?.final_image)preview(i)});
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
window.PostAuto={generate:generatePillar,image:i=>makeImage(i,false),reimage:i=>makeImage(i,true),keep,now,variant,no,drop,publishQueue,save:syncDraft};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensure);else ensure();
})();
