// Manual Windows integration check; isolated Chrome/OPFS, never user/shared folders.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const script=fs.readFileSync(path.join(__dirname,'../coupas-share-sync.js'),'utf8');
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/sync.js'){res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(script)}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><div id="anchor"></div><script src="/sync.js"></script>')}});
let chrome,socket;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'coupas-checkpoint-'));
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const debuggerUrl=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Chrome timeout')),15000);chrome.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1])}});chrome.once('error',reject)});
  socket=new WebSocket(debuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const response=JSON.parse(event.data);const item=pending.get(response.id);if(!item)return;pending.delete(response.id);response.error?item.reject(new Error(JSON.stringify(response.error))):item.resolve(response.result)});
  const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
  const {targetId}=await cdp('Target.createTarget',{url:`http://127.0.0.1:${server.address().port}/`});
  const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  async function evaluate(expression){const response=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));return response.result.value}
  async function ready(){for(let i=0;i<50;i++){if(await evaluate('!!window.CoupasShareSync'))return;await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('Script not loaded')}
  await ready();
  const setup=`
    const storage=await navigator.storage.getDirectory();
    const from=await storage.getDirectoryHandle('from',{create:true}),to=await storage.getDirectoryHandle('to',{create:true});
    const source=await from.getDirectoryHandle('InstagramReels',{create:true}),target=await to.getDirectoryHandle('InstagramReels',{create:true});
    const originalNow=Date.now;Date.now=()=>originalNow()+60000;
    async function write(dir,name,text){const handle=await dir.getFileHandle(name,{create:true});const out=await handle.createWritable();await out.write(text);await out.close();}
    async function job(name){const dir=await source.getDirectoryHandle(name,{create:true});await write(dir,'video.mp4','test-media');await write(dir,'content.json',JSON.stringify({content:{rewritten_text:name},media:{video:'video.mp4',images:[]}}));}
    let oldReads=0;const getFile=FileSystemDirectoryHandle.prototype.getFileHandle;
    FileSystemDirectoryHandle.prototype.getFileHandle=function(...args){if(this.name.includes('_old'))oldReads++;return getFile.apply(this,args)};
    window.showDirectoryPicker=async()=>target;
    window.CoupasShareSync.mount({anchor:document.getElementById('anchor'),getSource:()=>source,isBusy:()=>false,onBusy:()=>{}});
  `;
  const first=await evaluate(`(async()=>{${setup}await job('TH_20261020_100000_old');await job('X_20261020_110000_old');await document.getElementById('coupasShareTarget').onclick();await document.getElementById('coupasShareSync').onclick();return {status:document.getElementById('coupasShareResult').textContent,oldReads};})()`);
  assert.match(first.status,/복사 2개/);assert.ok(first.oldReads>0);
  await cdp('Page.reload',{},sessionId);await new Promise(resolve=>setTimeout(resolve,150));await ready();
  const second=await evaluate(`(async()=>{${setup}await new Promise(resolve=>setTimeout(resolve,50));await job('IG_20261019_090000_late');await document.getElementById('coupasShareSync').onclick();const resumed={status:document.getElementById('coupasShareResult').textContent,oldReads};await document.getElementById('coupasShareFull').onclick();return {resumed,full:{status:document.getElementById('coupasShareResult').textContent,oldReads}};})()`);
  assert.match(second.resumed.status,/복사 1개/);assert.match(second.resumed.status,/완료 기억 2개 생략/);assert.equal(second.resumed.oldReads,0);
  assert.match(second.full.status,/기존 동일 3개/);assert.ok(second.full.oldReads>0);
  console.log(JSON.stringify({ok:true,first,afterReload:second,scope:'temporary OPFS only'},null,2));
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{socket?.close();chrome?.kill();server.close()});
