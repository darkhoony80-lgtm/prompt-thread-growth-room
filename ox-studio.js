(()=>{
  const TYPE_META={
    novel:{label:'📚 소설',noun:'소설'},
    longform:{label:'🎬 롱폼',noun:'롱폼'},
    blog:{label:'📝 블로그',noun:'블로그'}
  };
  const state={type:'novel',candidates:[],selected:-1,current:null,library:[],loaded:false};
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function install(){
    const nav=document.querySelector('aside nav');
    const main=document.querySelector('main.main');
    if(!nav||!main||document.getElementById('ox-studio'))return;
    const button=document.createElement('button');
    button.className='nav';
    button.dataset.v='ox-studio';
    button.textContent='🐂 OX 콘텐츠 스튜디오';
    const settings=nav.querySelector('[data-v="settings"]');
    nav.insertBefore(button,settings||null);
    main.insertAdjacentHTML('beforeend',viewHtml());
    button.addEventListener('click',()=>{
      document.querySelectorAll('.nav').forEach(node=>node.classList.remove('on'));
      document.querySelectorAll('.view').forEach(node=>node.classList.remove('on'));
      button.classList.add('on');
      document.getElementById('ox-studio').classList.add('on');
      const title=document.getElementById('title');
      if(title)title.textContent='🐂 OX 콘텐츠 스튜디오';
      if(!state.loaded)loadLibrary();
    });
    bind();
    renderCandidates();
    renderLibrary();
  }

  function viewHtml(){return `<section class="view" id="ox-studio"><div class="ox-shell">
    <div class="section"><div><b>🐂 OX 콘텐츠 스튜디오</b><p class="mut">무료 OX로 장문 텍스트를 기획·생성하고 구조화 저장합니다. 이미지와 영상은 만들지 않습니다.</p></div><span class="badge">${escapeHtml('stealth/ox-alpha')}</span></div>
    <div class="ox-tabs" id="oxTypeTabs">${Object.entries(TYPE_META).map(([key,v])=>`<button class="btn${key==='novel'?' on':''}" data-ox-type="${key}">${v.label}</button>`).join('')}</div>
    <div class="ox-workspace">
      <div class="card"><div class="section"><div><b id="oxModeTitle">소설 소재</b><p class="mut">랜덤 소재는 짧은 후보 5개만 만듭니다.</p></div><button class="btn p" id="oxTopicsBtn">🎲 랜덤 소재</button></div><div id="oxCandidateStatus" class="ox-status">소재 후보를 먼저 생성하세요.</div><div id="oxCandidates" class="ox-candidates"></div><button class="btn p" id="oxGenerateBtn" disabled style="width:100%;margin-top:12px">선택 소재로 본문 생성</button></div>
      <div class="card"><div class="section"><div><b>결과 검토·수정</b><p class="mut">구조화 JSON을 직접 수정한 뒤 저장할 수 있습니다.</p></div><span class="badge" id="oxCurrentBadge">새 콘텐츠</span></div><div class="ox-meta"><label class="ox-field"><span class="mut">제목</span><input id="oxTitle" placeholder="생성 후 제목이 표시됩니다"></label><label class="ox-field"><span class="mut">상태</span><select id="oxStatus"><option>IDEA</option><option selected>DRAFT</option><option>READY</option><option>USED</option></select></label></div><textarea id="oxEditor" class="ox-editor" spellcheck="false" placeholder="생성 결과 JSON"></textarea><div id="oxEditorStatus" class="ox-status"></div><div class="ox-actions" style="margin-top:10px"><button class="btn p" id="oxSaveBtn" disabled>저장</button><button class="btn" id="oxJsonBtn" disabled>JSON</button><button class="btn" id="oxTxtBtn" disabled>TXT</button><button class="btn" id="oxZipBtn" disabled>ZIP 다운로드</button></div></div>
    </div>
    <div class="card"><div class="section"><div><b>저장된 콘텐츠</b><p class="mut">제목·주제·태그 검색과 유형·상태 필터를 지원합니다.</p></div><button class="btn" id="oxRefreshBtn">새로고침</button></div><div class="ox-library-tools"><input class="ox-search" id="oxSearch" placeholder="제목, 주제, 태그 검색"><div class="ox-filters" id="oxFilters"><button class="btn ox-filter on" data-filter="all">전체</button><button class="btn ox-filter" data-filter="novel">소설</button><button class="btn ox-filter" data-filter="longform">롱폼</button><button class="btn ox-filter" data-filter="blog">블로그</button><button class="btn ox-filter" data-filter="DRAFT">DRAFT</button><button class="btn ox-filter" data-filter="READY">READY</button><button class="btn ox-filter" data-filter="USED">USED</button></div></div><div id="oxLibraryStatus" class="ox-status"></div><div id="oxLibrary" class="ox-library-grid"></div></div>
  </div></section>`}

  function bind(){
    document.getElementById('oxTypeTabs').addEventListener('click',event=>{
      const button=event.target.closest('[data-ox-type]'); if(!button)return;
      state.type=button.dataset.oxType; state.candidates=[]; state.selected=-1;
      document.querySelectorAll('[data-ox-type]').forEach(node=>node.classList.toggle('on',node===button));
      document.getElementById('oxModeTitle').textContent=`${TYPE_META[state.type].noun} 소재`;
      renderCandidates(); setStatus('oxCandidateStatus','소재 후보를 먼저 생성하세요.');
    });
    document.getElementById('oxTopicsBtn').onclick=generateTopics;
    document.getElementById('oxGenerateBtn').onclick=generateContent;
    document.getElementById('oxSaveBtn').onclick=saveCurrent;
    document.getElementById('oxRefreshBtn').onclick=loadLibrary;
    document.getElementById('oxSearch').addEventListener('input',renderLibrary);
    document.getElementById('oxFilters').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;document.querySelectorAll('.ox-filter').forEach(node=>node.classList.toggle('on',node===button));renderLibrary()});
    document.getElementById('oxJsonBtn').onclick=()=>downloadCurrent('json');
    document.getElementById('oxTxtBtn').onclick=()=>downloadCurrent('txt');
    document.getElementById('oxZipBtn').onclick=()=>downloadCurrent('zip');
  }

  async function api(action,payload={}){
    const response=await fetch(`/api/content-router?action=${encodeURIComponent(action)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok){const error=new Error(data.error||`HTTP_${response.status}`);error.raw=data.raw_text||data.meta?.message||'';throw error}
    return data;
  }

  function setStatus(id,message,type=''){
    const node=document.getElementById(id); if(!node)return;
    node.textContent=message; node.className=`ox-status${type?` ${type}`:''}`;
  }

  async function generateTopics(){
    const button=document.getElementById('oxTopicsBtn'); button.disabled=true;
    state.candidates=[];state.selected=-1;renderCandidates();setStatus('oxCandidateStatus','OX가 짧은 후보 5개를 만드는 중…');
    try{const data=await api('ox_topics',{type:state.type});state.candidates=data.items;renderCandidates();setStatus('oxCandidateStatus','후보 하나를 선택하세요.','ok')}
    catch(error){setStatus('oxCandidateStatus',`소재 생성 실패: ${error.message}${error.raw?` · ${error.raw.slice(0,180)}`:''}`,'error')}
    finally{button.disabled=false}
  }

  function renderCandidates(){
    const box=document.getElementById('oxCandidates');if(!box)return;
    box.innerHTML=state.candidates.map((item,index)=>`<button class="ox-candidate${index===state.selected?' on':''}" data-candidate="${index}"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.one_line)}</span><small>${escapeHtml(item.tag)}</small></button>`).join('');
    box.querySelectorAll('[data-candidate]').forEach(button=>button.onclick=()=>{state.selected=Number(button.dataset.candidate);renderCandidates();document.getElementById('oxGenerateBtn').disabled=false;setStatus('oxCandidateStatus',`선택: ${state.candidates[state.selected].title}`,'ok')});
    document.getElementById('oxGenerateBtn').disabled=state.selected<0;
  }

  async function generateContent(){
    if(state.selected<0)return;
    const button=document.getElementById('oxGenerateBtn');button.disabled=true;setStatus('oxEditorStatus','OX 장문 생성 중…');
    try{
      const candidate=state.candidates[state.selected];
      const context=state.type==='novel'&&state.current?.content_json?novelContext(state.current.content_json):null;
      const data=await api('ox_generate',{type:state.type,candidate,context});
      state.current={id:null,type:state.type,title:itemTitle(data.item),status:'DRAFT',topic:candidate.one_line,tags:data.item.tags||[candidate.tag].filter(Boolean),content_json:data.item,created_at:null};
      syncEditor();setStatus('oxEditorStatus','생성 완료. 내용을 검토한 뒤 저장하세요.','ok');
    }catch(error){setStatus('oxEditorStatus',`생성 실패: ${error.message}${error.raw?` · 원문 보존: ${error.raw.slice(0,220)}`:''}`,'error')}
    finally{button.disabled=state.selected<0}
  }

  function novelContext(item){return {world_bible:item.world_bible,characters:item.characters,master_plot:item.master_plot,memory_summary:item.memory_summary,continuity_notes:item.continuity_notes}}
  function itemTitle(item){return String(item?.type==='novel'?item.title:item?.selected_title||item?.title||'').trim()}
  function syncEditor(){
    const current=state.current;
    document.getElementById('oxEditor').value=current?JSON.stringify(current.content_json,null,2):'';
    document.getElementById('oxTitle').value=current?.title||'';
    document.getElementById('oxStatus').value=current?.status||'DRAFT';
    document.getElementById('oxCurrentBadge').textContent=current?.id?'저장 콘텐츠':'새 콘텐츠';
    ['oxSaveBtn','oxJsonBtn','oxTxtBtn','oxZipBtn'].forEach(id=>document.getElementById(id).disabled=!current);
  }

  function editedRecord(){
    if(!state.current)throw new Error('편집할 콘텐츠가 없습니다.');
    let content;try{content=JSON.parse(document.getElementById('oxEditor').value)}catch{throw new Error('JSON 형식이 올바르지 않습니다.')}
    const title=document.getElementById('oxTitle').value.trim()||itemTitle(content);if(!title)throw new Error('제목이 필요합니다.');
    return {...state.current,type:content.type||state.current.type,title,status:document.getElementById('oxStatus').value,content_json:content,tags:Array.isArray(content.tags)?content.tags:state.current.tags||[]};
  }

  async function saveCurrent(){
    const button=document.getElementById('oxSaveBtn');button.disabled=true;
    try{const record=editedRecord();setStatus('oxEditorStatus','Supabase 저장 중…');const data=await api('ox_library_save',{item:record});state.current=data.item;syncEditor();setStatus('oxEditorStatus','저장 완료','ok');await loadLibrary()}
    catch(error){setStatus('oxEditorStatus',`저장 실패: ${error.message}${error.raw?` · ${error.raw}`:''}`,'error')}
    finally{button.disabled=!state.current}
  }

  async function loadLibrary(){
    state.loaded=true;setStatus('oxLibraryStatus','저장된 콘텐츠 불러오는 중…');
    try{const data=await api('ox_library_list');state.library=data.items;setStatus('oxLibraryStatus',`${state.library.length}개 콘텐츠`,'ok');renderLibrary()}
    catch(error){state.library=[];setStatus('oxLibraryStatus',`라이브러리 연결 실패: ${error.message}${error.raw?` · ${error.raw}`:''}`,'error');renderLibrary()}
  }

  function renderLibrary(){
    const root=document.getElementById('oxLibrary');if(!root)return;
    const filter=document.querySelector('.ox-filter.on')?.dataset.filter||'all';
    const query=document.getElementById('oxSearch')?.value.trim().toLocaleLowerCase()||'';
    const rows=state.library.filter(row=>{
      const filterMatch=filter==='all'||row.type===filter||row.status===filter;
      const hay=[row.title,row.topic,...(Array.isArray(row.tags)?row.tags:[])].join(' ').toLocaleLowerCase();
      return filterMatch&&(!query||hay.includes(query));
    });
    if(!rows.length){root.innerHTML='<div class="ox-empty">조건에 맞는 저장 콘텐츠가 없습니다.</div>';return}
    root.innerHTML=rows.map(row=>`<article class="ox-library-card" data-id="${escapeHtml(row.id)}"><div class="ox-card-head"><span class="badge">${TYPE_META[row.type]?.label||row.type} · ${escapeHtml(row.status)}</span><span class="mut">${escapeHtml(new Date(row.updated_at).toLocaleDateString('ko-KR'))}</span></div><h3>${escapeHtml(row.title)}</h3><div class="ox-summary">${escapeHtml(cardSummary(row))}</div><div class="ox-tags">${escapeHtml((row.tags||[]).join(' / '))}</div><div class="ox-card-actions"><button class="btn" data-act="open">열기</button><button class="btn" data-act="clone">복제</button><button class="btn p" data-act="zip">ZIP 다운로드</button><button class="btn" data-act="ready">READY</button><button class="btn" data-act="used">USED</button></div></article>`).join('');
    root.querySelectorAll('[data-id]').forEach(card=>card.addEventListener('click',event=>{const action=event.target.closest('[data-act]')?.dataset.act;if(action)libraryAction(card.dataset.id,action)}));
  }

  function cardSummary(row){
    const item=row.content_json||{};
    if(row.type==='novel')return `${item.genre||'장르 미정'} · ${item.episode_number||1}화 ${item.episode_title||''} · 등장인물 ${(item.characters||[]).length}명`;
    if(row.type==='longform'){const chapters=item.chapters||[];const scenes=chapters.reduce((sum,ch)=>sum+(ch.scenes||[]).length,0);const queries=chapters.every(ch=>(ch.scenes||[]).every(scene=>(scene.source_queries||[]).length));return `${Math.round((item.target_duration_sec||600)/60)}분 · ${chapters.length}챕터 · ${scenes}장면 · 소스 검색어 ${queries?'준비 ✓':'확인 필요'}`}
    return `${item.category||'분류 미정'} · 사실검증 ${item.fact_check_needed?'필요':'확인됨'} · 목차 ${(item.outline||[]).length}개`;
  }

  async function libraryAction(id,action){
    const row=state.library.find(item=>item.id===id);if(!row)return;
    if(action==='open'){state.current=structuredClone(row);state.type=row.type;document.querySelector(`[data-ox-type="${row.type}"]`)?.click();state.current=structuredClone(row);syncEditor();setStatus('oxEditorStatus','저장 콘텐츠를 불러왔습니다.','ok');document.getElementById('oxEditor').scrollIntoView({behavior:'smooth',block:'center'});return}
    if(action==='clone'){state.current={...structuredClone(row),id:null,title:`${row.title} 복제`,status:'DRAFT',created_at:null,updated_at:null};syncEditor();setStatus('oxEditorStatus','복제본을 준비했습니다. 저장 전까지 원본은 변경되지 않습니다.','ok');return}
    if(action==='zip'){state.current=structuredClone(row);downloadCurrent('zip');return}
    if(action==='ready'||action==='used'){
      try{await api('ox_library_status',{id,status:action.toUpperCase()});await loadLibrary()}
      catch(error){setStatus('oxLibraryStatus',`상태 변경 실패: ${error.message}`,'error')}
    }
  }

  function safeName(value){return String(value||'ox-content').normalize('NFKC').replace(/[\\/:*?"<>|]/g,'').replace(/\s+/g,' ').trim().slice(0,80)||'ox-content'}
  function contentText(record){
    const item=record.content_json;
    if(item.type==='novel')return `${item.title}\n${item.episode_number}화. ${item.episode_title}\n\n${item.episode_body}\n\n다음 화 방향\n${item.next_episode_direction||''}`;
    if(item.type==='longform')return `${item.selected_title}\n\n${item.opening_hook||''}\n\n${(item.chapters||[]).map(ch=>`${ch.chapter_number}. ${ch.title}\n${ch.narration}\n${(ch.scenes||[]).map(scene=>`[장면 ${scene.scene_number}] ${scene.narration}\n화면: ${scene.visual_description}\n검색어: ${(scene.source_queries||[]).join(', ')}`).join('\n\n')}`).join('\n\n')}\n\n${item.ending||''}`;
    return `${item.selected_title}\n\n${item.fact_summary||''}\n\n${(item.outline||[]).map(section=>`${section.heading}\n${section.body}`).join('\n\n')}\n\nFAQ\n${(item.faq||[]).map(entry=>typeof entry==='string'?entry:`Q. ${entry.question||''}\nA. ${entry.answer||''}`).join('\n\n')}`;
  }
  function downloadCurrent(format){
    let record;try{record=editedRecord()}catch(error){setStatus('oxEditorStatus',error.message,'error');return}
    const name=safeName(record.title);const json=JSON.stringify(record.content_json,null,2);const txt=contentText(record);
    if(format==='json')return downloadBlob(new Blob([json],{type:'application/json;charset=utf-8'}),`${name}.json`);
    if(format==='txt')return downloadBlob(new Blob([txt],{type:'text/plain;charset=utf-8'}),`${name}.txt`);
    const zip=makeZip([{name:'content.txt',data:new TextEncoder().encode(txt)},{name:'content.json',data:new TextEncoder().encode(json)}]);
    downloadBlob(new Blob([zip],{type:'application/zip'}),`${name}.zip`);
  }
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function crc32(bytes){let crc=-1;for(const value of bytes){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^-1)>>>0}
  function makeZip(files){
    const encoder=new TextEncoder(),locals=[],centrals=[];let offset=0;
    for(const file of files){const name=encoder.encode(file.name),data=file.data,crc=crc32(data);const local=new Uint8Array(30+name.length+data.length),lv=new DataView(local.buffer);lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0,true);lv.setUint16(8,0,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);local.set(data,30+name.length);locals.push(local);const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.set(name,46);centrals.push(central);offset+=local.length}
    const centralSize=centrals.reduce((sum,row)=>sum+row.length,0),end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,files.length,true);view.setUint16(10,files.length,true);view.setUint32(12,centralSize,true);view.setUint32(16,offset,true);const output=new Uint8Array(offset+centralSize+end.length);let cursor=0;for(const part of [...locals,...centrals,end]){output.set(part,cursor);cursor+=part.length}return output;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
