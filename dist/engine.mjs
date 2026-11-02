export const LEVELS = ['Easy', 'Medium', 'Hard'];
export const BUCKETS = [
  { id: 'ideas', label: 'Information and Ideas', domain: 'Information and Ideas', defaultCount: 10 },
  { id: 'craft', label: 'Craft and Structure', domain: 'Craft and Structure', defaultCount: 10 },
  { id: 'transitions', label: 'Transitions', domain: 'Expression of Ideas', skill: 'Transitions', defaultCount: 3 },
  { id: 'conventions', label: 'Standard English Conventions', domain: 'Standard English Conventions', defaultCount: 5 },
  { id: 'synthesis', label: 'Rhetorical Synthesis', domain: 'Expression of Ideas', skill: 'Rhetorical Synthesis', defaultCount: 2 },
];
export const MATH_BUCKETS = [
  {id:'algebra',label:'Algebra',domain:'Algebra',defaultCount:10},
  {id:'advanced',label:'Advanced Math',domain:'Advanced Math',defaultCount:10},
  {id:'data',label:'Problem-Solving and Data Analysis',domain:'Problem-Solving and Data Analysis',defaultCount:5},
  {id:'geometry',label:'Geometry and Trigonometry',domain:'Geometry and Trigonometry',defaultCount:5},
];
export const bucketsFor = section => section === 'Math' ? MATH_BUCKETS : BUCKETS;
export function inCollection(q, config={}) {
  return (q.source || 'college-board') === (config.source || 'college-board') && q.section === (config.section || 'Reading and Writing');
}
function numericValue(value) {
  const text=String(value??'').trim().replace(/−/g,'-');
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\/[+-]?(?:\d+(?:\.\d*)?|\.\d+))?$/.test(text))return null;
  const [a,b]=text.split('/').map(Number), n=b===undefined?a:a/b;
  return Number.isFinite(n)?n:null;
}
function numericRatio(value) {
  const text=String(value??'').trim().replace(/−/g,'-');
  if(numericValue(text)===null)return null;
  function decimal(part) {
    const negative=part.startsWith('-'),unsigned=part.replace(/^[+-]/,''),places=unsigned.includes('.')?unsigned.split('.')[1].length:0;
    return {n:BigInt(unsigned.replace('.',''))*(negative?-1n:1n),d:10n**BigInt(places)};
  }
  const parts=text.split('/'),a=decimal(parts[0]);
  if(parts.length===1)return a;
  const b=decimal(parts[1]);return b.n===0n?null:{n:a.n*b.d,d:a.d*b.n};
}
export function validResponse(q, answer) {
  return answer===null || (q?.responseType==='numeric' ? typeof answer==='string' && answer.length<=30 && numericValue(answer)!==null : ['A','B','C','D'].includes(answer));
}
export function answerMatches(q, answer) {
  if(!q || q.answerStatus==='unresolved' || answer===null || answer===undefined || answer==='')return false;
  if(q?.responseType!=='numeric')return answer===q?.answer;
  const value=numericValue(answer);if(value===null)return false;
  if(q.acceptedRange && Number.isFinite(q.acceptedRange.min) && Number.isFinite(q.acceptedRange.max) && value>=q.acceptedRange.min && value<=q.acceptedRange.max)return true;
  const actual=numericRatio(answer);if(!actual)return false;
  return (q.acceptedAnswers||q.answer.split(',')).some(a=>{const expected=numericRatio(a);return expected!==null && actual.n*expected.d===expected.n*actual.d;});
}
export function belongs(q, bucket) { return q.domain === bucket.domain && (!bucket.skill || q.skill === bucket.skill); }
export function defaultCounts(section) { return Object.fromEntries(bucketsFor(section).map(b => [b.id, b.defaultCount])); }
export function flattenHistory(history, byId) {
  return history.flatMap(s => s.rows.map(r => ({ ...r, session: s.id, ended: s.ended, mode: s.mode }))).filter(r => byId[r.id]);
}
export function skillStats(rows, byId) {
  const groups = new Map();
  for (const row of rows) {
    const q = byId[row.id]; if (!q) continue;
    const key = q.domain + '/' + q.skill;
    if (!groups.has(key)) groups.set(key, { domain: q.domain, skill: q.skill, total: 0, correct: 0, incorrect: 0, omitted: 0, seconds: 0, sessions: new Set() });
    const g = groups.get(key); g.total++; g.seconds += row.seconds || 0; g.sessions.add(row.session);
    if (!row.answer) g.omitted++; else if (answerMatches(q, row.answer)) g.correct++; else g.incorrect++;
  }
  return [...groups.values()].map(g => ({ ...g, sessions: g.sessions.size, answered: g.correct + g.incorrect,
    accuracy: g.total ? g.correct / g.total : 0, errorRate: g.total ? g.incorrect / g.total : 0,
    status: g.correct + g.incorrect < 5 ? 'Limited data' : g.correct / g.total < .6 ? 'Needs practice' : g.correct / g.total < .8 ? 'Developing' : 'Strong' }));
}
// Tutor attempts remain in analytics, but only test-mode sessions change the challenge mix.
export function smartMix(history, byId) {
  const recent = [...history].sort((a, b) => b.ended - a.ended).filter(s => s.mode !== 'tutor').flatMap(s => s.rows).filter(r => byId[r.id] && !byId[r.id].answerStatus).slice(0, 90);
  if (recent.length < 10) return { weights: [.25, .5, .25], evidence: recent.length, accuracy: null };
  const correct = recent.filter(r => answerMatches(byId[r.id], r.answer)).length;
  // Ten prior observations centered at 70% temper a single unusually good/bad session.
  const accuracy = (correct + 7) / (recent.length + 10);
  const hard = Math.max(.2, Math.min(.4, .25 + (accuracy - .65) * .5));
  const easy = Math.max(.2, Math.min(.35, .25 - (accuracy - .65) * .3));
  return { weights: [easy, 1 - easy - hard, hard], evidence: recent.length, accuracy };
}
export function allocate(n, weights) {
  const raw = weights.map(w => n * w), counts = raw.map(Math.floor);
  const order = raw.map((v, i) => ({ i, rest: v - counts[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let remaining = n - counts.reduce((a,b)=>a+b,0), j = 0; remaining > 0; remaining--, j++) counts[order[j % order.length].i]++;
  if (n >= 3) for (const i of [0, 2]) if (!counts[i]) { const from = counts.indexOf(Math.max(...counts)); counts[from]--; counts[i]++; }
  return counts;
}
export function eligiblePool(bank, history, byId, pool = 'all') {
  const rows = flattenHistory(history, byId), used = new Set(rows.map(r => r.id));
  const latest = new Map();
  for (const row of [...rows].sort((a,b) => a.ended - b.ended)) latest.set(row.id, row);
  return bank.filter(q => pool === 'unused' ? !used.has(q.id) : pool === 'incorrect' ? latest.has(q.id) && !answerMatches(q, latest.get(q.id).answer) : pool === 'marked' ? rows.some(r => r.id === q.id && r.flag) : true);
}
export function selectTest(bank, history, config, { rng = Math.random, now = Date.now() } = {}) {
  bank=bank.filter(q=>inCollection(q,config) && q.answerStatus!=='unresolved' && !q.duplicateOf);
  const buckets=bucketsFor(config.section);
  const byId = Object.fromEntries(bank.map(q => [q.id, q]));
  const counts = buckets.map(b => Number(config.counts[b.id] ?? 0));
  if (counts.some(n => !Number.isInteger(n) || n < 0 || n > 30)) throw Error('Enter a whole number from 0 to 30 for each topic.');
  const total = counts.reduce((a,b)=>a+b,0);
  if (total < 1 || total > 30) throw Error('Select between 1 and 30 questions in total.');
  const pool = eligiblePool(bank, history, byId, config.pool), mix = smartMix(history, byId);
  const rows = flattenHistory(history, byId), stats = skillStats(rows, byId), statBySkill = Object.fromEntries(stats.map(s => [s.domain + '/' + s.skill, s]));
  const latest = new Map(); for (const row of [...rows].sort((a,b) => a.ended - b.ended)) latest.set(row.id, row);
  const selected = [], fallbacks = [], rankedBuckets = [];
  for (let bi = 0; bi < buckets.length; bi++) {
    const bucket = buckets[bi], wanted = counts[bi], allowedSkills = config.skills?.[bucket.id];
    const candidates = pool.filter(q => belongs(q, bucket) && (!allowedSkills || allowedSkills.includes(q.skill)));
    if (candidates.length < wanted) throw Error(`${bucket.label}: ${candidates.length} available; ${wanted} requested. Reduce the count or change Question Mode / selected skills.`);
    const target = allocate(wanted, mix.weights), taken = new Set();
    const ranked = candidates.map(q => {
      const skill = statBySkill[q.domain + '/' + q.skill], last = latest.get(q.id);
      const weak = config.source!=='uworld' && skill && skill.total >= 3 ? Math.max(0, .75 - (skill.correct + 2) / (skill.total + 4)) * 3 : 0;
      let weight = 1 + weak;
      if (!last) weight *= 2.5;
      else if (!answerMatches(q, last.answer) && now - last.ended >= 2 * 86400000) weight *= 2;
      else if (now - last.ended < 86400000) weight *= .35;
      return { q, score: -Math.log(Math.max(1e-9, rng())) / weight };
    }).sort((a,b)=>a.score-b.score);
    if(config.source==='uworld'){selected.push(...ranked.slice(0,wanted).map(x=>x.q.id));continue;}
    rankedBuckets.push({ bucket, ranked });
    for (let i = 0; i < LEVELS.length; i++) {
      const matches = ranked.filter(x => x.q.difficulty === LEVELS[i]).slice(0, target[i]);
      matches.forEach(x => { selected.push(x.q.id); taken.add(x.q.id); });
      if (matches.length < target[i]) fallbacks.push({ topic: bucket.label, difficulty: LEVELS[i], requested: target[i], available: matches.length });
    }
    const missing = wanted - taken.size;
    ranked.filter(x => !taken.has(x.q.id)).slice(0, missing).forEach(x => selected.push(x.q.id));
  }
  // Reconcile rounding across small topics. Otherwise several one/two-question
  // topics can independently round Hard to zero despite a sizeable total test.
  const desired = allocate(total, mix.weights);
  const actual = LEVELS.map(l => selected.filter(id => byId[id].difficulty === l).length);
  for (let level = 0; level < LEVELS.length; level++) {
    while (actual[level] < desired[level]) {
      let swapped = false;
      for (const { bucket, ranked } of rankedBuckets) {
        const incoming = ranked.find(x => x.q.difficulty === LEVELS[level] && !selected.includes(x.q.id));
        if (!incoming) continue;
        const outgoing = [...ranked].reverse().find(x => selected.includes(x.q.id) && actual[LEVELS.indexOf(x.q.difficulty)] > desired[LEVELS.indexOf(x.q.difficulty)]);
        if (!outgoing || !belongs(outgoing.q, bucket)) continue;
        selected[selected.indexOf(outgoing.q.id)] = incoming.q.id;
        actual[LEVELS.indexOf(outgoing.q.difficulty)]--; actual[level]++;
        swapped = true; break;
      }
      if (!swapped) break; // The remaining requested levels are unavailable within the topic quotas.
    }
  }
  // Shuffle order without changing the exact topic counts or difficulty composition.
  for (let i = selected.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [selected[i], selected[j]] = [selected[j], selected[i]]; }
  return { ids: selected, mix, fallbacks, composition: config.source==='uworld'?{Unrated:selected.length}:Object.fromEntries(LEVELS.map(l => [l, selected.filter(id => byId[id].difficulty === l).length])) };
}
