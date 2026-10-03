(()=>{
const EXPECTED_FOLDER='InstagramReels';
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
let historyActionPending=false;
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
function removeLocalRecord(record){
  const rows=localRecords().filter(row=>row.job_id!==record.job_id&&row.folder_name!==record.folder_name);
  localStorage.setItem(SAFETY_KEY,JSON.stringify(rows));
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
async function ensureThreadsConnected(){
  const response=await fetch('/api/content-router?action=system_status',{cache:'no-store'});
  if(!response.ok)throw new Error(`Threads 연결 확인 실패: HTTP ${response.status}`);
  const status=await response.json();
  if(status.threads!==true)throw new Error('이 브라우저에 Threads 계정이 연결되지 않았습니다. 설정에서 Threads를 연결한 뒤 다시 실행해 주세요.');
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
async function inspectFolder(handle){
  const permission=await handle.queryPermission({mode:'readwrite'});
  if(permission!=='granted')return {permission,count:0,sample:[]};
  let count=0;
  const sample=[];
  for await(const [name,entry] of handle.entries()){
    if(entry.kind!=='directory')continue;
    count++;
    if(sample.length<3)sample.push(name);
  }
  return {permission,count,sample};
}
async function renderFolderState(){
  const badge=$('coupasFolderBadge'),name=$('coupasFolderName');
  if(!badge||!name)return false;
  if(!directoryHandle){badge.textContent='폴더 미연결';name.textContent='폴더를 선택해 주세요.';badge.className='badge review';return false}
  name.textContent=`선택한 폴더: ${directoryHandle.name} · 전체 경로는 브라우저에서 확인할 수 없습니다.`;
  if(directoryHandle.name!==EXPECTED_FOLDER){badge.textContent='다른 폴더 선택됨';badge.className='badge review';return false}
  try{
    const {permission,count,sample}=await inspectFolder(directoryHandle);
    if(permission!=='granted'){badge.textContent='권한 확인 필요';badge.className='badge review';return false}
    name.textContent=`선택한 폴더: ${directoryHandle.name} · 하위 폴더 ${count}개 읽기 확인${sample.length?` · 예: ${sample.join(', ')}`:''} · 전체 경로는 브라우저에서 확인할 수 없습니다.`;
    badge.textContent='폴더 연결됨';badge.className='badge positive';return true;
  }catch(error){badge.textContent='폴더 접근 실패';badge.className='badge review';setMessage(`선택한 폴더를 읽을 수 없습니다: ${error.message}`,'error');return false}
}

async function connectFolder(){
  if(running||historyActionPending)return;
  if(!window.showDirectoryPicker){
    setMessage('이 브라우저는 로컬 폴더 연결을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어 주세요.','error');return;
  }
  try{
    const handle=await window.showDirectoryPicker({id:'threads-coupas-source',mode:'readwrite'});
    if(handle.name!==EXPECTED_FOLDER)throw new Error(`${EXPECTED_FOLDER} 폴더를 정확히 선택해 주세요.`);
    const inspection=await inspectFolder(handle);
    if(inspection.permission!=='granted')throw new Error('선택한 폴더의 읽기/쓰기 권한을 허용해 주세요.');
    await storeHandle(handle);directoryHandle=handle;await renderFolderState();
    await loadHistory();
    setMessage(`선택한 ${handle.name} 폴더의 하위 폴더 ${inspection.count}개를 읽었습니다. 게시 이력은 각 작업 폴더에 로컬로 저장됩니다.`);
  }catch(error){if(error?.name!=='AbortError')setMessage(`폴더 접근 실패: ${error.message}`,'error')}
}

function setMessage(text,type=''){
  const node=$('coupasMessage');if(!node)return;node.textContent=text;node.className='mut '+(type==='error'?'coupas-result-error':type==='ok'?'positive':'');
}
function setStatus(text){if($('coupasStatus'))$('coupasStatus').textContent=text}
function renderStats(){
  const unlimited=stats.requested===null;
  $('coupasRequested').textContent=unlimited?'무제한':stats.requested;
  $('coupasSuccess').textContent=stats.success;
  $('coupasFailed').textContent=stats.failed;
  $('coupasRemaining').textContent=unlimited?'—':Math.max(0,stats.requested-stats.success);
}
function renderHistory(){
  const recover=$('coupasRecoverFailed');
  if(recover){
    const eligible=history.filter(isRecoverableFailure).length;
    recover.textContent=`인증·업로드 실패 → 대기 (${eligible}개 후보)`;
    recover.disabled=running||historyActionPending||!eligible;
  }
  const box=$('coupasResults'),count=$('coupasHistoryCount');if(!box||!count)return;
  count.textContent=`${history.length}개`;
  if(!history.length){box.innerHTML='<div class="card empty"><div><b>게시 이력 없음</b>완료 또는 실패한 작업이 여기에 표시됩니다.</div></div>';return}
  box.innerHTML=history.slice(0,100).map((row,index)=>{
    const label=row.status==='published'?'성공':PARTIAL_STATUSES.has(row.status)?'2/2 재시도 필요':row.status==='failed'?'실패':row.status==='pending'?'발행 대기':row.status==='stopped'?'정지':row.status;
    const link=row.threads_post_url?`<a href="${esc(row.threads_post_url)}" target="_blank" rel="noopener">Threads에서 보기 ↗</a>`:'';
    const actions=row.status==='failed'||PARTIAL_STATUSES.has(row.status)?`<button class="btn" data-coupas-action="retry" data-folder="${esc(row.folder_name||'')}">재시도</button><button class="btn coupas-delete" data-coupas-action="delete" data-folder="${esc(row.folder_name||'')}">폴더 삭제</button>`:'';
    return `<article class="post-card coupas-result"><div><div class="post-meta"><span>${index+1}. ${esc(label)}</span><span>${esc(row.folder_name||'')}</span><span>재시도 ${Number(row.retry_count)||0}</span></div><b>${esc(row.product_name||row.job_id||'')}</b>${row.error?`<p class="coupas-result-error">${esc(row.error)}</p>`:''}<div class="post-actions">${link}${actions}</div></div></article>`;
  }).join('');
}

async function listCandidateFolders(){
  const output=[];
  for await(const [name,handle] of directoryHandle.entries()){
    if(handle.kind!=='directory')continue;
    const existing=history.find(row=>row.folder_name===name);
    if(existing?.status==='published'||PARTIAL_STATUSES.has(existing?.status)||existing?.status==='history_invalid')continue;
    if(existing?.status==='failed'&&!isLegacyMissingCoupangUrlFailure(existing)&&!isLegacyMissingVideoFailure(existing))continue;
    output.push({name,handle});
  }
  output.sort((a,b)=>a.name.localeCompare(b.name,'ko-KR'));
  return output;
}
function isLegacyMissingCoupangUrlFailure(record){
  return record?.status==='failed'&&!record.threads_post_id&&!record.threads_post_url&&!record.reply_id&&String(record.error||'').trim()==='쿠팡 원본 링크 없음';
}
function isLegacyMissingVideoFailure(record){
  return record?.status==='failed'&&!record.threads_post_id&&!record.threads_post_url&&!record.reply_id&&String(record.error||'').trim()==='video.mp4 없음';
}
function isRecoverableFailure(record){
  if(record?.status!=='failed'||record.threads_post_id||record.threads_post_url||record.reply_id)return false;
  return /^(?:UNAUTHORIZED|THREADS_NOT_CONNECTED|Threads 본문 게시 실패: THREADS_NOT_CONNECTED|운영실 관리자 인증이 필요합니다\.)$|^(?:Threads 미디어 업로드 실패:|CONTENT_MASTER_MEDIA_UPLOAD_FAILED\b|Vercel Blob:)/.test(String(record.error||'').trim());
}
async function recoverFailedFolders(){
  if(running||historyActionPending)return;
  historyActionPending=true;
  $('coupasStart').disabled=true;
  setRunControlsLocked(true);renderHistory();
  let restored=0,skipped=0,failed=0;
  try{
    if(!directoryHandle||directoryHandle.name!==EXPECTED_FOLDER||await folderPermission(true)!=='granted')throw new Error('InstagramReels 폴더를 연결하고 쓰기 권한을 허용해 주세요.');
    // 페이지를 열었을 때의 로그인 결과를 재사용하지 않고 현재 세션을 확인한다.
    const response=await fetch('/api/content-router?action=admin_status',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});
    const auth=await response.json();
    if(!response.ok||auth.authenticated!==true)throw new Error('페이지를 새로고침하고 관리자 인증을 완료한 뒤 복구해 주세요.');
    await loadHistory();
    if(!historyReady)throw new Error('로컬 게시 이력을 확인할 수 없습니다.');
    const candidates=history.filter(isRecoverableFailure);
    if(!candidates.length){setMessage('복구 가능한 인증·업로드 실패 자료가 없습니다.');return}
    if(!confirm(`${candidates.length}개 후보의 게시 이력을 다시 확인하여 미게시 자료만 발행 대기로 복구합니다.\n이미 게시됐거나 상태가 불명확한 자료는 제외합니다.\n파일은 삭제하지 않으며, 지금 게시하지 않습니다. 계속할까요?`))return;
    for(const candidate of candidates){
      try{
        const name=String(candidate.folder_name||'');
        if(!name||name==='.'||name==='..'||/[\\/]/.test(name)){skipped++;continue}
        const handle=await directoryHandle.getDirectoryHandle(name);
        const fileHandle=await handle.getFileHandle(STATUS_FILE);
        const disk=JSON.parse(await (await fileHandle.getFile()).text());
        const records=[candidate,disk,...localRecords().filter(row=>row.job_id===candidate.job_id||row.folder_name===name)];
        // 최신 기록 하나만 믿지 않는다. 어느 저장소에든 게시 흔적/불명확한 상태가 있으면 보존한다.
        if(records.some(row=>row.job_id!==candidate.job_id||!isRecoverableFailure(row))){skipped++;continue}
        const next={...disk,folder_name:name,status:'pending',error:null,completed_at:null,updated_at:new Date().toISOString()};
        // 디스크 저장이 실패하면 메모리/localStorage를 대기 상태로 바꾸지 않는다.
        const writable=await fileHandle.createWritable();
        try{await writable.write(JSON.stringify(next,null,2));await writable.close()}
        catch(error){await writable.abort().catch(()=>{});throw error}
        putLocalRecord(next);
        restored++;
      }catch{failed++}
    }
    setMessage(`대기 복구 ${restored}개 · 안전 제외 ${skipped}개 · 저장/확인 실패 ${failed}개. 실제 게시는 [자동발행 시작]을 눌러야 진행됩니다.`,failed?'error':'ok');
  }catch(error){setMessage(`복구 중단: ${error.message}`,'error')}
  finally{
    historyActionPending=false;
    $('coupasStart').disabled=false;setRunControlsLocked(false);syncModeControls();
    await loadHistory();renderHistory();
  }
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
  const imageNames=data?.media?.images??[];
  if(!rewritten)throw new Error('content.rewritten_text 없음');
  if(!Array.isArray(imageNames))throw new Error('media.images 형식 오류');
  let video=null;
  if(videoName){
    if(!/\.mp4$/i.test(videoName))throw new Error('video.mp4 형식 오류');
    try{video=await (await folderInfo.handle.getFileHandle(videoName)).getFile()}
    catch(error){if(error?.name!=='NotFoundError')throw new Error(`동영상 파일 읽기 실패: ${error.message}`)}
    if(video&&!/\.mp4$/i.test(video.name))throw new Error('video.mp4 형식 오류');
  }
  const images=[];
  for(const name of imageNames){
    const safeName=String(name||'').trim();
    if(!safeName)throw new Error('이미지 파일명 오류');
    const file=await getRequiredFile(folderInfo.handle,safeName,`${safeName} 없음`);
    if(!/\.(?:jpe?g)$/i.test(file.name))throw new Error(`${safeName} 형식 오류`);
    images.push(file);
  }
  return {jobId:String(data?.job_id||folderInfo.name).trim().slice(0,160),folderName:folderInfo.name,rewritten,originalUrl,hasCoupangLink:Boolean(originalUrl),productHint,video,images};
}

function threadsText(value,hasCoupangLink){
  if(!hasCoupangLink)return [...String(value||'')].slice(0,500).join('');
  const clean=String(value||'').replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(clean.includes('쿠팡 파트너스 활동의 일환'))return [...clean].slice(0,500).join('');
  const available=500-[...DISCLOSURE].length-2;
  return `${[...clean].slice(0,Math.max(0,available)).join('').trim()}\n\n${DISCLOSURE}`;
}
async function uploadMedia(job,file,type,index){const source=file.type?file:new File([file],file.name,{type:type==='video'?'video/mp4':'image/jpeg',lastModified:file.lastModified});const local=await LocalMedia.local(source);return {type,url:local.url}}
async function publishParent(job){
  const media=[];
  if(job.video)media.push(await uploadMedia(job,job.video,'video',0));
  for(let index=0;index<job.images.length;index++)media.push(await uploadMedia(job,job.images[index],'image',index+1));
  const payload=window.LocalMedia?await LocalMedia.prepare({_temp_job_id:'coupas:'+job.jobId,text:threadsText(job.rewritten,job.hasCoupangLink),media}):{text:threadsText(job.rewritten,job.hasCoupangLink),media};
  const response=await fetch('/api/threads/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||!body.id)throw new Error(`Threads 본문 게시 실패: ${body.detail?.message||body.error||response.status}`);
  if(window.LocalMedia)await LocalMedia.published(payload,'threads',body.id).catch(console.error);
  return String(body.id);
}
async function permalink(id){
  try{
    const body=await adminApi('coupas_threads_permalink',{post_id:String(id)});
    return String(body.permalink||'');
  }catch{return ''}
}
async function publishLinkedPost(parentId,url){
  const link=String(url).trim();
  const text=`${DISCLOSURE}\n${link}`;
  let existing;
  try{
    existing=await adminApi('coupas_threads_reply_exists',{parent_id:String(parentId),text});
    if(!existing.exists)existing=await adminApi('coupas_threads_reply_exists',{parent_id:String(parentId),text:link});
  }
  catch(error){throw new Error(`Threads 2/2 중복 확인 실패: ${error.code||error.message}`)}
  if(existing.exists&&existing.id)return String(existing.id);
  const response=await fetch('/api/threads/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reply_to_id:String(parentId),text})});
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
  let retryCount=(Number(existing?.retry_count)||0)+1;
  const startedAt=new Date().toISOString();
  try{
    if(PARTIAL_STATUSES.has(existing?.status)&&existing?.threads_post_id&&existing?.generated_coupang_url){
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
    retryCount=(Number(existing?.retry_count)||0)+1;
    if(existing?.status==='published')return {skipped:true};
    await saveRecord({...(existing||{}),job_id:job.jobId,folder_name:job.folderName,status:'processing',started_at:existing?.started_at||startedAt,completed_at:null,original_coupang_url:job.originalUrl,error:null,retry_count:retryCount},folderInfo.handle);

    if(!job.hasCoupangLink){
      $('coupasCurrent').textContent=`${job.folderName} · 링크 없는 본문 게시`;
      const parentId=await publishParent(job);
      const completed=await saveRecord({
        ...(existing||{}),job_id:job.jobId,folder_name:job.folderName,started_at:existing?.started_at||startedAt,
        completed_at:new Date().toISOString(),status:'published',product_name:job.productHint||job.jobId,
        original_coupang_url:'',threads_post_id:parentId,threads_post_url:await permalink(parentId),
        error:null,retry_count:retryCount
      },folderInfo.handle);
      return completed;
    }

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
      await saveRecord({...(current||{}),job_id:job.jobId,folder_name:job.folderName,status:'failed',started_at:current?.started_at||startedAt,completed_at:new Date().toISOString(),original_coupang_url:job.originalUrl||current?.original_coupang_url,product_name:error?.body?.product_name||current?.product_name,error:friendlyError(error),retry_count:retryCount,match_candidates:candidateSummary(error?.body?.candidates||current?.match_candidates)},folderInfo.handle).catch(()=>{});
    }
    throw error;
  }
}

function actionableRecord(folderName){
  const safeName=String(folderName||'');
  if(!safeName||safeName==='.'||safeName==='..'||/[\\/]/.test(safeName))throw new Error('작업 폴더 이름이 올바르지 않습니다.');
  const record=history.find(row=>row.folder_name===safeName);
  if(!record||(record.status!=='failed'&&!PARTIAL_STATUSES.has(record.status)))throw new Error('실패한 작업만 재시도하거나 삭제할 수 있습니다.');
  return record;
}
async function prepareFolderAction(folderName){
  if(running)throw new Error('자동발행 실행 중에는 작업 결과를 변경할 수 없습니다.');
  if(!directoryHandle||await folderPermission(true)!=='granted')throw new Error('폴더 접근 권한이 필요합니다.');
  if(directoryHandle.name!==EXPECTED_FOLDER)throw new Error(`${EXPECTED_FOLDER} 폴더를 정확히 연결해 주세요.`);
  const record=actionableRecord(folderName);
  const handle=await directoryHandle.getDirectoryHandle(record.folder_name);
  return {record,handle};
}
async function retryFailedFolder(folderName){
  let ownsRun=false;
  try{
    const {record,handle}=await prepareFolderAction(folderName);
    await ensureThreadsConnected();
    running=true;ownsRun=true;stats={requested:1,success:0,failed:0,processed:0};renderStats();renderHistory();
    $('coupasStart').disabled=true;$('coupasStop').disabled=true;setStatus('재시도 중');$('coupasCurrent').textContent=record.folder_name;setMessage(`${record.folder_name} 작업을 재시도하고 있습니다.`);
    try{
      const result=await processFolder({name:record.folder_name,handle});
      if(!result?.skipped)stats.success++;
      setStatus('완료');setMessage(`${record.folder_name} 재시도가 완료되었습니다.`,'ok');
    }catch(error){
      stats.failed++;setStatus('재시도 실패');setMessage(`${record.folder_name}: ${friendlyError(error)}`,'error');
    }
    stats.processed++;renderStats();
  }catch(error){setMessage(error.message,'error')}
  finally{if(ownsRun){running=false;$('coupasStart').disabled=false;$('coupasStop').disabled=true;$('coupasCurrent').textContent='—';await loadHistory()}}
}
async function deleteFailedFolder(folderName){
  try{
    const {record}=await prepareFolderAction(folderName);
    const threadsWarning=PARTIAL_STATUSES.has(record.status)?'\n이미 게시된 Threads 1/2 게시물은 삭제되지 않습니다.':'';
    if(!confirm(`${record.folder_name} 폴더와 폴더 안의 모든 파일을 실제 디스크에서 삭제합니다.${threadsWarning}\n이 작업은 되돌릴 수 없습니다. 계속할까요?`))return;
    await directoryHandle.removeEntry(record.folder_name,{recursive:true});
    removeLocalRecord(record);
    history=history.filter(row=>row.job_id!==record.job_id&&row.folder_name!==record.folder_name);
    renderHistory();
    setMessage(`${record.folder_name} 폴더를 실제 디스크에서 삭제했습니다.`,'ok');
  }catch(error){setMessage(`폴더 삭제 실패: ${error.message}`,'error')}
}
async function handleHistoryAction(event){
  const button=event.target.closest('[data-coupas-action]');
  if(!button||historyActionPending)return;
  const folderName=button.dataset.folder||'';
  historyActionPending=true;
  try{
    if(button.dataset.coupasAction==='retry')await retryFailedFolder(folderName);
    if(button.dataset.coupasAction==='delete')await deleteFailedFolder(folderName);
  }finally{historyActionPending=false}
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

function selectedMode(){
  return document.querySelector('input[name="coupasMode"]:checked')?.value||'immediate';
}
function selectedIntervalMs(){
  const active=document.querySelector('[data-coupas-interval].on');
  const minutes=Number(active?.dataset.coupasInterval||30);
  return Math.max(1,minutes)*60_000;
}
function setRunControlsLocked(locked){
  $('coupasConnectFolder').disabled=locked;
  $('coupasRunCount').disabled=locked;
  document.querySelectorAll('input[name="coupasMode"],[data-coupas-interval]').forEach(node=>node.disabled=locked);
}
function syncModeControls(){
  const intervalMode=selectedMode()==='interval';
  const countField=$('coupasRunCount');
  const intervalOptions=$('coupasIntervalOptions');
  if(countField)countField.closest('.coupas-field').hidden=intervalMode;
  if(intervalOptions)intervalOptions.hidden=!intervalMode;
}
async function runIntervalAutomatic({intervalMs,getNextFolder,process,wait,isStopped,onNoFolder}){
  const failedFolders=new Set();
  while(!isStopped()){
    const folder=await getNextFolder(failedFolders);
    if(isStopped())break;
    if(folder){
      const succeeded=await process(folder);
      if(succeeded===false){
        // 상태 파일 저장 실패가 있어도 같은 자료를 이번 실행에서 무한 재시도하지 않는다.
        failedFolders.add(folder.name);
        continue;
      }
    }
    else if(onNoFolder)await onNoFolder();
    if(isStopped())break;
    if(!await wait(intervalMs))break;
  }
}

async function start(){
  if(running||historyActionPending)return;
  const mode=selectedMode();
  const intervalMode=mode==='interval';
  const requested=intervalMode?null:Number($('coupasRunCount').value);
  if(!intervalMode&&(!Number.isInteger(requested)||requested<=0)){setMessage('실행 개수는 1 이상의 정수로 입력해 주세요.','error');return}
  if(!window.showDirectoryPicker){setMessage('최신 Chrome 또는 Edge에서만 로컬 폴더를 연결할 수 있습니다.','error');return}
  let permission='denied';
  try{permission=await folderPermission(true)}catch(error){setStatus('폴더 확인 필요');setMessage(`선택한 폴더의 권한을 확인할 수 없습니다: ${error.message}`,'error');return}
  if(!directoryHandle||permission!=='granted'){setMessage('폴더 접근 권한이 필요합니다. 폴더 연결을 다시 눌러 주세요.','error');return}
  if(directoryHandle.name!==EXPECTED_FOLDER){setMessage(`${EXPECTED_FOLDER} 폴더를 정확히 연결해 주세요.`,'error');return}
  if(!await renderFolderState()){setStatus('폴더 확인 필요');return}
  try{await loadHistory()}catch(error){setStatus('폴더 확인 필요');setMessage(`선택한 폴더의 게시 이력을 읽을 수 없습니다: ${error.message}`,'error');return}
  if(!historyReady){setMessage('로컬 게시 이력을 확인할 수 없습니다. 폴더 쓰기 권한을 다시 연결해 주세요.','error');return}
  try{await ensureThreadsConnected()}catch(error){setStatus('Threads 연결 필요');setMessage(error.message,'error');return}

  if(running||historyActionPending)return;
  running=true;stopRequested=false;stats={requested,success:0,failed:0,processed:0};renderStats();
  $('coupasStart').disabled=true;$('coupasStop').disabled=false;setRunControlsLocked(true);setStatus('자료 확인 중');setMessage('미게시 하위 폴더를 확인하고 있습니다.');
  const started=Date.now(),deadline=started+60*60_000;
  try{
    if(intervalMode){
      const intervalMs=selectedIntervalMs();
      await runIntervalAutomatic({
        intervalMs,
        isStopped:()=>stopRequested,
        wait:waitForNext,
        getNextFolder:async failedFolders=>{
          await loadHistory();
          if(!historyReady)throw new Error('로컬 게시 이력을 확인할 수 없습니다. 폴더 쓰기 권한을 다시 연결해 주세요.');
          const folders=await listCandidateFolders();
          return folders.find(folder=>!failedFolders.has(folder.name))||null;
        },
        process:async folder=>{
          setStatus('실행 중');$('coupasCurrent').textContent=folder.name;$('coupasCountdown').textContent='처리 중';$('coupasNextAt').textContent='—';
          let succeeded=false;
          try{const result=await processFolder(folder);if(!result?.skipped){stats.success++;succeeded=true}}
          catch(error){stats.failed++;setMessage(`${folder.name}: ${friendlyError(error)} · 다음 자료를 바로 확인합니다.`,'error')}
          stats.processed++;renderStats();
          return succeeded;
        },
        onNoFolder:async()=>{
          setStatus('다음 자료 대기');$('coupasCurrent').textContent='—';setMessage('새 미게시 자료가 없습니다. 다음 간격에 다시 확인합니다.');
        }
      });
      if(stopRequested){setStatus('사용자 정지');setMessage('사용자 요청으로 자동발행을 정지했습니다.');}
      return;
    }
    const folders=await listCandidateFolders();
    const intervals=mode==='random'?randomIntervals(requested):[];
    let needsRandomWait=false;
    for(let index=0;index<folders.length&&stats.success<requested;index++){
      if(stopRequested)break;
      if(needsRandomWait&&mode==='random'){
        needsRandomWait=false;
        setStatus('다음 게시 대기');
        const remainingJobs=requested-stats.success;
        const maxWait=Math.max(0,deadline-Date.now()-remainingJobs*60_000);
        if(!await waitForNext(Math.min(intervals[stats.success-1]||0,maxWait)))break;
      }
      const folder=folders[index];setStatus('실행 중');$('coupasCurrent').textContent=folder.name;$('coupasCountdown').textContent='처리 중';$('coupasNextAt').textContent='—';
      try{const result=await processFolder(folder);if(!result?.skipped){stats.success++;needsRandomWait=stats.success<requested}}
      catch(error){stats.failed++;setMessage(`${folder.name}: ${friendlyError(error)}`,'error')}
      stats.processed++;renderStats();
    }
    if(stopRequested){setStatus('사용자 정지');setMessage('사용자 요청으로 자동발행을 정지했습니다.');}
    else if(stats.success<requested){setStatus('정상 종료');setMessage(`처리 가능한 폴더가 없어 종료했습니다. 성공 ${stats.success}개 · 실패 ${stats.failed}개`);}
    else{setStatus('완료');setMessage(`자동발행 작업이 완료되었습니다. 성공 ${stats.success}개 · 실패 ${stats.failed}개 · 총 소요시간 ${Math.ceil((Date.now()-started)/1000)}초`,'ok');}
  }catch(error){setStatus('실패');setMessage(error.message,'error')}
  finally{running=false;cancelWait=null;$('coupasStart').disabled=false;$('coupasStop').disabled=true;setRunControlsLocked(false);syncModeControls();$('coupasCurrent').textContent='—';$('coupasCountdown').textContent='—';$('coupasNextAt').textContent='—';await loadHistory()}
}
function stop(){if(!running)return;stopRequested=true;if(cancelWait)cancelWait();setStatus('정지 요청');setMessage('현재 게시 작업이 끝나면 안전하게 정지합니다.')}

async function init(){
  const resultsHead=$('coupasHistoryCount')?.parentElement;
  if(resultsHead&&!$('coupasRecoverFailed')){
    const button=document.createElement('button');
    button.id='coupasRecoverFailed';button.type='button';button.className='btn';button.disabled=true;
    button.textContent='인증·업로드 실패 → 대기';
    button.title='미게시 실패 자료만 복구합니다. 파일 삭제나 실제 게시는 하지 않습니다.';
    button.addEventListener('click',recoverFailedFolders);resultsHead.appendChild(button);
  }
  $('coupasConnectFolder')?.addEventListener('click',connectFolder);
  $('coupasStart')?.addEventListener('click',start);
  $('coupasStop')?.addEventListener('click',stop);
  document.querySelectorAll('input[name="coupasMode"]').forEach(node=>node.addEventListener('change',syncModeControls));
  document.querySelectorAll('[data-coupas-interval]').forEach(button=>button.addEventListener('click',()=>{
    if(running)return;
    document.querySelectorAll('[data-coupas-interval]').forEach(node=>node.classList.remove('on'));
    button.classList.add('on');
  }));
  $('coupasResults')?.addEventListener('click',handleHistoryAction);
  syncModeControls();
  await restoreHandle();
  try{await loadHistory()}catch(error){setMessage(`선택한 폴더의 게시 이력을 읽을 수 없습니다: ${error.message}`,'error')}
}
if(window.__THREADS_COUPAS_TEST__)window.__threadsCoupasTestHooks={
  runIntervalAutomatic,threadsText,isLegacyMissingCoupangUrlFailure,formatWait
};
init();
})();
