
async function api(url, opts){
  const r = await fetch(url, opts);
  const type = r.headers.get('content-type')||'';
  const isJson = type.includes('application/json');
  const data = isJson ? await r.json() : await r.text();
  return { ok: r.ok && (data.ok ?? true), raw: r, data };
}
function toast(msg, kind='ok'){
  let t = document.querySelector('.toast'); if(!t){ t = document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
  const div = document.createElement('div'); div.className = 'item '+(kind==='err'?'err':'ok'); div.textContent = msg;
  t.appendChild(div); setTimeout(()=>{ div.style.opacity='0'; div.style.transform='translateY(6px)'; setTimeout(()=>div.remove(), 300); }, 2600);
}
