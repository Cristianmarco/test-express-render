// Licitaciones (refactor) - ASCII only to avoid encoding issues

let licSeleccionada = null; // selected licitacion number
let licFamilias = []; // cache familias for datalist
let vigSeleccionada = null; // id seleccionada en R.Vigentes
let garSeleccionada = null; // item seleccionado en garantias
const garSeleccionMultiple = new Set(); // ids marcados para eliminación múltiple
let garSeleccionAnchorIndex = null; // último índice usado para selección por shift

function buildGarantiaFromRow(tr) {
  if (!tr) return null;
  return {
    id: tr.dataset.id,
    id_cliente: tr.dataset.idcliente || '',
    ingreso: tr.dataset.ingreso || '',
    cabecera: tr.dataset.cabecera || '',
    interno: tr.dataset.interno || '',
    codigo: tr.dataset.codigo || '',
    alt: tr.dataset.alt || '',
    cantidad: tr.dataset.cantidad || '',
    notificacion: tr.dataset.notificacion || '',
    notificado_en: tr.dataset.notificado || '',
    detalle: tr.dataset.detalle || '',
    recepcion: tr.dataset.recepcion || '',
    cod_proveedor: tr.dataset.codprov || '',
    proveedor: tr.dataset.proveedor || '',
    ref_proveedor: tr.dataset.refprov || '',
    ref_proveedor_alt: tr.dataset.refprov2 || '',
    resolucion: tr.dataset.resolucion || ''
  };
}

function applyGarantiaSelectionStyles() {
  const tbody = document.getElementById('tbody-garantias');
  if (!tbody) return;
  tbody.querySelectorAll('tr').forEach(tr => {
    const id = tr.dataset.id;
    if (!id) return;
    tr.classList.toggle('multi-selected', garSeleccionMultiple.has(id) && garSeleccionMultiple.size > 1);
    if (garSeleccionada && garSeleccionada.id === id) tr.classList.add('selected');
    else tr.classList.remove('selected');
  });
}
let garImportBusy = false;

async function cargarLicitaciones() {
  const tbody = document.getElementById('tbody-licitaciones');
  if (!tbody) return;
  // asegurar encabezado con columna Cliente
  try {
    const theadRow = tbody.closest('table')?.querySelector('thead tr');
    if (theadRow && !theadRow._clienteAdded) {
      const firstTh = theadRow.querySelector('th');
      const th = document.createElement('th');
      th.textContent = 'Cliente';
      theadRow.insertBefore(th, firstTh || null);
      theadRow._clienteAdded = true;
    }
  } catch {}
  tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>";
  try {
    const res = await fetch('/api/licitaciones', { credentials: 'include' });
    const data = await res.json();
    const lista = Array.isArray(data) ? data : [];
    if (lista.length === 0) {
      tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:10px; color:#666'>Sin licitaciones.</td></tr>";
      return;
    }
    const fmt = (d)=>{ if(!d) return '-'; try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d); } };
    tbody.innerHTML = lista.map(l => `
      <tr data-nro="${l.nro_licitacion}">
        <td>${l.cliente_razon || l.cliente_codigo || '-'}</td>
        <td>${l.nro_licitacion}</td>
        <td>${fmt(l.fecha)}</td>
        <td>${fmt(l.fecha_cierre)}</td>
        <td>${l.observacion || '-'}</td>
        <td>
          <button class="icon-button-erp visualizar btn-ver-licitacion" data-nro="${l.nro_licitacion}" title="Ver">
            <i class="fas fa-sign-in-alt"></i>
          </button>
        </td>
      </tr>
    `).join('');

    tbody.onclick = (e) => {
      const tr = e.target.closest('tr');
      if (tr && tr.dataset.nro) {
        licSeleccionada = tr.dataset.nro;
        tbody.querySelectorAll('tr').forEach(r=> r.classList.remove('selected'));
        tr.classList.add('selected');
      }
      const btn = e.target.closest('.btn-ver-licitacion');
      if (btn) {
        const nro = btn.getAttribute('data-nro');
        if (nro) verDetalleLicitacion(nro);
      }
    };
  } catch (err) {
    console.error('Error cargando licitaciones:', err);
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:10px; color:red'>Error al cargar.</td></tr>";
  }
}

