/* POST AUTO V1 - paste before </body> in index.html, then add <script src="/post-auto-v1.js"></script> */
(function(){
const CATS={AI_PROMPT:'AI 프롬프트',AI_TIP:'AI 활용 팁',HOT_ISSUE:'🔥 오늘의 핫이슈',FUN_RELATABLE:'재미·공감형',EXPERIMENT:'실험적인 콘텐츠'};
const KEY='pt_publish_queue_v1',FB='pt_content_feedback_v1';
let candidates=[];
function q(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}}
function saveQ(v){localStorage.setItem(KEY,JSON.stringify(v));renderQueue()}
function feedback(){try{return JSON.parse(localStorage.getItem(FB)||'[]')}catch{return[]}}
function addFeedback(x,kind){const a=feedback();a.unshift({kind,category:x.category,hook:x.hook,body:x.body.slice(0,180),at:Date.now()});localStorage.setItem(FB,JSON.stringify(a.slice(0,50)))}
function e(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function ensure(){
 const dash=document.getElementById('dashboard'); if(!dash||document.getElementById('autoV1'))return;
 dash.insertAdjacentHTML('afterbegin',`<div class="card" id="autoV1" style="margin-bottom:12px"><div class="section"><div><b>✨ 게시물 자동생성 V1</b><p class="mut">5개 콘텐츠 축에서 오늘 쓸 후보를 생성합니다. 마음에 드는 후보는 여러 개 채택할 수 있습니다.</p></div><button class="btn p" id="gen5">후보 5개 생성</button></div><div id="candidateList" class="post-list"></div></div>`);
 const cal=document.getElementById('calendar'); if(cal)cal.innerHTML=`<div class="section"><div><b>발행 대기함</b><p class="mut">👍 채택한 후보를 보관합니다. 🚀 즉시 게시도 가능합니다.</p></div><span class="badge" id="queueCount">0</span></div><div id="queueList" class="post-list"></div>`;
 document.getElementById('gen5').onclick=generate;renderQueue();
}
async function generate(){
 const b=document.getElementById('gen5');b.disabled=true;b.textContent='Gemini 생성 중…';
 try{
  const fb=feedback().slice(0,15).map(x=>`${x.kind}:${x.category}:${x.hook}`).join(' | ');
  const r=await fetch('/api/content/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({feedback:fb})});
  const j=await r.json();if(!r.ok){
  const detail =
    j?.detail?.message ||
    j?.detail?.error?.message ||
    j?.error ||
    'GENERATE_FAILED';

  throw new Error(detail);
};candidates=j.items;renderCandidates();
 }catch(err){alert('후보 생성 실패: '+err.message)}finally{b.disabled=false;b.textContent='후보 5개 생성'}
}
function renderCandidates(){
 const box=document.getElementById('candidateList'); if(!box)return;
 box.innerHTML=candidates.map((x,i)=>`<article class="card"><div class="post-meta"><span class="badge">${e(x.category_label||CATS[x.category])}</span>${x.image_needed?'<span class="badge">4:5 이미지</span>':'<span class="badge">텍스트</span>'}</div><h3 style="margin:8px 0">${e(x.hook)}</h3><textarea id="cb${i}" style="width:100%;min-height:150px;background:#0b0e12;border:1px solid var(--l);border-radius:10px;color:white;padding:12px">${e(x.body)}</textarea><p class="mut">추천 이유 · ${e(x.reason)}</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn p" onclick="PostAuto.keep(${i})">👍 발행 대기</button><button class="btn" onclick="PostAuto.now(${i})">🚀 즉시 게시</button><button class="btn" onclick="PostAuto.image(${i})" ${x.image_needed?'':'disabled'}>🖼 이미지 생성</button><button class="btn" onclick="PostAuto.variant(${i})">다른 버전</button><button class="btn" onclick="PostAuto.no(${i})">👎 별로예요</button></div><div id="img${i}" style="margin-top:10px"></div></article>`).join('');
}
async function makeImage(i){
 const x=candidates[i];if(!x?.image_needed)return null;
 const r=await fetch('/api/content/image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:x.image_prompt})});
 const j=await r.json();if(!r.ok)throw new Error(j.error||'IMAGE_FAILED');
 const url=`data:${j.mime_type};base64,${j.data}`;
 x.image_data_url=url;
 return url;
}
async function showImage(i){
 try{const url=candidates[i].image_data_url||await makeImage(i);document.getElementById('img'+i).innerHTML=`<div style="max-width:360px;position:relative"><img src="${url}" style="width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:12px"><div style="position:absolute;inset:0 0 auto;height:32%;background:linear-gradient(rgba(0,0,0,.78),transparent);border-radius:12px 12px 0 0"></div><div style="position:absolute;top:7%;left:7%;right:7%;font-size:clamp(26px,4vw,44px);font-weight:900;line-height:1.08;color:white;text-shadow:0 2px 5px rgba(0,0,0,.65)">${e(candidates[i].hook)}</div></div><p class="mut">미리보기: 후킹은 브라우저에서 정확한 한글로 합성됩니다.</p>`}catch(err){alert('이미지 생성 실패: '+err.message)}
}
function keep(i){const x={...candidates[i],body:document.getElementById('cb'+i).value,kept_at:Date.now()};delete x.image_data_url;const a=q();a.unshift(x);saveQ(a);addFeedback(x,'LIKE');alert('발행 대기함에 저장했습니다.')}
async function now(i){
 const x=candidates[i],text=document.getElementById('cb'+i).value.trim();if(!text)return;
 if(x.image_needed){alert('이미지 게시에는 Threads가 접근 가능한 공개 image_url 저장소가 필요합니다. 현재 Vercel Blob 연결 전이므로 이미지 후보는 발행 대기함에 저장한 뒤 게시하세요. 텍스트 후보는 즉시 게시 가능합니다.');return}
 if(!confirm('이 게시물을 지금 Threads에 게시할까요?'))return;
 const r=await fetch('/api/threads/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});const j=await r.json();if(!r.ok)return alert('게시 실패: '+(j.error||'PUBLISH_FAILED'));addFeedback(x,'PUBLISHED');alert('Threads 게시 완료 ✅')
}
function no(i){addFeedback(candidates[i],'DISLIKE');candidates.splice(i,1);renderCandidates()}
async function variant(i){addFeedback(candidates[i],'VARIANT');alert('현재 V1에서는 후보 5개를 다시 생성하면 피드백을 반영합니다.')}
function renderQueue(){const a=q(),c=document.getElementById('queueCount'),box=document.getElementById('queueList');if(c)c.textContent=a.length;if(!box)return;box.innerHTML=a.length?a.map((x,i)=>`<article class="card"><span class="badge">${e(x.category_label||CATS[x.category])}</span><h3>${e(x.hook)}</h3><div class="post-text">${e(x.body)}</div><div style="margin-top:10px"><button class="btn" onclick="PostAuto.drop(${i})">대기함에서 제거</button></div></article>`).join(''):'<div class="card empty"><div><b>발행 대기 없음</b>👍 채택한 후보가 여기에 쌓입니다.</div></div>'}
function drop(i){const a=q();a.splice(i,1);saveQ(a)}
window.PostAuto={keep,now,image:showImage,no,variant,drop};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensure);else ensure();
})();
