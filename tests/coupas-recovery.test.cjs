const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../threads-coupas-auto.js'),'utf8');
const row=(name,error='UNAUTHORIZED',extra={})=>({job_id:name,folder_name:name,status:'failed',error,retry_count:2,updated_at:'2026-09-29T00:00:00.000Z',...extra});
function harness(rows,{local=rows,authenticated=true,confirm=true,writeFailure='',closeFailure='',broken='',permission='granted'}={}){
  const disks=new Map(rows.map(r=>[r.folder_name,structuredClone(r)])),nodes=new Map(),calls=[],writes=[];
  let storage=JSON.stringify(local),confirmCount=0;
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',disabled:false,value:'1',className:'',closest:()=>({hidden:false})});
    return nodes.get(id);
  };
  const folder=name=>({kind:'directory',async getFileHandle(){return {
    async getFile(){return {async text(){return name===broken?'invalid JSON':JSON.stringify(disks.get(name))}}},
    async createWritable(){let staged;return {
      async write(text){if(name===writeFailure)throw new Error('disk full');staged=JSON.parse(text)},
      async close(){if(name===closeFailure)throw new Error('close failed');disks.set(name,staged);writes.push(name)},
      async abort(){}
    }}
  }}});
  const directory={name:'InstagramReels',async queryPermission(){return permission},async requestPermission(){return permission},
    async *entries(){for(const name of disks.keys())yield [name,folder(name)]},
    async getDirectoryHandle(name){if(!disks.has(name))throw new Error('missing');return folder(name)}
  };
  const ctx=vm.createContext({console,URL,Date,setTimeout,clearTimeout,setInterval,clearInterval,
    document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>({value:'immediate'})},
    window:{},localStorage:{getItem:()=>storage,setItem:(key,value)=>{storage=value}},
    confirm:()=>{confirmCount++;return confirm},
    async fetch(url){calls.push(url);assert.equal(url,'/api/content-router?action=admin_status');return {ok:true,async json(){return {authenticated}}}}
  });
  vm.runInContext(source.replace(/init\(\);\s*\}\)\(\);\s*$/,`window.test={recoverFailedFolders,isRecoverableFailure,listCandidateFolders,start,connectFolder,loadHistory,
    setup(d){directoryHandle=d},busy(value){running=value},pending(){return historyActionPending},history(){return history}};})();`),ctx);
  const api=ctx.window.test;api.setup(directory);
  return {api,disks,calls,writes,node,ctx,get local(){return JSON.parse(storage)},get confirmCount(){return confirmCount}};
}
test('only known pre-publication auth/upload errors are eligible',()=>{
  const h=harness([]);
  for(const error of ['UNAUTHORIZED','운영실 관리자 인증이 필요합니다.','Vercel Blob: Failed to retrieve the presigned URL','CONTENT_MASTER_MEDIA_UPLOAD_FAILED','Threads 미디어 업로드 실패: upload failed'])assert.equal(h.api.isRecoverableFailure(row('a',error)),true,error);
  for(const error of ['JSON 파싱 실패','Threads 본문 게시 실패: timeout','Threads 2/2 링크 게시 실패: UNAUTHORIZED','쿠팡 원본 링크 없음','NETWORK_ERROR'])assert.equal(h.api.isRecoverableFailure(row('a',error)),false,error);
  for(const extra of [{status:'published'},{status:'processing'},{status:'post_published_reply_failed'},{status:'post_published_link_pending'},{threads_post_id:'123'},{threads_post_url:'https://threads.com/post/123'},{reply_id:'456'}])assert.equal(h.api.isRecoverableFailure(row('a','UNAUTHORIZED',extra)),false);
});
test('batch recovery persists pending to disk and localStorage without posting and makes folders eligible',async()=>{
  const h=harness([row('a'),row('b','Vercel Blob: Failed to retrieve the presigned URL'),row('c','JSON 파싱 실패'),row('d','UNAUTHORIZED',{status:'published',threads_post_id:'123'})]);
  await h.api.recoverFailedFolders();
  assert.deepEqual(h.writes,['a','b']);
  assert.equal(h.disks.get('a').status,'pending');
  assert.equal(h.local.find(r=>r.job_id==='a').status,'pending');
  assert.equal(h.disks.get('a').retry_count,2);
  assert.equal(h.disks.get('a').error,null);
  assert.equal(h.disks.get('d').threads_post_id,'123');
  assert.deepEqual(Array.from(await h.api.listCandidateFolders(),x=>x.name),['a','b']);
  assert.deepEqual(h.calls,['/api/content-router?action=admin_status']);
  assert.match(h.node('coupasMessage').textContent,/대기 복구 2개/);
  await h.api.recoverFailedFolders();
  assert.equal(h.writes.length,2);
});
test('older published evidence in either store prevents recovery even if newest record says failed',async()=>{
  for(const publishedOnDisk of [true,false]){
    const published=row('a','UNAUTHORIZED',{status:'published',threads_post_id:'123',updated_at:'2026-09-28T00:00:00.000Z'});
    const failed=row('a');
    const h=harness([publishedOnDisk?published:failed],{local:[publishedOnDisk?failed:published]});
    await h.api.recoverFailedFolders();
    assert.equal(h.writes.length,0);
    assert.match(h.node('coupasMessage').textContent,/안전 제외 1개/);
  }
});
test('corrupt status and mismatched job identity are not reset',async()=>{
  const h=harness([row('a'),row('b','UNAUTHORIZED',{job_id:'another-job'})],{local:[row('a'),row('b')],broken:'a'});
  await h.api.recoverFailedFolders();
  assert.equal(h.writes.length,0);
});
test('write/close failure leaves failed state in both stores and does not block other recovery',async()=>{
  for(const key of ['writeFailure','closeFailure']){
    const h=harness([row('a'),row('b')],{[key]:'a'});
    await h.api.recoverFailedFolders();
    assert.equal(h.disks.get('a').status,'failed');
    assert.equal(h.local.find(r=>r.job_id==='a').status,'failed');
    assert.equal(h.disks.get('b').status,'pending');
    assert.match(h.node('coupasMessage').textContent,/저장\/확인 실패 1개/);
  }
});
test('cancel, invalid auth, denied permission and active publishing cause no recovery',async()=>{
  for(const options of [{confirm:false},{authenticated:false},{permission:'denied'}]){
    const h=harness([row('a')],options);await h.api.recoverFailedFolders();assert.equal(h.writes.length,0);
    assert.equal(h.api.pending(),false);
  }
  const h=harness([row('a')]);h.api.busy(true);await h.api.recoverFailedFolders();assert.equal(h.calls.length,0);
});
test('double recovery and start/folder change during recovery cannot launch other work',async()=>{
  const h=harness([row('a')]);
  const first=h.api.recoverFailedFolders();
  assert.equal(h.api.pending(),true);
  await h.api.recoverFailedFolders();await h.api.start();await h.api.connectFolder();
  await first;
  assert.equal(h.confirmCount,1);assert.deepEqual(h.writes,['a']);assert.equal(h.calls.length,1);
  assert.equal(h.node('coupasStart').disabled,false);
});
