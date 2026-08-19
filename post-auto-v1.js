/* Growth Engine V3. Filename kept for existing index.html include. */
(function(){
const CATS={AI_PROMPT:'AI 프롬프트',AI_TIP:'AI 활용 팁',FOOD_PICK:'오늘 뭐 먹지?',HOT_ISSUE:'🔥 오늘의 핫이슈'};
const Q='pt_queue_v3',F='pt_feedback_v3',P='pt_published_v3',D='pt_drafts_v6';
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
 const oldHook=x.hook||'';
 x.hook=hook(i);x.body=body(i);if(x.category==='AI_PROMPT')x.reply_prompt=replyPrompt(i);
 if(oldHook!==x.hook&&x.final_image)x.thumbnail_dirty=true;
 saveDrafts();
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fb(x,kind){const a=read(F);a.unshift({kind,category:x.category,topic:x.topic,hook:x.hook,at:Date.now()});write(F,a.slice(0,80))}
function body(i){return document.getElementById(`v3body-${i}`)?.value.trim()||candidates[i]?.body||''}
function replyPrompt(i){return document.getElementById(`v3reply-${i}`)?.value.trim()||candidates[i]?.reply_prompt||''}
function hook(i){return [...(document.getElementById(`v3hook-${i}`)?.value.trim()||candidates[i]?.hook||'')].slice(0,14).join('')}
async function perf(){try{const r=await fetch('/api/threads/my-posts',{cache:'no-store'}),j=await r.json();if(!r.ok)return '';const meta=new Map(read(P).map(x=>[String(x.thread_id),x]));return (j.items||[]).map(p=>{const m=meta.get(String(p.id));if(!m)return null;const s=p.insights||{};return `${m.category}/${m.hook}:views=${s.views??'-'},likes=${s.likes??'-'},replies=${s.replies??'-'},reposts=${s.reposts??'-'},quotes=${s.quotes??'-'},shares=${s.shares??'-'}`}).filter(Boolean).slice(0,10).join(' | ')}catch{return ''}}

restoreDrafts();

function ensure(){
 const old=document.getElementById('autoV1');if(old)old.remove();
 const old3=document.getElementById('autoV3');if(old3)old3.remove();
 const dash=document.getElementById('dashboard');if(!dash||document.getElementById('autoV5'))return;
 dash.insertAdjacentHTML('afterbegin',`<div class="card" id="autoV5" style="margin-bottom:12px"><div class="section"><div><b>✨ 게시물 성장 엔진</b><p class="mut">필요한 콘텐츠만 독립 호출합니다. 생성 → 검토/수정 → 이미지 생성 → 최종 확인 → 게시 순서입니다.</p></div></div><div id="v3status" class="mut" style="margin-bottom:10px"></div><div id="v3list" class="post-list"></div></div>`);
 const cal=document.getElementById('calendar');if(cal)cal.innerHTML=`<div class="section"><div><b>발행 대기함</b><p class="mut">이미지를 직접 확인하고 👍한 게시물만 저장됩니다.</p></div><span class="badge" id="v3qcount">0</span></div><div id="v3queue" class="post-list"></div>`;
 patchReplies();render();renderQueue();
}
async function generatePillar(i){
 const pillar=PILLARS[i],b=document.getElementById(`v3gen-${i}`),s=document.getElementById('v3status');
 if(!b)return;b.disabled=true;const old=b.textContent;b.textContent='생성 중…';
 s.textContent=pillar==='HOT_ISSUE'?'오늘 뉴스를 검색하고 핫이슈를 고르는 중입니다.':pillar==='FOOD_PICK'?'전국 실제 맛집을 검색하고 오늘의 메뉴를 고르는 중입니다.':'이 섹션만 집중해서 콘텐츠를 만드는 중입니다.';
 try{
  const feedback=read(F).filter(x=>x.category===pillar).slice(0,20).map(x=>`${x.kind}:${x.topic}:${x.hook}`).join(' | ');
  const performance=await perf();
  const r=await fetch('/api/content-router?action=generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pillar,feedback,performance})});
  const text=await r.text();let j;try{j=JSON.parse(text)}catch{throw new Error(text.slice(0,180)||`HTTP ${r.status}`)}
  if(!r.ok)throw new Error(j.detail||j.error||'GENERATE_FAILED');
  candidates[i]=j.item;saveDrafts();render();s.textContent=`${CATS[pillar]} 생성 완료 · 다른 섹션은 호출하지 않았습니다.`;
 }catch(e){s.textContent='';alert(`${CATS[pillar]} 생성 실패: `+e.message)}
 finally{const nb=document.getElementById(`v3gen-${i}`);if(nb){nb.disabled=false;nb.textContent=candidates[i]?'🔄 다시 생성':'✨ 생성'}}
}
function emptyCard(pillar,i){
 const desc={AI_TIP:'짧고 낯선 전문 명령어 + 영어 사용 예시',AI_PROMPT:'저장하고 싶은 상세 영문 프롬프트',FOOD_PICK:'점심·저녁·술안주를 실제 전국 맛집으로 추천',HOT_ISSUE:'오늘 실제 뉴스에서 가장 강한 이슈 하나'}[pillar];
 return `<article class="card" id="v3card-${i}"><div class="post-meta"><span class="badge">${esc(CATS[pillar])}</span></div><h3 style="margin:10px 0 6px">${esc(CATS[pillar])}</h3><p class="mut">${esc(desc)}</p><button class="btn p" id="v3gen-${i}" onclick="PostAuto.generate(${i})">✨ 생성</button></article>`;
}
function render(){
 const box=document.getElementById('v3list');if(!box)return;
 box.innerHTML=PILLARS.map((pillar,i)=>{const x=candidates[i];if(!x)return emptyCard(pillar,i);return `<article class="card" id="v3card-${i}"><div class="post-meta"><span class="badge">${esc(x.category_label||CATS[pillar])}</span><span class="badge">4:5 이미지 검수</span><span class="mut">총점 ${x.score?.total||0}</span></div><div class="v3grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,380px);gap:18px;align-items:start"><div><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><label class="mut">후킹 · 최대 14자</label><button class="btn" id="v3gen-${i}" onclick="PostAuto.generate(${i})">🔄 다시 생성</button></div><input id="v3hook-${i}" maxlength="14" oninput="PostAuto.save(${i})" value="${esc(x.hook)}" style="width:100%;margin:5px 0 10px;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:11px;font-size:18px;font-weight:800"><label class="mut">본문</label><textarea id="v3body-${i}" maxlength="500" oninput="PostAuto.save(${i})" style="width:100%;min-height:190px;margin-top:5px;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:12px;line-height:1.55">${esc(x.body)}</textarea>${pillar==='AI_PROMPT'?`<label class="mut" style="display:block;margin-top:10px">첫 댓글 · 복붙용 영문 프롬프트</label><textarea id="v3reply-${i}" maxlength="500" oninput="PostAuto.save(${i})" style="width:100%;min-height:150px;margin-top:5px;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:12px;line-height:1.55">${esc(x.reply_prompt||'')}</textarea><p class="mut">AI 프롬프트 게시물은 본문 게시 성공 후 이 내용만 첫 댓글로 자동 게시합니다.</p>`:''}<p class="mut">소재 · ${esc(x.topic)}</p><p class="mut">추천 이유 · ${esc(x.reason)}</p>${x.source_notes?.length?`<p class="mut">검증 메모 · ${esc(x.source_notes.join(' / '))}</p>`:''}<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn p" onclick="PostAuto.image(${i})">🖼 이미지 생성</button><button class="btn" onclick="PostAuto.reimage(${i})">🔄 이미지 다시 생성</button><button class="btn" onclick="PostAuto.applyHook(${i})">후킹 적용</button><button class="btn" onclick="PostAuto.variant(${i})">다른 버전</button><button class="btn" onclick="PostAuto.keep(${i})">👍 발행 대기</button><button class="btn p" onclick="PostAuto.now(${i})">🚀 즉시 게시</button><button class="btn" onclick="PostAuto.no(${i})">👎 비우기</button></div></div><div id="v3img-${i}" class="card" style="padding:10px;min-height:270px;display:grid;place-items:center"><span class="mut">이미지를 생성한 뒤 직접 확인하세요.</span></div></div></article>`}).join('');
 if(!document.getElementById('v3css'))document.head.insertAdjacentHTML('beforeend','<style id="v3css">@media(max-width:900px){.v3grid{grid-template-columns:1fr!important}}</style>');
 candidates.forEach((x,i)=>{if(x?.image_url||x?.final_image)preview(i)});
}
function load(src){return new Promise((ok,no)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=no;im.src=src})}
function split(ctx,text,max,font){
 const ch=[...text.replace(/\s+/g,' ').trim()].slice(0,14),all=ch.join('');ctx.font=`900 ${font}px "Pretendard","Noto Sans KR","Malgun Gothic",sans-serif`;if(ctx.measureText(all).width<=max)return [all];
 let best=null;for(let c=2;c<=ch.length-2;c++){const a=ch.slice(0,c).join('').trim(),b=ch.slice(c).join('').trim();if(!a||!b||[...b].length===1)continue;const score=Math.max(ctx.measureText(a).width,ctx.measureText(b).width)+Math.abs([...a].length-[...b].length)*22;if(!best||score<best.score)best={lines:[a,b],score}}return best?.lines||[all];
}
async function compose(i){
 const x=candidates[i];if(!x?.base_image)throw new Error('이미지를 먼저 생성해 주세요.');x.hook=hook(i);x.body=body(i);
 const im=await load(x.base_image),cv=document.createElement('canvas');cv.width=1080;cv.height=1350;const c=cv.getContext('2d'),scale=Math.max(cv.width/im.width,cv.height/im.height),sw=cv.width/scale,sh=cv.height/scale;
 c.drawImage(im,(im.width-sw)/2,(im.height-sh)/2,sw,sh,0,0,cv.width,cv.height);
 // Full-bleed artwork: never cover the top with a solid or obvious dark panel.
 // Only use text stroke/shadow so the generated scene remains visible behind the hook.
 let size=96,lines;while(size>=58){lines=split(c,x.hook,936,size);c.font=`900 ${size}px "Pretendard","Noto Sans KR","Malgun Gothic",sans-serif`;if(lines.length<=2&&lines.every(t=>c.measureText(t).width<=936))break;size-=4}
 c.textBaseline='top';c.strokeStyle='rgba(0,0,0,.72)';c.lineWidth=5;c.shadowColor='rgba(0,0,0,.78)';c.shadowBlur=14;c.shadowOffsetY=3;
 // Minimal brand accent only. No CTA bars, no extra labels.
 c.save();c.shadowColor='transparent';c.fillStyle='#baff2d';c.fillRect(72,62,82,8);c.restore();
 const visible=lines.slice(0,2);
 visible.forEach((t,n)=>{
   const y=86+n*Math.round(size*1.08);
   c.fillStyle=n===visible.length-1&&visible.length===2?'#baff2d':'#fff';
   c.strokeText(t,72,y);c.fillText(t,72,y);
 });
 // Bottom ownership mark only.
 c.save();c.shadowColor='transparent';c.globalAlpha=.15;c.fillStyle='#fff';c.font='800 34px Arial,sans-serif';c.textAlign='right';c.textBaseline='bottom';c.fillText('VOA PROMPT',1018,1302);c.restore();
 x.final_image=cv.toDataURL('image/jpeg',.92);x.image_url=null;x.thumbnail_dirty=false;preview(i);
}
function preview(i){const x=candidates[i],b=document.getElementById(`v3img-${i}`),src=x?.final_image||x?.image_url;if(!src){b.innerHTML='<span class="mut">이미지를 생성한 뒤 직접 확인하세요.</span>';return}b.innerHTML=`<div><img src="${src}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:11px;display:block"><p class="mut" style="margin:8px 2px 0">최종 썸네일 미리보기 · 확인 후 채택/게시</p></div>`}
async function makeImage(i,redo=false){
 const x=candidates[i],box=document.getElementById(`v3img-${i}`);if(!x)return;box.innerHTML='<span class="mut">Gemini 이미지 생성 중…</span>';x.variation=redo?(x.variation||1)+1:(x.variation||1);x.body=body(i);x.hook=hook(i);
 try{const r=await fetch('/api/content-router?action=image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate:x,variation:x.variation})}),j=await r.json();if(!r.ok)throw new Error(apiError(j,'IMAGE_FAILED'));x.base_image=`data:${j.mime_type};base64,${j.data}`;await compose(i);await upload(i);saveDrafts();preview(i)}catch(e){box.innerHTML='<span class="mut">이미지 생성 실패</span>';alert('이미지 생성 실패: '+e.message)}
}
async function publishFirstReply(parentId,text){
 if(!parentId||!text?.trim())return {ok:true,skipped:true};
 const r=await fetch('/api/threads/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_to_id:String(parentId),text:text.trim()})});
 const j=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(apiError(j,'FIRST_REPLY_FAILED'));
 return j;
}
async function upload(i){const x=candidates[i];if(x.image_url&&!x.final_image)return x.image_url;if(!x.final_image)throw new Error('최종 이미지를 먼저 확인해 주세요.');const r=await fetch('/api/content-router?action=store-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate_id:x.id,data_url:x.final_image})}),j=await r.json();if(!r.ok)throw new Error(apiError(j,'IMAGE_UPLOAD_FAILED'));x.image_url=j.url;return j.url}
async function keep(i){const x=candidates[i];if(!x?.final_image&&!x?.image_url)return alert('먼저 이미지를 생성해서 최종 썸네일을 확인해 주세요.');try{syncDraft(i);if(x.thumbnail_dirty&&!x.base_image)return alert('제목을 수정했어요. 이미지 다시 생성을 눌러 새 제목이 들어간 썸네일을 확인해 주세요.');if(x.base_image)await compose(i);const url=await upload(i),v={...x,image_url:url,kept_at:Date.now()};delete v.base_image;delete v.final_image;const a=read(Q);a.unshift(v);write(Q,a);fb(x,'LIKE');renderQueue();alert('이미지 포함 발행 대기 저장 완료 ✅')}catch(e){alert('저장 실패: '+e.message)}}
async function now(i){
 const x=candidates[i];if(!x?.final_image&&!x?.image_url)return alert('즉시 게시 전에 이미지를 생성해서 직접 확인해 주세요.');
 try{
  syncDraft(i);
  if(x.thumbnail_dirty&&!x.base_image)return alert('제목을 수정했어요. 이미지 다시 생성을 눌러 새 제목이 들어간 썸네일을 확인해 주세요.');
  if(x.base_image)await compose(i);
  const url=await upload(i);
  const text=body(i);
  if(text.length>500)return alert(`본문이 ${text.length}자예요. Threads 게시용 본문은 500자 이하로 줄여 주세요.`);
  const r=await fetch('/api/threads/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,image_url:url})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(apiError(j,'PUBLISH_FAILED'));
  let replyState=''; 
  if(x.category==='AI_PROMPT'&&x.reply_prompt?.trim()){
    try{await publishFirstReply(j.id,x.reply_prompt);replyState='\n영문 프롬프트도 첫 댓글에 자동 게시했어.'}
    catch(e){replyState=`\n본문은 게시됐지만 첫 댓글 프롬프트 게시 실패: ${e.message}`;}
  }
  const p=read(P);p.unshift({thread_id:j.id,category:x.category,topic:x.topic,hook:x.hook,at:Date.now()});write(P,p.slice(0,120));
  fb(x,'published');candidates[i]=null;saveDrafts();render();alert('게시 완료!'+replyState);
 }catch(e){alert('게시 실패: '+e.message)}
}
window.PostAuto={generate:generatePillar,image:i=>makeImage(i,false),reimage:i=>makeImage(i,true),applyHook,keep,now,variant,no,drop,publishQueue,save:syncDraft};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensure);else ensure();
})();