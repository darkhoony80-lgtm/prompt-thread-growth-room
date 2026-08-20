/* Sthari Growth Engine V1 - browser/manual run only */
(function(){
const KEY='pt_sthari_growth_v1',LOG='pt_sthari_growth_log_v1',QUERY_KEY='pt_sthari_queries_v1';
const DEFAULT_QUERIES=['스하리1000명프로젝트'];
const INTERVAL_MS=90000,DAILY_LIMIT=40,SAME_USER_DAILY=2;
const POOLS=['스하리 좋아요 😆🙌','스하리 갑니다 😎✨','스하리 왔어요 🔥🙌','스하리 완료 😄💚','반하리 갑니다 😆🙌','반하리 좋아요 😎💚','반하리 완료 🔥✨','또하리 좋아요 😄🙌','또하리 갑니다 😎🔥','또하리 환영해요 😆✨','같이 가요 😄🙌','오늘도 같이 가요 😎💚','성장 같이 가자아 😆🔥'];
let running=false,timer=null,queryIndex=0,busy=false;
function read(k,d){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d))}catch{return d}}
function write(k,v){localStorage.setItem(k,JSON.stringify(v))}
function queries(){
  const a=read(QUERY_KEY,null);
  if(!Array.isArray(a)){write(QUERY_KEY,DEFAULT_QUERIES);return [...DEFAULT_QUERIES]}
  return a.map(x=>String(x||'').trim()).filter(Boolean);
}
function saveQueries(a){
  const clean=[...new Set((a||[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,30);
  write(QUERY_KEY,clean);renderQueries();return clean;
}
function renderQueries(){
  const box=document.getElementById('sthariKeywordList'),count=document.getElementById('sthariKeywordCount');
  if(!box)return;
  const a=queries();
  if(count)count.textContent=`${a.length}개`;
  box.innerHTML=a.length?a.map((q,i)=>`<div class="sthari-keyword-row"><input data-sthari-query="${i}" maxlength="80" value="${esc(q)}" aria-label="검색어 ${i+1}"><button class="btn" data-sthari-delete="${i}">삭제</button></div>`).join(''):'<div class="sthari-keyword-empty">등록된 검색어가 없습니다. 검색어를 추가해야 엔진을 시작할 수 있습니다.</div>';
  box.querySelectorAll('[data-sthari-query]').forEach(input=>{
    input.addEventListener('change',()=>{
      const i=Number(input.dataset.sthariQuery),a=queries(),v=input.value.trim();
      if(!v){input.value=a[i]||'';return}
      a[i]=v;saveQueries(a);
    });
    input.addEventListener('keydown',e=>{if(e.key==='Enter')input.blur()});
  });
  box.querySelectorAll('[data-sthari-delete]').forEach(btn=>btn.addEventListener('click',()=>{
    const i=Number(btn.dataset.sthariDelete),a=queries();a.splice(i,1);saveQueries(a);
  }));
}
function addQuery(){
  const input=document.getElementById('sthariKeywordNew'),v=input?.value.trim();
  if(!v)return;
  const a=queries();
  if(!a.some(x=>x.toLowerCase()===v.toLowerCase()))a.push(v);
  saveQueries(a);
  input.value='';
  input.focus();
}
function dayKey(ts=Date.now()){return new Date(ts).toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})}
function state(){const v=read(KEY,{processed:{},users:{},daily:{}});v.processed=v.processed||{};v.users=v.users||{};v.daily=v.daily||{};return v}
function todayStats(){const s=state(),d=s.daily[dayKey()]||{};return {done:d.done||0,found:d.found||0,skipped:d.skipped||0,failed:d.failed||0}}
function saveStats(p){const s=state(),d=dayKey(),c=s.daily[d]||{done:0,found:0,skipped:0,failed:0};for(const[k,v]of Object.entries(p))c[k]=(c[k]||0)+v;s.daily[d]=c;write(KEY,s);renderStats()}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function log(row){const a=read(LOG,[]);a.unshift({...row,at:Date.now()});write(LOG,a.slice(0,80));renderLog()}
function renderStats(){const x=todayStats();document.getElementById('sthariDone')&&(sthariDone.textContent=x.done);document.getElementById('sthariFound')&&(sthariFound.textContent=x.found);document.getElementById('sthariSkipped')&&(sthariSkipped.textContent=x.skipped);document.getElementById('sthariFailed')&&(sthariFailed.textContent=x.failed)}
function renderLog(){const b=document.getElementById('sthariLog');if(!b)return;const a=read(LOG,[]);b.innerHTML=a.length?a.slice(0,20).map(x=>`<div class="row"><div><b>@${esc(x.username||'unknown')}</b><div class="mut">${esc(x.query||'')} · ${esc(x.text||'')}</div></div><span class="badge">${esc(x.status||'완료')}</span></div>`).join(''):'<div class="mut">아직 처리 기록이 없습니다.</div>'}
function setState(t,on=false){const e=document.getElementById('sthariState');if(e){e.textContent=t;e.style.color=on?'var(--ok)':''}sthariStart.disabled=on;sthariStop.disabled=!on}
function userCount(s,u){return Number(s.users?.[dayKey()]?.[String(u||'').toLowerCase()]||0)}
function markDone(i){const s=state(),d=dayKey(),u=String(i.username||'').toLowerCase();s.processed[i.id]=Date.now();s.users[d]=s.users[d]||{};s.users[d][u]=(s.users[d][u]||0)+1;s.daily[d]=s.daily[d]||{done:0,found:0,skipped:0,failed:0};s.daily[d].done=(s.daily[d].done||0)+1;write(KEY,s);renderStats()}
function replyFor(i){const seed=String(i.id||'').split('').reduce((n,c)=>(n*33+c.charCodeAt(0))>>>0,5381);return POOLS[seed%POOLS.length]}
function qualifies(i){return !!String(i?.id||'').trim()}
async function search(q){const r=await fetch('/api/threads/growth?q='+encodeURIComponent(q),{cache:'no-store'}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.hint||j?.detail?.message||j?.error||'SEARCH_FAILED');return j}
async function act(i,t){const r=await fetch('/api/threads/growth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({thread_id:i.id,text:t})}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.detail?.message||j?.error||'ACTION_FAILED');return j}
async function cycle(){if(!running||busy)return;busy=true;try{if(todayStats().done>=DAILY_LIMIT){stop('오늘 한도 40건 완료');return}const qs=queries();if(!qs.length){stop('검색어를 1개 이상 등록해 주세요');return}const q=qs[queryIndex++%qs.length];sthariNow.textContent=`"${q}" 최근 글 검색 중…`;const j=await search(q);saveStats({found:j.count||0});const s=state();let p=null,skip=0;for(const i of(j.items||[])){if(!qualifies(i)||s.processed?.[i.id]||userCount(s,i.username)>=SAME_USER_DAILY){skip++;continue}p=i;break}if(skip)saveStats({skipped:skip});if(!p){sthariNow.textContent=`"${q}" · 새 대상 없음`;return}const text=replyFor(p);sthariNow.textContent=`@${p.username} · 답글 + 리포스트 중…`;await act(p,text);markDone(p);log({username:p.username,query:q,text,status:'💬 + 🔁 완료',thread_id:p.id});sthariNow.textContent=`@${p.username} 처리 완료`}catch(e){saveStats({failed:1});log({username:'system',query:'',text:e.message,status:'실패'});sthariNow.textContent='오류 · '+e.message}finally{busy=false;if(running)timer=setTimeout(cycle,INTERVAL_MS)}}
function start(){if(running)return;running=true;setState('실행 중',true);sthariNow.textContent='엔진 시작…';cycle()}
function stop(m='사용자가 멈춤'){running=false;if(timer)clearTimeout(timer);timer=null;busy=false;setState('정지됨',false);sthariNow.textContent=m}
function init(){renderStats();renderLog();renderQueries();setState('정지됨',false);sthariStart.addEventListener('click',start);sthariStop.addEventListener('click',()=>stop());sthariClearLog.addEventListener('click',()=>{localStorage.removeItem(LOG);renderLog()});sthariKeywordAdd.addEventListener('click',addQuery);sthariKeywordNew.addEventListener('keydown',e=>{if(e.key==='Enter')addQuery()});window.addEventListener('beforeunload',()=>stop('브라우저 종료'))}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();window.SthariGrowth={start,stop};
})();
