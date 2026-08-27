(() => {
'use strict';
const $=id=>document.getElementById(id);
const authCard=$('authCard'),workspace=$('workspace'),accessKey=$('accessKey'),connectBtn=$('connectBtn'),disconnectBtn=$('disconnectBtn'),authError=$('authError'),connection=$('connection'),q=$('q'),resultsEl=$('results'),view=$('view'),status=$('status'),snapshotInfo=$('snapshotInfo');
let keyText=sessionStorage.getItem('s360_staff_key')||'',index=[],prepared=[],matches=[],active=-1,meta={};

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const toks=s=>norm(s).split(/\s+/).filter(Boolean);
const money=v=>(v===''||v==null)?'—':(Number.isFinite(Number(v))?Number(v).toLocaleString()+' DH':esc(v));
const pct=v=>(v===''||v==null||!Number.isFinite(Number(v)))?'—':(Math.round(Number(v)*1000)/10)+'%';
const kv=(k,v)=>`<div class="kv"><span>${esc(k)}</span><span>${v===''||v==null?'—':v}</span></div>`;
function b64bytes(s){const bin=atob(s),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return a}
async function deriveKey(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return crypto.subtle.importKey('raw',d,{name:'AES-GCM'},false,['decrypt'])}
async function decryptEnvelope(text,key){
  const env=JSON.parse(text);
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64bytes(env.nonce)},key,b64bytes(env.ct));
  let bytes=new Uint8Array(pt);
  if(env.compression==='gzip'){
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function loadEncrypted(){
  const names=['snapshot.000','snapshot.001','snapshot.002','snapshot.003','snapshot.004','snapshot.005','snapshot.006','snapshot.007','snapshot.008','snapshot.009','snapshot.010','snapshot.011'];
  const rs=await Promise.all(names.map(n=>fetch('./'+n,{cache:'no-store'})));
  for(const r of rs)if(!r.ok)throw new Error('Snapshot file unavailable.');
  return (await Promise.all(rs.map(r=>r.text()))).join('');
}
function setConnected(on,detail=''){connection.className='connection '+(on?'online':'offline');connection.textContent=on?('Unlocked'+(detail?' · '+detail:'')):'Locked';authCard.hidden=on;workspace.hidden=!on}
function prepare(rows){return rows.map(x=>({...x,_id:norm(x.id),_name:norm(x.name),_nameTokens:toks(x.name),_aliasTokens:toks(x.aliases),_searchTokens:toks([x.id,x.name,x.phone,x.email,x.currentClass,x.latestInvoice,x.aliases].filter(Boolean).join(' '))}))}
async function unlock(){
  authError.textContent='';keyText=accessKey.value.trim()||keyText;if(!keyText){authError.textContent='Enter the staff access key.';return}
  connectBtn.disabled=true;connectBtn.textContent='Unlocking…';const t=performance.now();
  try{
    const key=await deriveKey(keyText),payload=await decryptEnvelope(await loadEncrypted(),key);
    meta=payload.meta||{};const fields=payload.fields||[];index=(payload.records||[]).map(row=>Object.fromEntries(fields.map((f,i)=>[f,row[i]??''])));prepared=prepare(index);sessionStorage.setItem('s360_staff_key',keyText);
    setConnected(true,prepared.length.toLocaleString()+' students');status.textContent=`Ready · ${Math.round(performance.now()-t)}ms · ${meta.buildId||''}`;
    snapshotInfo.innerHTML='';q.focus();
  }catch(e){sessionStorage.removeItem('s360_staff_key');keyText='';authError.textContent='Could not unlock Student 360. Check the staff key.';setConnected(false)}
  finally{connectBtn.disabled=false;connectBtn.textContent='Unlock'}
}
function lock(){keyText='';index=prepared=[];sessionStorage.removeItem('s360_staff_key');q.value='';resultsEl.hidden=true;view.className='empty';view.textContent='Start typing a student’s name or ID.';setConnected(false);accessKey.value='';accessKey.focus()}
function findMatches(query,limit=20){
  const nq=norm(query);if(!nq)return[];const terms=nq.split(/\s+/).filter(Boolean),out=[];
  for(const x of prepared){
    let score=0,ok=true;if(x._id===nq)score+=10000;if(x._name===nq)score+=5000;
    for(const term of terms){
      let s=0;
      if(x._nameTokens.includes(term))s=1200;
      else if(x._aliasTokens.includes(term))s=1100;
      else if(term.length>=2&&x._nameTokens.some(t=>t.startsWith(term)))s=700;
      else if(term.length>=2&&x._aliasTokens.some(t=>t.startsWith(term)))s=650;
      else if(x._id.startsWith(term))s=600;
      else if(term.length>=3&&x._searchTokens.some(t=>t.startsWith(term)))s=200;
      else{ok=false;break}
      score+=s;
    }
    if(ok)out.push({x,score});
  }
  out.sort((a,b)=>b.score-a.score||String(a.x.name||'').localeCompare(String(b.x.name||'')));return out.slice(0,limit).map(o=>o.x);
}
function showResults(items){
  matches=items;active=-1;
  if(!items.length){resultsEl.innerHTML='<div class="result muted">No matches</div>';resultsEl.hidden=false;return}
  resultsEl.innerHTML=items.map((x,i)=>`<div class="result" data-i="${i}"><b>${esc(x.name||'(unnamed)')}</b><span class="muted">ID ${esc(x.id)}${x.age?' · age '+esc(x.age):''}${x.currentClass?' · '+esc(x.currentClass):''}</span></div>`).join('');
  resultsEl.hidden=false;resultsEl.querySelectorAll('.result[data-i]').forEach(el=>el.onclick=()=>openStudent(items[Number(el.dataset.i)]));
}
function alertChips(row){return String(row.alertCodes||'').split('|').filter(Boolean).map(a=>`<span class="chip warn">${esc(a)}</span>`).join('')}
function openStudent(r){
  resultsEl.hidden=true;q.value=r.name||r.id||'';
  const att=r.attendanceStatus==='HAS_DATA'?`${pct(r.attendanceRate)}${r.latestAttendance?' · '+esc(r.latestAttendance):''}`:esc(r.attendanceStatus||'—');
  const fin=r.financeStatus==='DATA_REQUIRES_REVIEW'?'<span class="error">DATA REQUIRES REVIEW</span>':money(r.paymentsAttributed);
  const outstanding=r.outstanding==='UNKNOWN'||r.outstanding===''?'UNKNOWN':money(r.outstanding);
  view.className='';view.innerHTML=`
  ${r.alertCodes?`<div class="card banner"><b>Needs attention</b><div class="chips">${alertChips(r)}</div></div>`:''}
  <div class="hero">
    <section class="card"><div class="name">${esc(r.name)}</div><div class="muted">Student ID ${esc(r.id)} · ${esc(r.directoryStatus||'')}</div><div class="chips">${r.currentClass?`<span class="chip good">${esc(r.currentClass)}</span>`:''}${r.placement?`<span class="chip">${esc(r.placement)}</span>`:''}</div></section>
    <section class="card">${kv('Age',esc(r.age||'—'))}${kv('Phone',esc(r.phone||'—'))}${kv('Email',esc(r.email||'—'))}${kv('Data quality',esc(r.dataQuality||'—'))}</section>
  </div>
  <div class="grid">
    <section class="card"><h3>Current class</h3>${kv('Class',esc(r.currentClass||'—'))}${kv('Teacher',esc(r.teacher||'—'))}${kv('Roster',esc(r.roster||'—'))}</section>
    <section class="card"><h3>Placement</h3>${kv('Summary',esc(r.placement||'—'))}${kv('Pathway',esc(r.placementPathway||'—'))}</section>
    <section class="card"><h3>Attendance</h3>${kv('Status',att)}</section>
    <section class="card"><h3>Finance</h3>${kv('Latest invoice',esc(r.latestInvoice||'—'))}${kv('Payments attributed',fin)}${kv('Outstanding',outstanding)}</section>
    <section class="card wide"><h3>Snapshot provenance</h3>${kv('Build',esc(meta.buildId||'—'))}${kv('Updated',esc(meta.updatedAt||'—'))}<div class="muted">This production core comes from the validated Canonical DB snapshot. No Google Drive page or Apps Script page is used to open the app.</div></section>
  </div>`;
}
q.addEventListener('input',()=>showResults(findMatches(q.value)));
q.addEventListener('keydown',e=>{const els=[...resultsEl.querySelectorAll('.result[data-i]')];if(e.key==='Escape'){resultsEl.hidden=true;return}if(!els.length)return;if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(active+1,els.length-1)}else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(active-1,0)}else if(e.key==='Enter'){e.preventDefault();const row=matches[active>=0?active:0];if(row)openStudent(row);return}els.forEach((el,i)=>el.classList.toggle('active',i===active))});
connectBtn.addEventListener('click',unlock);accessKey.addEventListener('keydown',e=>{if(e.key==='Enter')unlock()});disconnectBtn.addEventListener('click',lock);document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))resultsEl.hidden=true});
snapshotInfo.innerHTML='<div class="snapshot">Encrypted canonical snapshot ready. Unlock to load Student 360.</div>';
if(keyText){accessKey.value=keyText;unlock()}else{setConnected(false);accessKey.focus()}
})();