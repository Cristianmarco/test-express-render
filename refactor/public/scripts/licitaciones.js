// Licitaciones (refactor) - ASCII only to avoid encoding issues

let licSeleccionada = null; // selected licitacion number
let licFamilias = []; // cache familias for datalist

async function cargarLicitaciones() {
  const tbody = document.getElementById('tbody-licitaciones');
  if (!tbody) return;
  tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>";
  try {
    const res = await fetch('/api/licitaciones', { credentials: 'include' });
    const data = await res.json();
    const lista = Array.isArray(data) ? data : [];
    if (lista.length === 0) {
      tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:10px; color:#666'>Sin licitaciones.</td></tr>";
      return;
    }
    const fmt = (d)=>{ if(!d) return '-'; try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d); } };
    tbody.innerHTML = lista.map(l => `
      <tr data-nro="${l.nro_licitacion}">
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
    tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding:10px; color:red'>Error al cargar.</td></tr>";
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
  tBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>";
  try {
    const res = await fetch(`/api/licitaciones/${encodeURIComponent(nro)}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    const fmt = (d)=>{ if(!d) return '-'; try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d); } };
    if (nEl) nEl.textContent = nro;
    if (fEl) fEl.textContent = fmt(data.fecha);
    if (cEl) cEl.textContent = fmt(data.fecha_cierre);
    if (oEl) oEl.textContent = data.observacion || '-';
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) {
      tBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'>Sin items.</td></tr>";
    } else {
      tBody.innerHTML = items.map(it => `
        <tr>
          <td>${it.codigo || '-'}</td>
          <td>${it.descripcion || '-'}</td>
          <td>${it.cantidad || '-'}</td>
          <td>${it.estado || '-'}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Error detalle licitacion:', err);
    tBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:red'>Error al cargar.</td></tr>";
  }
}

function bindLicitacionesView() {
  const tbody = document.getElementById('tbody-licitaciones');
  if (!tbody) return;
  cargarLicitaciones();
}

if (document.querySelector('[data-view="licitaciones"]')) {
  document.addEventListener('view:changed', (e)=>{
    if (e.detail === 'licitaciones') setTimeout(()=>{ bindLicitacionesView(); bindLicitacionesPanel(); }, 50);
  });
  bindLicitacionesView();
  bindLicitacionesPanel();
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
  if (btnAdd && !btnAdd._bound){ btnAdd._bound = true; btnAdd.addEventListener('click', ()=> abrirModalABMLicitacion()); }
  if (btnEdit && !btnEdit._bound){ btnEdit._bound = true; btnEdit.addEventListener('click', async ()=>{
    if (!licSeleccionada) { alert('Seleccione una licitacion.'); return; }
    try{
      const res = await fetch(`/api/licitaciones/${encodeURIComponent(licSeleccionada)}`, { credentials:'include' });
      const data = await res.json(); if(!res.ok) throw new Error(data.error||'Error');
      abrirModalABMLicitacion(data, licSeleccionada);
    }catch{ alert('No se pudo cargar la licitacion.'); }
  }); }
  if (btnDel && !btnDel._bound){ btnDel._bound = true; btnDel.addEventListener('click', async ()=>{
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
  form.reset(); titems.innerHTML=''; form.dataset.originalNro = originalNro||'';
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
      if (!nro || !fecha || !fecha_cierre || items.length===0) { alert('Complete datos e ingrese al menos un item.'); return; }
      const editing = !!form.dataset.originalNro;
      const url = editing ? `/api/licitaciones/${encodeURIComponent(form.dataset.originalNro)}` : '/api/licitaciones';
      const method = editing ? 'PUT' : 'POST';
      try {
        const res = await fetch(url, { method, credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ nro_licitacion: nro, fecha, fecha_cierre, observacion, items }) });
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
        <option value="cotizado" ${String(it.estado||'').toLowerCase()==='cotizado'?'selected':''}>Cotizado</option>
        <option value="no cotizado" ${String(it.estado||'').toLowerCase()==='no cotizado'?'selected':''}>No cotizado</option>
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