async function verDetalleLicitacion(nro) {
  const modal = document.getElementById('modal-licitacion-detalle');
  const tBody = document.getElementById('tbody-licitacion-items');
  const nEl = document.getElementById('lic-det-nro');
  const fEl = document.getElementById('lic-det-fecha');
  const cEl = document.getElementById('lic-det-cierre');
  const oEl = document.getElementById('lic-det-observacion');
  if (!modal || !tBody) return;
  modal.style.display = 'flex';
  try {
    const hdr = modal.querySelector('thead tr');
    if (hdr && !hdr._accionAdded) { const th = document.createElement('th'); th.textContent = 'Acción'; hdr.appendChild(th); hdr._accionAdded = true; }
  } catch {}
  tBody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>";
  try {
    const res = await fetch(`/api/licitaciones/${encodeURIComponent(nro)}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    const fmt = (d)=>{ if(!d) return '-'; try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d); } };
    if (nEl) nEl.textContent = nro;
    if (fEl) fEl.textContent = fmt(data.fecha);
    if (cEl) cEl.textContent = fmt(data.fecha_cierre);
    if (oEl) oEl.textContent = data.observacion || '-';
    let items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      try {
        const rIt = await fetch(`/api/licitaciones/${encodeURIComponent(nro)}/items`, { credentials: 'include' });
        const js = await rIt.json();
        if (Array.isArray(js)) items = js;
      } catch {}
    }
    if (!items.length) {
      tBody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:10px; color:#666'>Sin items.</td></tr>";
    } else {
      tBody.innerHTML = items.map(it => `
        <tr>
          <td>${it.codigo || '-'}</td>
          <td>${it.descripcion || '-'}</td>
          <td>${it.cantidad || '-'}</td>
          <td>${it.estado || '-'}</td>
          <td><button type="button" class="btn-aceptar btn-aceptar-item" data-codigo="${(it.codigo||'').replace(/\"/g,'&quot;')}" data-desc="${(it.descripcion||'').replace(/\"/g,'&quot;')}" data-cant="${it.cantidad||''}">Aceptado</button></td>
        </tr>
      `).join('');
      tBody.querySelectorAll('.btn-aceptar-item').forEach(btn => {
        if (!btn._bound) {
          btn._bound = true;
          btn.addEventListener('click', () => abrirModalAceptarItem({
            codigo: btn.getAttribute('data-codigo'),
            descripcion: btn.getAttribute('data-desc'),
            cantidad: Number(btn.getAttribute('data-cant')||'0')||1,
            originBtn: btn,
          }));
        }
      });
      // Post-procesar: marcar ya aceptados (R.Vigentes) SOLO de esta licitación
      try {
        const rv = await fetch('/api/reparaciones_dota', { credentials: 'include' });
        const arr = await rv.json();
        if (Array.isArray(arr)) {
          const acc = new Set();
          const nroStr = String(nro||'').trim();
          arr.forEach(r => {
            // Solo considerar los vigentes que pertenecen a esta licitación (nro_pedido)
            if (String(r.nro_pedido||'').trim() !== nroStr) return;
            const c=(r.codigo||'').toString().trim().toLowerCase();
            const d=(r.descripcion||'').toString().trim().toLowerCase();
            acc.add(c);
            acc.add(c+'|'+d);
          });
          tBody.querySelectorAll('.btn-aceptar-item').forEach(b=>{
            const c=(b.getAttribute('data-codigo')||'').trim().toLowerCase();
            const d=(b.getAttribute('data-desc')||'').trim().toLowerCase();
            if (acc.has(c) || acc.has(c+'|'+d)) { b.classList.add('btn-accepted'); b.disabled=true; b.title='Ya aceptado'; }
          });
        }
      } catch {}
    }
  } catch (err) {
    console.error('Error detalle licitacion:', err);
    tBody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:10px; color:red'>Error al cargar.</td></tr>";
  }
}

// Modal pequeño para aceptar ítem
function ensureAceptarModal(){
  if (document.getElementById('modal-aceptar-licit-item')) return;
  const m = document.createElement('div');
  m.id = 'modal-aceptar-licit-item';
  m.className = 'modal-refactor';
  m.style.display = 'none';
  m.innerHTML = `
    <div class="modal-contenido-refactor modal-erp-producto" style="max-width:520px;">
      <span class="cerrar" id="btn-close-aceptar">&times;</span>
      <h2 class="modal-titulo-principal"><i class="fas fa-check"></i> Aceptar Ítem</h2>
      <form id="form-aceptar-licit-item" autocomplete="off" style="display:flex; flex-direction:column; gap:10px;">
        <div class="form-grid">
          <div>
            <label>N° de Orden</label>
            <input type="text" id="acept-nro" placeholder="Opcional" />
          </div>
        </div>
        <div class="form-grid">
          <div>
            <label>Destino</label>
            <input type="text" id="acept-destino" placeholder="Taller/Depósito" />
          </div>
        </div>
        <div class="form-grid">
          <div>
            <label>Razón Social</label>
            <select id="acept-razon">
              <option value="">Seleccione</option>
            </select>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button type="submit" class="btn-aceptar"><i class="fas fa-check"></i> Aceptar</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(m);
  const close = ()=>{ m.style.display='none'; };
  m.querySelector('#btn-close-aceptar').addEventListener('click', close);
  const form = m.querySelector('#form-aceptar-licit-item');
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const ds = form.dataset || {};
    const payload = {
      codigo: ds.codigo,
      descripcion: ds.descripcion,
      cantidad: Number(ds.cantidad||'1')||1,
      nro_pedido: (document.getElementById('acept-nro').value||'').trim(),
      destino: document.getElementById('acept-destino').value.trim(),
      razon_social: (document.getElementById('acept-razon').value || '').trim()
    };
    try{
      const res = await fetch('/api/reparaciones_dota', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const js = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(js.error||'No se pudo aceptar');
      alert('Ítem aceptado y enviado a Reparaciones Vigentes.');
      close();
      try{ if(window._aceptarOriginBtn){ window._aceptarOriginBtn.classList.add('btn-accepted'); window._aceptarOriginBtn.disabled = true; window._aceptarOriginBtn.title='Ya aceptado'; window._aceptarOriginBtn = null; } }catch{}
    }catch(err){ alert(err.message||'No se pudo aceptar'); }
  });
}

let _aceptarOriginBtn = null;
function abrirModalAceptarItem({ codigo, descripcion, cantidad, originBtn }){
  ensureAceptarModal();
  const m = document.getElementById('modal-aceptar-licit-item');
  const f = document.getElementById('form-aceptar-licit-item');
  if (m && f) {
    _aceptarOriginBtn = originBtn || null;
    try { window._aceptarOriginBtn = _aceptarOriginBtn; } catch {}
    f.dataset.codigo = codigo || '';
    f.dataset.descripcion = descripcion || '';
    f.dataset.cantidad = String(cantidad || 1);
    const nroInput = document.getElementById('acept-nro');
    if (nroInput) nroInput.value='';
    document.getElementById('acept-destino').value='';
    const sel = document.getElementById('acept-razon');
    // cargar clientes si aún no cargó
    if (sel && !sel._loaded) {
      sel._loaded = true;
      fetch('/api/clientes', { credentials:'include' })
        .then(r=>r.json()).then(arr=>{
          const list = Array.isArray(arr)? arr : [];
          sel.innerHTML = '<option value="">Seleccione</option>' + list.map(c=>{
            const name = (c.razon_social || c.fantasia || '').toString();
            const safe = name.replace(/\"/g,'&quot;');
            return `<option value="${safe}">${safe}</option>`;
          }).join('');
        }).catch(()=>{});
    } else if (sel) {
      sel.value = '';
    }
    m.style.display = 'flex';
  }
}

function bindLicitacionesView() {
  const tbody = document.getElementById('tbody-licitaciones');
  if (!tbody) return;
  cargarLicitaciones();
}

if (document.querySelector('[data-view="licitaciones"]')) {
  document.addEventListener('view:changed', (e)=>{
    if (e.detail === 'licitaciones') setTimeout(()=>{
      bindLicitacionesView();
      bindLicitacionesPanel();
      bindGarantiasPanel();
      setupLicitacionesTabs();
      bindLicitacionesDeselect();
      bindVigentesDeselect();
    }, 50);
  });
  bindLicitacionesView();
  bindLicitacionesPanel();
  bindGarantiasPanel();
  setupLicitacionesTabs();
  bindLicitacionesDeselect();
  bindVigentesDeselect();
}

// ---------- Panel y ABM ----------

function bindLicitacionesPanel() {
  
  const tbody = document.getElementById('tbody-licitaciones');
  if (tbody && !tbody._selBound) {
    tbody._selBound = true;
    tbody.addEventListener('click', (e)=>{
      const tr = e.target.closest('tr');
      if (tr && tr.dataset.nro) {
        licSeleccionada = tr.dataset.nro;
        tbody.querySelectorAll('tr').forEach(r=> r.classList.remove('selected'));
        tr.classList.add('selected');
      }
    });
  }
  const btnAdd = document.getElementById('btn-lic-agregar');
  const btnEdit = document.getElementById('btn-lic-modificar');
  const btnDel = document.getElementById('btn-lic-eliminar');
  if (btnAdd && !btnAdd._bound){ btnAdd._bound = true; btnAdd.addEventListener('click', ()=>{ if(isVigenteActiveView()) abrirModalVigenteABM(); else abrirModalABMLicitacion(); }); }
  if (btnEdit && !btnEdit._bound){ btnEdit._bound = true; btnEdit.addEventListener('click', async ()=>{
    if (isVigenteActiveView()) {
      if (!vigSeleccionada){ alert('Seleccione una reparación vigente.'); return; }
      const row = document.querySelector(`#tbody-vigentes tr[data-id="${vigSeleccionada}"]`);
      if(!row){ alert('No se pudo localizar la fila.'); return; }
      const data = {
        id: vigSeleccionada,
        nro_pedido: row.dataset.nro || '',
        codigo: row.dataset.codigo || '',
        descripcion: row.dataset.descripcion || '',
        cantidad: Number(row.dataset.cantidad||'')||1,
        destino: row.dataset.destino || '',
        razon_social: row.dataset.razon || '',
        pendientes: (row.dataset.pendientes!==undefined? Number(row.dataset.pendientes) : null)
      };
      abrirModalVigenteABM(data);
    } else {
      if (!licSeleccionada) { alert('Seleccione una licitacion.'); return; }
      try{
        const res = await fetch(`/api/licitaciones/${encodeURIComponent(licSeleccionada)}`, { credentials:'include' });
        const data = await res.json(); if(!res.ok) throw new Error(data.error||'Error');
        abrirModalABMLicitacion(data, licSeleccionada);
      }catch{ alert('No se pudo cargar la licitacion.'); }
    }
  }); }
  if (btnDel && !btnDel._bound){ btnDel._bound = true; btnDel.addEventListener('click', async ()=>{
    if (isVigenteActiveView()){
      if (!vigSeleccionada){ alert('Seleccione una reparación vigente.'); return; }
      if (!confirm('Eliminar reparación vigente seleccionada?')) return;
      try{ const r = await fetch(`/api/reparaciones_dota/${vigSeleccionada}`, { method:'DELETE', credentials:'include' }); const p = await r.json(); if(!r.ok) throw new Error(p.error||'Error'); vigSeleccionada=null; cargarVigentes(); }catch{ alert('No se pudo eliminar.'); }
      return;
    }
    if (!licSeleccionada) { alert('Seleccione una licitacion.'); return; }
    if (!confirm(`Eliminar licitacion ${licSeleccionada}?`)) return;
    try{
      const res = await fetch(`/api/licitaciones/${encodeURIComponent(licSeleccionada)}`, { method:'DELETE', credentials:'include' });
      const payload = await res.json(); if(!res.ok) throw new Error(payload.error||'Error');
      licSeleccionada=null; cargarLicitaciones();
    }catch{ alert('No se pudo eliminar.'); }
  }); }
}

async function abrirModalABMLicitacion(data, originalNro){
  const modal = document.getElementById('modal-licitacion-abm');
  const form = document.getElementById('form-licitacion');
  const titems = document.getElementById('tbody-lic-items');
  const title = document.getElementById('lic-abm-title');
  if(!modal || !form || !titems) return;
  // Inject client select if missing and load options
  try {
    if (!document.getElementById('lic-cliente')) {
      const grid = document.createElement('div');
      grid.className = 'form-grid doble';
      grid.innerHTML = `
        <div>
          <label for="lic-cliente">Cliente *</label>
          <select name="cliente_codigo" id="lic-cliente" required></select>
        </div>
      `;
      form.insertBefore(grid, form.firstElementChild);
    }
    const sel = document.getElementById('lic-cliente');
    if (sel && !sel._loaded) {
      sel._loaded = true;
      let clientes = [];
      try {
        const rc = await fetch('/api/clientes', { credentials:'include' });
        clientes = await rc.json();
        if (!Array.isArray(clientes)) clientes = [];
      } catch { clientes = []; }
      sel.innerHTML = clientes.map(c => {
        const val = (c.codigo||'').toString();
        const txt = (c.razon_social || c.fantasia || c.codigo || '').toString();
        return `<option value="${val.replace(/\\\"/g,'&quot;')}">${txt.replace(/\\\"/g,'&quot;')}</option>`;
      }).join('');
      // preferir DOTA por defecto (normalizando texto y código)
      const norm = (s)=> (s||'').toString().toLowerCase().replace(/[^a-z0-9]/g,'');
      let prefer = clientes.find(c => norm(c.razon_social).includes('dota') || norm(c.fantasia).includes('dota') || norm(c.codigo)==='dota');
      if (prefer && prefer.codigo!=null) {
        sel.value = String(prefer.codigo);
      } else {
        const options = Array.from(sel.options);
        const found = options.find(o => norm(o.textContent).includes('dota') || norm(o.value)==='dota');
        if (found) sel.value = found.value; else if (options[0]) sel.value = options[0].value;
      }
    }
  } catch {}
  form.reset(); titems.innerHTML=''; form.dataset.originalNro = originalNro||'';
  // Si es nueva licitación, forzar default del cliente a DOTA SRL/DOTA
  if (!data) {
    try {
      const sel = document.getElementById('lic-cliente');
      if (sel) {
        const norm = (s)=> (s||'').toString().toLowerCase().replace(/[^a-z0-9]/g,'');
        const options = Array.from(sel.options);
        const foundExact = options.find(o => norm(o.textContent)==='dotasrl' || norm(o.value)==='dotasrl');
        const found = foundExact || options.find(o => norm(o.textContent).includes('dota') || norm(o.value)==='dota');
        if (found) sel.value = found.value;
        // fallback asíncrono por si las opciones cargan luego del fetch
        setTimeout(()=>{
          const opts = Array.from(sel.options);
          const fExact = opts.find(o => norm(o.textContent)==='dotasrl' || norm(o.value)==='dotasrl');
          const f = fExact || opts.find(o => norm(o.textContent).includes('dota') || norm(o.value)==='dota');
          if (f) sel.value = f.value;
        }, 200);
      }
    } catch {}
  }
  if (title) title.innerHTML = `<i class="fas fa-file-signature"></i> ${originalNro? 'Modificar' : 'Nueva'} Licitacion`;
  // prepare familias datalist (one-time fetch)
  try{
    const dlId = 'lic-familias-dl';
    let dl = modal.querySelector(`#${dlId}`);
    if(!dl){ dl = document.createElement('datalist'); dl.id = dlId; form.prepend(dl); }
    if(licFamilias.length===0){
      const r = await fetch('/api/familias', { credentials:'include' });
      const arr = await r.json();
      licFamilias = Array.isArray(arr)? arr : [];
    }
    const opts = licFamilias.map(f=> `<option value="${(f.codigo||'').replace(/\"/g,'&quot;')}">${(f.descripcion||'').replace(/\"/g,'&quot;')}</option>`).join('');
    dl.innerHTML = opts;
  }catch{}
  if (data) {
    document.getElementById('lic-nro').value = data.nro_licitacion || originalNro || '';
    document.getElementById('lic-fecha').value = data.fecha ? String(data.fecha).slice(0,10) : '';
    document.getElementById('lic-cierre').value = data.fecha_cierre ? String(data.fecha_cierre).slice(0,10) : '';
    document.getElementById('lic-obs').value = data.observacion || '';
    try { const sel = document.getElementById('lic-cliente'); if (sel && data.cliente_codigo) sel.value = data.cliente_codigo; } catch {}
    const items = Array.isArray(data.items)? data.items : [];
    if (items.length) items.forEach(addItemRowFromData); else addEmptyItemRow();
  } else { addEmptyItemRow(); }
  const btnAddItem = document.getElementById('btn-lic-add-item');
  if (btnAddItem && !btnAddItem._bound) { btnAddItem._bound = true; btnAddItem.addEventListener('click', addEmptyItemRow); }  // Delegate pick-familia in items table
  if (!titems._familiaBound) {
    titems._familiaBound = true;
    titems.addEventListener('click', (e)=>{
      const btn = e.target.closest('.btn-pick-familia');
      if (!btn) return;
      const row = e.target.closest('tr');
      if (!row) return;
      abrirModalLicFamilias(row);
    });
  }
  if (!form._bound) {
    form._bound = true;
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const nro = document.getElementById('lic-nro').value.trim();
      const fecha = document.getElementById('lic-fecha').value;
      const fecha_cierre = document.getElementById('lic-cierre').value;
      const observacion = document.getElementById('lic-obs').value.trim();
      const items = collectItems();
      const cliente_codigo = document.getElementById('lic-cliente')?.value || null;
      if (!nro || !fecha || !fecha_cierre || items.length===0) { alert('Complete datos e ingrese al menos un item.'); return; }
      const editing = !!form.dataset.originalNro;
      const url = editing ? `/api/licitaciones/${encodeURIComponent(form.dataset.originalNro)}` : '/api/licitaciones';
      const method = editing ? 'PUT' : 'POST';
      try {
        const res = await fetch(url, { method, credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ nro_licitacion: nro, fecha, fecha_cierre, observacion, cliente_codigo, items }) });
        const payload = await res.json(); if(!res.ok) throw new Error(payload.error||'Error');
        modal.style.display='none'; licSeleccionada=nro; cargarLicitaciones();
      } catch { alert('No se pudo guardar.'); }
    });
  }
  modal.style.display='flex'; setTimeout(()=>{ try{ modal.querySelector('.modal-contenido-refactor')?.scrollTo(0,0);}catch{} },0);
}

