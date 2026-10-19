const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const handler=require('../api/content-router.js');
async function request(action,{method='POST',auth=true,cookie='',body={}}={}){
  const req=Readable.from(method==='POST'?[Buffer.from(JSON.stringify(body))]:[]);
  req.method=method;req.query={action};req.headers={host:'test.example',...(auth?{'x-admin-token':'fixture-admin'}:{}),...(cookie?{cookie}:{})};
  const result={headers:{}};
  await handler(req,{setHeader(name,value){result.headers[name]=value},status(code){result.status=code;return this},json(body){result.body=body}});
  return result;
}
async function fixtures(run){
  const values={ADMIN_API_TOKEN:'fixture-admin',INSTAGRAM_ACCESS_TOKEN:'fixture-instagram',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
  const prior=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  const priorFetch=global.fetch;
  Object.assign(process.env,values);
  try{await run()}finally{global.fetch=priorFetch;for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value}}
}
test('authenticated POST reaches Instagram GET /me and reports real account response',()=>fixtures(async()=>{
  const calls=[];
  global.fetch=async(url,options)=>{calls.push([String(url),options]);return {ok:true,json:async()=>({user_id:'12345',username:'fixture_account',account_type:'BUSINESS'})}};
  const result=await request('instagram_status');
  assert.equal(result.status,200);assert.equal(result.body.connected,true);assert.equal(result.body.account.username,'fixture_account');
  assert.equal(calls.length,1);assert.match(calls[0][0],/^https:\/\/graph\.instagram\.com\/v\d+\.0\/me\?/);
  assert.equal(calls[0][1].method,'GET');assert.equal(result.headers['Cache-Control'],'no-store');
  assert.ok(!JSON.stringify(result).includes('fixture-instagram'));
}));
test('authenticated POST checks both Supabase service tables using read-only GET',()=>fixtures(async()=>{
  const calls=[];
  global.fetch=async(url,options)=>{calls.push([String(url),options]);return {ok:true,json:async()=>[]}};
  const result=await request('supabase_status');
  assert.equal(result.status,200);assert.equal(result.body.connected,true);
  assert.equal(calls.length,2);
  assert.ok(calls.some(([url])=>url.includes('instagram_prompt_posts?select=id&limit=1')));
  assert.ok(calls.some(([url])=>url.includes('instagram_prompt_deliveries?select=id&limit=1')));
  assert.ok(calls.every(([,options])=>options.method==='GET'));
  assert.ok(!JSON.stringify(result).includes('sb_secret_fixture'));
}));
test('anonymous POST remains blocked before either provider is called',()=>fixtures(async()=>{
  global.fetch=async()=>{throw new Error('provider must not be called')};
  for(const action of ['instagram_status','supabase_status']){
    const result=await request(action,{auth:false});assert.equal(result.status,401);assert.equal(result.body.error,'UNAUTHORIZED');
  }
}));
test('common router still rejects GET without making status routes public',()=>fixtures(async()=>{
  global.fetch=async()=>{throw new Error('provider must not be called')};
  for(const action of ['instagram_status','supabase_status'])assert.equal((await request(action,{method:'GET'})).status,405);
}));
test('browser admin login cookie authorizes POST status checks',()=>fixtures(async()=>{
  global.fetch=async()=>({ok:true,json:async()=>[]});
  const login=await request('admin_login',{auth:false,body:{token:'fixture-admin'}});
  assert.equal(login.status,200);
  const cookie=login.headers['Set-Cookie'].split(';')[0];
  const status=await request('supabase_status',{auth:false,cookie});assert.equal(status.status,200);assert.equal(status.body.connected,true);
}));
test('expired Instagram auth remains a provider error rather than a method conflict',()=>fixtures(async()=>{
  global.fetch=async()=>({ok:false,status:401,json:async()=>({error:{code:190,type:'OAuthException',message:'Expired fixture-instagram'}})});
  const result=await request('instagram_status');assert.equal(result.status,401);assert.equal(result.body.error,'INSTAGRAM_AUTH_FAILED');
  assert.ok(!JSON.stringify(result).includes('fixture-instagram'));
}));
test('Supabase query failure does not report connected',()=>fixtures(async()=>{
  global.fetch=async()=>({ok:false,status:403,json:async()=>({message:'Permission denied'})});
  const result=await request('supabase_status');assert.equal(result.status,502);assert.equal(result.body.connected,false);assert.equal(result.body.error,'SUPABASE_CONNECTION_FAILED');
}));
