(()=>{
const MARKER='.coupas-share-sync.json';
const DB='prompt-thread-growth-room';
const STORE='directory-handles';
const KEY='threads-coupas-share-target';
const CHECKPOINT_KEY=KEY+'-checkpoint';
const CHECKPOINT_FORMAT='coupas-share-checkpoint-v1';
const safeName=name=>typeof name==='string'&&name!=='.'&&name!=='..'&&!/[\\/\x00-\x1f]/.test(name)&&name.length>0;
const folderOrder=name=>{const match=String(name).match(/^(?:IG|TH|X)_(\d{8})_(\d{6})_/);return match?match[1]+match[2]+':'+name:''};
function validCheckpoint(value){return value?.format===CHECKPOINT_FORMAT&&Array.isArray(value.completed)&&value.completed.every(safeName)&&(!value.lastFolder||safeName(value.lastFolder))}
async function readCheckpoint(source,target,read=()=>targetStore(undefined,CHECKPOINT_KEY)){
  const value=await read();
  if(!validCheckpoint(value)||!value.source||!value.target)return null;
  if(!await value.source.isSameEntry(source)||!await value.target.isSameEntry(target))return null;
  return value;
}
async function optionalFile(dir,name){
  try{return await dir.getFileHandle(name)}catch(error){if(error.name==='NotFoundError')return null;throw error}
}
async function independent(source,target){
  if(await source.isSameEntry(target)||await source.resolve(target)!==null||await target.resolve(source)!==null)throw new Error('원본과 공유 대상은 서로 다른 폴더여야 하며 서로의 하위 폴더일 수 없습니다.');
}
async function writeText(dir,name,text){
  const handle=await dir.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  try{await writable.write(text);await writable.close()}catch(error){await writable.abort().catch(()=>{});throw error}
}
async function readPackage(dir,now){
  const manifest=await (await dir.getFileHandle('content.json')).getFile();
  const raw=await manifest.text(),data=JSON.parse(raw);
  if(!data?.content||!data?.media||!Array.isArray(data.media.images))throw new Error('content.json 구조를 확인해 주세요.');
  const names=[...new Set([data.media.video,...data.media.images].filter(value=>value!==null&&value!==undefined&&value!==''))];
  if(names.some(name=>!safeName(name)||name==='content.json'||name===MARKER||name==='.threads-coupas-status.json'||/\.(?:crdownload|part|partial|tmp)$/i.test(name)))throw new Error('미디어 파일 이름이 올바르지 않습니다.');
  const text=await optionalFile(dir,'content.txt');
  if(text)names.push('content.txt');
  const files=[];
  for(const name of [...new Set(names)]){
    const handle=await dir.getFileHandle(name),file=await handle.getFile();
    files.push({name,handle,file});
  }
  if([manifest,...files.map(item=>item.file)].some(file=>file.lastModified>now-30000))return null;
  return {raw,manifest,files,signature:JSON.stringify([raw,...files.map(item=>[item.name,item.file.size,item.file.lastModified])])};
}
async function copyPackages(source,target,{now=Date.now(),onProgress=()=>{},checkpoint=null,onCheckpoint=async()=>{}}={}){
  await independent(source,target);
  // 실제 접근 실패를 성공으로 처리하지 않는다.
  for await(const unused of target.entries()){break}
  const completed=new Set(validCheckpoint(checkpoint)?checkpoint.completed:[]);
  let lastFolder=validCheckpoint(checkpoint)?checkpoint.lastFolder||'':'';
  const snapshot=()=>({format:CHECKPOINT_FORMAT,completed:[...completed],lastFolder,updatedAt:now});
  const remember=async name=>{
    completed.add(name);
    if(!lastFolder||folderOrder(name)>folderOrder(lastFolder))lastFolder=name;
    try{await onCheckpoint(snapshot())}catch(error){const failure=new Error('진행 기록 저장 실패: '+error.message);failure.checkpointFailure=true;throw failure}
  };
  const result={copied:0,skipped:0,remembered:0,pending:0,failed:0,errors:[]};
  for await(const [name,dir] of source.entries()){
    if(dir.kind!=='directory')continue;
    if(completed.has(name)){result.remembered++;continue}
    try{
      if(!safeName(name))throw new Error('작업 폴더 이름이 올바르지 않습니다.');
      let pack;
      try{pack=await readPackage(dir,now)}catch(error){if(error.name==='NotFoundError'||error instanceof SyntaxError){result.pending++;continue}throw error}
      if(!pack){result.pending++;continue}
      onProgress(`${name} 확인 중`);
      const out=await target.getDirectoryHandle(name,{create:true});
      const existing=await optionalFile(out,'content.json');
      let sameManifest=false;
      if(existing)sameManifest=await (await existing.getFile()).text()===pack.raw;
      if(sameManifest){
        for(const item of pack.files){
          const file=await optionalFile(out,item.name);
          if(!file||(await file.getFile()).size!==item.file.size)throw new Error('공유 대상의 기존 자료가 다릅니다. 기존 게시 자료를 덮어쓰지 않았습니다.');
        }
        result.skipped++;await remember(name);continue;
      }
      if(await optionalFile(out,'.threads-coupas-status.json'))throw new Error('공유 대상에 게시 이력이 있어 덮어쓰지 않았습니다.');
      const markerHandle=await optionalFile(out,MARKER);
      if(markerHandle){
        const marker=JSON.parse(await (await markerHandle.getFile()).text());
        if(marker.format!=='coupas-share-sync-v1'||marker.signature!==pack.signature)throw new Error('공유 대상에 다른 동기화 자료가 있습니다.');
      }else{
        for await(const unused of out.entries())throw new Error('공유 대상에 같은 이름의 다른 자료가 있어 덮어쓰지 않았습니다.');
        await writeText(out,MARKER,JSON.stringify({format:'coupas-share-sync-v1',signature:pack.signature}));
      }
      for(const item of pack.files){
        onProgress(`${name} / ${item.name} 복사 중`);
        const prior=await optionalFile(out,item.name);
        if(prior&&(await prior.getFile()).size===item.file.size)continue;
        const handle=prior||await out.getFileHandle(item.name,{create:true});
        const writable=await handle.createWritable();
        await item.file.stream().pipeTo(writable);
        if((await handle.getFile()).size!==item.file.size)throw new Error(`${item.name} 복사 크기 확인 실패`);
      }
      for(const item of pack.files){
        const fresh=await item.handle.getFile();
        if(fresh.size!==item.file.size||fresh.lastModified!==item.file.lastModified)throw new Error('복사 중 원본 파일이 변경됐습니다. 다시 동기화해 주세요.');
      }
      const fresh=await (await dir.getFileHandle('content.json')).getFile();
      if(fresh.lastModified!==pack.manifest.lastModified||await fresh.text()!==pack.raw)throw new Error('복사 중 원본 JSON이 변경됐습니다.');
      // 파일이 모두 닫히고 확인된 뒤 마지막에 게시 입력 manifest를 공개한다.
      await writeText(out,'content.json',pack.raw);
      if(await (await out.getFileHandle('content.json')).getFile().then(file=>file.text())!==pack.raw)throw new Error('content.json 저장 확인 실패');
      result.copied++;
      await remember(name);
    }catch(error){if(error.checkpointFailure)throw error;result.failed++;if(result.errors.length<5)result.errors.push(`${name}: ${error.message}`)}
  }
  result.checkpoint=snapshot();
  return result;
}
async function targetStore(value,key=KEY){
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,value?'readwrite':'readonly');
    const request=value?tx.objectStore(STORE).put(value,key):tx.objectStore(STORE).get(key);
    let stored;request.onsuccess=()=>{stored=request.result};
    tx.oncomplete=()=>resolve(stored||null);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  })}finally{db.close()}
}
let controls=null;
function setLocked(locked){if(controls){controls.choose.disabled=locked;controls.sync.disabled=locked;controls.full.disabled=locked}}
function mount({anchor,getSource,isBusy,onBusy}){
  if(!anchor||document.getElementById('coupasShareSync'))return;
  const box=document.createElement('div');box.className='coupas-field';
  box.innerHTML='<label>공유 폴더 수동 동기화</label><div class="coupas-actions"><button type="button" class="btn" id="coupasShareTarget">공유 폴더 지정</button><button type="button" class="btn p" id="coupasShareSync">공유 동기화</button><button type="button" class="btn" id="coupasShareFull">전체 다시 확인</button></div><p class="mut" id="coupasShareName">공유 대상 폴더를 지정해 주세요.</p><p class="mut">위 기준 폴더 → 지정한 공유 대상의 InstagramReels 폴더로 복사합니다. 완료 폴더는 이 브라우저에 기억해 내부 재검사를 생략하고, 새 폴더·준비 중·실패 항목만 확인합니다. 이전 폴더를 수정했거나 공유 파일을 복구하려면 [전체 다시 확인]을 누르세요. 기존 게시 자료는 덮어쓰거나 삭제하지 않습니다.</p><p class="mut" id="coupasShareResult" role="status" aria-live="polite"></p>';
  anchor.after(box);
  const choose=box.querySelector('#coupasShareTarget'),sync=box.querySelector('#coupasShareSync'),label=box.querySelector('#coupasShareName'),status=box.querySelector('#coupasShareResult');
  const full=box.querySelector('#coupasShareFull');
  let target=null,busy=false;
  controls={choose,sync,full};
  const message=(text,error=false)=>{status.textContent=text;status.className='mut'+(error?' coupas-result-error':'')};
  const display=()=>{label.textContent=target?`공유 대상: ${target.name} · 동기화 시 실제 접근을 확인합니다.`:'공유 대상 폴더를 지정해 주세요.'};
  choose.onclick=async()=>{
    if(busy||isBusy())return;
    try{
      if(!window.showDirectoryPicker)throw new Error('Chrome 또는 Edge에서 폴더를 지정해 주세요.');
      const picked=await window.showDirectoryPicker({id:'coupas-share-target',mode:'readwrite'});
      if(picked.name!=='InstagramReels')throw new Error('공유 폴더 안의 InstagramReels 폴더를 선택해 주세요. 없으면 폴더 선택 창에서 새로 만들어 주세요.');
      const source=getSource();if(source)await independent(source,picked);
      for await(const unused of picked.entries()){break}
      await targetStore(picked);target=picked;display();message('공유 대상을 지정했습니다. [공유 동기화]를 눌러 복사하세요.');
    }catch(error){if(error.name!=='AbortError')message(`공유 폴더 연결 실패: ${error.message}`,true)}
  };
  const runSync=async(fullScan=false)=>{
    if(busy||isBusy())return;
    const source=getSource();
    if(!source||source.name!=='InstagramReels'){message('먼저 위 기준 폴더를 연결해 주세요.',true);return}
    if(!target){message('먼저 [공유 폴더 지정]에서 대상 InstagramReels 폴더를 선택해 주세요.',true);return}
    busy=true;onBusy(true);setLocked(true);sync.textContent='동기화 중…';
    try{
      for(const [handle,mode] of [[source,'read'],[target,'readwrite']]){
        if(await handle.queryPermission({mode})!=='granted'&&await handle.requestPermission({mode})!=='granted')throw new Error('원본 읽기 및 공유 대상 쓰기 권한을 허용해 주세요.');
      }
      const checkpoint=fullScan?null:await readCheckpoint(source,target);
      const save=value=>targetStore({...value,source,target},CHECKPOINT_KEY);
      message(checkpoint?`이전 완료 ${checkpoint.completed.length}개 내부 검사 생략 · 마지막 확인: ${checkpoint.lastFolder||'—'}`:'전체 폴더를 확인하고 진행 위치를 기억합니다.');
      const result=await copyPackages(source,target,{checkpoint,onCheckpoint:save,onProgress:message});
      await save(result.checkpoint);
      message(`복사 ${result.copied}개 · 완료 기억 ${result.remembered}개 생략 · 기존 동일 ${result.skipped}개 · 준비 중 ${result.pending}개 · 실패 ${result.failed}개\n마지막 확인: ${result.checkpoint.lastFolder||'—'}${result.errors.length?'\n'+result.errors.join('\n'):''}`,result.failed>0);
    }catch(error){message(`공유 동기화 실패: ${error.message} 공유 PC·네트워크·Windows 공유 권한을 확인해 주세요.`,true)}
    finally{busy=false;onBusy(false);setLocked(false);sync.textContent='공유 동기화'}
  };
  sync.onclick=()=>runSync();full.onclick=()=>runSync(true);
  targetStore().then(handle=>{if(!target&&handle?.kind==='directory'){target=handle;display()}}).catch(()=>message('이전에 지정한 공유 폴더를 불러오지 못했습니다. 다시 지정해 주세요.',true));
}
window.CoupasShareSync={mount,setLocked,copyPackages};
})();