function addEmptyItemRow(){ addItemRowFromData({}); }
function addItemRowFromData(it){
  const titems = document.getElementById('tbody-lic-items'); if(!titems) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="input-codigo" placeholder="Codigo" value="${it.codigo||''}" list="lic-familias-dl"></td>
    <td><input class="input-desc" placeholder="Descripcion" value="${(it.descripcion||'').replace(/\"/g,'&quot;')}"></td>
    <td><input class="input-cant" type="number" min="0" step="1" value="${it.cantidad||''}"></td>
    <td>
      <select class="input-estado">
        <option value="no cotizado" ${(!it.estado || String(it.estado||'').toLowerCase()==='no cotizado')?'selected':''}>No cotizado</option>
        <option value="cotizado" ${String(it.estado||'').toLowerCase()==='cotizado'?'selected':''}>Cotizado</option>
      </select>
    </td>
    <td><button type="button" class="btn-secundario btn-eliminar-item"><i class="fas fa-times"></i></button></td>
  `;
  titems.appendChild(tr); tr.querySelector('.btn-eliminar-item').addEventListener('click', ()=> tr.remove());
  const codeInput = tr.querySelector('.input-codigo');
  const descInput = tr.querySelector('.input-desc');
  if(codeInput && descInput && !codeInput._bound){
    codeInput._bound = true;
    codeInput.addEventListener('change', ()=>{
      const v = (codeInput.value||'').toLowerCase().trim();
      const f = licFamilias.find(x=> (x.codigo||'').toLowerCase()===v);
      if(f){ descInput.value = f.descripcion||''; }
    });
  }
}

function collectItems(){
  const titems = document.getElementById('tbody-lic-items'); if(!titems) return [];
  const items = []; titems.querySelectorAll('tr').forEach(tr=>{
    const codigo = tr.querySelector('.input-codigo')?.value.trim();
    const descripcion = tr.querySelector('.input-desc')?.value.trim();
    const cantidadStr = tr.querySelector('.input-cant')?.value; const estado = tr.querySelector('.input-estado')?.value.trim();
    const cantidad = cantidadStr ? Number(cantidadStr) : null;
    if (codigo && descripcion && (cantidad!=null)) items.push({ codigo, descripcion, cantidad, estado });
  });
  return items;
}

// Modal ABM para R.Vigentes (agregar/editar manualmente)
function ensureVigenteModal(){
  if (document.getElementById('modal-vigente-abm')) return;
  const m = document.createElement('div');
  m.id = 'modal-vigente-abm'; m.className='modal-refactor'; m.style.display='none';
  m.innerHTML = `
    <div class="modal-contenido-refactor modal-erp-producto" style="max-width:560px;">
      <span class="cerrar" id="btn-close-vigente">&times;</span>
      <h2 class="modal-titulo-principal"><i class="fas fa-tools"></i> Reparación Vigente</h2>
      <form id="form-vigente" autocomplete="off" style="display:flex; flex-direction:column; gap:10px;">
        <div class="form-grid doble">
          <div>
            <label>Código *</label>
            <input type="text" id="vig-codigo" required />
          </div>
          <div>
            <label>Cantidad *</label>
            <input type="number" id="vig-cantidad" min="1" step="1" required />
          </div>
        </div>
        <div class="form-grid">
          <div>
            <label>Descripción *</label>
            <input type="text" id="vig-descripcion" required />
          </div>
        </div>
        <div class="form-grid doble">
          <div>
            <label>N° Orden</label>
            <input type="text" id="vig-nro" />
          </div>
          <div>
            <label>Pendientes</label>
            <input type="number" id="vig-pendientes" min="0" step="1" />
          </div>
        </div>
        <div class="form-grid doble">
          <div>
            <label>Destino</label>
            <input type="text" id="vig-destino" />
          </div>
          <div>
            <label>Razón Social</label>
            <select id="vig-razon"><option value="">Seleccione</option></select>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button type="submit" class="btn-aceptar"><i class="fas fa-save"></i> Guardar</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(m);
  m.querySelector('#btn-close-vigente').addEventListener('click', ()=> m.style.display='none');
  const form = m.querySelector('#form-vigente');
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const id = form.dataset.id || '';
    const payload = {
      codigo: document.getElementById('vig-codigo').value.trim(),
      descripcion: document.getElementById('vig-descripcion').value.trim(),
      cantidad: Number(document.getElementById('vig-cantidad').value||'1')||1,
      nro_pedido: document.getElementById('vig-nro').value.trim()||null,
      destino: document.getElementById('vig-destino').value.trim()||null,
      razon_social: document.getElementById('vig-razon').value.trim()||null,
      pendientes: (document.getElementById('vig-pendientes').value!==''? Number(document.getElementById('vig-pendientes').value) : undefined)
    };
    if (!payload.codigo || !payload.descripcion){ alert('Complete código y descripción'); return; }
    const method = id? 'PUT' : 'POST';
    const url = id? `/api/reparaciones_dota/${id}` : '/api/reparaciones_dota';
    try{
      const r = await fetch(url, { method, credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const js = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(js.error||'Error');
      m.style.display='none'; cargarVigentes();
    }catch(err){ alert('No se pudo guardar'); }
  });
}

