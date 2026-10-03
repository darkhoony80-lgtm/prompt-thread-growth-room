const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../threads-coupas-auto.js'),'utf8');
const folderCode=source.slice(source.indexOf('async function inspectFolder('),source.indexOf('\nasync function connectFolder()'));
const statusCode=source.slice(source.indexOf('async function ensureThreadsConnected('),source.indexOf('\nasync function saveRecord('));

function folderHarness(handle){
  const nodes={coupasFolderBadge:{textContent:'',className:''},coupasFolderName:{textContent:''}};
  const context=vm.createContext({directoryHandle:handle,EXPECTED_FOLDER:'InstagramReels',$:id=>nodes[id],setMessage:()=>{}});
  vm.runInContext(folderCode,context);
  return {nodes,render:context.renderFolderState};
}

test('folder display uses the selected handle and verified children, never a fixed PC path',async()=>{
  const handle={name:'InstagramReels',async queryPermission(){return 'granted'},async *entries(){yield ['first',{kind:'directory'}];yield ['file.txt',{kind:'file'}];yield ['second',{kind:'directory'}]}};
  const {nodes,render}=folderHarness(handle);
  assert.equal(await render(),true);
  assert.equal(nodes.coupasFolderBadge.textContent,'폴더 연결됨');
  assert.match(nodes.coupasFolderName.textContent,/하위 폴더 2개 읽기 확인/);
  assert.match(nodes.coupasFolderName.textContent,/first, second/);
  assert.doesNotMatch(nodes.coupasFolderName.textContent,/C:\\Users/);
  assert.doesNotMatch(source,/EXPECTED_PATH/);
  assert.doesNotMatch(fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8'),/coupasFolderName">C:\\Users/);
});

test('folder is not marked connected when permission or actual read fails',async()=>{
  for(const handle of [
    {name:'InstagramReels',async queryPermission(){return 'prompt'}},
    {name:'InstagramReels',async queryPermission(){return 'granted'},async *entries(){throw new Error('missing folder')}},
    {name:'Other',async queryPermission(){return 'granted'}}
  ]){
    const {nodes,render}=folderHarness(handle);
    assert.equal(await render(),false);
    assert.notEqual(nodes.coupasFolderBadge.textContent,'폴더 연결됨');
  }
});

test('missing Threads browser session blocks before publishing',async()=>{
  let calls=0;
  const context=vm.createContext({fetch:async url=>{calls++;assert.equal(url,'/api/content-router?action=system_status');return {ok:true,async json(){return {threads:false}}}}});
  vm.runInContext(statusCode,context);
  await assert.rejects(context.ensureThreadsConnected(),/Threads 계정이 연결되지 않았습니다/);
  assert.equal(calls,1);
});

test('automatic run leaves folder jobs untouched when Threads session is missing',async()=>{
  const nodes=new Map(),calls=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',className:'',value:'1',disabled:false});
    return nodes.get(id);
  };
  const handle={name:'InstagramReels',async queryPermission(){return 'granted'},async *entries(){yield ['job-1',{kind:'directory',async getFileHandle(){const error=new Error('missing');error.name='NotFoundError';throw error}}]}};
  const context=vm.createContext({console,Date,URL,setTimeout,clearTimeout,setInterval,clearInterval,
    document:{getElementById:node,querySelector:()=>({value:'immediate'}),querySelectorAll:()=>[]},
    window:{showDirectoryPicker(){}},localStorage:{getItem:()=>null,setItem(){}},
    async fetch(url){calls.push(url);return {ok:true,async json(){return {threads:false}}}}
  });
  vm.runInContext(source.replace(/init\(\);\s*\}\)\(\);\s*$/,`window.test={start,setFolder(handle){directoryHandle=handle}};})();`),context);
  context.window.test.setFolder(handle);
  await context.window.test.start();
  assert.deepEqual(calls,['/api/content-router?action=system_status']);
  assert.equal(node('coupasStatus').textContent,'Threads 연결 필요');
  assert.match(node('coupasMessage').textContent,/Threads 계정이 연결되지 않았습니다/);
  assert.equal(node('coupasStart').disabled,false);
});
