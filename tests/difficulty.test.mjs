import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectTest,defaultCounts,BUCKETS,LEVELS,belongs,matchesDifficulty} from '../dist/engine.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/bank.json',import.meta.url)));
const math=JSON.parse(readFileSync(new URL('../dist/math-bank.json',import.meta.url)));
const byId=Object.fromEntries([...bank,...math].map(q=>[q.id,q]));
const picked=(config,questions=bank,history=[])=>selectTest(questions,history,config).ids.map(id=>byId[id]);
test('independent topic filters support hard Ideas/Craft and medium + hard Boundaries',()=>{
  const config={counts:{ideas:10,craft:10,conventions:10},skills:{conventions:['Boundaries']},difficulties:{ideas:['Hard'],craft:['Hard'],conventions:['Medium','Hard']}};
  for(let run=0;run<30;run++){
    const qs=picked(config);
    assert.equal(qs.length,30);assert.equal(new Set(qs.map(q=>q.id)).size,30);
    for(const domain of ['Information and Ideas','Craft and Structure']){
      const group=qs.filter(q=>q.domain===domain);assert.equal(group.length,10);
      assert.ok(group.every(q=>q.difficulty==='Hard'));
    }
    const boundaries=qs.filter(q=>q.skill==='Boundaries');assert.equal(boundaries.length,10);
    assert.ok(boundaries.every(q=>['Medium','Hard'].includes(q.difficulty)));
    assert.ok(boundaries.some(q=>q.difficulty==='Medium'));assert.ok(boundaries.some(q=>q.difficulty==='Hard'));
  }
});
test('each single level and every pair stay strict, including with automatic topics',()=>{
  for(const levels of [...LEVELS.map(l=>[l]),['Easy','Medium'],['Easy','Hard'],['Medium','Hard']]){
    const qs=picked({counts:{ideas:10,craft:10,transitions:3},difficulties:{ideas:levels}});
    assert.equal(qs.length,23);
    assert.ok(qs.filter(q=>q.domain==='Information and Ideas').every(q=>levels.includes(q.difficulty)));
  }
});
test('scarcity and empty selection never silently use excluded difficulties',()=>{
  const subset=bank.filter(q=>q.domain==='Information and Ideas'&&q.difficulty==='Hard').slice(0,2).concat(bank.filter(q=>q.difficulty==='Easy'));
  assert.throws(()=>picked({counts:{ideas:3},difficulties:{ideas:['Hard']}},subset),/2 available; 3 requested.*difficulty/);
  assert.throws(()=>picked({counts:{ideas:1},difficulties:{ideas:[]}}),/0 available/);
  assert.equal(picked({counts:{craft:3},difficulties:{ideas:[]}}).length,3);
});
test('question modes intersect with skill and difficulty filters',()=>{
  const q=bank.find(q=>q.skill==='Boundaries'&&q.difficulty==='Hard');
  const history=[{id:'previous',ended:1,mode:'exam',rows:[{id:q.id,answer:null,flag:true}]}];
  for(const pool of ['incorrect','marked']){
    assert.deepEqual(picked({pool,counts:{conventions:1},skills:{conventions:['Boundaries']},difficulties:{conventions:['Hard']}},bank,history).map(q=>q.id),[q.id]);
  }
  assert.ok(picked({pool:'unused',counts:{conventions:3},difficulties:{conventions:['Hard']}},bank,history).every(item=>item.id!==q.id));
});
test('default and explicit all-level tests keep exact quotas and automatic balance',()=>{
  for(const difficulties of [undefined,Object.fromEntries(BUCKETS.map(b=>[b.id,LEVELS]))]){
    const qs=picked({counts:defaultCounts(),difficulties});
    assert.equal(qs.length,30);
    for(const b of BUCKETS)assert.equal(qs.filter(q=>belongs(q,b)).length,b.defaultCount);
    for(const level of LEVELS)assert.ok(qs.some(q=>q.difficulty===level));
  }
});
test('Math supports its own difficulty filters and UWorld remains unrated',()=>{
  const qs=picked({section:'Math',counts:{algebra:5,geometry:5},difficulties:{algebra:['Hard'],geometry:['Medium','Hard']}},math);
  assert.equal(qs.length,10);assert.ok(qs.filter(q=>q.domain==='Algebra').every(q=>q.difficulty==='Hard'));
  assert.ok(qs.every(q=>q.difficulty!=='Easy'));
  const uw={id:'uw',section:'Math',source:'uworld',domain:'Algebra',skill:'Linear equations',difficulty:'Unrated',answerStatus:'draft'};
  const config={section:'Math',source:'uworld',counts:{algebra:1},difficulties:{algebra:[]}};
  assert.equal(matchesDifficulty(uw,config,'algebra'),true);
  assert.deepEqual(selectTest([uw],[],config).ids,['uw']);
});