function abrirModalVigenteABM(data){
  ensureVigenteModal();
  const m = document.getElementById('modal-vigente-abm');
  const f = document.getElementById('form-vigente');
  // cargar clientes para select si no cargó
  const sel = document.getElementById('vig-razon');
  if (sel && !sel._loaded){ sel._loaded=true; fetch('/api/clientes',{credentials:'include'}).then(r=>r.json()).then(arr=>{ const list=Array.isArray(arr)?arr:[]; sel.innerHTML='<option value="">Seleccione</option>'+list.map(c=>{const n=(c.razon_social||c.fantasia||'').toString().replace(/\"/g,'&quot;'); return `<option value="${n}">${n}</option>`;}).join(''); }).catch(()=>{}); }
  if (data){
    f.dataset.id = data.id||'';
    document.getElementById('vig-codigo').value = data.codigo||'';
    document.getElementById('vig-descripcion').value = data.descripcion||'';
    document.getElementById('vig-cantidad').value = data.cantidad||1;
    document.getElementById('vig-nro').value = data.nro_pedido||'';
    document.getElementById('vig-destino').value = data.destino||'';
    document.getElementById('vig-razon').value = data.razon_social||'';
    document.getElementById('vig-pendientes').value = (data.pendientes!=null? data.pendientes : '');
  } else {
    f.dataset.id='';
    document.getElementById('vig-codigo').value = '';
    document.getElementById('vig-descripcion').value = '';
    document.getElementById('vig-cantidad').value = 1;
    document.getElementById('vig-nro').value = '';
    document.getElementById('vig-destino').value = '';
    document.getElementById('vig-razon').value = '';
    document.getElementById('vig-pendientes').value = '';
  }
  m.style.display='flex';
}
// -------- Deseleccion al clickear fuera de la tabla --------
function clearLicitacionSelection(){
  const tbody = document.getElementById('tbody-licitaciones');
  if (!tbody) return;
  tbody.querySelectorAll('tr.selected').forEach(r=> r.classList.remove('selected'));
  licSeleccionada = null;
}

function bindLicitacionesDeselect(){
  if (document._licDeselectBound) return;
  document._licDeselectBound = true;
  document.addEventListener('click', (e)=>{
    const tbody = document.getElementById('tbody-licitaciones');
    if (!tbody) return;
    const table = tbody.closest('table');
    const det = document.getElementById('modal-licitacion-detalle');
    const abm = document.getElementById('modal-licitacion-abm');
    const isModalOpen = (det && det.style.display==='flex') || (abm && abm.style.display==='flex');
    if (isModalOpen) return;
    const insideTable = !!e.target.closest('table');
    const insidePanel = !!e.target.closest('.erp-panel-flotante');
    if (insideTable || insidePanel) return;
    // Asegurarse que estamos en la vista licitaciones visible
    const viewRoot = document.querySelector('[data-view="licitaciones"]');
    if (!viewRoot || viewRoot.style.display==='none') return;
    clearLicitacionSelection();
  }, true);
}

// -------- Tabs: Licitaciones / R.Vigentes --------
function setupLicitacionesTabs(){
  try{
    const host = document.querySelector('[data-view="licitaciones"]');
    if(!host) return;
    if(host._tabsInit) return;
    // Si existen pestañas estáticas en el EJS, solo enlazamos los eventos
    const tabsBar = document.getElementById('lic-tabs');
    const tabLicEl = document.getElementById('lic-tab');
    const tabVigEl = document.getElementById('vig-tab');
    const tabGarEl = document.getElementById('gar-tab');
    const panelLic = document.getElementById('lic-panel');
    const panelGar = document.getElementById('gar-panel');
    const btnVigClear = document.getElementById('btn-vig-clear');
    if (tabsBar && tabLicEl && tabVigEl) {
      host._tabsInit = true;
      const activate = (which) => {
        tabsBar.querySelectorAll('button[data-tab]').forEach(x=> x.classList.remove('tab-active'));
        const btn = tabsBar.querySelector(`button[data-tab="${which}"]`);
        if (btn) btn.classList.add('tab-active');
        tabLicEl.style.display = which==='lic'? 'block' : 'none';
        tabVigEl.style.display = which==='vig'? 'block' : 'none';
        if (tabGarEl) tabGarEl.style.display = which==='gar' ? 'block' : 'none';
        if (panelLic) panelLic.style.display = which==='gar' ? 'none' : 'flex';
        if (panelGar) panelGar.style.display = which==='gar' ? 'flex' : 'none';
        if (btnVigClear) btnVigClear.style.display = which==='vig' ? 'inline-flex' : 'none';
        if(which==='vig') cargarVigentes();
        if(which==='gar') cargarGarantias();
      };

      tabsBar.addEventListener('click', (e)=>{
        const b = e.target.closest('button[data-tab]'); if(!b) return;
        const which = b.getAttribute('data-tab');
        activate(which);
      });
      activate('lic');
      if (btnVigClear && !btnVigClear._bound){
        btnVigClear._bound = true;
        btnVigClear.addEventListener('click', ()=>{
          clearVigenteSelection();
        });
      }
      return; // no construir dinamicamente
    }
    host._tabsInit = true;
    const mainCard = host.querySelector('.erp-main-card'); if(!mainCard) return;
    if (mainCard._tabsBuilt) return;
    // localizar el bloque principal de la tabla por su tbody específico
    const bodyLic = document.getElementById('tbody-licitaciones');
    let tableCard = bodyLic ? bodyLic.closest('.erp-table-card') : null;
    if (!tableCard) {
      // fallback a primer .erp-table-card directa
      const directCards = Array.from(mainCard.children).filter(el=> el.classList && el.classList.contains('erp-table-card'));
      tableCard = directCards.length ? directCards[0] : mainCard.querySelector('.erp-table-card');
    }
    if(!tableCard) return;
    mainCard._tabsBuilt = true;
    // panel flotante asociado (acciones agregar/modificar/eliminar)
    let panel = tableCard.nextElementSibling && tableCard.nextElementSibling.classList && tableCard.nextElementSibling.classList.contains('erp-panel-flotante') ? tableCard.nextElementSibling : null;
    const bar = document.createElement('div');
    bar.style.display='flex'; bar.style.gap='8px'; bar.style.margin='6px 0 12px';
    bar.innerHTML = `
      <button class="btn-secundario" data-tab="lic">Licitaciones</button>
      <button class="btn-secundario" data-tab="vig">R.Vigentes</button>
    `;
    const tabLic = document.createElement('div'); tabLic.id='tab-lic';
    tabLic.appendChild(tableCard);
    if (panel) tabLic.appendChild(panel);
    const tabVig = document.createElement('div'); tabVig.id='tab-vig'; tabVig.style.display='none';
    tabVig.innerHTML = `
      <div class="erp-table-card">
        <table class="tabla-erp">
          <thead><tr>
            <th>Nro Pedido</th><th>Código</th><th>Descripción</th><th>Cantidad</th><th>Destino</th><th>Razón Social</th><th>Pendientes</th>
          </tr></thead>
          <tbody id="tbody-vigentes"></tbody>
        </table>
      </div>`;
    const headerRow = mainCard.querySelector('.erp-header-row');
    if (headerRow && headerRow.nextSibling) mainCard.insertBefore(bar, headerRow.nextSibling);
    else mainCard.insertBefore(bar, mainCard.firstChild);
    mainCard.insertBefore(tabLic, bar.nextSibling);
    mainCard.insertBefore(tabVig, tabLic.nextSibling);
    bar.addEventListener('click', (e)=>{
      const b = e.target.closest('button[data-tab]'); if(!b) return;
      const which = b.getAttribute('data-tab');
      tabLic.style.display = which==='lic'? 'block' : 'none';
      tabVig.style.display = which==='vig'? 'block' : 'none';
      if(which==='vig') cargarVigentes();
    });
  }catch(err){ console.warn('setup tabs licitaciones error', err); }
}

async function cargarVigentes(){
  const tb = document.getElementById('tbody-vigentes'); if(!tb) return;
  tb.innerHTML = "<tr><td colspan='7' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>";
  try{
    const res = await fetch('/api/reparaciones_dota', { credentials:'include' });
    const data = await res.json();
    const lista = Array.isArray(data)? data : [];
    if(lista.length===0){ tb.innerHTML = "<tr><td colspan='7' style='text-align:center; padding:10px; color:#666'>Sin vigentes.</td></tr>"; return; }
    tb.innerHTML = lista.map(r=>`
      <tr data-id="${r.id}" data-nro="${(r.nro_pedido||'').toString().replace(/\"/g,'&quot;')}" data-codigo="${(r.codigo||'').toString().replace(/\"/g,'&quot;')}" data-descripcion="${(r.descripcion||'').toString().replace(/\"/g,'&quot;')}" data-cantidad="${r.cantidad||''}" data-destino="${(r.destino||'').toString().replace(/\"/g,'&quot;')}" data-razon="${(r.razon_social||'').toString().replace(/\"/g,'&quot;')}" data-pendientes="${(r.pendientes!=null?r.pendientes:'')}">
        <td>${r.nro_pedido||'-'}</td>
        <td>${r.codigo||'-'}</td>
        <td>${r.descripcion||'-'}</td>
        <td>${r.cantidad||'-'}</td>
        <td>${r.destino||'-'}</td>
        <td>${r.razon_social||'-'}</td>
        <td>${r.pendientes!=null?r.pendientes:'-'}</td>
      </tr>`).join('');
    // selección de filas
    if (!tb._selBound){
      tb._selBound = true;
      tb.addEventListener('click', (e)=>{
        const tr = e.target.closest('tr'); if(!tr) return;
        vigSeleccionada = tr.dataset.id || null;
        tb.querySelectorAll('tr').forEach(x=> x.classList.remove('selected'));
        tr.classList.add('selected');
      });
    }
  }catch(err){ console.error('vigentes load', err); tb.innerHTML = "<tr><td colspan='7' style='text-align:center; padding:10px; color:red'>Error al cargar.</td></tr>"; }
}

// -------- Deseleccion para R.Vigentes --------
function clearVigenteSelection(){
  const tb = document.getElementById('tbody-vigentes');
  if (!tb) return;
  tb.querySelectorAll('tr.selected').forEach(r=> r.classList.remove('selected'));
  vigSeleccionada = null;
}

// aceptar ambas variantes de id: 'vig-tab' (estatica) y 'tab-vig' (dinamica)
function isVigenteActiveView(){
  const vt = document.getElementById('vig-tab') || document.getElementById('tab-vig');
  return !!(vt && vt.style.display !== 'none');
}

function isGarantiaActiveView(){
  const gt = document.getElementById('gar-tab') || document.getElementById('tab-gar');
  return !!(gt && gt.style.display !== 'none');
}

function bindVigentesDeselect(){
  if (document._vigDeselectBound) return;
  document._vigDeselectBound = true;
  document.addEventListener('click', (e)=>{
    try{
      const tb = document.getElementById('tbody-vigentes');
      if (!tb) return;
      if (!isVigenteActiveView()) return;
      // evitar deseleccion si hay modales abiertos
      const det = document.getElementById('modal-licitacion-detalle');
      const abmLic = document.getElementById('modal-licitacion-abm');
      const abmVig = document.getElementById('modal-vigente-abm');
      const modalOpen = (det && (det.style.display==='flex' || det.style.display==='block')) ||
                        (abmLic && (abmLic.style.display==='flex' || abmLic.style.display==='block')) ||
                        (abmVig && (abmVig.style.display==='flex' || abmVig.style.display==='block'));
      if (modalOpen) return;
      // considerar clicks dentro de la pestaña (cualquiera de las variantes) y en la tabla correspondiente
      const insideTab = !!e.target.closest('#vig-tab, #tab-vig');
      const insideTable = !!e.target.closest('#vig-tab table, #tab-vig table');
      const insidePanel = !!e.target.closest('.erp-panel-flotante');
      // si el click fue sobre la tabla o el panel, no deseleccionar
      if (insideTable || insidePanel) return;
      // si esta dentro de la pestaña pero fuera de la tabla -> deseleccionar
      if (insideTab && !insideTable && !insidePanel) { clearVigenteSelection(); return; }
      // si esta fuera de la pestaña completamente -> deseleccionar
      if (!insideTab) { clearVigenteSelection(); }
    }catch(_){}
  }, true);
}

// -------- Garantias --------
function formatGarantiaDate(value, opts = {}) {
  if (!value) return '-';
  const { dateOnly = false } = opts;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const dateStr = d.toLocaleDateString('es-AR');
    if (dateOnly) return dateStr;
    return dateStr + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

async function cargarGarantias() {
  const tbody = document.getElementById('tbody-garantias');
  if (!tbody) return;
  garSeleccionMultiple.clear();
  garSeleccionAnchorIndex = null;
  garSeleccionada = null;
  tbody.innerHTML = "<tr><td colspan='16' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>";
  try {
    const res = await fetch('/api/licitaciones/garantias', { credentials: 'include' });
    const data = await res.json();
    const lista = Array.isArray(data) ? data : [];
    if (!lista.length) {
      tbody.innerHTML = "<tr><td colspan='16' style='text-align:center; padding:10px; color:#666'>Sin garantias registradas.</td></tr>";
      garSeleccionada = null;
      return;
    }
    const rows = lista.map((g, idx) => {
      const attr = (v) => (v == null ? '' : String(v)).replace(/"/g, '&quot;');
      const html = (v) => {
        if (v == null) return '';
        return String(v)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      };
      const numero = idx + 1;
      return `
        <tr
          data-id="${attr(g.id)}"
          data-index="${idx}"
          data-idcliente="${attr(g.id_cliente || '')}"
          data-ingreso="${attr(g.ingreso || '')}"
          data-cabecera="${attr(g.cabecera || '')}"
          data-interno="${attr(g.interno || '')}"
          data-codigo="${attr(g.codigo || '')}"
          data-alt="${attr(g.alt || '')}"
          data-cantidad="${attr(g.cantidad || '')}"
          data-notificacion="${attr(g.notificacion || '')}"
          data-notificado="${attr(g.notificado_en || '')}"
          data-detalle="${attr(g.detalle || '')}"
          data-recepcion="${attr(g.recepcion || '')}"
          data-codprov="${attr(g.cod_proveedor || '')}"
          data-proveedor="${attr(g.proveedor || '')}"
          data-refprov="${attr(g.ref_proveedor || '')}"
          data-refprov2="${attr(g.ref_proveedor_alt || '')}"
          data-resolucion="${attr(g.resolucion || '')}"
        >
          <td>${html(numero)}</td>
          <td>${html(g.id_cliente || g.id || '')}</td>
          <td>${html(formatGarantiaDate(g.ingreso, { dateOnly: true }))}</td>
          <td>${html(g.cabecera || '')}</td>
          <td>${html(g.interno || '')}</td>
          <td>${html(g.codigo || '')}</td>
          <td>${html(g.alt || '')}</td>
          <td>${html(g.cantidad ?? '')}</td>
          <td>${html(formatGarantiaDate(g.notificacion, { dateOnly: true }))}</td>
          <td>${html(g.detalle || '')}</td>
          <td>${html(g.ref_proveedor || '')}</td>
        </tr>`;
    }).join('');
    tbody.innerHTML = rows;
    applyGarantiaSelectionStyles();
    if (!tbody._garBound) {
      tbody._garBound = true;
      tbody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        if (!tr || !tr.dataset.id) return;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const currentIndex = rows.indexOf(tr);
        if (currentIndex === -1) return;
        if (e.shiftKey && garSeleccionAnchorIndex != null) {
          garSeleccionMultiple.clear();
          const start = Math.min(garSeleccionAnchorIndex, currentIndex);
          const end = Math.max(garSeleccionAnchorIndex, currentIndex);
          for (let i = start; i <= end; i++) {
            const row = rows[i];
            if (row?.dataset.id) garSeleccionMultiple.add(row.dataset.id);
          }
          garSeleccionAnchorIndex = currentIndex;
        } else if (e.ctrlKey || e.metaKey) {
          if (garSeleccionMultiple.has(tr.dataset.id)) garSeleccionMultiple.delete(tr.dataset.id);
          else garSeleccionMultiple.add(tr.dataset.id);
          garSeleccionAnchorIndex = currentIndex;
        } else {
          garSeleccionMultiple.clear();
          garSeleccionMultiple.add(tr.dataset.id);
          garSeleccionAnchorIndex = currentIndex;
        }
        garSeleccionada = buildGarantiaFromRow(tr);
        if (!garSeleccionMultiple.size) garSeleccionada = null;
        applyGarantiaSelectionStyles();
      });
    } else {
      applyGarantiaSelectionStyles();
    }
  } catch (err) {
    console.error('garantias load', err);
    tbody.innerHTML = "<tr><td colspan='16' style='text-align:center; padding:10px; color:red'>Error al cargar.</td></tr>";
  }
}

function openGarantiaModal(edit = false) {
  const modal = document.getElementById('modal-garantia');
  const form = document.getElementById('form-garantia');
  if (!modal || !form) return;
  if (edit && !garSeleccionada) {
    alert('Seleccione una garantia.');
    return;
  }
  form.reset();
  form.dataset.mode = edit ? 'edit' : 'create';
  if (edit && garSeleccionada) {
    Object.entries(garSeleccionada).forEach(([key, val]) => {
      const input = form.querySelector(`[name="${key}"]`);
      if (input) input.value = val ?? '';
    });
  }
  if (!form._bound) {
    form._bound = true;
    form.addEventListener('submit', guardarGarantia);
  }
  const title = document.getElementById('gar-modal-title');
  if (title) title.textContent = edit ? 'Editar garantia' : 'Nueva garantia';
  modal.style.display = 'flex';
}

async function guardarGarantia(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  data.cantidad = data.cantidad === '' ? 1 : Number(data.cantidad);
  if (!Number.isFinite(data.cantidad) || data.cantidad <= 0) data.cantidad = 1;
  const payload = {
    id_cliente: data.id_cliente || null,
    ingreso: data.ingreso || null,
    cabecera: data.cabecera || null,
    interno: data.interno || null,
    codigo: data.codigo || null,
    alt: data.alt || null,
    cantidad: data.cantidad,
    notificacion: data.notificacion || null,
    notificado_en: data.notificado_en || null,
    detalle: data.detalle || null,
    recepcion: data.recepcion || null,
    cod_proveedor: data.cod_proveedor || null,
    proveedor: data.proveedor || null,
    ref_proveedor: data.ref_proveedor || null,
    ref_proveedor_alt: data.ref_proveedor_alt || null,
    resolucion: data.resolucion || null
  };
  const isEdit = form.dataset.mode === 'edit' && garSeleccionada && garSeleccionada.id;
  const url = isEdit ? `/api/licitaciones/garantias/${garSeleccionada.id}` : '/api/licitaciones/garantias';
  const method = isEdit ? 'PUT' : 'POST';
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Error al guardar');
    alert('Garantia guardada');
    document.getElementById('modal-garantia').style.display = 'none';
    garSeleccionada = null;
    cargarGarantias();
  } catch (err) {
    console.error('guardar garantia', err);
    alert('No se pudo guardar la garantia');
  }
}

async function eliminarGarantia() {
  if (garSeleccionMultiple.size > 0) {
    if (!confirm(`Eliminar ${garSeleccionMultiple.size} garantias seleccionadas?`)) return;
    try {
      const ids = Array.from(garSeleccionMultiple);
      const res = await fetch('/api/licitaciones/garantias/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ids })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Error al eliminar');
      alert(`Se eliminaron ${body.deleted || ids.length} garantias`);
      garSeleccionMultiple.clear();
      garSeleccionada = null;
      cargarGarantias();
    } catch (err) {
      console.error('eliminar garantias', err);
      alert('No se pudo eliminar las garantias seleccionadas');
    }
    return;
  }
  if (!garSeleccionada || !garSeleccionada.id) {
    alert('Seleccione una garantia.');
    return;
  }
  if (!confirm('Eliminar garantia seleccionada?')) return;
  try {
    const res = await fetch(`/api/licitaciones/garantias/${garSeleccionada.id}`, { method: 'DELETE', credentials: 'include' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Error al eliminar');
    alert('Garantia eliminada');
    garSeleccionada = null;
    cargarGarantias();
  } catch (err) {
    console.error('eliminar garantia', err);
    alert('No se pudo eliminar la garantia');
  }
}

function bindGarantiasPanel() {
  const btnAdd = document.getElementById('btn-gar-agregar');
  const btnEdit = document.getElementById('btn-gar-modificar');
  const btnDel = document.getElementById('btn-gar-eliminar');
  const btnImp = document.getElementById('btn-gar-importar');
  const inputFile = document.getElementById('gar-import-file');
  if (btnAdd && !btnAdd._bound) { btnAdd._bound = true; btnAdd.addEventListener('click', () => openGarantiaModal(false)); }
  if (btnEdit && !btnEdit._bound) { btnEdit._bound = true; btnEdit.addEventListener('click', () => openGarantiaModal(true)); }
  if (btnDel && !btnDel._bound) { btnDel._bound = true; btnDel.addEventListener('click', eliminarGarantia); }
  if (btnImp && !btnImp._bound) {
    btnImp._bound = true;
    btnImp.addEventListener('click', () => {
      if (garImportBusy) return;
      if (inputFile) inputFile.click();
    });
  }
  if (inputFile && !inputFile._bound) {
    inputFile._bound = true;
    inputFile.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        garImportBusy = true;
        if (btnImp) btnImp.disabled = true;
        await importarGarantiasDesdeArchivo(file);
      } finally {
        garImportBusy = false;
        if (btnImp) btnImp.disabled = false;
        e.target.value = '';
      }
    });
  }
}

async function importarGarantiasDesdeArchivo(file) {
  try {
    const base64 = await leerArchivoComoBase64(file);
    if (!base64) {
      alert('No se pudo leer el archivo.');
      return;
    }
    const res = await fetch('/api/licitaciones/garantias/import-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ filename: file.name, content: base64 })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Error al importar');
    alert(`Importacion completada (${body.inserted || 0} filas).`);
    cargarGarantias();
  } catch (err) {
    console.error('import garantias', err);
    alert(err.message || 'No se pudo importar el archivo de garantias.');
  }
}

function leerArchivoComoBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = reader.result || '';
        const base64 = typeof result === 'string' ? result.split(',').pop() : '';
        resolve(base64 || '');
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// IIFE duplicado eliminado - la logica de deseleccion esta ahora centralizada en bindVigentesDeselect
