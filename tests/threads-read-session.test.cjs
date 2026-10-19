const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
async function fixture(run){
 const prior=process.env.THREADS_APP_SECRET,priorFetch=global.fetch;
 process.env.THREADS_APP_SECRET='fixture-threads-secret';
 const lib=await import(pathToFileURL(path.join(__dirname,'../lib-threads-session.js')));
 const posts=(await import(pathToFileURL(path.join(__dirname,'../api/threads/my-posts.js')))).default;
 const comments=(await import(pathToFileURL(path.join(__dirname,'../api/threads/comments.js')))).default;
 const request=async(handler,session,query={})=>{
  const result={headers:{}};
  const cookie=session?'pt_threads_session='+encodeURIComponent(lib.encodeSession(session)):'';
  await handler({method:'GET',query,headers:{cookie}},{setHeader(k,v){result.headers[k]=v},status(code){result.status=code;return this},json(body){result.body=body}});
  return result;
 };
 try{await run({posts,comments,request})}finally{global.fetch=priorFetch;if(prior===undefined)delete process.env.THREADS_APP_SECRET;else process.env.THREADS_APP_SECRET=prior}
}
const session=()=>({userId:'12345',accessToken:'fixture-old-token',tokenType:'long_lived',expiresAt:Date.now()+2*86400000});
test('both comments and insights refresh near-expiry sessions before their read requests',()=>fixture(async({posts,comments,request})=>{
 for(const handler of [posts,comments]){
  const calls=[];
  global.fetch=async raw=>{
   const url=new URL(raw);calls.push(url);
   if(url.pathname==='/refresh_access_token')return {ok:true,json:async()=>({access_token:'fixture-fresh-token',expires_in:5184000})};
   assert.equal(url.searchParams.get('access_token'),'fixture-fresh-token');
   if(url.pathname==='/v1.0/me')return {ok:true,status:200,json:async()=>({id:'12345',username:'fixture_account'})};
   return {ok:true,status:200,json:async()=>({data:[]})};
  };
  const result=await request(handler,session(),{mode:'insights',days:'7'});
  assert.equal(result.status,200);assert.equal(result.body.ok,true);
  assert.equal(calls[0].pathname,'/refresh_access_token');assert.match(result.headers['Set-Cookie'],/^pt_threads_session=/);
 }
}));
test('expired non-refreshable or absent sessions return 401 without querying Meta',()=>fixture(async({posts,comments,request})=>{
 global.fetch=async()=>{throw new Error('must not request provider')};
 for(const handler of [posts,comments]){
  for(const value of [null,{...session(),tokenType:'short_lived',expiresAt:Date.now()-1000}]){
   const result=await request(handler,value);
   assert.equal(result.status,401);assert.equal(result.body.error,'THREADS_NOT_CONNECTED');
  }
 }
}));
test('healthy read sessions do not refresh; provider auth errors stay distinguishable',()=>fixture(async({posts,comments,request})=>{
 for(const handler of [posts,comments]){
  global.fetch=async raw=>{assert.ok(!String(raw).includes('/refresh_access_token'));return {ok:false,status:401,json:async()=>({error:{code:190,message:'Expired token'}})}};
  const result=await request(handler,{...session(),expiresAt:Date.now()+30*86400000});
  assert.equal(result.status,502);assert.equal(result.body.error,'THREADS_ME_FAILED');
 }
}));
function browserHarness(fetch){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const functionText=name=>{
  const start=html.indexOf((name==='syncReplies'?'async ':'')+'function '+name+'(');
  return html.slice(start,html.indexOf('\n}',start)+2);
 };
 const nodes={replyCount:{},repliesList:{}};
 const context=vm.createContext({fetch,window:{_replyItems:[{id:'old'}],_replyHistoryAvailable:true},document:{getElementById:id=>nodes[id]},esc:String,updateBatchButton(){context.disabled=true},renderReplies(value){context.rendered=value}});
 vm.runInContext(functionText('threadsReadError')+'\n'+functionText('syncReplies'),context);
 return {context,nodes};
}
test('comments errors are visible and clear stale reply actions even when caller catches rejection',async()=>{
 const {context,nodes}=browserHarness(async()=>({ok:false,json:async()=>({error:'THREADS_NOT_CONNECTED'})}));
 await context.syncReplies().catch(()=>{});
 assert.equal(context.window._replyItems.length,0);assert.equal(context.window._replyHistoryAvailable,false);assert.equal(context.disabled,true);
 assert.equal(nodes.replyCount.textContent,'조회 실패');assert.match(nodes.repliesList.innerHTML,/관리자 로그인과 Threads 계정 연결은 별도/);
});
test('comments query succeeds independently from post listing',async()=>{
 const {context}=browserHarness(async url=>{assert.equal(url,'/api/threads/comments');return {ok:true,json:async()=>({ok:true,count:1,items:[{id:'reply1'}]})}});
 const result=await context.syncReplies();assert.equal(result.count,1);assert.equal(context.rendered.items[0].id,'reply1');
});
