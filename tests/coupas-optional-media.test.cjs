const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../threads-coupas-auto.js'),'utf8');
function harness({video=null,images=[],link='',missingVideo=false,permissionError=false,matchError=false,replyError=false,prior=null}={}){
  const calls=[],uploads=[],saves=[];
  const data={job_id:'job',content:{rewritten_text:'테스트 본문',coupang_url:link},media:{video,images}};
  const folder={name:'job',handle:{async getFileHandle(name){
    if(name===video&&permissionError)throw Object.assign(new Error('permission'),{name:'NotAllowedError'});
    if(name===video&&missingVideo)throw Object.assign(new Error('missing'),{name:'NotFoundError'});
    return {async getFile(){return {name,async text(){return JSON.stringify(data)}}}};
  }}};
  const ctx=vm.createContext({URL,Date,console,window:{},document:{getElementById:()=>({textContent:''})},
    async fetch(url,options){calls.push({url,body:JSON.parse(options.body)});return {ok:true,async json(){return {id:'parent'}}}}
  });
  vm.runInContext(source.replace(/init\(\);\s*\}\)\(\);\s*$/,`window.test={readJob,processFolder,publishParent,listCandidateFolders,isLegacyMissingVideoFailure,isLegacyMissingCoupangUrlFailure,
    setup(options){history=options.prior?[options.prior]:[];uploadMedia=options.upload;saveRecord=options.save;adminApi=options.admin;publishLinkedPost=options.reply},
    records(rows){history=rows;directoryHandle={async *entries(){for(const r of rows)yield [r.folder_name,{kind:'directory'}]}}}};})();`),ctx);
  const api=ctx.window.test;
  api.setup({prior,
    async upload(job,file,type){uploads.push({file:file.name,type});return {type,url:'https://media.example/'+file.name}},
    async save(record){saves.push(record);return record},
    async admin(action){calls.push({action});if(action==='coupas_resolve_product'){if(matchError)throw new Error('COUPANG_PRODUCT_MATCH_FAILED');return {product_name:'상품',generated_coupang_url:'https://link.coupang.com/test'}}return {permalink:'https://threads.com/post/parent'}},
    async reply(id,url){calls.push({reply:id,url});if(replyError)throw new Error('reply failure');return 'reply'}
  });
  return {api,data,folder,calls,uploads,saves};
}
test('no MP4 and no link posts photos in order without product lookup or reply',async()=>{
  const h=harness({images:['a.jpg','b.jpeg']});
  const result=await h.api.processFolder(h.folder);
  assert.deepEqual(h.uploads.map(x=>x.file),['a.jpg','b.jpeg']);
  const request=h.calls.find(x=>x.url==='/api/threads/publish');
  assert.equal(request.body.text,'테스트 본문');assert.equal(request.body.media.length,2);
  assert.ok(!h.calls.some(x=>x.reply||x.action==='coupas_resolve_product'));
  assert.equal(result.status,'published');assert.equal(result.threads_post_url,'https://threads.com/post/parent');
});
test('no media metadata allows text-only publishing, with no Blob upload',async()=>{
  const h=harness();delete h.data.media;
  await h.api.processFolder(h.folder);
  assert.equal(h.uploads.length,0);
  assert.deepEqual(h.calls.find(x=>x.url==='/api/threads/publish').body.media,[]);
});
test('missing declared video falls back to images; video permission errors do not',async()=>{
  const h=harness({video:'video.mp4',images:['a.jpg'],missingVideo:true});
  await h.api.processFolder(h.folder);assert.deepEqual(h.uploads.map(x=>x.file),['a.jpg']);
  const denied=harness({video:'video.mp4',permissionError:true});
  await assert.rejects(denied.api.readJob(denied.folder),/동영상 파일 읽기 실패/);
  assert.equal(denied.calls.length,0);
});
test('existing video still precedes photos and missing link avoids disclosure',async()=>{
  const h=harness({video:'video.mp4',images:['a.jpg'],link:'   '});
  await h.api.processFolder(h.folder);
  assert.deepEqual(h.uploads.map(x=>x.file),['video.mp4','a.jpg']);
  assert.equal(h.calls.find(x=>x.url==='/api/threads/publish').body.text,'테스트 본문');
});
test('linked photo post still matches product and requires both posts for published',async()=>{
  const h=harness({images:['a.jpg'],link:'https://coupang.com/product'});
  const result=await h.api.processFolder(h.folder);
  assert.ok(h.calls.some(x=>x.action==='coupas_resolve_product'));
  assert.ok(h.calls.some(x=>x.reply==='parent'));
  assert.match(h.calls.find(x=>x.url==='/api/threads/publish').body.text,/쿠팡 파트너스/);
  assert.equal(result.status,'published');assert.equal(result.reply_id,'reply');
});
test('matching failure never falls back to unlinked publishing',async()=>{
  const h=harness({link:'https://coupang.com/product',matchError:true});
  await assert.rejects(h.api.processFolder(h.folder),/COUPANG_PRODUCT_MATCH_FAILED/);
  assert.ok(!h.calls.some(x=>x.url==='/api/threads/publish'));
});
test('reply-only retry never reads media or republishes the parent',async()=>{
  const h=harness({prior:{job_id:'job',folder_name:'job',status:'post_published_reply_failed',threads_post_id:'old-parent',generated_coupang_url:'https://link.coupang.com/test'}});
  h.folder.handle.getFileHandle=()=>{throw new Error('must not read media')};
  const result=await h.api.processFolder(h.folder);
  assert.equal(result.status,'published');assert.equal(h.uploads.length,0);
  assert.ok(h.calls.some(x=>x.reply==='old-parent'));
  assert.ok(!h.calls.some(x=>x.url==='/api/threads/publish'));
});
test('validation still rejects blank text, invalid MP4 and malformed images',async()=>{
  for(const change of [d=>d.content.rewritten_text='',d=>d.media.video='video.exe',d=>d.media.images='a.jpg']){
    const h=harness();change(h.data);await assert.rejects(h.api.readJob(h.folder));
  }
});
test('legacy missing-video failures become candidates, posted or unrelated failures do not',async()=>{
  const h=harness();
  const rows=[
    {folder_name:'a',status:'failed',error:'video.mp4 없음'},
    {folder_name:'b',status:'failed',error:'video.mp4 없음',threads_post_id:'posted'},
    {folder_name:'c',status:'failed',error:'JSON 파싱 실패'},
    {folder_name:'d',status:'failed',error:'쿠팡 원본 링크 없음'},
    {folder_name:'e',status:'published',error:'video.mp4 없음'}
  ];h.api.records(rows);
  assert.deepEqual(Array.from(await h.api.listCandidateFolders(),x=>x.name),['a','d']);
});
