import { BUCKETS, MATH_BUCKETS, bucketsFor, inCollection, answerMatches, validResponse, LEVELS, belongs, defaultCounts, flattenHistory, skillStats, smartMix, eligiblePool, selectTest } from './engine.mjs';
import { mountAuth } from './auth.mjs';
import { AccountStore } from './account-store.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icon = name => `<i data-lucide="${name}"></i>`;
const fmt = n => `${Math.floor(Math.max(0,n)/60)}:${String(Math.floor(Math.max(0,n)%60)).padStart(2,'0')}`;
const percent = (a,b) => b ? Math.round(a/b*100) : 0;
const date = ts => new Date(ts).toLocaleString('en-US', { timeZone:'Asia/Dushanbe', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
let bank;
try { const response = await fetch('bank.json'); if (!response.ok) throw Error(); bank = await response.json(); const mathResponse=await fetch('math-bank.json'); if(!mathResponse.ok)throw Error(); bank.push(...await mathResponse.json()); const uwResponse=await fetch('uworld-bank.json');if(!uwResponse.ok)throw Error();bank.push(...await uwResponse.json()); }
catch { $('#app').innerHTML = '<div class="notice">The question bank could not be loaded. Run the local server and reload this page.</div>'; throw Error('Question bank unavailable'); }
const byId = Object.fromEntries(bank.map(q => [q.id,q]));
const domains = [...new Set(bank.map(q => q.domain))];
const englishBuckets = ['ideas','craft','transitions','synthesis','conventions'].map(id => BUCKETS.find(b => b.id === id));
const collectionBank = () => bank.filter(q=>inCollection(q,builder)&&q.answerStatus!=='unresolved'&&!q.duplicateOf);
const allBuckets=[...BUCKETS,...MATH_BUCKETS];
const libraryFilter={domain:'',status:'all',query:''};
const STORE = 'qbank-focus-v1';
let data={history:[],active:null}, accountStore=null, account=null, authController=null, appReady=false, accountEpoch=0;
function loadLocalDemo() {
try { data = JSON.parse(localStorage.getItem(STORE)); } catch {}
if (!data || !Array.isArray(data.history)) data = { history:[], active:null };
// Preserve earlier histories; convert an old in-progress session to a single block.
if (data.active?.stages) {
  data.legacyActive = structuredClone(data.active);
  const old = data.active, ids = old.stages.flatMap(s => s.ids).slice(0,30);
  data.active = { id:old.id, name:old.name, created:old.created, ids, index:0, responses:old.responses,
    mode:old.mode, timed:old.minutes>0, remaining:old.stages[old.stage]?.remaining||0, paused:true,
    telemetry:old.telemetry, composition:{}, lastTick:Date.now(), config:{counts:defaultCounts()} };
}
appReady=true;
$('#account-controls').textContent='Local demo · saved on this device';
$('#account-label').textContent='Local demo';
$('#sync-toolbar').hidden=true;
render(false);
}
let screen = 'create', moreOpen=false, notesOpen=false, eliminator=false, readingSize=18, storageWarning=false, pendingHighlight=null;
let builder = { source:'college-board', section:'Reading and Writing', counts:defaultCounts(), pool:'all', tutor:false, timed:true, minutes:35, name:'', telemetry:false,
  skills:Object.fromEntries(allBuckets.map(b=>[b.id,[...new Set(bank.filter(q=>belongs(q,b)).map(q=>q.skill))]])), expanded:[] };
const skillDescriptions = {
  'Central Ideas and Details':'Main idea and key details', 'Inferences':'Conclusions supported by the passage',
  'Command of Evidence':'Textual and quantitative evidence', 'Words in Context':'Vocabulary in context',
  'Text Structure and Purpose':'Purpose, function, and structure', 'Cross-Text Connections':'Compare two texts',
  'Boundaries':'Sentence boundaries and punctuation', 'Form, Structure, and Sense':'Grammar and sentence structure',
  'Transitions':'Logical connections between ideas', 'Rhetorical Synthesis':'Use notes to meet a writing goal'
};
const reasons = ['Not specified','Misread the prompt','Knowledge gap','Rushed the answer','Ran out of time','Changed a correct answer','Other reason'];
function save() {
  if(!appReady)return;
  if(accountStore){accountStore.save(data);return;}
  try { localStorage.setItem(STORE,JSON.stringify(data)); }
  catch { if (!storageWarning) { storageWarning=true; document.body.insertAdjacentHTML('beforeend','<div class="error-banner" role="alert">Storage is full or unavailable. Export your history before closing this page.</div>'); } }
}
function sessionRows(s) { return s.ids.map(id=>({ id,...s.responses[id] })); }
function allRows(history=data.history) { return flattenHistory(history,byId).filter(r=>!byId[r.id].answerStatus); }
function isCorrect(r) { return answerMatches(byId[r.id],r.answer); }
function tally(rows) { const correct=rows.filter(isCorrect).length, omitted=rows.filter(r=>!r.answer).length; return { total:rows.length,correct,omitted,incorrect:rows.length-correct-omitted,accuracy:percent(correct,rows.length) }; }
function currentQ() { return data.active && byId[data.active.ids[data.active.index]]; }
function currentR() { return data.active && data.active.responses[currentQ().id]; }
function badge(status) { const c = status==='Needs practice'?'weak':status==='Limited data'?'limited':status==='Developing'?'developing':''; return `<span class="status ${c}">${status}</span>`; }
function metric(label,value,sub='') { return `<div class="metric"><span>${label}</span><strong>${value}</strong>${sub?`<small>${sub}</small>`:''}</div>`; }
function statusFor(r) { if(byId[r.id]?.answerStatus==='draft')return !r.answer?'<span class="status omitted">Omitted</span>':`<span class="status ${isCorrect(r)?'':'incorrect'}">${isCorrect(r)?'Matches draft':'Differs from draft'}</span>`; return !r.answer?'<span class="status omitted">Omitted</span>':isCorrect(r)?'<span class="status">Correct</span>':'<span class="status incorrect">Incorrect</span>'; }
function skillSort(a,b) { return a.accuracy-b.accuracy || b.total-a.total; }

function explanation(q) { return q.rationaleImages ? q.rationaleImages.map((src,i)=>`<img class="math-explanation-image" src="${esc(src)}" alt="College Board worked explanation for ${q.id}, part ${i+1}" loading="lazy"><a class="math-zoom" href="${esc(src)}" target="_blank" rel="noopener">Open explanation at full size ↗</a>`).join('') : esc(q.rationale); }
function collectionPicker() {
  return `<section class="collection-picker" aria-label="Question bank"><div class="collection-intro"><div><span class="eyebrow">YOUR PRACTICE LIBRARY</span><h2>Choose your question bank</h2><p>One focused session. A little more confidence.</p></div>${icon('library-big')}</div><div class="collection-tabs" role="group" aria-label="Question bank source">${[['college-board','College Board','Official SAT question bank','graduation-cap'],['uworld','UWorld','SAT questions · draft answer key','layers']].map(([id,label,sub,glyph])=>`<button type="button" data-collection="${id}" class="collection-tab ${builder.source===id?'selected':''}" aria-pressed="${builder.source===id}">${icon(glyph)}<span><strong>${label}</strong><small>${sub}</small></span><span class="collection-tag">${bank.filter(q=>(q.source||'college-board')===id).length+(id==='uworld'?' source pages':' questions')}</span></button>`).join('')}</div>${true?`<div class="subject-tabs" role="group" aria-label="SAT subject">${[['Reading and Writing','Reading & Writing','book-open'],['Math','Math','calculator']].map(([id,label,glyph])=>`<button type="button" data-section="${id}" class="${builder.section===id?'selected':''}" aria-pressed="${builder.section===id}">${icon(glyph)}${label}<span>${bank.filter(q=>q.section===id&&(q.source||'college-board')===builder.source).length}</span></button>`).join('')}</div>`:''}</section>`;
}
function draftNotice() {return `<div class="draft-notice" role="note"><strong>UWorld · Draft answers need review</strong><p>These answers and explanations were independently generated. They are not an official UWorld key. Scores are provisional and stay out of Performance and automatic difficulty adjustments. Pages with incomplete information remain in the library and are excluded from generated tests.</p><a href="#library/uworld/0">Review all questions &amp; draft answers →</a></div>`;}
function sourceImages(images,id) {return (images||[]).map((src,i)=>`<img class="math-question-image" src="${esc(src)}" alt="Original UWorld screenshot ${esc(id)}, part ${i+1}" loading="lazy"><a class="math-zoom" href="${esc(src)}" target="_blank" rel="noopener">Open original at full size ↗</a>`).join('');}
function libraryPage(page=0) {
  const qs=bank.filter(q=>q.source==='uworld'&&(!libraryFilter.domain||q.domain===libraryFilter.domain)&&(libraryFilter.status==='all'||q.answerStatus===libraryFilter.status)&&(!libraryFilter.query||[q.id,q.file,q.skill].join(' ').toLowerCase().includes(libraryFilter.query.toLowerCase()))),start=Math.max(0,Math.min(Math.floor(page),Math.max(0,Math.ceil(qs.length/50)-1)))*50;
  return `${draftNotice()}<div class="toolbar"><a href="#create" class="button">Back to Create Test</a><span class="subtle">${qs.length} source pages · ${qs.filter(q=>q.answerStatus==='draft'&&!q.duplicateOf).length} unique draft answers · ${qs.filter(q=>q.answerStatus==='unresolved').length} need source review</span></div><section class="section"><h2 class="section-title">Question &amp; Answer Library</h2><div class="library-filters"><label>Topic<select id="library-domain"><option value="">All topics</option>${domains.map(d=>`<option value="${esc(d)}" ${libraryFilter.domain===d?'selected':''}>${esc(d)}</option>`).join('')}</select></label><label>Status<select id="library-status"><option value="all">All pages</option><option value="draft" ${libraryFilter.status==='draft'?'selected':''}>Draft answer</option><option value="unresolved" ${libraryFilter.status==='unresolved'?'selected':''}>Needs source review</option></select></label><label>Find a page<input id="library-search" type="search" placeholder="Question ID, file, or skill" value="${esc(libraryFilter.query)}"></label></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Question</th><th>Topic</th><th>Status</th><th>Draft answer</th><th></th></tr></thead><tbody>${qs.slice(start,start+50).map(q=>`<tr><td>${esc(q.file)} · p. ${q.page}</td><td>${esc(q.domain)}</td><td>${q.duplicateOf?'Duplicate screenshot':q.answerStatus==='draft'?'Draft · needs review':'Source incomplete / unclear'}</td><td>${esc(q.answer??'Unresolved')}</td><td><a href="#source/${q.id}">Inspect</a></td></tr>`).join('')}</tbody></table></div></section><div class="builder-actions">${start?`<a class="button" href="#library/uworld/${start/50-1}">Previous 50</a>`:'<span></span>'}${start+50<qs.length?`<a class="button" href="#library/uworld/${start/50+1}">Next 50</a>`:''}</div>`;
}
function sourcePage(id) {
  const q=byId[id];if(!q||q.source!=='uworld')return '<div class="empty">Question not found.</div>';
  return `${draftNotice()}<div class="toolbar"><a class="button" href="#library/uworld/0">Back to Library</a><span class="subtle">${esc(q.file)} · page ${q.page} · ${esc(q.id)}</span></div><section class="section"><h2 class="section-title">Original Question</h2><div class="section-body source-review ${q.passageImages?.length?'split-source':''}"><div>${sourceImages(q.passageImages?.length?q.passageImages:q.questionImages,q.id)}</div>${q.passageImages?.length?`<div>${sourceImages(q.questionImages,q.id)}</div>`:''}</div></section><section class="section"><h2 class="section-title">${q.answerStatus==='draft'?'Draft answer · '+esc(q.answer):'Answer unresolved'}</h2><div class="rationale">${esc(q.rationale)}${q.reviewNote?`<p class="review-note"><strong>Review note:</strong> ${esc(q.reviewNote)}</p>`:''}${q.duplicateOf?`<p class="review-note">Duplicate screenshot of <a href="#source/${esc(q.duplicateOf)}">${esc(q.duplicateOf)}</a>; kept out of generated tests.</p>`:''}<p class="draft-inline">Independently generated draft · needs review · not an official UWorld answer</p></div></section>`;
}
function builderPool() { return eligiblePool(collectionBank(),data.history,byId,builder.pool); }
function builderPage() {
  const pool=builderPool(), stats=skillStats(allRows(),byId), builderBuckets=builder.section==='Math'?MATH_BUCKETS:englishBuckets;
  const collection=collectionPicker();
  const selectedTotal=Object.values(builder.counts).reduce((a,b)=>a+Number(b||0),0);
  return `${collection}${builder.source==='uworld'?draftNotice():''}${data.active?`<div class="notice row"><span>A test is in progress: <strong>${esc(data.active.name)}</strong></span><a href="#practice" class="button">Resume Test</a></div>`:''}
  <form id="builder-form" novalidate>
    <section class="section"><h2 class="section-title">Test Mode ${icon('info')}</h2><div class="section-body"><div class="mode-row">
      <label class="switch-label"><input type="checkbox" name="tutor" ${builder.tutor?'checked':''}><span class="switch"></span>Tutor</label>
      <label class="switch-label"><input type="checkbox" name="timed" ${builder.timed?'checked':''}><span class="switch"></span>Timed</label>
      <label class="field-inline" id="minutes-field" ${builder.timed?'':'hidden'}>Time limit <input type="number" name="minutes" value="${builder.minutes}" min="1" max="180" aria-label="Time limit in minutes"> min</label>
    </div><p class="mode-description" id="mode-description">${builder.tutor?'Answers and explanations are available after you submit each response.':'Answers and explanations are available after you finish the test.'}</p></div>
    <h2 class="section-title">Question Mode ${icon('info')}</h2><div class="section-body question-modes">${[['all','All'],['unused','Unused'],['incorrect','Incorrect'],['marked','Marked']].map(([v,label])=>`<label><input type="radio" name="pool" value="${v}" ${builder.pool===v?'checked':''}>${label}<span class="count-pill">${eligiblePool(collectionBank(),data.history,byId,v).length}</span></label>`).join('')}</div></section>
    <section class="section"><h2 class="section-title">Subjects &amp; Question Counts</h2><div class="topic-head"><span>${builder.section}</span><span>Available</span><span>Questions</span></div>
    ${builderBuckets.map(b=>{
      const available=pool.filter(q=>belongs(q,b)&&builder.skills[b.id].includes(q.skill)).length;
      const skills=[...new Set(collectionBank().filter(q=>belongs(q,b)).map(q=>q.skill))],expanded=builder.expanded.includes(b.id);
      return `${b.id==='transitions'?'<div class="topic-group" role="group" aria-label="Expression of Ideas"><h3 class="topic-group-title">Expression of Ideas</h3>':''}<div class="topic-row ${b.domain==='Expression of Ideas'?'topic-child':''}"><div class="topic-line"><div class="topic-label"><button class="expand-topic" type="button" data-expand="${b.id}" aria-label="${expanded?'Collapse':'Expand'} ${b.label} skills" aria-expanded="${expanded}">${icon(expanded?'chevron-down':'chevron-right')}</button><label for="count-${b.id}">${b.label}</label></div><span><span class="count-pill">${available}</span></span><input id="count-${b.id}" class="topic-number number-input" type="number" min="0" max="30" step="1" value="${builder.counts[b.id]}" name="count-${b.id}" data-count="${b.id}" aria-label="${b.label} question count"></div>
      <div class="topic-skills" ${expanded?'':'hidden'}>${skills.map(skill=>{const g=stats.find(s=>s.skill===skill);return `<label><input type="checkbox" data-skill-bucket="${b.id}" value="${esc(skill)}" ${builder.skills[b.id].includes(skill)?'checked':''}>${esc(skill)} <span class="count-pill">${pool.filter(q=>belongs(q,b)&&q.skill===skill).length}</span>${g?.status==='Needs practice'?'<span class="status weak">Focus</span>':''}</label>`}).join('')}</div></div>${b.id==='synthesis'?'</div>':''}`;
    }).join('')}</section>
    <section class="section"><h2 class="section-title">No. of Questions</h2><div class="section-body"><div class="test-settings"><label class="test-name">Test name <input type="text" name="testName" maxlength="80" placeholder="Practice ${data.history.length+1}" value="${esc(builder.name)}"></label><div id="total-block" class="total-block ${selectedTotal>30||selectedTotal<1?'invalid':''}"><strong id="question-total">${selectedTotal}</strong><span>/ 30 maximum</span></div></div><p class="subtle" style="margin:18px 0 0">${builder.source==='uworld'?'UWorld difficulty is not rated. Your chosen topic counts are kept exact.':'Question difficulty is selected automatically. Every test includes a balanced mix.'}</p>
    <details style="margin-top:16px"><summary class="subtle" style="cursor:pointer">Activity tracking</summary><label class="switch-label" style="margin-top:15px"><input type="checkbox" name="telemetry" ${builder.telemetry?'checked':''}><span class="switch"></span>Record pointer movement</label><p class="subtle" style="margin-top:12px">Optional, stored on this device. Pointer movement does not identify why an answer was wrong.</p></details>
    <p id="builder-error" class="error" role="alert"></p></div></section>
    <div class="builder-actions"><button type="button" class="button" data-action="reset-counts">Reset default mix</button><button type="submit" class="button primary generate" id="generate-test" ${selectedTotal>30||selectedTotal<1?'disabled':''}>Generate Test</button></div>
  </form>`;
}
function startTest() {
  if(data.active) { showModal('Test in progress','Resume or end the current test before generating another.',()=>location.hash='practice','Resume Test');return; }
  try {
    const picked=selectTest(bank,data.history,builder);
    const responses=Object.fromEntries(picked.ids.map(id=>[id,{answer:null,seconds:0,changes:[],visits:0,clicks:0,scrolls:0,points:[],flag:false,locked:false,eliminated:[],notes:'',highlights:[]}]));
    data.active={id:crypto.randomUUID(),name:builder.name.trim()||`${builder.source==='uworld'?'UWorld · ':''}${builder.section==='Math'?'Math':'Reading & Writing'} Practice ${data.history.length+1}`,created:Date.now(),ids:picked.ids,index:0,responses,mode:builder.tutor?'tutor':'exam',timed:builder.timed,remaining:builder.timed?Number(builder.minutes)*60:0,paused:false,telemetry:builder.telemetry,composition:picked.composition,selection:picked.mix,fallbacks:picked.fallbacks,config:structuredClone(builder),lastTick:Date.now()};
    if(builder.timed&&(!Number.isFinite(+builder.minutes)||+builder.minutes<1||+builder.minutes>180)) { data.active=null;throw Error('Set a time limit between 1 and 180 minutes.'); }
    currentR().visits++;save();location.hash='practice';
  } catch(err) { $('#builder-error').textContent=err.message;$('#builder-error').scrollIntoView({block:'nearest'}); }
}

function splitQuestion(q) {
  if(q.source==='uworld')return {source:q.passage||'',prompt:q.responseType==='numeric'?'Enter your answer.':'Choose an answer using the original choices.'};
  if(q.section==='Math')return {source:q.passage||'',prompt:q.responseType==='numeric'?'Enter your answer.':'Select the answer shown in the question.'};
  const raw=q.passage;
  let start=-1;
  if(q.skill==='Rhetorical Synthesis') start=raw.lastIndexOf('The student');
  if(start<0) { const matches=[...raw.matchAll(/(?:^|\n)(Which\b|What\b|Based on\b|According to\b|How\b|As used\b)/g)]; const m=matches.at(-1); if(m)start=m.index+(raw[m.index]==='\n'?1:0); }
  if(start<0) { const matches=[...raw.matchAll(/Which choice |Which quotation |What does the text /g)]; if(matches.length)start=matches.at(-1).index; }
  if(start<0) return {source:raw,prompt:'Select the best answer.'};
  return {source:raw.slice(0,start).trim(),prompt:raw.slice(start).replace(/\s+/g,' ').trim()};
}
function formattedSource(q,raw,highlights=[]) {
  if(q.source==='uworld'&&q.section!=='Math')return sourceImages(q.passageImages,q.id);
  if(q.questionImages)return q.questionImages.map((src,i)=>`<img class="math-question-image" src="${esc(src)}" alt="Original math question ${q.id}, part ${i+1}"><a class="math-zoom" href="${esc(src)}" target="_blank" rel="noopener">Open question at full size ↗</a>`).join('');
  const lines=raw.split('\n'), poetic=lines.length>5&&lines.filter(l=>l.length<75).length/lines.length>.65&&q.skill!=='Rhetorical Synthesis';
  let text=esc(poetic?raw:raw.replace(/\s+/g,' '));
  for(const u of q.underlines||[]) { const phrase=esc(poetic?u:u.replace(/\s+/g,' '));if(phrase.length>3)text=text.replace(phrase,`<u>${phrase}</u>`); }
  for(const h of highlights) { const safe=esc(h);if(safe.length>1)text=text.replace(safe,`<mark>${safe}</mark>`); }
  if(q.skill==='Rhetorical Synthesis'&&raw.includes('\n')) {
    const first=raw.indexOf('\n'),notes=raw.slice(first+1).split(/\.\s*\n/).map(s=>s.trim()).filter(Boolean);
    return `<p>${esc(raw.slice(0,first))}</p><ul class="notes-list">${notes.map(n=>`<li>${esc(n.replace(/\s+/g,' '))}${n.endsWith('.')?'':'.'}</li>`).join('')}</ul>`;
  }
  return `<div class="${poetic?'verse':'passage'}">${poetic?text:`<p>${text}</p>`}</div>`;
}
function figures(q) { return (q.figures||[]).map(p=>`<img class="figure" src="figures/${p}.webp" alt="Graph or table for question ${q.id}">`).join(''); }
function timerMarkup(s) { const forced=s.timed&&s.remaining<=300;return `<strong id="exam-time" ${s.hideTime&&!forced?'hidden':''}>${s.timed?fmt(s.remaining):'Untimed'}</strong>${s.timed?`<button class="hide-time" data-action="hide-time" ${forced?'hidden':''}>${s.hideTime?'Show':'Hide'}</button>`:''}`; }
function examPage() {
  const s=data.active;
  if(!s)return '<div class="empty"><p>No test in progress.</p><a class="button primary" href="#create">Create Test</a></div>';
  if(s.paused)return `<div class="paused-screen"><div class="paused-card"><h1>Test paused</h1><p>${esc(s.name)}<br>Your answers are saved on this device.</p><button class="exam-button" data-action="resume">Resume Test</button><p style="margin:22px 0 0"><a href="#create">Back to Create Test</a></p></div></div>`;
  const q=currentQ(),r=currentR(),parts=splitQuestion(q);
  return `<div class="exam-shell ${q.section==='Math'?'math-exam':''} ${q.source==='uworld'?'draft-exam':''}" style="--reading-size:${readingSize}px"><header class="exam-header"><div><div class="exam-heading">${q.section==='Math'?'Math':'Section 1: Reading and Writing'}${q.source==='uworld'?' · Draft key':''}</div><button class="exam-link" data-action="directions">Directions ${icon('chevron-down')}</button></div><div class="exam-timer ${s.timed&&s.remaining<=300?'warning':''}">${timerMarkup(s)}</div><div class="exam-tools"><button class="exam-tool" data-action="notes" aria-expanded="${notesOpen}">${icon(q.section==='Math'||q.source==='uworld'?'notebook-pen':'highlighter')}<span>${q.section==='Math'||q.source==='uworld'?'Notes':'Highlights &amp; Notes'}</span></button><button class="exam-tool" data-action="more" aria-expanded="${moreOpen}">${icon('ellipsis-vertical')}<span>More</span></button>${moreOpen?`<div class="more-menu"><button data-action="pause">Pause Test</button><button data-action="navigator">Review Questions</button><div class="size-controls">Text size <button data-action="smaller" aria-label="Decrease text size">−</button><button data-action="larger" aria-label="Increase text size">+</button></div><button data-action="finish">End Test</button></div>`:''}</div></header>
  <div class="exam-content"><section class="exam-passage" id="question-area" aria-label="Question content">${figures(q)}<div id="source-text">${formattedSource(q,parts.source,r.highlights||[])}</div></section><section class="exam-answer-pane" aria-label="Question and answers"><div class="question-strip"><span class="question-number">${s.index+1}</span><button class="mark-review ${r.flag?'marked':''}" data-action="flag" aria-pressed="${r.flag}">${icon('bookmark')}Mark for Review</button><button ${q.responseType==='numeric'?'hidden':''} class="eliminate-toggle ${eliminator?'active':''}" data-action="eliminator" title="Option eliminator" aria-label="Toggle option eliminator" aria-pressed="${eliminator}">ABC</button></div><p class="exam-prompt">${esc(parts.prompt)}</p>${q.source==='uworld'&&q.section!=='Math'?sourceImages(q.questionImages,q.id):''}${q.responseType==='numeric'?`<div class="numeric-response"><label for="numeric-answer">Your answer</label><input id="numeric-answer" type="text" inputmode="text" autocomplete="off" maxlength="30" placeholder="e.g. 3/4 or 0.75" value="${esc(r.answer||'')}" ${r.locked?'disabled':''} aria-describedby="numeric-help"><p id="numeric-help" class="subtle">Enter a number, decimal, or fraction.</p><p id="numeric-error" class="error" role="status"></p></div>`:`<div class="answer-list ${q.source==='uworld'?'screenshot-answers':''}" role="radiogroup" aria-label="Answer choices">${['A','B','C','D'].map(a=>`<div class="answer-row"><button class="answer-choice ${r.answer===a?'selected':''} ${r.eliminated?.includes(a)?'eliminated':''}" role="radio" aria-label="Answer ${a}" aria-checked="${r.answer===a}" data-answer="${a}" ${r.locked?'disabled':''}><span class="choice-letter">${a}</span><span class="choice-text">${esc(q.choices[a]).replace(/\s+/g,' ')}</span></button>${eliminator?`<button class="eliminate-choice" data-eliminate="${a}" aria-label="${r.eliminated?.includes(a)?'Restore':'Eliminate'} option ${a}" ${r.locked?'disabled':''}>${r.eliminated?.includes(a)?'Undo':icon('circle-minus')}</button>`:''}</div>`).join('')}</div>`}

  ${s.mode==='tutor'?`<div class="exam-submit"><button class="exam-button secondary" data-action="check" ${!r.answer||r.locked?'disabled':''}>Submit Answer</button></div>${r.locked?`<div class="tutor-feedback"><strong>${q.source==='uworld'?(isCorrect({id:q.id,...r})?'Matches draft':'Differs from draft'):(isCorrect({id:q.id,...r})?'Correct':'Incorrect')} · ${q.source==='uworld'?'Draft answer':'Correct answer'}: ${esc(q.answer)}</strong><div class="explanation">${q.source==='uworld'?'<p class="draft-inline">AI draft · needs review · not an official UWorld key</p>':''}${explanation(q)}</div></div>`:''}`:''}</section></div>
  <footer class="exam-footer"><span class="test-label">${esc(s.name)}</span><button class="question-menu-trigger" data-action="navigator">Question ${s.index+1} of ${s.ids.length} ${icon('chevron-up')}</button><div class="exam-nav"><button class="exam-button" data-jump="${s.index-1}" ${s.index===0?'disabled':''}>Back</button><button class="exam-button" ${s.index===s.ids.length-1?'data-action="review-test"':`data-jump="${s.index+1}"`}>${s.index===s.ids.length-1?'Review':'Next'}</button></div></footer>
  ${notesOpen?`<aside class="notes-panel" aria-label="Highlights and Notes"><div class="row"><h3>Highlights &amp; Notes</h3><button class="icon-button" data-action="notes" aria-label="Close notes">${icon('x')}</button></div><p>${q.section==='Math'||q.source==='uworld'?'Add your working or a reminder for this question.':'Select passage text, then use Highlight selection.'}</p><div ${q.section==='Math'||q.source==='uworld'?'hidden':''}><button class="button" data-action="highlight">Highlight selection</button><button class="button" style="margin-top:8px" data-action="clear-highlights">Clear highlights</button></div><label class="subtle" style="display:block;margin-top:18px" for="question-note">Notes for this question</label><textarea id="question-note" placeholder="Add a note…">${esc(r.notes||'')}</textarea></aside>`:''}</div>`;
}

function showModal(title,body,onConfirm,confirm='Continue',cancel='Cancel') {
  const dialog=document.createElement('dialog');dialog.innerHTML=`<h2 class="dialog-title">${title}</h2><div class="dialog-body">${body}</div><div class="dialog-actions">${cancel?`<button class="button" data-dialog-cancel>${cancel}</button>`:''}${onConfirm?`<button class="button primary" data-dialog-confirm>${confirm}</button>`:''}</div>`;document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-dialog-cancel]')?.addEventListener('click',()=>dialog.remove());dialog.querySelector('[data-dialog-confirm]')?.addEventListener('click',()=>{dialog.remove();onConfirm();});dialog.addEventListener('cancel',()=>dialog.remove());return dialog;
}
function navigator(review=false) {
  const s=data.active;if(!s)return;tick();if(!data.active)return;
  const unanswered=s.ids.filter(id=>!s.responses[id].answer).length;
  const d=showModal(review?'Review Your Test':'Question Menu',`<div class="legend"><span><i class="answered-key"></i>Answered</span><span><i></i>Unanswered</span><span><i class="flagged-key"></i>Marked</span></div><div class="navigator-grid">${s.ids.map((id,i)=>`<button data-nav-jump="${i}" class="${s.responses[id].answer?'answered ':''}${s.responses[id].flag?'flagged ':''}${s.index===i?'current':''}" aria-label="Question ${i+1}${s.responses[id].answer?', answered':', unanswered'}${s.responses[id].flag?', marked for review':''}">${i+1}</button>`).join('')}</div><p class="subtle">${unanswered} unanswered · ${s.ids.filter(id=>s.responses[id].flag).length} marked for review</p>`,review?()=>confirmFinish():null,review?'Submit Test':'',review?'Return to test':'Close');
  d.querySelectorAll('[data-nav-jump]').forEach(b=>b.onclick=()=>{d.remove();jump(+b.dataset.navJump);});
}
function jump(index) { const s=data.active;if(!s||index<0||index>=s.ids.length)return;tick();if(data.active!==s)return;s.index=index;currentR().visits++;moreOpen=false;pendingHighlight=null;save();render(false); }
function confirmFinish() { const s=data.active;if(!s)return;const t=tally(sessionRows(s));showModal('Submit Test?',`<p>You have answered ${t.total-t.omitted} of ${t.total} questions.</p>${t.omitted?`<p>${t.omitted} unanswered questions will be recorded as omitted.</p>`:''}<p>You cannot change answers after submitting.</p>`,()=>finishTest(),'Submit Test','Keep working'); }
function finishTest(expired=false) {
  const s=data.active;if(!s)return;const result={id:s.id,name:s.name,created:s.created,ended:Date.now(),mode:s.mode,telemetry:s.telemetry,rows:sessionRows(s),composition:s.composition,selection:s.selection,fallbacks:s.fallbacks||[],timed:s.timed,expired};
  data.history.unshift(result);data.active=null;moreOpen=false;notesOpen=false;save();location.hash='result/'+result.id;
}
function tick() {
  const s=data.active;if(!s||s.paused)return;
  const now=Date.now(),delta=Math.max(0,(now-(s.lastTick||now))/1000);s.lastTick=now;
  if(screen!=='practice')return;
  const activeDelta=s.timed?Math.min(delta,s.remaining):delta;currentR().seconds+=activeDelta;
  if(s.timed) { s.remaining=Math.max(0,s.remaining-delta);if(s.remaining===0){save();document.querySelectorAll('dialog').forEach(d=>d.remove());finishTest(true);return;} }
  const el=$('#exam-time');if(el){el.textContent=s.timed?fmt(s.remaining):'Untimed';if(s.timed&&s.remaining<=300){el.hidden=false;el.parentElement.classList.add('warning');el.parentElement.querySelector('.hide-time')?.setAttribute('hidden','');}}
  save();
}
setInterval(tick,1000);
window.addEventListener('beforeunload',()=>{tick();save();});

function domainPanels(rows) {
  return domains.map(domain=>{const rr=rows.filter(r=>byId[r.id].domain===domain),t=tally(rr);return `<div><div class="domain-label">${domain}</div><div class="segments" aria-label="${rr.length?t.accuracy+' percent correct':'No data'}">${Array.from({length:7},(_,i)=>`<span class="${rr.length&&i<Math.round(t.accuracy/100*7)?'filled':''}"></span>`).join('')}</div><div class="domain-caption">${rr.length?`${t.accuracy}% correct · ${t.correct}/${t.total} · ${t.incorrect} incorrect, ${t.omitted} omitted`:'No questions attempted'}</div></div>`}).join('');
}
function weaknessSummary(rows) {
  const stats=skillStats(rows,byId),qualified=stats.filter(s=>s.answered>=5).sort(skillSort);
  if(!qualified.length)return '<div class="insight-callout">Complete more answered questions to identify reliable patterns. Incorrect answers and omissions are shown separately below. Skill labels begin after 5 answered questions.</div>';
  const ds=domains.map(domain=>({domain,...tally(rows.filter(r=>byId[r.id].domain===domain))})).filter(x=>x.correct+x.incorrect>=5).sort((a,b)=>a.accuracy-b.accuracy);
  const d=ds[0],within=stats.filter(s=>s.domain===d.domain).sort((a,b)=>b.incorrect-a.incorrect||a.accuracy-b.accuracy),weak=within[0]||qualified[0];
  if(d.accuracy>=80)return `<div class="insight-callout"><strong>Strong overall accuracy.</strong> Your lowest-scoring domain is ${d.domain} at ${d.accuracy}%. Keep a mixed practice set to maintain coverage.</div>`;
  return `<div class="insight-callout"><strong>Focus: ${d.domain}</strong> — ${d.accuracy}% correct across ${d.total} questions.<br><strong>${weak.skill}</strong>${skillDescriptions[weak.skill]?` (${skillDescriptions[weak.skill].toLowerCase()})`:''} accounts for ${weak.incorrect} of ${d.incorrect} incorrect answers in this domain. ${weak.total<10?'This is an early signal based on a small sample.':'Prioritize this question type in your next test.'}</div>`;
}
function skillTable(rows) {
  const stats=skillStats(rows,byId),draft=rows.some(r=>byId[r.id]?.source==='uworld'),scopedBank=bank.filter(q=>draft?q.source==='uworld':!q.answerStatus);
  return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Question type</th><th class="num">Attempted</th><th class="num">Correct</th><th class="num">Incorrect</th><th class="num">Omitted</th><th>Accuracy</th><th>Status</th></tr></thead><tbody>${domains.map(domain=>`<tr class="skill-domain"><td colspan="7">${domain}</td></tr>${[...new Set(scopedBank.filter(q=>q.domain===domain).map(q=>q.skill))].map(skill=>{const g=stats.find(s=>s.domain===domain&&s.skill===skill);return `<tr><td>${esc(skill)}<span class="skill-description">${skillDescriptions[skill]||''}</span></td><td class="num">${g?.total||0}</td><td class="num">${g?.correct||0}</td><td class="num">${g?.incorrect||0}</td><td class="num">${g?.omitted||0}</td><td>${g?Math.round(g.accuracy*100)+'%':'—'}<div class="percent-bar"><span style="width:${g?g.accuracy*100:0}%"></span></div></td><td>${badge(g?.status||'Limited data')}</td></tr>`}).join('')}`).join('')}</tbody></table></div>`;
}
function sampleHistory() {
  return Array.from({length:3},(_,session)=>{
    const ids=[];for(const b of BUCKETS){const qs=bank.filter(q=>belongs(q,b));if(b.id==='ideas')qs.sort((a,b)=>(a.skill==='Central Ideas and Details'?-1:1)-(b.skill==='Central Ideas and Details'?-1:1));ids.push(...qs.slice(session*10,session*10+b.defaultCount).map(q=>q.id));}
    return {id:'sample-'+session,name:'Example Test '+(session+1),mode:'exam',ended:Date.now()-(3-session)*86400000,rows:ids.map((id,i)=>{const q=byId[id],wrong=q.skill==='Central Ideas and Details'?i%4!==0:q.domain==='Craft and Structure'?i%5===0:i%7===0;return {id,answer:wrong?['A','B','C','D'].find(a=>a!==q.answer):q.answer,seconds:55+i%25,changes:[],points:[],flag:false,notes:'',visits:1,clicks:0,scrolls:0};})};
  });
}
function performancePage(sample=false) {
  const history=sample?sampleHistory():data.history.filter(s=>s.rows.some(r=>!byId[r.id]?.answerStatus)),rows=allRows(history),t=tally(rows),mix=smartMix(history,byId);
  return `<div class="notice">Performance uses College Board results. UWorld draft results are available in Previous Tests and do not affect these analytics.</div>${sample?'<div class="sample-banner"><strong>EXAMPLE DATA</strong> · Demonstration only. These results do not affect your history or smart test selection. <a href="#performance">Return to my results</a></div>':''}
  <div class="toolbar"><label class="subtle" for="performance-scope">Show</label><select id="performance-scope"><option value="all">All completed tests</option><option value="recent">Last 3 tests</option></select>${!sample?'<a class="button" href="#performance/sample">View example analytics</a>':''}</div>
  <div id="performance-report">${performanceReport(rows,history.length,mix)}</div>`;
}
function performanceReport(rows,count,mix) {
  const t=tally(rows);
  return `<div class="metric-row">${metric('Questions attempted',t.total,`${count} completed tests`)}${metric('Accuracy',t.total?t.accuracy+'%':'—','Correct / all questions')}${metric('Incorrect',t.incorrect,'Answer selected was wrong')}${metric('Omitted',t.omitted,'No answer selected')}</div>
  ${weaknessSummary(rows)}<section class="section"><h2 class="section-title">Knowledge and Skills</h2><div class="section-body domain-grid">${domainPanels(rows)}</div></section><section class="section"><h2 class="section-title">Performance by Question Type</h2>${skillTable(rows)}</section>
  <section class="section"><h2 class="section-title">Next Test Selection</h2><div class="section-body"><p style="font-size:14px;line-height:1.7">${mix.evidence<10?'Your next test uses a medium-centered mix while the app gathers results.':'The mix adjusts gradually using your most recent test-mode results. Medium questions remain the largest group; easy and hard questions stay in rotation.'} Question types with repeated errors receive extra selection weight within your chosen topic counts.</p><p class="subtle">${mix.evidence} recent test-mode questions used. Tutor practice is included in skill analytics, but does not change the difficulty mix. Availability and small topic counts can affect the exact mix.</p></div></section>`;
}
function historyPage() {
  return `<div class="toolbar"><button class="button" data-action="export">Export History</button><label class="button" style="cursor:pointer">Import History<input type="file" id="import-history" accept="application/json" hidden></label></div>${data.active?`<div class="notice row"><span>Saved test: ${esc(data.active.name)}</span><a href="#practice" class="button">Resume Test</a></div>`:''}<section class="section"><h2 class="section-title">Previous Tests</h2>${data.history.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Test</th><th>Completed</th><th>Mode</th><th class="num">Questions</th><th class="num">Score</th><th>Actions</th></tr></thead><tbody>${data.history.map(s=>`<tr><td>${esc(s.name)}${s.rows.some(r=>byId[r.id]?.answerStatus==='draft')?'<span class="draft-label">Draft scoring · needs review</span>':''}</td><td>${date(s.ended)}</td><td>${s.mode==='tutor'?'Tutor':'Test'}</td><td class="num">${s.rows.length}</td><td class="num">${tally(s.rows).accuracy}%</td><td><a href="#result/${s.id}">Review</a></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><p>No completed tests yet.</p><a class="button primary" href="#create">Create Test</a></div>'}</section>`;
}
function resultPage(id) {
  const s=data.history.find(s=>s.id===id);if(!s)return '<div class="empty">Test not found.</div>';
  const t=tally(s.rows),draft=s.rows.some(r=>byId[r.id]?.answerStatus==='draft');
  return `${draft?draftNotice():''}`+ `<div class="toolbar"><a class="button" href="#history">Back to Previous Tests</a><span class="subtle">${esc(s.name)} · ${date(s.ended)}${s.expired?' · Time limit reached':''}</span></div><div class="metric-row">${metric('Total Questions',t.total)}${metric(draft?'Matches draft':'Correct Answers',t.correct,`${t.accuracy}% ${draft?'draft agreement':'accuracy'}`)}${metric(draft?'Differs from draft':'Incorrect Answers',t.incorrect)}${metric('Omitted',t.omitted)}</div>
  <section class="section"><h2 class="section-title">Knowledge and Skills</h2><div class="section-body domain-grid">${domainPanels(s.rows)}</div></section><section class="section"><h2 class="section-title">Question Types</h2>${skillTable(s.rows)}</section>
  <section class="section"><h2 class="section-title">Questions Overview</h2><div class="section-body row"><span class="subtle">Active time ${fmt(s.rows.reduce((a,r)=>a+r.seconds,0))}</span><label class="subtle">Filter <select id="result-filter"><option value="all">All questions</option><option value="incorrect">${draft?'Differs from draft':'Incorrect'}</option><option value="omitted">Omitted</option><option value="correct">${draft?'Matches draft':'Correct'}</option></select></label></div><div class="table-scroll"><table class="data-table"><thead><tr><th>No.</th><th>Question type</th><th>Your answer</th><th>${draft?'Draft answer':'Correct answer'}</th><th>Result</th><th>Time</th><th></th></tr></thead><tbody>${s.rows.map((r,i)=>`<tr data-outcome="${!r.answer?'omitted':isCorrect(r)?'correct':'incorrect'}"><td>${i+1}</td><td>${esc(byId[r.id].skill)}</td><td>${esc(r.answer||'—')}</td><td>${byId[r.id].answer}</td><td>${statusFor(r)}</td><td>${fmt(r.seconds)}</td><td><a href="#review/${s.id}/${r.id}">Review</a></td></tr>`).join('')}</tbody></table></div></section><div class="builder-actions"><a class="button primary" href="#create">Create Test</a></div>`;
}
function reviewPage(sid,qid) {
  const s=data.history.find(s=>s.id===sid),r=s?.rows.find(r=>r.id===qid),q=byId[qid];if(!r||!q)return '<div class="empty">Question not found.</div>';
  const parts=splitQuestion(q);
  return `${q.source==='uworld'?draftNotice():''}<div class="toolbar"><a class="button" href="#result/${s.id}">Back to Results</a><span class="subtle">${q.id} · ${q.domain} · ${q.skill}</span></div><section class="section"><h2 class="section-title">${statusFor(r)} ${esc(q.skill)}</h2><div class="review-layout"><div class="review-source">${figures(q)}${formattedSource(q,parts.source,r.highlights||[])}</div><div class="review-answers"><p style="font:18px/1.6 Georgia,serif">${esc(parts.prompt)}</p>${q.source==='uworld'&&q.section!=='Math'?sourceImages(q.questionImages,q.id):''}${q.responseType==='numeric'?`<p>Your answer: <strong>${esc(r.answer||'Omitted')}</strong></p><p>${q.source==='uworld'?'Draft answer':'Correct answer'}: <strong>${esc(q.answer)}</strong></p>`:''}${Object.entries(q.choices).map(([a,text])=>`<div class="review-choice ${a===q.answer?'correct':a===r.answer?'wrong':''}"><span class="choice-letter">${a}</span><span>${esc(text).replace(/\s+/g,' ')}</span>${a===q.answer?(q.source==='uworld'?'<small>Draft answer</small>':'<small>Correct answer</small>'):a===r.answer?'<small>Your answer</small>':''}</div>`).join('')}</div></div></section>
  <section class="section"><h2 class="section-title">Explanation</h2><div class="rationale">${explanation(q)}</div></section><section class="section"><h2 class="section-title">Your Activity</h2><div class="section-body"><p class="subtle">${fmt(r.seconds)} · ${r.visits||1} visits · ${r.changes?.length||0} answer changes</p>${r.changes?.length?`<p class="subtle">${r.changes.map(c=>`${esc(c.from||'—')} → ${esc(c.to||'—')} at ${fmt(c.at)}`).join(' · ')}</p>`:''}<label class="subtle" for="error-reason">Error reason</label><select id="error-reason" class="reason-select" data-reason="${s.id}/${q.id}">${reasons.map(v=>`<option ${r.reason===v?'selected':''}>${v}</option>`).join('')}</select>${r.notes?`<h3 style="font-size:15px;margin-top:25px">Your notes</h3><p class="saved-notes">${esc(r.notes)}</p>`:''}${r.points?.length?`<h3 style="font-size:15px;margin-top:25px">Pointer trace</h3><p class="subtle">Movement within the passage area. This does not identify the cause of an error.</p><svg class="pointer-svg" viewBox="0 0 1000 600"><polyline fill="none" stroke="#4b80a7" stroke-width="2" points="${r.points.map(p=>`${p.x*1000},${p.y*600}`).join(' ')}"/></svg>`:''}</div></section>`;
}

function render(preserveScroll=true) {
  if(!appReady)return;
  const [route,id,qid]=(location.hash.slice(1)||'create').split('/');
  const pScroll=preserveScroll?$('.exam-passage')?.scrollTop:0,aScroll=preserveScroll?$('.exam-answer-pane')?.scrollTop:0;
  screen=route;
  document.body.classList.toggle('exam-mode',route==='practice'&&!!data.active);
  $('#page-title').textContent=({create:'Create Test',home:'Create Test',history:'Previous Tests',performance:'Performance',insights:'Performance',result:'Test Results',review:'Question Review',practice:'Practice Test',library:'UWorld Library',source:'Draft Answer Review'})[route]||'Create Test';
  document.querySelectorAll('.sidebar nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+route||(route==='insights'&&a.hash==='#performance')));
  $('#app').innerHTML=route==='library'?libraryPage(+qid||0):route==='source'?sourcePage(id):route==='practice'?examPage():route==='history'?historyPage():route==='performance'||route==='insights'?performancePage(id==='sample'):route==='result'?resultPage(id):route==='review'?reviewPage(id,qid):builderPage();
  window.lucide?.createIcons();
  if(preserveScroll){if($('.exam-passage'))$('.exam-passage').scrollTop=pScroll||0;if($('.exam-answer-pane'))$('.exam-answer-pane').scrollTop=aScroll||0;}
  $('#builder-form')?.addEventListener('submit',e=>{e.preventDefault();startTest();});
}
function updateBuilderTotal() {
  const total=Object.values(builder.counts).reduce((a,b)=>a+Number(b||0),0);$('#question-total').textContent=total;$('#total-block').classList.toggle('invalid',total<1||total>30);$('#generate-test').disabled=total<1||total>30;
}
function pause() {tick();if(!data.active)return;data.active.paused=true;data.active.lastTick=Date.now();moreOpen=false;save();render();}
function exportHistory() {const url=URL.createObjectURL(new Blob([JSON.stringify({version:2,history:data.history},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='qbank-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

document.addEventListener('input',e=>{
  const t=e.target;
  if(t.id==='numeric-answer'&&data.active&&!currentR().locked){const r=currentR(),value=t.value.trim(),valid=validResponse(currentQ(),value);if(r.answer!==(valid?value:null)){if(r.answer)r.changes.push({from:r.answer,to:valid?value:null,at:r.seconds});r.answer=valid?value:null;}$('#numeric-error').textContent=value&&!valid?'Enter a valid number or fraction.':'';const submit=$('[data-action="check"]');if(submit)submit.disabled=!r.answer;save();}
  if(t.dataset.count){builder.counts[t.dataset.count]=t.value===''?0:Number(t.value);updateBuilderTotal();}
  if(t.name==='testName')builder.name=t.value;if(t.name==='minutes')builder.minutes=t.value;
  if(t.id==='question-note'&&data.active){currentR().notes=t.value;save();}
});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.id.startsWith('library-')){if(t.id==='library-domain')libraryFilter.domain=t.value;if(t.id==='library-status')libraryFilter.status=t.value;if(t.id==='library-search')libraryFilter.query=t.value.trim();location.hash='library/uworld/0';render();return;}
  if(t.name==='pool'){builder.pool=t.value;render();}
  if(t.name==='tutor'){builder.tutor=t.checked;$('#mode-description').textContent=t.checked?'Answers and explanations are available after you submit each response.':'Answers and explanations are available after you finish the test.';}
  if(t.name==='timed'){builder.timed=t.checked;$('#minutes-field').hidden=!t.checked;}
  if(t.name==='telemetry')builder.telemetry=t.checked;
  if(t.dataset.skillBucket){let arr=builder.skills[t.dataset.skillBucket];builder.skills[t.dataset.skillBucket]=t.checked?[...new Set([...arr,t.value])]:arr.filter(v=>v!==t.value);render();}
  if(t.id==='result-filter')document.querySelectorAll('[data-outcome]').forEach(row=>row.hidden=t.value!=='all'&&row.dataset.outcome!==t.value);
  if(t.dataset.reason){const [sid,qid]=t.dataset.reason.split('/');data.history.find(s=>s.id===sid).rows.find(r=>r.id===qid).reason=t.value;save();}
  if(t.id==='performance-scope'){const sample=location.hash.endsWith('/sample'),history=sample?sampleHistory():data.history.filter(s=>s.rows.some(r=>!byId[r.id]?.answerStatus)),scope=t.value==='recent'?history.slice(0,3):history;$('#performance-report').innerHTML=performanceReport(allRows(scope),scope.length,smartMix(scope,byId));window.lucide?.createIcons();}
  if(t.id==='import-history'){
    try{const f=t.files[0];if(!f)return;if(f.size>20e6)throw Error('File is too large.');const v=JSON.parse(await f.text());if(![1,2].includes(v.version)||!Array.isArray(v.history))throw Error('Invalid history file.');
      for(const s of v.history){if(typeof s.id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(s.id)||typeof s.name!=='string'||!Number.isFinite(s.ended)||!Array.isArray(s.rows)||s.rows.some(r=>!byId[r.id]||!Number.isFinite(r.seconds)||r.seconds<0||!validResponse(byId[r.id],r.answer)||!Array.isArray(r.changes)||r.changes.some(c=>!validResponse(byId[r.id],c.from)||!validResponse(byId[r.id],c.to)||!Number.isFinite(c.at))||!Array.isArray(r.points)||r.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw Error('The file contains incompatible results.');}
      const ids=new Set(data.history.map(s=>s.id));data.history.push(...v.history.filter(s=>!ids.has(s.id)));data.history.sort((a,b)=>b.ended-a.ended);save();render();
    }catch(err){showModal('Import failed',esc(err.message),()=>{},'OK','');}
  }
});
document.addEventListener('click',e=>{
  if(e.target.closest('.sidebar nav a'))$('.sidebar').classList.remove('open');
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.collection){builder.source=b.dataset.collection;builder.counts=defaultCounts(builder.section);builder.pool='all';builder.expanded=[];render();return;}
  if(b.dataset.section){builder.section=b.dataset.section;builder.counts=defaultCounts(builder.section);builder.expanded=[];render();return;}
  if(b.dataset.expand){const key=b.dataset.expand;builder.expanded=builder.expanded.includes(key)?builder.expanded.filter(x=>x!==key):[...builder.expanded,key];render();return;}
  if(b.dataset.jump!==undefined){jump(+b.dataset.jump);return;}
  if(b.dataset.answer&&data.active){tick();if(!data.active)return;const r=currentR();if(r.locked)return;const a=b.dataset.answer;if(r.eliminated?.includes(a))return;if(r.answer!==a&&r.answer)r.changes.push({from:r.answer,to:a,at:r.seconds});r.answer=a;save();render();return;}
  if(b.dataset.eliminate&&data.active){const r=currentR();if(r.locked)return;const a=b.dataset.eliminate;r.eliminated??=[];r.eliminated=r.eliminated.includes(a)?r.eliminated.filter(v=>v!==a):[...r.eliminated,a];if(r.eliminated.includes(a)&&r.answer===a){r.changes.push({from:a,to:null,at:r.seconds});r.answer=null;}save();render();return;}
  switch(b.dataset.action){
    case'signout':void authController?.signOut();break;
    case'sync-now':void syncAccount();break;
    case'reload-cloud-draft':if(accountStore)showModal('Reload saved test?', '<p>This replaces the unfinished test on this device with the latest saved test from your account. Your completed tests will be kept.</p>',async()=>{try{data.active=await accountStore.reloadCloudDraft();if(data.active)data.active.paused=true;save();render();}catch{showModal('Could not reload','Check your connection and try again.',()=>{},'OK','');}},'Reload cloud test');break;
    case'menu':if(window.innerWidth>650)document.body.classList.toggle('nav-collapsed');else $('.sidebar').classList.toggle('open');break;
    case'reset-counts':builder.counts=defaultCounts(builder.section);render();break;
    case'flag':currentR().flag=!currentR().flag;save();render();break;
    case'eliminator':eliminator=!eliminator;render();break;
    case'more':moreOpen=!moreOpen;render();break;
    case'notes':notesOpen=!notesOpen;moreOpen=false;render();break;
    case'hide-time':data.active.hideTime=!data.active.hideTime;save();render();break;
    case'pause':pause();break;
    case'resume':if(accountStore?.conflict){showModal('Saved test changed','Another device saved a newer test. Use Reload cloud test before continuing.',()=>{},'OK','');break;}if(data.active){data.active.paused=false;data.active.lastTick=Date.now();save();render();}break;
    case'directions':if(currentQ().section==='Math'){showModal('Math directions','<p>Solve each problem. For multiple-choice questions, choose A, B, C, or D using the choices in the original question. For numeric questions, enter a number, decimal, or fraction.</p><p>You may move between questions, mark for review, and use Notes. Answers are revealed after submission.</p>',()=>{},'Close','');break;}showModal('Reading and Writing',`<p>Read the passage and choose the best answer from the four choices.</p><p>You may move between questions, mark questions for review, and eliminate answer choices. Only one answer may be selected.</p><p>This practice test contains ${data.active.ids.length} questions. ${data.active.timed?'The timer applies to the entire test.':'This test is untimed.'}</p>`,()=>{},'Close','');break;
    case'navigator':moreOpen=false;navigator();break;
    case'review-test':navigator(true);break;
    case'finish':moreOpen=false;confirmFinish();break;
    case'larger':readingSize=Math.min(24,readingSize+1);render();break;
    case'smaller':readingSize=Math.max(15,readingSize-1);render();break;
    case'check':if(currentR()?.answer){currentR().locked=true;save();render();}break;
    case'export':exportHistory();break;
    case'highlight':{const selection=window.getSelection(),node=selection?.anchorNode;let text=node&&$('#source-text')?.contains(node)?selection.toString().trim():pendingHighlight?.id===currentQ().id?pendingHighlight.text:'';if(!text){showModal('Highlight selection','Select text in the passage before choosing Highlight selection.',()=>{},'OK','');break;}currentR().highlights??=[];currentR().highlights.push(text.replace(/\s+/g,' '));save();selection?.removeAllRanges();pendingHighlight=null;render();break;}
    case'clear-highlights':currentR().highlights=[];pendingHighlight=null;save();render();break;
  }
});
let lastPointer=0;
document.addEventListener('selectionchange',()=>{const s=window.getSelection(),text=s?.toString().trim();if(screen==='practice'&&data.active&&text&&$('#source-text')?.contains(s.anchorNode))pendingHighlight={id:currentQ().id,text};});
document.addEventListener('pointermove',e=>{if(screen!=='practice'||!data.active?.telemetry||data.active.paused||performance.now()-lastPointer<250)return;const area=e.target.closest('#question-area');if(!area)return;lastPointer=performance.now();const r=currentR(),rect=area.getBoundingClientRect();if(r.points.length<1200)r.points.push({x:Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height)),t:Math.round(r.seconds)});});
document.addEventListener('click',e=>{if(screen==='practice'&&data.active&&!data.active.paused&&e.target.closest('#question-area'))currentR().clicks++;});
document.addEventListener('scroll',e=>{if(screen==='practice'&&data.active&&!data.active.paused&&e.target?.matches?.('.exam-passage,.exam-answer-pane'))currentR().scrolls++;},true);
document.addEventListener('keydown',e=>{if(screen!=='practice'||!data.active||data.active.paused||e.target.matches('input,textarea,select')||document.querySelector('dialog[open]'))return;if(e.target.closest('.answer-choice')&&!e.altKey&&['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();const choices=[...document.querySelectorAll('.answer-choice:not(:disabled):not(.eliminated)')];const index=choices.indexOf(e.target.closest('.answer-choice')),direction=['ArrowRight','ArrowDown'].includes(e.key)?1:-1;const next=choices[(index+direction+choices.length)%choices.length];next?.click();document.querySelector('[data-answer="'+next?.dataset.answer+'"]')?.focus();return;}if(e.altKey&&e.key==='ArrowRight'){e.preventDefault();jump(data.active.index+1);}if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();jump(data.active.index-1);}});
window.addEventListener('hashchange',()=>{if(screen==='practice'&&location.hash!=='#practice'&&data.active){tick();if(data.active){data.active.paused=true;data.active.lastTick=Date.now();}}moreOpen=false;notesOpen=false;$('.sidebar').classList.remove('open');save();render(false);window.scrollTo(0,0);});
function syncStatus({kind,text}) {
  $('#sync-status').textContent=text;
  $('#sync-toolbar').dataset.state=kind;
  $('[data-action="reload-cloud-draft"]').hidden=kind!=='conflict';
  if(kind==='conflict'&&data.active&&!data.active.paused){data.active.paused=true;save();if(appReady)render();}
}
async function syncAccount() {
  const store=accountStore;if(!store)return;
  const ok=await store.flush();
  if(!ok || store!==accountStore)return;
  try {const history=await store.refreshHistory();if(store===accountStore){data.history=history;render();}}
  catch {if(store===accountStore)syncStatus({kind:'error',text:'Could not refresh history. Check your connection and retry.'});}
}
function resetAccount({clearCache=false}={}) {
  ++accountEpoch;appReady=false;
  accountStore?.dispose({clearCache});accountStore=null;account=null;
  data={history:[],active:null};
  moreOpen=false;notesOpen=false;pendingHighlight=null;
  document.querySelectorAll('dialog').forEach(d=>d.remove());
  document.body.classList.remove('exam-mode');
  $('#app').innerHTML='';$('#account-controls').innerHTML='';$('#sync-toolbar').hidden=true;
}
authController=await mountAuth({
  onDemo:loadLocalDemo,
  onSignedOut:resetAccount,
  beforeSignOut:async()=>{
    if(!appReady)return true;
    if(data.active)pause();
    if(accountStore&&!await accountStore.flush()){
      showModal('Sync before signing out','Your changes have not all reached your account. Retry Sync now, or resolve the saved-test conflict, before signing out. You can export completed tests from Previous Tests.',()=>{},'OK','');
      return false;
    }
    return true;
  },
  onSignedIn:async({client,user})=>{
    resetAccount();const generation=accountEpoch;
    const store=new AccountStore({client,userId:user.id,storage:localStorage,onStatus:syncStatus});
    accountStore=store;account=user;
    const loaded=await store.load();
    if(generation!==accountEpoch){store.dispose();return;}
    data=loaded;
    if(store.conflict&&data.active)data.active.paused=true;
    // Never claim a shared browser's old anonymous history for a new account.
    builder={source:'college-board',section:'Reading and Writing',counts:defaultCounts(),pool:'all',tutor:false,timed:true,minutes:35,name:'',telemetry:false,
      skills:Object.fromEntries(allBuckets.map(b=>[b.id,[...new Set(bank.filter(q=>belongs(q,b)).map(q=>q.skill))]])),expanded:[]};
    $('#account-controls').innerHTML=`<span class="account-email">${esc(user.email||'Your account')}</span><button class="account-signout" data-action="signout">Sign out</button>`;
    $('#account-label').textContent='Personal practice';$('#sync-toolbar').hidden=false;
    appReady=true;render(false);if(screen==='practice')tick();
  }
});
window.addEventListener('online',()=>{if(accountStore)void accountStore.flush();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&accountStore){tick();save();void accountStore.flush();}});
