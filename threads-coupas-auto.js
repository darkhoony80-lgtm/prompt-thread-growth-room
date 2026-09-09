(()=>{
const EXPECTED_FOLDER='InstagramReels';
const EXPECTED_PATH='C:\\Users\\tjznf\\Downloads\\InstagramReels';
const DB_NAME='prompt-thread-growth-room';
const DB_STORE='directory-handles';
const DB_KEY='threads-coupas-root';
const SAFETY_KEY='threads_coupas_publish_safety_v1';
const STATUS_FILE='.threads-coupas-status.json';
const DISCLOSURE='이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const PARTIAL_STATUSES=new Set(['post_published_link_pending','post_published_reply_failed']);

let directoryHandle=null;
let history=[];
let historyReady=false;
let running=false;
let stopRequested=false;
let cancelWait=null;
let stats={requested:0,success:0,failed:0,processed:0};

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function localRecords(){
  try{const rows=JSON.parse(localStorage.getItem(SAFETY_KEY)||'[]');return Array.isArray(rows)?rows:[]}catch{return []}
}
function putLocalRecord(record){
  const rows=localRecords(),index=rows.findIndex(row=>row.job_id===record.job_id||row.folder_name===record.folder_name);
  const next={...(index>=0?rows[index]:{}),...record,updated_at:new Date().toISOString()};
  if(index>=0)rows[index]=next;else rows.unshift(next);
  localStorage.setItem(SAFETY_KEY,JSON.stringify(rows.slice(0,1000)));
  mergeHistory([next]);
  return next;
}
function mergeHistory(rows){
  const map=new Map();
  [...history,...(Array.isArray(rows)?rows:[])].forEach(row=>{
    if(!row?.job_id)return;
    const old=map.get(row.job_id);
    if(!old||String(row.updated_at||'')>=String(old.updated_at||''))map.set(row.job_id,row);
  });
  history=[...map.values()].sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  renderHistory();
}
function knownRecord(jobId,folderName){
  return history.find(row=>row.job_id===jobId||row.folder_name===folderName)||null;
}

async function adminApi(action,payload={}){
  const ready=await (window.voaraAdminReady||Promise.resolve(false));
  if(!ready)throw new Error('운영실 관리자 인증이 필요합니다.');
  const response=await fetch(`/api/content-router?action=${encodeURIComponent(action)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(body.detail||body.error||`HTTP ${response.status}`);
    error.code=body.error;error.body=body;throw error;
  }
  return body;
}

async function saveRecord(record,folderHandle){
  const local=putLocalRecord(record);
  if(!folderHandle)throw new Error('로컬 작업 폴더 상태 저장 실패');
  const fileHandle=await folderHandle.getFileHandle(STATUS_FILE,{create:true});
  const writable=await fileHandle.createWritable();
  try{await writable.write(JSON.stringify(local,null,2))}
  finally{await writable.close()}
  return local;
}

async function loadHistory(){
  historyReady=false;
  history=[];
  mergeHistory(localRecords());
  if(!directoryHandle||await folderPermission(false)!=='granted')return;
  const records=[];
  for await(const [name,handle] of directoryHandle.entries()){
    if(handle.kind!=='directory')continue;
    try{
      const file=await (await handle.getFileHandle(STATUS_FILE)).getFile();
      const record=JSON.parse(await file.text());
      if(!record?.job_id||!record?.status)throw new Error('상태 정보 누락');
      records.push({...record,folder_name:name});
    }catch(error){
      if(error?.name!=='NotFoundError')records.push({job_id:name,folder_name:name,status:'history_invalid',error:`로컬 상태 파일 확인 필요: ${error.message}`,updated_at:new Date().toISOString()});
    }
  }
  mergeHistory(records);
  historyReady=true;
}

function openHandleDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(DB_STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function storeHandle(handle){
  const db=await openHandleDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(handle,DB_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  db.close();
}
async function restoreHandle(){
  try{
    const db=await openHandleDb();
    const handle=await new Promise((resolve,reject)=>{
      const tx=db.transaction(DB_STORE,'readonly'),request=tx.objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);
    });
    db.close();
    if(handle?.kind==='directory')directoryHandle=handle;
  }catch{}
  await renderFolderState();
}
async function folderPermission(request=false){
  if(!directoryHandle)return 'denied';
  const options={mode:'readwrite'};
  let state=await directoryHandle.queryPermission(options);
  if(state!=='granted'&&request)state=await directoryHandle.requestPermission(options);
  return state;
}
async function renderFolderState(){
  const badge=$('coupasFolderBadge'),name=$('coupasFolderName');
  if(!badge||!name)return;
  if(!directoryHandle){badge.textContent='폴더 미연결';name.textContent=EXPECTED_PATH;return}
  const permission=await folderPermission(false);
  name.textContent=`${EXPECTED_PATH} · 선택됨: ${directoryHandle.name}`;
  badge.textContent=permission==='granted'?'폴더 연결됨':'권한 확인 필요';
  badge.className='badge '+(permission==='granted'?'positive':'review');
}

async function connectFolder(){
  if(!window.showDirectoryPicker){
    setMessage('이 브라우저는 로컬 폴더 연결을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어 주세요.','error');return;
  }
  try{
    const handle=await window.showDirectoryPicker({id:'threads-coupas-source',mode:'readwrite',startIn:'downloads'});
    if(handle.name!==EXPECTED_FOLDER)throw new Error(`${EXPECTED_FOLDER} 폴더를 정확히 선택해 주세요.`);
    directoryHandle=handle;await storeHandle(handle);await renderFolderState();
    await loadHistory();
    setMessage('폴더가 연결되었습니다. 게시 이력은 각 작업 폴더에 로컬로 저장됩니다.');
  }catch(error){if(error?.name!=='AbortError')setMessage(`폴더 접근 실패: ${error.message}`,'error')}
}

function setMessage(text,type=''){
  const node=$('coupasMessage');if(!node)return;node.textContent=text;node.className='mut '+(type==='error'?'coupas-result-error':type==='ok'?'positive':'');
}
function setStatus(text){if($('coupasStatus'))$('coupasStatus').textContent=text}
function renderStats(){
  $('coupasRequested').textContent=stats.requested;
  $('coupasSuccess').textContent=stats.success;
  $('coupasFailed').textContent=stats.failed;
  $('coupasRemaining').textContent=Math.max(0,stats.requested-stats.processed);
}
function renderHistory(){
  const box=$('coupasResults'),count=$('coupasHistoryCount');if(!box||!count)return;
  count.textContent=`${history.length}개`;
  if(!history.length){box.innerHTML='<div class="card empty"><div><b>게시 이력 없음</b>완료 또는 실패한 작업이 여기에 표시됩니다.</div></div>';return}
  box.innerHTML=history.slice(0,100).map((row,index)=>{
    const label=row.status==='published'?'성공':PARTIAL_STATUSES.has(row.status)?'2/2 재시도 필요':row.status==='failed'?'실패':row.status==='stopped'?'정지':row.status;
    const link=row.threads_post_url?`<a href="${esc(row.threads_post_url)}" target="_blank" rel="noopener">Threads에서 보기 ↗</a>`:'';
    return `<article class="post-card coupas-result"><div><div class="post-meta"><span>${index+1}. ${esc(label)}</span><span>${esc(row.folder_name||'')}</span><span>재시도 ${Number(row.retry_count)||0}</span></div><b>${esc(row.product_name||row.job_id||'')}</b>${row.error?`<p class="coupas-result-error">${esc(row.error)}</p>`:''}<div class="post-actions">${link}</div></div></article>`;
  }).join('');
}

async function listCandidateFolders(limit){
  const output=[];
  for await(const [name,handle] of directoryHandle.entries()){
    if(handle.kind!=='directory')continue;
    const existing=history.find(row=>row.folder_name===name);
    if(existing?.status==='published'||existing?.status==='history_invalid')continue;
    output.push({name,handle});
  }
  output.sort((a,b)=>a.name.localeCompare(b.name,'ko-KR'));
  return output.slice(0,limit);
}
async function getRequiredFile(folder,name,errorCode){
  try{return await (await folder.getFileHandle(name)).getFile()}catch{throw new Error(errorCode)}
}
async function readJob(folderInfo){
  let jsonFile;
  try{jsonFile=await (await folderInfo.handle.getFileHandle('content.json')).getFile()}catch{throw new Error('content.json 없음')}
  let data;
  try{data=JSON.parse(await jsonFile.text())}catch{throw new Error('JSON 파싱 실패')}
  const rewritten=String(data?.content?.rewritten_text||'').trim();
  const originalUrl=String(data?.content?.coupang_url||'').trim();
  const productHint=String(data?.content?.product_name||data?.content?.narration||data?.content?.original_text||'').trim().slice(0,160);
  const videoName=String(data?.media?.video||'').trim();
  const imageNames=data?.media?.images;
  if(!rewritten)throw new Error('content.rewritten_text 없음');
  if(!originalUrl)throw new Error('쿠팡 원본 링크 없음');
  if(!videoName)throw new Error('video.mp4 없음');
  if(!Array.isArray(imageNames))throw new Error('media.images 형식 오류');
  const video=await getRequiredFile(folderInfo.handle,videoName,'video.mp4 없음');
  if(!/\.mp4$/i.test(video.name))throw new Error('video.mp4 형식 오류');
  const images=[];
  for(const name of imageNames){
    const safeName=String(name||'').trim();
    if(!safeName)throw new Error('이미지 파일명 오류');
    const file=await getRequiredFile(folderInfo.handle,safeName,`${safeName} 없음`);
    if(!/\.(?:jpe?g)$/i.test(file.name))throw new Error(`${safeName} 형식 오류`);
    images.push(file);
  }
  return {jobId:String(data?.job_id||folderInfo.name).trim().slice(0,160),folderName:folderInfo.name,rewritten,originalUrl,productHint,video,images};
}

function threadsText(value){
  const clean=String(value||'').replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(clean.includes('쿠팡 파트너스 활동의 일환'))return [...clean].slice(0,500).join('');
  const available=500-[...DISCLOSURE].length-2;
  return `${[...clean].slice(0,Math.max(0,available)).join('').trim()}\n\n${DISCLOSURE}`;
}
async function uploadMedia(job,file,type,index){
  const safeJob=String(job.jobId||job.folderName).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80)||'job';
  const safeName=String(file.name||`${type}-${index}`).replace(/[^a-zA-Z0-9._-]/g,'-').slice(-100);
  const pathname=`content-master/coupas-${safeJob}/${Date.now()}-${index}-${safeName}`;
  const mod=await import('https://esm.sh/@vercel/blob@2.8.0/client?bundle');
  const result=await mod.uploadPresigned(pathname,file,{access:'public',handleUploadUrl:'/api/content-router?action=media_upload',contentType:file.type||(type==='video'?'video/mp4':'image/jpeg'),multipart:file.size>5*1024*1024});
  return {type,url:result.url};
}
async function publishParent(job){
  const media=[];
  media.push(await uploadMedia(job,job.video,'video',0));
  for(let index=0;index<job.images.length;index++)media.push(await uploadMedia(job,job.images[index],'image',index+1));
  const response=await fetch('/api/threads/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:threadsText(job.rewritten),media})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.id)throw new Error(`Threads 본문 게시 실패: ${body.detail?.message||body.error||response.status}`);
  return String(body.id);
}
async function permalink(id){
  try{
    const body=await adminApi('coupas_threads_permalink',{post_id:String(id)});
    return String(body.permalink||'');
  }catch{return ''}
}
async function publishLinkedPost(parentId,url){
  let existing;
  try{existing=await adminApi('coupas_threads_reply_exists',{parent_id:String(parentId),text:String(url).trim()})}
  catch(error){throw new Error(`Threads 2/2 중복 확인 실패: ${error.code||error.message}`)}
  if(existing.exists&&existing.id)return String(existing.id);
  const response=await fetch('/api/threads/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_to_id:String(parentId),text:String(url).trim()})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.id)throw new Error(`Threads 2/2 링크 게시 실패: ${body.detail?.message||body.error||response.status}`);
  return String(body.id);
}

function candidateSummary(rows){
  return (Array.isArray(rows)?rows:[]).slice(0,5).map(row=>({productId:row.productId,productName:row.productName,matchScore:Number(row.matchScore)||0}));
}
function friendlyError(error){
  const raw=String(error?.message||error||'알 수 없는 오류');
  if(/COUPANG_URL_INVALID/.test(raw))return '쿠팡 원본 링크 없음 또는 형식 오류';
  if(/COUPANG_PRODUCT_NAME_NOT_FOUND|COUPANG_PRODUCT_PAGE_HTTP/.test(raw))return '상품명 추출 실패';
  if(/COUPANG_PARTNERS_NOT_CONFIGURED/.test(raw))return '쿠팡파트너스 API 설정 없음';
  if(/COUPANG_PRODUCT_SEARCH_FAILED/.test(raw))return `쿠팡파트너스 API 실패: ${raw}`;
  if(/COUPANG_PRODUCT_MATCH_FAILED/.test(raw))return '동일 상품 매칭 실패';
  if(/COUPANG_DEEPLINK_CREATE_FAILED|COUPANG_DEEPLINK_NOT_RETURNED/.test(raw))return `제휴링크 생성 실패: ${raw}`;
  if(/CONTENT_MASTER_MEDIA_UPLOAD_FAILED|upload/i.test(raw))return `Threads 미디어 업로드 실패: ${raw}`;
  return raw;
}
async function resolveProduct(job,existing){
  if(existing?.generated_coupang_url&&existing?.product_name){
    return {product_name:existing.product_name,generated_coupang_url:existing.generated_coupang_url,matched_product:{matchScore:Number(existing.match_score)||null},candidates:existing.match_candidates||[]};
  }
  return adminApi('coupas_resolve_product',{original_coupang_url:job.originalUrl,product_hint:job.productHint});
}
async function processFolder(folderInfo){
  let job={jobId:folderInfo.name,folderName:folderInfo.name,originalUrl:''};
  let existing=knownRecord(job.jobId,job.folderName);
  const startedAt=new Date().toISOString();
  try{
    if(PARTIAL_STATUSES.has(existing?.status)&&existing?.threads_post_id&&existing?.generated_coupang_url){
      const retryCount=(Number(existing.retry_count)||0)+1;
      $('coupasCurrent').textContent=`${folderInfo.name} · ${existing.product_name||'2/2 링크 재시도'}`;
      const partial={...existing,status:existing.status,error:null,retry_count:retryCount};
      await saveRecord(partial,folderInfo.handle);
      try{
        const replyId=await publishLinkedPost(existing.threads_post_id,existing.generated_coupang_url);
        const completed=await saveRecord({...partial,status:'published',completed_at:new Date().toISOString(),reply_id:replyId,error:null},folderInfo.handle);
        return completed;
      }catch(error){
        await saveRecord({...partial,status:'post_published_reply_failed',error:friendlyError(error)},folderInfo.handle).catch(()=>{});
        throw error;
      }
    }
    job=await readJob(folderInfo);
    existing=knownRecord(job.jobId,job.folderName);
    const retryCount=(Number(existing?.retry_count)||0)+1;
    if(existing?.status==='published')return {skipped:true};
    await saveRecord({...(existing||{}),job_id:job.jobId,folder_name:job.folderName,status:'processing',started_at:existing?.started_at||startedAt,completed_at:null,original_coupang_url:job.originalUrl,error:null,retry_count:retryCount},folderInfo.handle);

    const product=await resolveProduct(job,existing);
    $('coupasCurrent').textContent=`${job.folderName} · ${product.product_name}`;
    const base={job_id:job.jobId,folder_name:job.folderName,started_at:existing?.started_at||startedAt,product_name:product.product_name,original_coupang_url:job.originalUrl,generated_coupang_url:product.generated_coupang_url,match_score:Number(product.matched_product?.matchScore)||null,match_candidates:candidateSummary(product.candidates),retry_count:retryCount};
    let parentId=PARTIAL_STATUSES.has(existing?.status)?String(existing?.threads_post_id||''):'';
    let parentUrl=PARTIAL_STATUSES.has(existing?.status)?String(existing?.threads_post_url||''):'';
    if(!parentId){
      parentId=await publishParent(job);
      let partial=await saveRecord({...base,status:'post_published_link_pending',threads_post_id:parentId,threads_post_url:'',error:null},folderInfo.handle);
      parentUrl=await permalink(parentId);
      partial=await saveRecord({...partial,threads_post_url:parentUrl},folderInfo.handle);
    }
    try{
      const replyId=await publishLinkedPost(parentId,product.generated_coupang_url);
      const completed=await saveRecord({...base,status:'published',completed_at:new Date().toISOString(),threads_post_id:parentId,threads_post_url:parentUrl||await permalink(parentId),reply_id:replyId,error:null},folderInfo.handle);
      return completed;
    }catch(error){
      await saveRecord({...base,status:'post_published_reply_failed',threads_post_id:parentId,threads_post_url:parentUrl,error:friendlyError(error)},folderInfo.handle).catch(()=>{});
      throw error;
    }
  }catch(error){
    const current=knownRecord(job.jobId,job.folderName);
    if(!PARTIAL_STATUSES.has(current?.status)&&current?.status!=='published'){
      await saveRecord({...(current||{}),job_id:job.jobId,folder_name:job.folderName,status:'failed',started_at:current?.started_at||startedAt,completed_at:new Date().toISOString(),original_coupang_url:job.originalUrl||current?.original_coupang_url,product_name:error?.body?.product_name||current?.product_name,error:friendlyError(error),retry_count:Number(current?.retry_count)||1,match_candidates:candidateSummary(error?.body?.candidates||current?.match_candidates)},folderInfo.handle).catch(()=>{});
    }
    throw error;
  }
}

function randomIntervals(count){
  if(count<=1)return [];
  const waits=count-1,totalMinutes=Math.min(50,Math.max(2,waits*5));
  const weights=Array.from({length:waits},()=>.35+Math.random()*1.65),sum=weights.reduce((a,b)=>a+b,0);
  return weights.map(weight=>Math.round(totalMinutes*60_000*weight/sum));
}
function formatWait(ms){
  const total=Math.max(0,Math.ceil(ms/1000)),minutes=Math.floor(total/60),seconds=total%60;
  return `${minutes}분 ${String(seconds).padStart(2,'0')}초 후`;
}
async function waitForNext(ms){
  if(ms<=0)return !stopRequested;
  return new Promise(resolve=>{
    const end=Date.now()+ms;
    $('coupasNextAt').textContent=new Date(end).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
    const tick=()=>{
      if(stopRequested){clearInterval(timer);cancelWait=null;$('coupasCountdown').textContent='취소됨';resolve(false);return}
      const left=end-Date.now();$('coupasCountdown').textContent=formatWait(left);
      if(left<=0){clearInterval(timer);cancelWait=null;resolve(true)}
    };
    const timer=setInterval(tick,250);cancelWait=()=>{stopRequested=true;tick()};tick();
  });
}

async function start(){
  if(running)return;
  const requested=Number($('coupasRunCount').value);
  if(!Number.isInteger(requested)||requested<=0){setMessage('실행 개수는 1 이상의 정수로 입력해 주세요.','error');return}
  if(!window.showDirectoryPicker){setMessage('최신 Chrome 또는 Edge에서만 로컬 폴더를 연결할 수 있습니다.','error');return}
  if(!directoryHandle||await folderPermission(true)!=='granted'){setMessage('폴더 접근 권한이 필요합니다. 폴더 연결을 다시 눌러 주세요.','error');return}
  if(directoryHandle.name!==EXPECTED_FOLDER){setMessage(`${EXPECTED_FOLDER} 폴더를 정확히 연결해 주세요.`,'error');return}
  await loadHistory();
  if(!historyReady){setMessage('로컬 게시 이력을 확인할 수 없습니다. 폴더 쓰기 권한을 다시 연결해 주세요.','error');return}

  running=true;stopRequested=false;stats={requested,success:0,failed:0,processed:0};renderStats();
  $('coupasStart').disabled=true;$('coupasStop').disabled=false;setStatus('자료 확인 중');setMessage('미게시 하위 폴더를 확인하고 있습니다.');
  const mode=document.querySelector('input[name="coupasMode"]:checked')?.value||'immediate';
  const started=Date.now(),deadline=started+60*60_000;
  try{
    const folders=await listCandidateFolders(requested);
    const intervals=mode==='random'?randomIntervals(folders.length):[];
    for(let index=0;index<folders.length;index++){
      if(stopRequested)break;
      if(index>0&&mode==='random'){
        setStatus('다음 게시 대기');
        const remainingJobs=folders.length-index;
        const maxWait=Math.max(0,deadline-Date.now()-remainingJobs*60_000);
        if(!await waitForNext(Math.min(intervals[index-1]||0,maxWait)))break;
      }
      const folder=folders[index];setStatus('실행 중');$('coupasCurrent').textContent=folder.name;$('coupasCountdown').textContent='처리 중';$('coupasNextAt').textContent='—';
      try{const result=await processFolder(folder);if(!result?.skipped)stats.success++}
      catch(error){stats.failed++;setMessage(`${folder.name}: ${friendlyError(error)}`,'error')}
      stats.processed++;renderStats();
    }
    if(stopRequested){setStatus('사용자 정지');setMessage('사용자 요청으로 자동발행을 정지했습니다.');}
    else if(stats.processed<requested){setStatus('정상 종료');setMessage('새로운 게시물 자료가 없어 자동발행을 정상 종료했습니다.');}
    else{setStatus('완료');setMessage(`자동발행 작업이 완료되었습니다. 총 소요시간 ${Math.ceil((Date.now()-started)/1000)}초`,'ok');}
  }catch(error){setStatus('실패');setMessage(error.message,'error')}
  finally{running=false;cancelWait=null;$('coupasStart').disabled=false;$('coupasStop').disabled=true;$('coupasCurrent').textContent='—';$('coupasCountdown').textContent='—';$('coupasNextAt').textContent='—';await loadHistory()}
}
function stop(){if(!running)return;stopRequested=true;if(cancelWait)cancelWait();setStatus('정지 요청');setMessage('현재 게시 작업이 끝나면 안전하게 정지합니다.')}

async function init(){
  $('coupasConnectFolder')?.addEventListener('click',connectFolder);
  $('coupasStart')?.addEventListener('click',start);
  $('coupasStop')?.addEventListener('click',stop);
  await restoreHandle();
  await loadHistory();
}
init();
})();
