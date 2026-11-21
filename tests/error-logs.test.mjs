import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectLogs,groupLogs,writeLog,applyAssignments} from '../dist/error-logs.mjs';
import {createGroupingHandler} from '../lib/error-log-grouping.mjs';
const bank={q1:{id:'q1'},q2:{id:'q2'}};
const session=rows=>({id:'test-1',name:'Practice',ended:1,rows});
test('logs persist in history, keep original wording, and group by normalized type',()=>{
  const a={id:'q1'},b={id:'q2'};
  writeLog(a,"I didn't understand the text",'Reading comprehension');
  writeLog(b,"Couldn't follow the passage",' reading   COMPREHENSION ');
  const entries=collectLogs(JSON.parse(JSON.stringify([session([a,b])])),bank);
  assert.equal(groupLogs(entries).length,1);
  assert.equal(groupLogs(entries)[0].entries.length,2);
  assert.equal(entries[0].text,"I didn't understand the text");
});
test('legacy reasons are visible, empty logs are excluded, and missing questions are skipped',()=>{
  const entries=collectLogs([session([{id:'q1',reason:'Knowledge gap'},{id:'q2',reason:'Not specified'},{id:'gone',errorLog:'oops'}])],bank);
  assert.equal(entries.length,1);assert.equal(entries[0].type,'Knowledge gap');
});
test('clearing removes both custom and old dropdown logs',()=>{
  const row={id:'q1',reason:'Rushed the answer'};
  writeLog(row,'wrong wording','Prompt');writeLog(row,'  ');
  assert.equal(collectLogs([session([row])],bank).length,0);
});
test('AI only changes types, protects manual choices, and ignores stale edits',()=>{
  const a={id:'q1'},b={id:'q2'};writeLog(a,'text was unclear');writeLog(b,'also unclear','My type');
  const entries=collectLogs([session([a,b])],bank);
  assert.equal(applyAssignments(entries,entries.map(e=>({id:e.key,type:'Passage comprehension'}))),1);
  assert.equal(a.errorLog,'text was unclear');assert.equal(a.errorType,'Passage comprehension');assert.equal(b.errorType,'My type');
  writeLog(a,'new cause');assert.equal(applyAssignments(entries,[{id:entries[0].key,type:'Wrong stale group'}]),0);
});
test('repeated questions in separate tests remain distinct attempts',()=>{
  const entries=collectLogs([session([{id:'q1',errorLog:'x'}]),{...session([{id:'q1',errorLog:'x'}]),id:'test-2'}],bank);
  assert.equal(new Set(entries.map(e=>e.key)).size,2);
});
test('oversized custom logs and categories are rejected',()=>{
  assert.throws(()=>writeLog({},'a'.repeat(2001)));assert.throws(()=>writeLog({},'a','b'.repeat(101)));
});
const request=(body,token='valid')=>new Request('https://qbank.test/api/error-log-groups',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
const payload={logs:[{id:'one',text:'did not understand'},{id:'two',text:'could not understand text'}],types:[]};
const env={GOOGLE_GENERATIVE_AI_API_KEY:'test-only'};
test('endpoint rejects unauthenticated callers before running Gemini',async()=>{
  let calls=0;const handler=createGroupingHandler({env,authenticate:async()=>null,generate:async()=>{calls++;}});
  assert.equal((await handler(request(payload,''))).status,401);assert.equal((await handler(request(payload))).status,401);assert.equal(calls,0);
});
test('missing API key does not lose logs or invoke Gemini',async()=>{
  const handler=createGroupingHandler({env:{},authenticate:async()=>({id:'user'}),generate:()=>assert.fail()});
  const response=await handler(request(payload));assert.equal(response.status,503);assert.match((await response.json()).error,/saved/);
});
test('endpoint validates input, output coverage, duplicate IDs, and size limits',async()=>{
  let calls=0;const handler=createGroupingHandler({env,authenticate:async()=>({id:'user'}),generate:async()=>{calls++;return {assignments:[{id:'one',type:'Reading'}]};}});
  assert.equal((await handler(request({logs:[]}))).status,400);
  assert.equal((await handler(request({logs:[payload.logs[0],payload.logs[0]]}))).status,400);
  assert.equal((await handler(request({logs:[{id:'one',text:'a'.repeat(2001)}]}))).status,400);
  assert.equal(calls,0);assert.equal((await handler(request(payload))).status,502);
});
test('endpoint returns validated semantic grouping without leaking the key',async()=>{
  const handler=createGroupingHandler({env,authenticate:async()=>({id:'user'}),generate:async input=>({assignments:input.logs.map(log=>({id:log.id,type:'Passage comprehension'}))})});
  const response=await handler(request(payload));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.equal(body.assignments.length,2);assert.equal(new Set(body.assignments.map(a=>a.type)).size,1);assert.doesNotMatch(JSON.stringify(body),/test-only/);
});
test('provider failure yields a recoverable error; method is restricted',async()=>{
  const handler=createGroupingHandler({env,authenticate:async()=>({id:'user'}),generate:async()=>{throw Error('secret-provider-details');}});
  const response=await handler(request(payload));assert.equal(response.status,502);assert.doesNotMatch(JSON.stringify(await response.json()),/secret-provider-details/);
  assert.equal((await handler(new Request('https://qbank.test/api/error-log-groups'))).status,405);
});
test('installed Gemini SDK processes a structured response using the real server integration',async()=>{
  const originalFetch=globalThis.fetch;let sent;
  globalThis.fetch=async(url,options)=>{
    assert.match(String(url),/generativelanguage.googleapis.com/);
    sent=JSON.parse(options.body);
    return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({assignments:payload.logs.map(log=>({id:log.id,type:'Passage comprehension'}))})}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:20,totalTokenCount:40}});
  };
  try{
    const handler=createGroupingHandler({env,authenticate:async()=>({id:'user'})});
    const response=await handler(request(payload));assert.equal(response.status,200);
    assert.equal((await response.json()).assignments.length,2);
    assert.match(JSON.stringify(sent),/did not understand/);
  }finally{globalThis.fetch=originalFetch;}
});
test('error log fields survive account upload and a fresh device load',async()=>{
  const {AccountStore}=await import('../dist/account-store.mjs');
  const saved=new Map();
  const client={from(table){return {
    select(){return this;},eq(){return this;},order(){return this;},range(){return this;},maybeSingle(){return this;},
    upsert(value){saved.set(value.id,structuredClone(value));return this;},
    then(resolve,reject){return Promise.resolve({data:table==='qbank_sessions'?[...saved.values()]:null,error:null}).then(resolve,reject);}
  };}};
  const cache=new Map(),storage={getItem:key=>cache.get(key)||null,setItem:(key,value)=>cache.set(key,value)};
  const first=new AccountStore({client,userId:'student',storage});
  await first.load();const row={id:'q1'};writeLog(row,'I did not understand the text','Comprehension');
  first.save({history:[session([row])],active:null});assert.equal(await first.flush(),true);first.dispose();
  const second=new AccountStore({client,userId:'student',storage});
  try{const loaded=await second.load();assert.equal(loaded.history[0].rows[0].errorLog,row.errorLog);assert.equal(loaded.history[0].rows[0].errorType,'Comprehension');}finally{second.dispose();}
});
