const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandler,STORE_ID,PROJECT_ID,RETENTION_MS}=require('../lib/weekly-blob-cleanup.cjs');
const NOW=Date.parse('2026-10-21T00:00:00Z');
const env={CRON_SECRET:'test-only-secret',VERCEL_ENV:'production',VERCEL_PROJECT_ID:PROJECT_ID,BLOB_STORE_ID:STORE_ID};
const old=(name='content-master/temp-example/old.mp4',uploadedAt=new Date(NOW-RETENTION_MS-1))=>({pathname:name,url:`https://test.public.blob.vercel-storage.com/${name}`,uploadedAt,size:123,etag:'version-1'});
function setup(pages,options={}){
  const calls={list:[],del:[],loads:0};let index=0;
  const handler=createHandler({env:{...env,...options.env},now:()=>NOW,log:{info(){},error(){}},loadBlob:async()=>{calls.loads++;return {list:async args=>{calls.list.push(args);const page=pages[index++];if(page instanceof Error)throw page;return page},del:async(...args)=>{calls.del.push(args);if(options.deleteError)throw options.deleteError}}}});
  return {calls,async run(query={},headers={authorization:`Bearer ${env.CRON_SECRET}`},method='GET'){
    const res={headers:{},setHeader(key,value){this.headers[key]=value},status(status){this.statusCode=status;return this},json(body){this.body=body;return this}};
    await handler({method,headers,query},res);return res;
  }};
}
test('missing/wrong auth and wrong method never access Blob',async()=>{
  const s=setup([]);
  assert.equal((await s.run({},{})).statusCode,401);
  assert.equal((await s.run({},{authorization:'Bearer wrong'})).statusCode,401);
  assert.equal((await s.run({},undefined,'POST')).statusCode,405);
  assert.equal(s.calls.loads,0);
  const missing=setup([],{env:{CRON_SECRET:''}});
  assert.equal((await missing.run()).statusCode,401);
});
test('preview, wrong project and wrong store fail closed',async()=>{
  for(const mismatch of [{VERCEL_ENV:'preview'},{VERCEL_PROJECT_ID:'other'},{BLOB_STORE_ID:'store_other'}]){
    const s=setup([],{env:mismatch});assert.equal((await s.run()).statusCode,503);assert.equal(s.calls.loads,0);
  }
});
test('dry run lists all files and never deletes',async()=>{
  const s=setup([{blobs:[old()],hasMore:false}]);const r=await s.run({dry_run:'1'});
  assert.equal(r.statusCode,200);assert.equal(r.body.eligible,1);assert.equal(r.body.deleted,0);
  assert.equal(r.body.files[0].pathname,'content-master/temp-example/old.mp4');
  assert.equal(s.calls.del.length,0);assert.equal(s.calls.list[0].storeId,STORE_ID);
  assert.equal(r.headers['Cache-Control'],'no-store');
});
test('seven day cutoff preserves newer/future/invalid dates and unknown paths',async()=>{
  const s=setup([{blobs:[old(),old('threads-growth/boundary.jpg',new Date(NOW-RETENTION_MS)),old('content-master/new.mov',new Date(NOW-RETENTION_MS+1)),old('content-master/future.png',new Date(NOW+1)),old('content-master/bad.webp','not-a-date'),old('content-master/missing.jpg',null),old('unrelated/old.jpg'),old('content-master/document.json'),{...old('content-master/unsafe.jpg'),url:'https://example.com/content-master/unsafe.jpg'}],hasMore:false}]);
  const r=await s.run();assert.equal(r.body.scanned,9);assert.equal(r.body.deleted,2);
  assert.deepEqual(s.calls.del.map(x=>x[0]),[old().url,old('threads-growth/boundary.jpg').url]);
  assert.deepEqual(s.calls.del[0][1],{storeId:STORE_ID,ifMatch:'version-1'});
});
test('all pages are gathered before deletion, cursor is forwarded',async()=>{
  const s=setup([{blobs:[old('instagram-carousel/a.jpg')],hasMore:true,cursor:'page-2'},{blobs:[old('instagram-webtoon-cuts/b.jpg')],hasMore:false}]);
  const r=await s.run();assert.equal(r.body.deleted,2);assert.equal(s.calls.list[1].cursor,'page-2');
});
test('later list failure or cursor loop never deletes a partial inventory',async()=>{
  for(const next of [new Error('offline'),{blobs:[],hasMore:true,cursor:'same'}]){
    const s=setup([{blobs:[old()],hasMore:true,cursor:'same'},next]);assert.equal((await s.run()).statusCode,502);assert.equal(s.calls.del.length,0);
  }
});
test('missing ETag and concurrently overwritten object are retained',async()=>{
  const noTag=setup([{blobs:[{...old(),etag:undefined}],hasMore:false}]);assert.equal((await noTag.run()).body.deleted,0);
  const e=Object.assign(new Error('changed'),{name:'BlobPreconditionFailedError'});
  const changed=setup([{blobs:[old()],hasMore:false}],{deleteError:e});assert.equal((await changed.run()).body.deleted,0);
});
test('empty store succeeds and unknown delete errors are not reported as success',async()=>{
  const empty=setup([{blobs:[],hasMore:false}]);assert.equal((await empty.run()).body.deleted,0);
  const broken=setup([{blobs:[old()],hasMore:false}],{deleteError:new Error('private-provider-error')});const r=await broken.run();
  assert.equal(r.statusCode,502);assert.equal(r.body.deleted,0);assert.equal(JSON.stringify(r.body).includes('private-provider-error'),false);
});
test('only the weekly cron is added, existing routes remain unchanged',()=>{
  const config=require('../vercel.json');assert.deepEqual(config.crons,[{path:'/api/content-router?action=weekly_blob_cleanup',schedule:'0 19 * * 6'}]);
  assert.equal(config.cleanUrls,true);assert.equal(config.rewrites.length,3);
  assert.equal(require('node:fs').readFileSync(require.resolve('../post-auto-v1.js'),'utf8').includes('LocalMedia.sweep('),false);
});
test('cron uses existing router and cannot bypass its separate bearer authentication',async()=>{
  const handler=require('../api/content-router.js');
  const res={setHeader(){},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};
  await handler({method:'GET',query:{action:'weekly_blob_cleanup'},headers:{}},res);
  assert.equal(res.statusCode,401);
  await handler({method:'GET',query:{},headers:{}},res);
  assert.equal(res.statusCode,405);
});
test('publishing reuploads expired remote media from local original without head polling',async()=>{
  const source=require('node:fs').readFileSync(require.resolve('../local-media.js'),'utf8');
  const uploadSource=source.slice(source.indexOf('async function upload(url)'),source.indexOf('const payloadUrls='))
    .replace("await import('https://esm.sh/@vercel/blob@2.8.0/client?bundle')",'mockModule');
  for(const [uploadedAt,expectedUploads] of [[new Date(NOW-3600000).toISOString(),0],[new Date(NOW-RETENTION_MS).toISOString(),1],[new Date(NOW-RETENTION_MS+30000).toISOString(),1],[undefined,1]]){
    let uploads=0;
    const row={remote_url:'https://old.public.blob.vercel-storage.com/old.mp4',uploaded_at:uploadedAt,upload_state:'uploaded',mime:'video/mp4',size:1,file:Buffer.from('x')};
    const upload=require('node:vm').runInNewContext('('+uploadSource+')',{
      Date:class extends Date{static now(){return NOW}},inflight:new Map(),aliases:()=>({'blob:test':'id'}),locked:async(id,work)=>work(),get:async()=>row,owner:()=> 'owner',put:async()=>{},preview:()=>{},api:async()=>({pathname:'content-master/new.mp4',intent:'new-intent'}),
      mockModule:{uploadPresigned:async()=>{uploads++;return {url:'https://new.public.blob.vercel-storage.com/new.mp4'}}}
    });
    const result=await upload('blob:test');assert.equal(uploads,expectedUploads);assert.equal(result,expectedUploads?'https://new.public.blob.vercel-storage.com/new.mp4':'https://old.public.blob.vercel-storage.com/old.mp4');
  }
});

