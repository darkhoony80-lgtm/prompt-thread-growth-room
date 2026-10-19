const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {Blob}=require('node:buffer');
const context=vm.createContext({window:{},Date,console});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../coupas-share-sync.js'),'utf8'),context);
const copy=context.window.CoupasShareSync.copyPackages;
const NOW=Date.now(),OLD=NOW-60000;
const missing=()=>Object.assign(new Error('not found'),{name:'NotFoundError'});
class Dir{
  constructor(name='InstagramReels',parent=null){this.kind='directory';this.name=name;this.parent=parent;this.items=new Map();this.events=parent?.events||[];this.failName=''}
  async isSameEntry(other){return this===other}
  async resolve(other){const names=[];let node=other;while(node&&node!==this){names.unshift(node.name);node=node.parent}return node===this?names:null}
  async *entries(){if(this.unavailable)throw new Error('network unavailable');yield* this.items.entries()}
  async getDirectoryHandle(name,{create=false}={}){let entry=this.items.get(name);if(!entry&&create){entry=new Dir(name,this);this.items.set(name,entry)}if(!entry)throw missing();if(entry.kind!=='directory')throw new Error('type mismatch');return entry}
  async getFileHandle(name,{create=false}={}){
    let entry=this.items.get(name);
    if(!entry&&create){this.put(name,'');entry=this.items.get(name)}
    if(!entry)throw missing();if(entry.kind!=='file')throw new Error('type mismatch');return entry;
  }
  put(name,text,modified=OLD){
    const dir=this;
    const entry={kind:'file',name,data:text,modified,async getFile(){const blob=new Blob([entry.data]);blob.lastModified=entry.modified;return blob},async createWritable(){
      const chunks=[];
      const stream=new WritableStream({
        async write(value){if(dir.failName===name)throw new Error('connection lost');chunks.push(value)},
        async close(){entry.data=await new Blob(chunks).text();entry.modified=Date.now();dir.events.push(name)},
        async abort(){}
      });
      stream.write=async value=>{const writer=stream.getWriter();try{await writer.write(value)}finally{writer.releaseLock()}};
      stream.close=async()=>{const writer=stream.getWriter();try{await writer.close()}finally{writer.releaseLock()}};
      stream.abort=async()=>{};
      return stream;
    }};
    this.items.set(name,entry);return this;
  }
}
function fixture(){
  const source=new Dir(),target=new Dir();
  const job=new Dir('X_20261019_120000_123',source);source.items.set(job.name,job);
  job.put('content.json',JSON.stringify({schema_version:1,job_id:job.name,content:{rewritten_text:'번역 본문'},media:{video:'video.mp4',images:['image_01.jpg']}}));
  job.put('video.mp4','video-data').put('image_01.jpg','image-data').put('content.txt','원문/본문');
  job.put('.threads-coupas-status.json','{"status":"failed"}');
  return {source,target,job};
}
test('manual copy preserves package bytes, commits JSON last and never copies posting state',async()=>{
  const {source,target,job}=fixture();
  const result=await copy(source,target,{now:NOW});
  assert.equal(result.copied,1);assert.equal(result.failed,0);
  const out=await target.getDirectoryHandle(job.name);
  assert.equal(await (await out.getFileHandle('video.mp4')).getFile().then(file=>file.text()),'video-data');
  assert.equal(out.events.at(-1),'content.json');
  assert.ok(!out.items.has('.threads-coupas-status.json'));
  out.put('.threads-coupas-status.json','{"status":"published"}');
  const again=await copy(source,target,{now:NOW});
  assert.equal(again.skipped,1);assert.equal(again.copied,0);
  assert.equal(out.items.get('.threads-coupas-status.json').data,'{"status":"published"}');
});
test('network write failure leaves no publication JSON; explicit retry resumes owned partial package',async()=>{
  const {source,target,job}=fixture();
  const out=await target.getDirectoryHandle(job.name,{create:true});out.failName='video.mp4';
  const failed=await copy(source,target,{now:NOW});
  assert.equal(failed.failed,1);assert.equal(failed.copied,0);assert.ok(!out.items.has('content.json'));
  out.failName='';
  assert.equal((await copy(source,target,{now:NOW})).copied,1);
  assert.equal(out.items.get('video.mp4').data,'video-data');
});
test('unrelated target files, changed metadata and posting history are not overwritten',async()=>{
  for(const kind of ['unrelated','published','different']){
    const {source,target,job}=fixture(),out=await target.getDirectoryHandle(job.name,{create:true});
    if(kind==='unrelated')out.put('keep.txt','keep');
    if(kind==='published')out.put('.threads-coupas-status.json','{"status":"published"}');
    if(kind==='different')out.put('content.json','{"other":true}');
    const before=[...out.items].map(([name,item])=>[name,item.data]);
    const result=await copy(source,target,{now:NOW});
    assert.equal(result.failed,1);
    assert.deepEqual([...out.items].map(([name,item])=>[name,item.data]),before);
  }
});
test('self-copy and nested source/target are blocked before writes',async()=>{
  const source=new Dir();const child=await source.getDirectoryHandle('child',{create:true});
  for(const [a,b] of [[source,source],[source,child],[child,source]])await assert.rejects(copy(a,b),/서로 다른 폴더/);
});
test('unfinished and recently changed source packages wait without creating destination jobs',async()=>{
  for(const kind of ['missing','recent','invalid']){
    const {source,target,job}=fixture();
    if(kind==='missing')job.items.delete('video.mp4');
    if(kind==='recent')job.items.get('video.mp4').modified=NOW;
    if(kind==='invalid')job.items.get('content.json').data='{';
    const result=await copy(source,target,{now:NOW});
    assert.equal(result.pending,1);assert.equal(target.items.size,0);
  }
});
test('unavailable shared root fails instead of reporting zero-copy success',async()=>{
  const {source,target}=fixture();target.unavailable=true;
  await assert.rejects(copy(source,target),/network unavailable/);
});
test('file change during copy blocks publication JSON',async()=>{
  const {source,target,job}=fixture();let changed=false;
  const result=await copy(source,target,{now:NOW,onProgress:text=>{if(!changed&&text.includes('video.mp4')){changed=true;job.items.get('video.mp4').modified++}}});
  assert.equal(result.failed,1);assert.ok(!(await target.getDirectoryHandle(job.name)).items.has('content.json'));
});
test('unsafe metadata paths are rejected before creating destination content',async()=>{
  const {source,target,job}=fixture();
  job.items.get('content.json').data=JSON.stringify({content:{},media:{video:'../outside.mp4',images:[]}});
  const result=await copy(source,target,{now:NOW});
  assert.equal(result.failed,1);assert.equal(target.items.size,0);
});
