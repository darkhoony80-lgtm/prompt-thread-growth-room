const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../threads-coupas-auto.js'),'utf8');
const start=source.indexOf('async function runIntervalAutomatic(');
const end=source.indexOf('\nasync function start()',start);
const context=vm.createContext({});vm.runInContext(source.slice(start,end),context);
const run=context.runIntervalAutomatic;

for(const minutes of [30,60,120])test(`${minutes}m: consecutive failures advance immediately; only success triggers interval`,async()=>{
  const events=[],folders=['fail1','fail2','success'].map(name=>({name}));
  await run({intervalMs:minutes*60000,isStopped:()=>false,
    async getNextFolder(excluded){return folders.find(f=>!excluded.has(f.name))},
    async process(folder){events.push(folder.name);return folder.name==='success'},
    async wait(ms){events.push(ms);return false}
  });
  assert.deepEqual(events,['fail1','fail2','success',minutes*60000]);
});
test('all failures are attempted once even if storage still lists them; empty queue waits',async()=>{
  const events=[];
  await run({intervalMs:1800000,isStopped:()=>false,
    async getNextFolder(excluded){return excluded.has('a')?null:{name:'a'}},
    async process(){events.push('failed');return false},
    async onNoFolder(){events.push('empty')},async wait(){events.push('wait');return false}
  });
  assert.deepEqual(events,['failed','empty','wait']);
});
test('new data after empty queue is picked up; success always waits again',async()=>{
  let hasNew=false,waits=0;const events=[];
  await run({intervalMs:100,isStopped:()=>false,async getNextFolder(){return hasNew?{name:'new'}:null},
    async process(){events.push('new');return true},async onNoFolder(){events.push('empty')},
    async wait(){events.push('wait');hasNew=true;return ++waits<2}
  });assert.deepEqual(events,['empty','wait','new','wait']);
});
test('stop during a failed item prevents the next item without waiting',async()=>{
  let stopped=false,processed=0;
  await run({intervalMs:100,isStopped:()=>stopped,async getNextFolder(){return {name:'a'}},
    async process(){processed++;stopped=true;return false},async wait(){assert.fail('must not wait')}
  });assert.equal(processed,1);
});
test('stop during waiting prevents the next publication',async()=>{
  let stopped=false,processed=0;
  await run({intervalMs:100,isStopped:()=>stopped,async getNextFolder(){return {name:'a'}},
    async process(){processed++;return true},async wait(){stopped=true;return false}
  });assert.equal(processed,1);
});
