// Clean (ASCII-only) Planilla script
// Avoids encoding issues and restores calendar + planilla flow

console.log('planilla.js loaded');
// Track scanned items to auto-revert stock when removed from textarea
const _repuestosTrack = new Map(); // code -> { id: number, count: number }

let currentDate = new Date();

// Devuelve un Set de fechas ISO (YYYY-MM-DD) con datos en el rango dado
async function fetchDiasConDatosIso(y, m0) {
  try {
    const firstDate = `${y}-${String(m0 + 1).padStart(2, '0')}-01`;
    const lastDate = `${y}-${String(m0 + 1).padStart(2, '0')}-${String(new Date(y, m0 + 1, 0).getDate()).padStart(2, '0')}`;
    const res = await fetch(`/api/reparaciones_planilla/rango?inicio=${firstDate}&fin=${lastDate}`, { credentials: 'include' });
    if (!res.ok) return new Set();
    const data = await res.json();
    const set = new Set();
    for (const r of (Array.isArray(data) ? data : [])) {
      const iso = String(r.fecha || '').split('T')[0];
      if (iso) set.add(iso);
    }
    return set;
  } catch {
    return new Set();
  }
}


// ---------- Calendar ----------
function bindMonthNavigation() {
  const prev = document.getElementById('prevMonth');
  const next = document.getElementById('nextMonth');
  if (prev) prev.onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(currentDate); };
  if (next) next.onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(currentDate); };
}

async function renderCalendar(date) {
  const grid = document.getElementById('calendarGrid');
  const title = document.getElementById('calendarTitle');
  if (!grid || !title) return;

  const y = date.getFullYear();
  const m = date.getMonth();
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  title.textContent = monthNames[m] + ' de ' + y;

  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  let startDay = first.getDay();
  if (startDay === 0) startDay = 7; // Monday=1 .. Sunday=7

  grid.innerHTML = '';

  // Obtener días con datos como ISO exactas (evita problemas de TZ)
  let diasConDatosISO = new Set();
  try {
    diasConDatosISO = await fetchDiasConDatosIso(y, m);
  } catch {}

  // blanks
  for (let i = 1; i < startDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'day empty';
    grid.appendChild(empty);
  }
  // days
  for (let d = 1; d <= last.getDate(); d++) {
    const cell = document.createElement('div');
    cell.className = 'day';
    cell.textContent = String(d);
    const today = new Date();
    if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) cell.classList.add('today');
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (diasConDatosISO.has(iso)) cell.classList.add('has-data');
    cell.addEventListener('click', () => abrirModalPlanilla(`${d}/${m+1}/${y}`));
    grid.appendChild(cell);
  }
}

// ---------- Planilla (modal) ----------
async function abrirModalPlanilla(fechaTxt) {
  const modal = document.getElementById('modal-planilla');
  const spanFecha = document.getElementById('fecha-planilla');
  const tbody = document.getElementById('tbody-reparaciones');
  if (!modal || !spanFecha || !tbody) return;
  modal.style.display = 'flex';
  spanFecha.textContent = fechaTxt;
  // Vincular botón pequeño de Excel (izquierda del contador)
  try {
    const parts = (fechaTxt || '').split('/');
    let iso = fechaTxt;
    if (parts.length === 3 && fechaTxt.includes('/')) {
      iso = `${parts[2]}-${String(parts[1]).padStart(2,'0')}-${String(parts[0]).padStart(2,'0')}`;
    }
    const excelBtn = document.getElementById('btn-exportar-planilla');
    if (excelBtn){
      excelBtn.title = 'Exportar Excel (.xlsx)';
      excelBtn.onclick = () => window.open(`/api/reparaciones_planilla/export?fecha=${encodeURIComponent(iso)}&format=xlsx`, '_blank');
    }
  } catch {}
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:10px; color:#888">Cargando...</td></tr>';

  // dd/mm/yyyy -> yyyy-mm-dd
  let fechaISO = '';
  try {
    const [d,m,y] = (fechaTxt||'').split('/');
    if (d && m && y) fechaISO = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  } catch {}
  if (!fechaISO) return;

  try {
    const res = await fetch(`/api/reparaciones_planilla?fecha=${fechaISO}&_=${Date.now()}` , { credentials:'include', cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:10px; color:#666">Sin reparaciones para esta fecha.</td></tr>';
      const cEl = document.getElementById('planilla-count'); if (cEl) cEl.textContent = '0';
      return;
    }
    const cEl = document.getElementById('planilla-count'); if (cEl) cEl.textContent = String(data.length);
    tbody.innerHTML = data.map((rep, idx) => `
      <tr data-id="${rep.id||''}"
          data-familia-id="${rep.familia_id||''}"
          data-tecnico-id="${rep.tecnico_id||''}"
          data-cliente-id="${rep.cliente_id||''}"
          data-cliente-tipo="${rep.cliente_tipo||''}">
        <td>${idx + 1}</td>
        <td>${rep.cliente||'-'}</td>
        <td>${rep.id_reparacion||'-'}</td>
        <td>${rep.coche_numero||'-'}</td>
        <td>${rep.equipo||'-'}</td>
        <td>${rep.tecnico||'-'}</td>
        <td>${rep.garantia==='si'?'Si':'No'}</td>
        <td>${rep.nro_pedido_ref||'-'}</td>
        <td>${rep.observaciones||'-'}</td>
        <td style="display:none" class="col-hora-inicio">${rep.hora_inicio||''}</td>
        <td style="display:none" class="col-hora-fin">${rep.hora_fin||''}</td>
        <td style="display:none" class="col-trabajo">${rep.trabajo||''}</td>
        <td style="display:none" class="col-id-dota">${rep.id_dota||''}</td>
        <td style="display:none" class="col-ultimo-reparador-nombre">${rep.ultimo_reparador_nombre||''}</td>
        <td style="display:none" class="col-ultimo-reparador-id">${rep.ultimo_reparador||''}</td>
        <td style="display:none" class="col-resolucion">${rep.resolucion||''}</td>
        <td style="display:none" class="col-familia-id">${rep.familia_id||''}</td>
        <td style="display:none" class="col-tecnico-id">${rep.tecnico_id||''}</td>
        <td style="display:none" class="col-cliente-id">${rep.cliente_id||''}</td>
        <td style="display:none" class="col-cliente-tipo">${rep.cliente_tipo||''}</td>
      </tr>`).join('');
  } catch (err) {
    console.error('planilla load error:', err);
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:10px; color:#c33">Error al conectar con el servidor.</td></tr>';
  }
}

// ---------- Productos: selección en cascada (Familia -> Grupo -> Productos) ----------
function bindProductoSelectorCascada(){
  const btn = document.getElementById('btn-seleccionar-repuesto');
  if(!btn) return; if(btn._bound_casc) return; btn._bound_casc = true;
  btn.addEventListener('click', async ()=>{
    const famSel = document.getElementById('familia_id');
    const familiaId = famSel && famSel.value ? String(famSel.value) : '';
    if(!familiaId){ alert('Seleccione primero una Familia/Equipo.'); return; }

    const gIdEl = document.getElementById('grupo_id_seleccionado');
    const selectedGrupoId = gIdEl && gIdEl.value ? String(gIdEl.value) : '';
    if (selectedGrupoId) return abrirProductosFiltrados(selectedGrupoId, familiaId);
    abrirGruposParaFamilia(familiaId, async (gid)=>{ await abrirProductosFiltrados(gid, familiaId); });
  });
}

function abrirGruposParaFamilia(familiaId, onSelect){
  const modalG = document.getElementById('modal-grupos');
  const tbodyG = document.getElementById('tbody-grupos');
  if(!modalG || !tbodyG) return;
  modalG.style.display = 'flex';
  tbodyG.innerHTML = "<tr><td colspan='2' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando grupos...</td></tr>";
  fetch(`/api/grupo/by_familia/${encodeURIComponent(familiaId)}`, { credentials:'include' })
    .then(r=>r.json())
    .then(arr=>{
      const lista = Array.isArray(arr) ? arr : [];
      if(lista.length===0){
        tbodyG.innerHTML = "<tr><td colspan='2' style='text-align:center; padding:10px; color:#666'>Sin grupos para esta familia.</td></tr>";
      } else {
        tbodyG.innerHTML = lista.map(g=>
          `<tr>
            <td><button type="button" class="btn-secundario btn-elegir-grupo" data-id="${g.id}" data-nombre="${(g.descripcion||g.codigo||('Grupo '+g.id)).replace(/\"/g,'&quot;')}"><i class='fas fa-check'></i> Elegir</button></td>
            <td>${g.descripcion || g.codigo || ('Grupo '+g.id)}</td>
          </tr>`
        ).join('');
      }
      tbodyG.onclick = (ev)=>{
        const b = ev.target.closest('.btn-elegir-grupo');
        if(!b) return;
        const gid = b.getAttribute('data-id');
        const gname = b.getAttribute('data-nombre') || '';
        cerrarModalGrupos();
        if(typeof onSelect==='function') onSelect(gid, gname);
      };
    })
    .catch(err=>{
      console.error('Error grupos:', err);
      tbodyG.innerHTML = "<tr><td colspan='2' style='text-align:center; padding:10px; color:red'>Error al cargar grupos.</td></tr>";
    });
}

async function abrirProductosFiltrados(grupoId, familiaId){
  const modalP = document.getElementById('modal-productos');
  const tbodyP = document.getElementById('tbody-productos');
  if(!modalP || !tbodyP) return;
  modalP.style.display = 'flex';
  tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando productos...</td></tr>";
  try{
    const res = await fetch(`/api/productos?grupo_id=${encodeURIComponent(grupoId)}&familia_id=${encodeURIComponent(familiaId)}`, { credentials:'include' });
    const prods = await res.json();
    const lista = Array.isArray(prods)? prods : [];
    if(lista.length===0){
      tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'>Sin productos.</td></tr>";
    } else {
      tbodyP.innerHTML = lista.map(p=>
        `<tr>
          <td><button type="button" class="btn-secundario btn-add-producto" data-id="${p.id}" data-codigo="${(p.codigo||'').replace(/\"/g,'&quot;')}" data-desc="${(p.descripcion||'').replace(/\"/g,'&quot;')}"><i class='fas fa-plus'></i> Agregar</button></td>
          <td>${p.descripcion||'-'}</td>
          <td>${p.codigo||'-'}</td>
          <td>${p.stock_total!=null? p.stock_total : '-'}</td>
        </tr>`
      ).join('');
    }
    tbodyP.onclick = (evt)=>{
      const add = evt.target.closest('.btn-add-producto');
      if(!add) return;
      const codigo = add.getAttribute('data-codigo')||'';
      const desc = add.getAttribute('data-desc')||'';
      const area = document.getElementById('trabajo');
      if(area){
        const prefix = area.value && !area.value.endsWith('\n') ? '\n' : '';
        const label = desc ? `(${codigo}) - ${desc}` : `(${codigo})`;
        area.value = (area.value||'') + prefix + label;
        area.dispatchEvent(new Event('input', { bubbles:true }));
      }
      cerrarModalProductos();
    };
  }catch(err){
    console.error('Error cargando productos:', err);
    tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:red'>Error al cargar productos.</td></tr>";
  }
}

function setGrupoSeleccion(id, nombre){
  const hid = document.getElementById('grupo_id_seleccionado');
  const wrap = document.getElementById('grupo-seleccion-resumen');
  const nameEl = document.getElementById('grupo-seleccionado-nombre');
  if(hid) hid.value = id || '';
  if(nameEl) nameEl.textContent = nombre || '';
  if(wrap) wrap.style.display = (id ? 'inline-flex' : 'none');
}

function clearGrupoSeleccion(){ setGrupoSeleccion('', ''); }

function bindEnhanceFamilyGroupButtons(){
  const btnG = document.getElementById('btn-elegir-grupo');
  const btnClear = document.getElementById('btn-limpiar-grupo');
  const selFam = document.getElementById('familia_id');
  if(selFam && !selFam._bound){ selFam._bound = true; selFam.addEventListener('change', clearGrupoSeleccion); }
  if(btnClear && !btnClear._bound){ btnClear._bound = true; btnClear.addEventListener('click', clearGrupoSeleccion); }
  if(btnG && !btnG._bound){
    btnG._bound = true;
    btnG.addEventListener('click', ()=>{
      const famSel = document.getElementById('familia_id');
      const familiaId = famSel && famSel.value ? String(famSel.value) : '';
      if(!familiaId){ alert('Seleccione primero una Familia/Equipo.'); return; }
      abrirGruposParaFamilia(familiaId, (gid, gname)=>{ setGrupoSeleccion(gid, gname); });
    });
  }
}

// ---------- Actions ----------
function bindPlanillaActions() {
  const tbody = document.getElementById('tbody-reparaciones');
  const btnVer = document.getElementById('btn-ver-detalle');
  const btnAgregar = document.getElementById('btn-agregar-rep');
  const btnEditar = document.getElementById('btn-modificar-rep');
  const btnEliminar = document.getElementById('btn-eliminar-rep');
  if (!tbody) return;

  let seleccion = null;

  tbody.onclick = (e) => {
    const fila = e.target.closest('tr'); if (!fila) return;
    document.querySelectorAll('#tbody-reparaciones tr').forEach(tr=>tr.classList.remove('selected'));
    fila.classList.add('selected');
    const c = fila.querySelectorAll('td');
    seleccion = {
      id: fila.dataset.id||'',
      familia_id: fila.dataset.familiaId||'',
      tecnico_id: fila.dataset.tecnicoId||'',
      cliente_id: fila.dataset.clienteId||'',
      cliente_tipo: fila.dataset.clienteTipo||'',
      cliente: c[0]?.textContent.trim()||'-',
      id_reparacion: c[1]?.textContent.trim()||'-',
      coche: c[2]?.textContent.trim()||'-',
      equipo: c[3]?.textContent.trim()||'-',
      tecnico: c[4]?.textContent.trim()||'-',
      garantia: c[5]?.textContent.trim()||'-',
      observaciones: c[6]?.textContent.trim()||'-',
      hora_inicio: fila.querySelector('.col-hora-inicio')?.textContent.trim()||'',
      hora_fin: fila.querySelector('.col-hora-fin')?.textContent.trim()||'',
      trabajo: fila.querySelector('.col-trabajo')?.textContent.trim()||'',
      id_dota: fila.querySelector('.col-id-dota')?.textContent.trim()||'',
      ultimo_reparador_nombre: fila.querySelector('.col-ultimo-reparador-nombre')?.textContent.trim()||'',
      ultimo_reparador: fila.querySelector('.col-ultimo-reparador-id')?.textContent.trim()||'',
      resolucion: fila.querySelector('.col-resolucion')?.textContent.trim()||''
    };
  };

  if (btnVer) btnVer.onclick = () => {
    if (!seleccion) { alert('Selecciona una reparacion primero.'); return; }
    const map = {
      'detalle-cliente': seleccion.cliente,
      'detalle-id-reparacion': seleccion.id_reparacion,
      'detalle-coche': seleccion.coche,
      'detalle-equipo': seleccion.equipo,
      'detalle-tecnico': seleccion.tecnico,
      'detalle-garantia': seleccion.garantia,
      'detalle-observaciones': seleccion.observaciones,
      'detalle-hora-inicio': seleccion.hora_inicio||'-',
      'detalle-hora-fin': seleccion.hora_fin||'-',
      'detalle-trabajo': seleccion.trabajo||'-'
    };
    Object.entries(map).forEach(([id,val])=>{ const el=document.getElementById(id); if(el) el.textContent=val; });
    const modal = document.getElementById('modal-detalle'); if (modal) modal.style.display='flex';
  };

  if (btnAgregar) btnAgregar.onclick = () => {
    const modal = document.getElementById('modal-reparacion'); const form=document.getElementById('form-reparacion');
    if (modal) {
      modal.style.display='flex';
      // Asegurar que el modal arranque scrolleado arriba siempre
      setTimeout(()=>{
        try { const content = modal.querySelector('.modal-contenido-refactor'); if (content) content.scrollTop = 0; if (form) form.scrollTop = 0; const first = (form||modal).querySelector('input, select, textarea'); if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
        } catch(_) {}
      }, 0);
    }
    if (form) {
      form.reset();
      try {
        if (!document.getElementById('nro_pedido_ref')) {
          const wrap = document.createElement('div');
          wrap.className = 'form-grid';
          wrap.innerHTML = '<div><label>N° Pedido (R.Vigente)</label><input type="text" name="nro_pedido_ref" id="nro_pedido_ref" placeholder="Nro de pedido de licitaciones" /></div>';
          const marker = form.querySelector("input[name='coche_numero']");
          if (marker && marker.closest('.form-grid.doble')) {
            marker.closest('.form-grid.doble').insertAdjacentElement('afterend', wrap);
          } else {
            form.insertBefore(wrap, form.firstChild);
          }
        }
      } catch {}
      try{ _repuestosTrack.clear(); }catch(_){ }
      const selGar = document.getElementById('garantia'); if (selGar) selGar.value = 'no';
      const extra = document.getElementById('garantia-extra-fields'); if (extra) extra.style.display = 'none';
    }
    prepararSelectClientes(); prepararSelectFamilias(); prepararSelectTecnicos();
    bindClienteExternoToggle(true);
    bindGarantiaToggle(true);
  };

  if (btnEditar) btnEditar.onclick = async () => {
    if (!seleccion) { alert('Selecciona una reparacion para modificar.'); return; }
    const modal = document.getElementById('modal-reparacion'); const form=document.getElementById('form-reparacion');
    if (modal) { modal.style.display='flex'; setTimeout(()=>{ try { if (form) form.scrollTop = 0; } catch(_){} }, 0); } if (form) form.dataset.id = seleccion.id||'';
    const setVal = (sel,val)=>{ const el=document.querySelector(sel); if(el) el.value=val||''; };
    setVal("input[name='id_reparacion']", seleccion.id_reparacion);
    setVal("input[name='coche_numero']", seleccion.coche);
    setVal("textarea[name='observaciones']", seleccion.observaciones);
    setVal("input[name='hora_inicio']", seleccion.hora_inicio);
    setVal("input[name='hora_fin']", seleccion.hora_fin);
    setVal("textarea[name='trabajo']", seleccion.trabajo);
    // Cliente tipo/id
    const selTipo = document.getElementById('cliente_tipo');
    if(selTipo){ selTipo.value = (seleccion.cliente_tipo || '').toLowerCase() || 'dota'; }
    const wrapCli = document.getElementById('cliente_externo_wrapper');
    if(wrapCli) wrapCli.style.display = (selTipo && selTipo.value === 'externo') ? 'block' : 'none';
    await prepararSelectClientes();
    const selCli = document.getElementById('cliente_id');
    if (selCli && seleccion.cliente_id) selCli.value = String(seleccion.cliente_id);

    // Garantia + extras
    const selGar = document.getElementById('garantia');
    if(selGar){ selGar.value = (String(seleccion.garantia||'no').toLowerCase().startsWith('s') ? 'si' : 'no'); }
    bindGarantiaToggle(true);
    setVal("input[name='id_dota']", seleccion.id_dota);
    await prepararSelectTecnicos();
    const tec=document.getElementById('tecnico_id'); if(tec && seleccion.tecnico_id) tec.value=String(seleccion.tecnico_id);
    const ult=document.getElementById('ultimo_reparador'); if(ult && seleccion.ultimo_reparador) ult.value=String(seleccion.ultimo_reparador);
    setVal("select[name='resolucion']", seleccion.resolucion);

    // Familia: solo cargar y seleccionar
    await prepararSelectFamilias();
    const fam = document.getElementById('familia_id'); if (fam && seleccion.familia_id) fam.value=String(seleccion.familia_id);
  };

  if (btnEliminar) btnEliminar.onclick = async () => {
    if (!seleccion) { alert('Selecciona una reparacion para eliminar.'); return; }
    if (!confirm(`Eliminar la reparacion ${seleccion.id_reparacion}?`)) return;
    try {
      const nroRef = prompt('Nro pedido a devolver pendientes (opcional):','');
      const qs = nroRef ? ('?nro_pedido_ref='+ encodeURIComponent(nroRef)) : '';
      const res = await fetch(`/api/reparaciones_planilla/${encodeURIComponent(seleccion.id)}${qs}`, { method:'DELETE', credentials:'include' });
      const data = await res.json();
      if (res.ok) {
        alert('Reparacion eliminada.');
        const fechaSpan = document.getElementById('fecha-planilla');
        if (fechaSpan && fechaSpan.textContent) abrirModalPlanilla(fechaSpan.textContent);
      } else {
        alert('Error: ' + (data.error||'desconocido'));
      }
    } catch { alert('Error al eliminar.'); }
  };

  // Bind submit on create/edit form to avoid full-page POST
  const form = document.getElementById('form-reparacion');
  if (form && !form._submitBound) {
    form._submitBound = true;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(form).entries());
      // Fecha viene mostrada en el span de planilla (dd/mm/yyyy) -> enviar ISO (yyyy-mm-dd)
      const fechaTxt = (document.getElementById('fecha-planilla')?.textContent || '').trim();
      if (fechaTxt) {
        try {
          const [d,m,y] = fechaTxt.split('/');
          datos.fecha = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        } catch(_) {
          datos.fecha = fechaTxt; // fallback
        }
      }
      if ((datos.cliente_tipo||'').toLowerCase() === 'externo') {
        datos.cliente_id = document.getElementById('cliente_id')?.value || '';
      } else {
        datos.cliente_id = '';
      }

      let url = '/api/reparaciones_planilla';
      let method = 'POST';
      const editingId = form.dataset.id;
      if (editingId) { url = `/api/reparaciones_planilla/${encodeURIComponent(editingId)}`; method = 'PUT'; }

      try {
        console.log('Guardando reparacion:', { method, url, datos });
        const res = await fetch(url, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos),
        });
        if (!res.ok) {
          const t = await res.text().catch(()=> '');
          throw new Error(`Error al guardar reparacion (${res.status}) ${t}`);
        }
        // Cerrar modal y recargar lista del dia
        cerrarModalReparacion();
        // limpiar modo edicion
        delete form.dataset.id;
        const fechaSpan = document.getElementById('fecha-planilla');
        try{ learnTrabajoTermsFrom(datos.trabajo); }catch{}
        if (fechaSpan && fechaSpan.textContent) abrirModalPlanilla(fechaSpan.textContent);
      } catch (err) {
        console.error('Error guardando reparacion (refactor):', err);
        alert('No se pudo guardar la reparacion.');
      }
    });
  }
}

// ---------- Select helpers ----------
// Cargar clientes (externos) para el select de cliente_id
async function prepararSelectClientes(){
  const sel = document.getElementById('cliente_id');
  if(!sel) return;
  try{
    sel.innerHTML = '<option value="">Cargando clientes...</option>';
    const res = await fetch('/api/clientes', { credentials:'include' });
    const data = await res.json();
    const lista = Array.isArray(data)? data : [];
    sel.innerHTML = '<option value="">Seleccione</option>';
    lista.forEach(c => {
      const opt = document.createElement('option');
      opt.value = (c.id!=null? c.id : c.codigo);
      opt.textContent = c.fantasia || c.razon_social || c.nombre || (`Cliente ${c.id||c.codigo||''}`);
      sel.appendChild(opt);
    });
  } catch(err){
    console.error('Error cargando clientes:', err);
    sel.innerHTML = '<option value="">(sin datos)</option>';
  }
}

// Load tecnicos for generic select id
async function cargarTecnicosEnSelect(selectId){
  try{
    const sel = typeof selectId==='string'? document.getElementById(selectId) : selectId;
    if(!sel) return;
    sel.innerHTML = '<option value="">Cargando tecnicos...</option>';
    const res = await fetch('/api/tecnicos', { credentials:'include' });
    const data = await res.json();
    const lista = Array.isArray(data)?data:[];
    sel.innerHTML = '<option value="">Seleccione</option>';
    lista.forEach(t=>{ const opt=document.createElement('option'); opt.value=t.id; opt.textContent=t.nombre||('Tecnico '+t.id); sel.appendChild(opt); });
  }catch{
    const sel = typeof selectId==='string'? document.getElementById(selectId) : selectId; if(sel) sel.innerHTML='<option value="">(sin datos)</option>';
  }
}

// Populate categorias select and bind change
async function prepararSelectCategorias(){
  const sel = document.getElementById('categoria_id');
  if(!sel) return;
  sel.innerHTML = '<option value="">Todas</option>';
  try{
    const res = await fetch('/api/categoria', { credentials:'include' });
    const data = await res.json();
    const lista = Array.isArray(data)?data:[];
    lista.forEach(c=>{
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.descripcion || c.codigo || ('Cat '+c.id);
      sel.appendChild(opt);
    });
  }catch{ /* fallback: deja solo "Todas" */ }
  sel.onchange = () => prepararSelectFamilias();
}

// Populate familias select, optionally filtered by categoria
async function prepararSelectFamilias(){
  const selFam = document.getElementById('familia_id');
  const selCat = document.getElementById('categoria_id');
  if(!selFam) return;
  selFam.innerHTML = '<option value="">Seleccione un equipo</option>';
  try{
    const catId = selCat ? selCat.value : '';
    const url = catId ? (`/api/familias/by_categoria/${encodeURIComponent(catId)}`) : '/api/familias';
    const res = await fetch(url, { credentials:'include' });
    const data = await res.json();
    const lista = Array.isArray(data)?data:[];
    lista.forEach(f=>{
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.descripcion || f.nombre || f.codigo || ('Equipo '+f.id);
      selFam.appendChild(opt);
    });
  }catch{
    selFam.innerHTML = '<option value="">(sin datos)</option>';
  }
}

// Populate tecnicos select
async function prepararSelectTecnicos(){
  await cargarTecnicosEnSelect('tecnico_id');
  await cargarTecnicosEnSelect('ultimo_reparador');
}

// Mostrar/ocultar campos extra de garantía
function toggleGarantiaExtra(){
  const sel = document.getElementById('garantia');
  const extra = document.getElementById('garantia-extra-fields');
  if(!sel || !extra) return;
  extra.style.display = (sel.value === 'si') ? 'block' : 'none';
}

// ----- Modal helpers (close) -----
function cerrarModalPlanilla(){ const m=document.getElementById('modal-planilla'); if(m) m.style.display='none'; }
function cerrarModalReparacion(){ const m=document.getElementById('modal-reparacion'); if(m) m.style.display='none'; }
function cerrarModalGrupos(){ const m=document.getElementById('modal-grupos'); if(m) m.style.display='none'; }
function cerrarModalProductos(){ const m=document.getElementById('modal-productos'); if(m) m.style.display='none'; }
function cerrarModalHistorial(){ const m=document.getElementById('modal-historial'); if(m) m.style.display='none'; const i=document.getElementById('buscar-reparacion'); if(i) i.value=''; }
function cerrarModalDetalle(){ const m=document.getElementById('modal-detalle'); if(m) m.style.display='none'; }

// Cierre por ESC y clic fuera del contenido
function cerrarModalesAbiertos(){
  const ids = ['modal-planilla','modal-reparacion','modal-grupos','modal-productos','modal-detalle','modal-historial'];
  ids.forEach(id => { const el = document.getElementById(id); if (el && (el.style.display === 'flex' || el.style.display === 'block' || getComputedStyle(el).display !== 'none')) { el.style.display = 'none'; } });
}
document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape' || e.key === 'Esc') {
    e.preventDefault();
    cerrarModalesAbiertos();
  }
});
document.addEventListener('click', (e)=>{
  const t = e.target;
  if (t && t.classList && t.classList.contains('modal-refactor')) {
    t.style.display = 'none';
  }
});

// Watch textarea to revert stock when scanned items are removed
function bindTrabajoWatcher(){
  const area = document.getElementById('trabajo');
  if(!area || area._watchBound) return; area._watchBound = true;
  const getCounts = (text)=>{
    const counts = new Map();
    const re = /\(([^)]+)\)/g; // matches (CODE)
    let m;
    while((m = re.exec(text||''))){
      const code = (m[1]||'').trim();
      if(_repuestosTrack.has(code)){
        counts.set(code, (counts.get(code)||0)+1);
      }
    }
    return counts;
  };
  area.addEventListener('input', async ()=>{
    try{
      const current = getCounts(area.value||'');
      for(const [code, data] of _repuestosTrack){
        const prev = data.count||0;
        const now = current.get(code)||0;
        if(now < prev){
          const diff = prev - now;
          try{ await aumentarStockProducto(data.id, diff, `Reversion (${code})`); }catch(e){ console.warn('No se pudo revertir stock:', e); }
          data.count = now; // update downwards
        } else if(now > prev){
          // Do not auto discount on manual duplicates; clamp to previous
          data.count = prev;
        }
      }
    }catch(err){ console.warn('Watcher trabajo error:', err); }
  });
}

// --- Texto predictivo para textarea 'trabajo' ---
const DEFAULT_TRABAJO_TERMS = [
  'impulsor','rulemanes','correa','bomba','limpieza','ajuste','cambio','cableado','conector',
  'placa','sensor','motor','filtro','fusible','soldadura','revision','diagnostico','calibracion',
  'prueba','firmware','lubricacion','tornillos','enchufe','borne','terminal'
];

function loadTrabajoTerms(){
  try{
    const raw = localStorage.getItem('erp_trabajo_terms');
    const arr = raw ? JSON.parse(raw) : [];
    const base = Array.isArray(arr) ? arr : [];
    return Array.from(new Set([...DEFAULT_TRABAJO_TERMS, ...base]));
  }catch{ return DEFAULT_TRABAJO_TERMS.slice(); }
}

function saveTrabajoTerms(list){
  try{ localStorage.setItem('erp_trabajo_terms', JSON.stringify(Array.from(new Set(list)).slice(0,200))); }catch{}
}

function learnTrabajoTermsFrom(text){
  if(!text) return;
  try{
    const words = String(text).toLowerCase().match(/[a-záéíóúñ0-9]{3,}/gi) || [];
    const curr = loadTrabajoTerms();
    const merged = Array.from(new Set([...curr, ...words]));
    saveTrabajoTerms(merged);
  }catch{}
}

function bindTrabajoAutocomplete(){
  const area = document.getElementById('trabajo');
  const box  = document.getElementById('trabajo-suggest');
  if(!area || !box || area._autoBound) return; area._autoBound = true;

  let selIndex = -1;

  const render = (prefix)=>{
    const p = (prefix||'').toLowerCase();
    const items = loadTrabajoTerms().filter(t=>t.toLowerCase().startsWith(p)).slice(0,8);
    if(!p || items.length===0){ box.style.display='none'; box.innerHTML=''; selIndex=-1; return; }
    box.innerHTML = items.map((t,i)=>`<div class="suggest-item${i===0?' active':''}" data-value="${t.replace(/\"/g,'&quot;')}">${t}</div>`).join('');
    selIndex = 0; box.style.display='block';
  };

  const currentPrefix = ()=>{
    const pos = area.selectionStart||0;
    const left = area.value.slice(0,pos);
    const m = left.match(/([\p{L}áéíóúñ\d]+)$/iu);
    return m ? m[1] : '';
  };

  const apply = (val)=>{
    const pos = area.selectionStart||0;
    const left = area.value.slice(0,pos);
    const right = area.value.slice(pos);
    const m = left.match(/([\p{L}áéíóúñ\d]+)$/iu);
    const newLeft = m ? (left.slice(0, left.length - m[1].length) + val + ' ') : (left + val + ' ');
    area.value = newLeft + right;
    const newPos = newLeft.length; area.setSelectionRange(newPos, newPos);
    box.style.display='none';
  };

  area.addEventListener('input', ()=>{
    const p = currentPrefix();
    if(p.length>=2) render(p); else { box.style.display='none'; }
  });
  area.addEventListener('keydown', (e)=>{
    if(box.style.display!=='block') return;
    const items = Array.from(box.querySelectorAll('.suggest-item'));
    if(!items.length) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); selIndex=(selIndex+1)%items.length; items.forEach((el,i)=>el.classList.toggle('active', i===selIndex)); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); selIndex=(selIndex-1+items.length)%items.length; items.forEach((el,i)=>el.classList.toggle('active', i===selIndex)); }
    else if(e.key==='Enter' || e.key==='Tab'){ e.preventDefault(); apply(items[selIndex].getAttribute('data-value')); }
    else if(e.key==='Escape'){ box.style.display='none'; }
  });
  box.addEventListener('mousedown', (ev)=>{
    const it = ev.target.closest('.suggest-item'); if(!it) return; ev.preventDefault(); apply(it.getAttribute('data-value'));
  });
  area.addEventListener('blur', ()=>{ setTimeout(()=>{ box.style.display='none'; }, 150); });
}

// Interceptar Enter en el input de código y evitar submit del form
function bindCodigoRepuestoEnter(){
  const scanInput = document.getElementById('scan-codigo-repuesto');
  const form = document.getElementById('form-reparacion');
  if(scanInput && !scanInput._enterBound){
    scanInput._enterBound = true;
    const handle = ()=>{
      const v = (scanInput.value||'').trim();
      if(v){ try{ agregarPorCodigo(v); }catch(_){} scanInput.value=''; scanInput.focus(); }
    };
    ['keydown','keypress','keyup'].forEach(type=>{
      scanInput.addEventListener(type, (e)=>{
        if(e.key === 'Enter'){
          e.preventDefault(); e.stopPropagation();
          if(type === 'keyup') handle();
          return false;
        }
      }, true);
    });
  }
  if(form && !form._scanSubmitGuard){
    form._scanSubmitGuard = true;
    form.addEventListener('submit', (e)=>{
      const scan = document.getElementById('scan-codigo-repuesto');
      const active = document.activeElement;
      if(scan && (active === scan || (scan.value && !e.submitter))){
        e.preventDefault(); e.stopPropagation();
        const v = (scan.value||'').trim();
        if(v){ try{ agregarPorCodigo(v); }catch(_){} scan.value=''; scan.focus(); }
        return false;
      }
    }, true);
  }
}

// ---------- Productos: abrir listado con buscador ----------
function bindProductoSelectorSimple(){
  const btn = document.getElementById('btn-seleccionar-repuesto');
  if(!btn) return; if(btn._bound_simple) return; btn._bound_simple = true;
  let allProducts = [];
  btn.addEventListener('click', async ()=>{
    const modalP = document.getElementById('modal-productos');
    const tbodyP = document.getElementById('tbody-productos');
    const input = document.getElementById('buscar-producto-planilla');
    const btnBuscar = document.getElementById('btn-buscar-producto-planilla');
    if(!modalP || !tbodyP) return;
    modalP.style.display = 'flex';
    tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando productos...</td></tr>";
    try{
      const res = await fetch('/api/productos', { credentials:'include' });
      const prods = await res.json();
      allProducts = Array.isArray(prods)? prods : [];
      renderLista(allProducts);
    }catch(err){
      console.error('Error cargando productos:', err);
      tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:red'>Error al cargar productos.</td></tr>";
    }

    function renderLista(list){
      if(!tbodyP) return;
      if(!list.length){ tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'>Sin productos.</td></tr>"; return; }
      tbodyP.innerHTML = list.map(p=>
        `<tr>
          <td><button type=\"button\" class=\"btn-secundario btn-add-producto\" data-id=\"${p.id}\" data-codigo=\"${(p.codigo||'').replace(/\\\"/g,'&quot;')}\" data-desc=\"${(p.descripcion||'').replace(/\\\"/g,'&quot;')}\"><i class='fas fa-plus'></i> Agregar</button></td>
          <td>${p.descripcion||'-'}</td>
          <td>${p.codigo||'-'}</td>
          <td>${p.stock_total!=null? p.stock_total : '-'}</td>
        </tr>`).join('');
    }

    const doSearch = ()=>{
      const t = (input && input.value || '').trim().toLowerCase();
      if(!t) return renderLista(allProducts);
      const filtered = allProducts.filter(p=> (p.codigo||'').toLowerCase().includes(t) || (p.descripcion||'').toLowerCase().includes(t));
      renderLista(filtered);
    };
    if(btnBuscar && !btnBuscar._bound){ btnBuscar._bound=true; btnBuscar.onclick = doSearch; }
    if(input && !input._bound){ input._bound=true; input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); doSearch(); } }); }

    tbodyP.onclick = (evt)=>{
      const add = evt.target.closest('.btn-add-producto');
      if(!add) return;
      const codigo = add.getAttribute('data-codigo')||'';
      const desc = add.getAttribute('data-desc')||'';
      const area = document.getElementById('trabajo');
      if(area){
        const prefix = area.value && !area.value.endsWith('\n') ? '\n' : '';
        const label = desc ? `(${codigo}) - ${desc}` : `(${codigo})`;
        area.value = (area.value||'') + prefix + label;
        area.dispatchEvent(new Event('input', { bubbles:true }));
      }
      cerrarModalProductos();
    };
  });
}

// ---------- Productos (seleccion en cascada: familia -> grupos -> productos) ----------
function bindProductoSelectorCascada(){
  const btn = document.getElementById('btn-seleccionar-repuesto');
  if(!btn) return;
  if(btn._bound) return; btn._bound = true;

  btn.addEventListener('click', async ()=>{
    const famSel = document.getElementById('familia_id');
    const familiaId = famSel && famSel.value ? String(famSel.value) : '';
    if(!familiaId){ alert('Seleccione primero una Familia/Equipo.'); return; }

    // 1) Modal de grupos filtrados por familia
    const modalG = document.getElementById('modal-grupos');
    const tbodyG = document.getElementById('tbody-grupos');
    if(!modalG || !tbodyG) return;
    modalG.style.display = 'flex';
    tbodyG.innerHTML = "<tr><td colspan='2' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando grupos...</td></tr>";

    try{
      const resG = await fetch(`/api/grupo/by_familia/${encodeURIComponent(familiaId)}`, { credentials:'include' });
      const grupos = await resG.json();
      const listaG = Array.isArray(grupos)? grupos : [];
      if(listaG.length===0){
        tbodyG.innerHTML = "<tr><td colspan='2' style='text-align:center; padding:10px; color:#666'>Sin grupos para esta familia.</td></tr>";
      } else {
        tbodyG.innerHTML = listaG.map(g=>
          `<tr>
            <td><button type="button" class="btn-secundario btn-elegir-grupo" data-id="${g.id}"><i class='fas fa-check'></i> Elegir</button></td>
            <td>${g.descripcion || g.codigo || ('Grupo '+g.id)}</td>
          </tr>`
        ).join('');
      }

      // Delegar click en tabla grupos
      tbodyG.onclick = async (ev)=>{
        const b = ev.target.closest('.btn-elegir-grupo');
        if(!b) return;
        const grupoId = b.getAttribute('data-id');
        cerrarModalGrupos();

        // 2) Modal de productos filtrados por grupo+familia
        const modalP = document.getElementById('modal-productos');
        const tbodyP = document.getElementById('tbody-productos');
        if(!modalP || !tbodyP) return;
        modalP.style.display = 'flex';
        tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando productos...</td></tr>";
        try{
          const resP = await fetch(`/api/productos?grupo_id=${encodeURIComponent(grupoId)}&familia_id=${encodeURIComponent(familiaId)}`, { credentials:'include' });
          const prods = await resP.json();
          const lista = Array.isArray(prods)? prods : [];
          if(lista.length===0){
            tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'>Sin productos.</td></tr>";
          } else {
            tbodyP.innerHTML = lista.map(p=>
              `<tr>
                <td><button type="button" class="btn-secundario btn-add-producto" data-id="${p.id}" data-codigo="${(p.codigo||'').replace(/\"/g,'&quot;')}"><i class='fas fa-plus'></i> Agregar</button></td>
                <td>${p.descripcion||'-'}</td>
                <td>${p.codigo||'-'}</td>
                <td>${p.stock_total!=null? p.stock_total : '-'}</td>
              </tr>`
            ).join('');
          }

          // Delegar click en tabla productos
          tbodyP.onclick = async (evt)=>{
            const add = evt.target.closest('.btn-add-producto');
            if(!add) return;
            const codigo = add.getAttribute('data-codigo')||'';
            const desc = add.getAttribute('data-desc')||'';
            const prodId = add.getAttribute('data-id');
            const area = document.getElementById('trabajo');
            if(area){
              const prefix = area.value && !area.value.endsWith('\n') ? '\n' : '';
              const label = desc ? `(${codigo}) - ${desc}` : `(${codigo})`;
              area.value = (area.value||'') + prefix + label;
              area.dispatchEvent(new Event('input', { bubbles:true }));
            }
            try{
              if (prodId && confirm(`Descontar 1 unidad del stock de ${codigo}?`)) {
                await descontarStockProducto(prodId, `Seleccion directa (${codigo})`);
              }
            }catch(err){ console.warn('No se pudo descontar stock ahora:', err); }
            cerrarModalProductos();
          };
        }catch(err){
          console.error('Error cargando productos:', err);
          tbodyP.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:red'>Error al cargar productos.</td></tr>";
        }
      };
    }catch(err){
      console.error('Error cargando grupos:', err);
      tbodyG.innerHTML = "<tr><td colspan='2' style='text-align:center; padding:10px; color:red'>Error al cargar grupos.</td></tr>";
    }
  });
}

async function descontarStockProducto(productoId, observacion){
  try{
    const res = await fetch(`/api/stock/${encodeURIComponent(productoId)}`, { credentials:'include' });
    const depos = await res.json();
    const arr = Array.isArray(depos)? depos : [];
    let deposito = 1, max = -Infinity;
    arr.forEach(d=>{ const cant = typeof d.cantidad==='number'? d.cantidad : parseInt(d.cantidad||'0',10); if(cant>max){ max=cant; deposito=d.deposito_id; } });
    const payload = { producto_id: Number(productoId), deposito_id: Number(deposito), tipo: 'SALIDA', cantidad: 1, observacion: observacion||'Seleccion planilla' };
    const resMv = await fetch('/api/stock/movimiento', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) });
    if(!resMv.ok){ const e=await resMv.json().catch(()=>({})); throw new Error(e && e.error || 'movimiento_failed'); }
    return true;
  } catch(err){ throw err; }
}
// Incrementar stock (ENTRADA) para reversion al borrar linea del trabajo
async function aumentarStockProducto(productoId, cantidad, observacion){
  try{
    const res = await fetch(`/api/stock/${encodeURIComponent(productoId)}`, { credentials:'include' });
    const depos = await res.json();
    const arr = Array.isArray(depos)? depos : [];
    let deposito = 1, max = -Infinity;
    arr.forEach(d=>{ const cant = typeof d.cantidad==='number'? d.cantidad : parseInt(d.cantidad||'0',10); if(cant>max){ max=cant; deposito=d.deposito_id; } });
    const payload = { producto_id: Number(productoId), deposito_id: Number(deposito), tipo: 'ENTRADA', cantidad: Math.max(1, Number(cantidad)||1), observacion: observacion||'Reversion planilla' };
    const resMv = await fetch('/api/stock/movimiento', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) });
    if(!resMv.ok){ const e=await resMv.json().catch(()=>({})); throw new Error(e && e.error || 'movimiento_failed'); }
    return true;
  } catch(err){ throw err; }
}

// ---------- Productos (selección para trabajo) ----------
function bindProductoSelector(){
  const btn = document.getElementById('btn-seleccionar-repuesto');
  if(!btn) return;

  // evitar doble binding
  if(btn._bound) return; btn._bound = true;

  btn.addEventListener('click', async ()=>{
    const modal = document.getElementById('modal-productos');
    const tbody = document.getElementById('tbody-productos');
    if(!modal || !tbody) return;
    modal.style.display = 'flex';
    tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando productos...</td></tr>";

    try{
      const res = await fetch('/api/productos', { credentials:'include' });
      const data = await res.json();
      const lista = Array.isArray(data)? data : [];
      if(lista.length===0){
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'>Sin productos.</td></tr>";
      } else {
        const rows = lista.map(p=>
          `<tr>
            <td><button type="button" class="btn-secundario btn-add-producto" data-codigo="${(p.codigo||'').replace(/\"/g,'&quot;')}" data-desc="${(p.descripcion||'').replace(/\"/g,'&quot;')}"><i class='fas fa-plus'></i> Agregar</button></td>
            <td>${p.descripcion||'-'}</td>
            <td>${p.codigo||'-'}</td>
            <td>${p.stock_total!=null? p.stock_total : '-'}</td>
          </tr>`
        ).join('');
        tbody.innerHTML = rows;
      }

      // delegate click para agregar al textarea
      tbody.onclick = (ev)=>{
        const btnAdd = ev.target.closest('.btn-add-producto');
        if(!btnAdd) return;
        const codigo = btnAdd.getAttribute('data-codigo')||'';
        const desc = btnAdd.getAttribute('data-desc')||'';
        const area = document.getElementById('trabajo');
        if(area){
          const prefix = area.value && !area.value.endsWith('\n') ? '\n' : '';
          const label = desc ? `(${codigo}) - ${desc}` : `(${codigo})`;
          area.value = (area.value||'') + prefix + label;
          area.dispatchEvent(new Event('input', { bubbles:true }));
        }
        cerrarModalProductos();
      };
    } catch(err){
      console.error('Error cargando productos:', err);
      tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:red'>Error al cargar productos.</td></tr>";
    }
  });
}

// ----- Historial: buscador + render -----
function bindHistorialSearch(){
  const input = document.getElementById('buscar-reparacion');
  const btn = document.getElementById('btn-buscar-historial');
  if(!input || !btn) return;

  // evitar listeners duplicados
  const newBtn = btn.cloneNode(true); btn.parentNode.replaceChild(newBtn, btn);
  const newInput = input.cloneNode(true); input.parentNode.replaceChild(newInput, input);

  const buscar = async () => {
    const q = (newInput.value||'').trim();
    if(!q){ alert('Ingrese texto a buscar'); return; }
    const modal = document.getElementById('modal-historial');
    const tbody = document.getElementById('tbody-historial');
    if(tbody) tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Buscando...</td></tr>";
    if(modal) modal.style.display='flex';

    try{
      // 1) Búsqueda parcial general
      const rbus = await fetch(`/api/reparaciones_planilla/buscar?q=${encodeURIComponent(q)}`, { credentials:'include' });
      const list = rbus.ok ? await rbus.json() : [];
      if (Array.isArray(list) && list.length === 1) {
        return cargarHistorial(list[0].id_reparacion);
      }
      if (Array.isArray(list) && list.length > 1) {
        const filas = list.map(r => `
          <tr class='resultado-clickable' data-id='${r.id_reparacion}'>
            <td colspan='2'><b>${r.id_reparacion}</b>${r.id_dota ? ` · DOTA ${r.id_dota}` : ''}</td>
            <td>${r.cliente || '-'}</td>
            <td>${r.equipo || '-'}</td>
            <td>${r.coche_numero || '-'}</td>
            <td>Ver</td>
          </tr>`).join('');
        if (tbody) tbody.innerHTML = filas;
        tbody.querySelectorAll('tr.resultado-clickable').forEach(tr => tr.addEventListener('click', () => cargarHistorial(tr.dataset.id)));
        return;
      }
      // 2) Si no hubo coincidencias, probar por nro de pedido
      const rped = await fetch(`/api/reparaciones_planilla/por_pedido?nro=${encodeURIComponent(q)}`, { credentials:'include' });
      const porPedido = rped.ok ? await rped.json() : [];
      if (Array.isArray(porPedido) && porPedido.length > 0) {
        const filas = porPedido.map(r => `
          <tr class='resultado-clickable' data-id='${r.id_reparacion}'>
            <td colspan='2'><b>${r.id_reparacion}</b>${r.nro_pedido_ref ? ` · Pedido ${r.nro_pedido_ref}` : ''}</td>
            <td>${r.cliente || '-'}</td>
            <td>${r.equipo || '-'}</td>
            <td>${r.coche_numero || '-'}</td>
            <td>Ver</td>
          </tr>`).join('');
        if (tbody) tbody.innerHTML = filas;
        tbody.querySelectorAll('tr.resultado-clickable').forEach(tr => tr.addEventListener('click', () => cargarHistorial(tr.dataset.id)));
        return;
      }
      // 3) Fallback exacto por compatibilidad
      return cargarHistorial(q);
      const txt = (v)=> (v==null||v==='')? '-' : String(v);
      const set = (elId, val)=>{ const el=document.getElementById(elId); if(el){ el.replaceChildren(document.createTextNode(txt(val))); } };
      set('historial-id', id);
      set('historial-cliente', first && first.cliente);
      set('historial-equipo', first && first.equipo);
      set('historial-coche', first && first.coche_numero);

      const extra = document.getElementById('historial-garantia-extra');
      if(extra){
        const show = !!(first && (first.id_dota || first.ultimo_reparador_nombre || first.resolucion || first.garantia==='si'));
        extra.style.display = show ? 'flex' : 'none';
        set('historial-id-dota', first && first.id_dota);
        set('historial-ultimo-reparador', first && first.ultimo_reparador_nombre);
        set('historial-resolucion', first && first.resolucion);
      }

      if(!Array.isArray(data) || data.length===0){
        if(tbody) tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:10px; color:#666'>Sin historial disponible.</td></tr>";
      } else {
        const ff = (f)=>{ try{ return new Date(f).toLocaleDateString('es-AR'); }catch{ return txt(f); } };
        const fh = (h)=>{ if(!h) return '-'; if(typeof h==='string') return h.slice(0,5); try{ return new Date(`1970-01-01T${h}`).toTimeString().slice(0,5); }catch{ return txt(h);} };
        const rows = data.map(r=>
          `<tr>
            <td>${ff(r.fecha)}</td>
            <td>${txt(r.trabajo)}</td>
            <td>${fh(r.hora_inicio)}</td>
            <td>${fh(r.hora_fin)}</td>
            <td>${txt(r.tecnico)}</td>
            <td>${r.garantia==='si'?'Si':'No'}</td>
          </tr>`
        ).join('');
        if(tbody) tbody.innerHTML = rows;
      }
    } catch(err){
      console.error('Error historial (refactor):', err);
      if(tbody) tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:10px; color:red'>Error al buscar historial.</td></tr>";
    }
  };

  newBtn.onclick = buscar;
  newInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); buscar(); }});
}

// auto-bind buscador historial
if (document.readyState !== 'loading') {
  bindHistorialSearch();
} else {
  document.addEventListener('DOMContentLoaded', bindHistorialSearch);
}

// ---------- Init ----------
function initPlanilla(){
  const grid = document.getElementById('calendarGrid');
  if(!grid){ setTimeout(initPlanilla,100); return; }
  bindMonthNavigation();
  renderCalendar(currentDate);
  bindPlanillaActions();
  bindProductoSelectorSimple();
  prepararSelectClientes(); prepararSelectFamilias(); prepararSelectTecnicos();
  bindCodigoRepuestoEnter();
  bindTrabajoWatcher();
  bindTrabajoAutocomplete();
}

if (document.getElementById('calendarGrid')) {
  initPlanilla();
  bindGarantiaToggle(true);
} else {
  document.addEventListener('view:changed', (e)=>{
    if(e.detail==='planilla') setTimeout(()=>{ initPlanilla(); bindGarantiaToggle(true); bindCodigoRepuestoEnter(); bindTrabajoWatcher(); bindTrabajoAutocomplete(); },100);
  });

  // Capturar Enter en el input para evitar submit + validación del formulario
  if(!document._scanEnterGuard){
    document._scanEnterGuard = true;
    document.addEventListener('keydown', (e)=>{
      if(e && e.key === 'Enter'){
        const t = e.target;
        if(t && t.id === 'scan-codigo-repuesto'){
          e.preventDefault();
          const v = (t.value||'').trim();
          if(v){ agregarPorCodigo(v); t.value=''; t.focus(); }
        }
      }
    }, true);
  }
}

// ---------- Scanner de códigos/QR para agregar repuestos ----------
(function(){
  let stream = null;
  let scanning = false;
  let rafId = null;
  let detector = null;
  let canvas = null, ctx = null;

  async function startScanner(){
    const video = document.getElementById('scanner-video');
    if(!video) return;
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
      if('BarcodeDetector' in window){
        try{ detector = new window.BarcodeDetector({ formats: ['qr_code','ean_13','code_128','code_39','upc_a'] }); }catch{ detector = new window.BarcodeDetector(); }
      } else {
        detector = null;
      }
      scanning = true;
      loop();
    }catch(err){
      console.warn('No se pudo iniciar cámara', err);
    }
  }

  function stopScanner(){
    scanning = false;
    if(rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if(stream){ stream.getTracks().forEach(t=>t.stop()); stream = null; }
  }

  async function loop(){
    if(!scanning) return;
    const video = document.getElementById('scanner-video');
    if(video && video.readyState >= 2){
      const w = video.videoWidth, h = video.videoHeight;
      if(w && h){
        canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
        if(detector){
          try{
            const codes = await detector.detect(canvas);
            if(codes && codes.length){
              const raw = codes[0].rawValue || codes[0].raw || '';
              onCodeDetected(raw);
              return; // detener al primer hallazgo
            }
          }catch(e){ /* ignore per frame */ }
        }
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  function normalizeScanned(text){
    if(!text) return '';
    let t = String(text).trim();
    try{ const obj = JSON.parse(t); if(obj && obj.codigo) return String(obj.codigo).trim(); }catch{}
    const m = t.match(/([A-Z0-9\-\.]+)/i); // toma bloque alfanumérico más útil
    return (m? m[1] : t).trim();
  }

  async function agregarPorCodigo(codigo){
    if(!codigo) return;
    const code = String(codigo).trim();
    try{
      const res = await fetch('/api/productos', { credentials:'include' });
      const data = await res.json();
      const lista = Array.isArray(data)? data : [];
      const prod = lista.find(p => {
        const c = String(p.codigo||'').trim().toLowerCase();
        const b = String(p.codigo_barra||'').trim();
        const bLower = b.toLowerCase();
        const stripZeros = (s)=> String(s||'').replace(/^0+/, '');
        return (c === code.toLowerCase() || bLower === code.toLowerCase() || stripZeros(b) === stripZeros(code));
      });
      const area = document.getElementById('trabajo');
      if(prod){
        const prefix = area && area.value && !area.value.endsWith('\n') ? '\n' : '';
        const label = `(${prod.codigo}) - ${prod.descripcion||''}`;
        if(area){ area.value = (area.value||'') + prefix + label; area.dispatchEvent(new Event('input',{bubbles:true})); }
        // descuento automático al agregar por código
        try{
          await descontarStockProducto(prod.id, `Codigo (${prod.codigo})`);
        }catch(_){ }
        // registrar para posible reversión si el usuario borra la línea
        try{
          const info = _repuestosTrack.get(prod.codigo) || { id: prod.id, count: 0 };
          info.id = prod.id; info.count = (info.count||0) + 1; _repuestosTrack.set(prod.codigo, info);
        }catch(_){ }
        cerrarModalScanner();
      } else {
        alert('No se encontró producto con código: ' + code);
      }
    }catch(err){ console.error('Error buscando productos por código', err); alert('No se pudo consultar productos.'); }
  }

  // Exponer para posibles llamados externos (evitar problemas de scope)
  try{ window.agregarPorCodigo = agregarPorCodigo; }catch(_){ }

  function onCodeDetected(raw){
    stopScanner();
    const code = normalizeScanned(raw);
    if(!code){ alert('Código inválido.'); return; }
    agregarPorCodigo(code);
  }

  // Expuestos globales para el HTML
  window.cerrarModalScanner = function(){
    const m = document.getElementById('modal-scanner'); if(m) m.style.display='none';
    stopScanner();
  };
  window.abrirModalScanner = function(){
    const m = document.getElementById('modal-scanner'); if(m) m.style.display='flex';
    startScanner();
  };

  // Bind botones
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = document.getElementById('btn-scan-repuesto');
    if(btn && !btn._bound){ btn._bound = true; btn.addEventListener('click', ()=>{ window.abrirModalScanner(); }); }
    const addByCode = document.getElementById('btn-add-by-code');
    const input = document.getElementById('manual-scan-code');
    if(addByCode && !addByCode._bound){ addByCode._bound = true; addByCode.addEventListener('click', ()=>{ const v=input && input.value; if(v) agregarPorCodigo(v); }); }
    if(input && !input._bound){ input._bound = true; input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); const v=input.value.trim(); if(v) agregarPorCodigo(v); } }); }
    const scanInput = document.getElementById('scan-codigo-repuesto');
    if(scanInput && !scanInput._bound){
      scanInput._bound = true;
      const handle = ()=>{ const v=scanInput.value.trim(); if(v){ agregarPorCodigo(v); scanInput.value=''; scanInput.focus(); } };
      scanInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); handle(); } });
      scanInput.addEventListener('change', ()=>{ /* para algunos escaners que envían blur */ handle(); });
    }
  });
  document.addEventListener('view:changed', (e)=>{
    if(e.detail==='planilla'){
      // rebind in case the view was dynamically injected
      const btn = document.getElementById('btn-scan-repuesto');
      if(btn && !btn._bound){ btn._bound = true; btn.addEventListener('click', ()=>{ window.abrirModalScanner(); }); }
      const addByCode = document.getElementById('btn-add-by-code');
      const input = document.getElementById('manual-scan-code');
      if(addByCode && !addByCode._bound){ addByCode._bound = true; addByCode.addEventListener('click', ()=>{ const v=input && input.value; if(v) agregarPorCodigo(v); }); }
      if(input && !input._bound){ input._bound = true; input.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); const v=input.value.trim(); if(v) agregarPorCodigo(v); } }); }
      const scanInput = document.getElementById('scan-codigo-repuesto');
      if(scanInput && !scanInput._bound){
        scanInput._bound = true;
        const handle = ()=>{ const v=scanInput.value.trim(); if(v){ agregarPorCodigo(v); scanInput.value=''; scanInput.focus(); } };
        scanInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); handle(); } });
        scanInput.addEventListener('change', ()=>{ handle(); });
      }
    }
  });
})();

// Helper global para cargar historial por ID (usado por el buscador parcial)
async function cargarHistorial(id){
  const modal = document.getElementById('modal-historial');
  const tbody = document.getElementById('tbody-historial');
  try{
    const res = await fetch(`/api/reparaciones_planilla/historial/${encodeURIComponent(id)}`, { credentials:'include' });
    const data = await res.json();
    if(!res.ok) throw new Error(data && data.error || 'Error');

    const first = Array.isArray(data) && data.length>0 ? data[0] : null;
    document.getElementById('historial-id')?.replaceChildren(document.createTextNode(id));
    document.getElementById('historial-cliente')?.replaceChildren(document.createTextNode(first?.cliente || '-'));
    document.getElementById('historial-equipo')?.replaceChildren(document.createTextNode(first?.equipo || '-'));
    document.getElementById('historial-coche')?.replaceChildren(document.createTextNode(first?.coche_numero || '-'));

    const extra = document.getElementById('historial-garantia-extra');
    if (extra) {
      const showExtra = !!(first && (first.id_dota || first.ultimo_reparador_nombre || first.resolucion || first.garantia === 'si'));
      extra.style.display = showExtra ? 'flex' : 'none';
      document.getElementById('historial-id-dota')?.replaceChildren(document.createTextNode(first?.id_dota ?? '-'));
      document.getElementById('historial-ultimo-reparador')?.replaceChildren(document.createTextNode(first?.ultimo_reparador_nombre || '-'));
      document.getElementById('historial-resolucion')?.replaceChildren(document.createTextNode(first?.resolucion || '-'));
    }

    const fmt = (v) => (v == null || v === '') ? '-' : v;
    const fmtFecha = (f) => { try { return new Date(f).toLocaleDateString('es-AR'); } catch { return String(f||'-'); } };
    const fmtHora = (h) => { if(!h) return '-'; if (typeof h === 'string') return h.slice(0,5); try { return new Date(`1970-01-01T${h}`).toTimeString().slice(0,5);} catch { return String(h);} };
    const rows = (Array.isArray(data)?data:[]).map(r => {
      const fecha = fmtFecha(r.fecha);
      const trabajo = fmt(r.trabajo);
      const hi = fmtHora(r.hora_inicio);
      const hf = fmtHora(r.hora_fin);
      const tec = fmt(r.tecnico);
      const gar = r.garantia === 'si' ? 'Si' : 'No';
      return `<tr><td>${fecha}</td><td>${trabajo}</td><td>${hi}</td><td>${hf}</td><td>${tec}</td><td>${gar}</td></tr>`;
    }).join('');
    if (tbody) tbody.innerHTML = rows || "<tr><td colspan='6' style='text-align:center; padding:10px; color:#666'>Sin historial disponible.</td></tr>";
    if (modal) modal.style.display='flex';
  } catch(err){
    console.error('Error historial:', err);
    if (tbody) tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:10px; color:red'>Error al buscar historial.</td></tr>";
  }
}

// Garantia: bind robusto para vista cargada dinámicamente
function bindGarantiaToggle(forceApply){
  const g = document.getElementById('garantia');
  if(g && !g._bound){ g._bound = true; g.addEventListener('change', toggleGarantiaExtra); }
  if (forceApply) toggleGarantiaExtra();
}

// Mostrar/ocultar select de cliente externo según tipo
function bindClienteExternoToggle(forceApply){
  const sel = document.getElementById('cliente_tipo');
  const wrap = document.getElementById('cliente_externo_wrapper');
  const selCli = document.getElementById('cliente_id');
  if(!sel || !wrap || !selCli) return;
  const apply = ()=>{
    const isExt = (sel.value||'').toLowerCase()==='externo';
    wrap.style.display = isExt ? 'grid' : 'none';
    selCli.required = !!isExt;
    if(isExt){ prepararSelectClientes(); }
    else { selCli.value=''; }
  };
  if(!sel._bound){ sel._bound=true; sel.addEventListener('change', apply); }
  if(forceApply || sel.value){ apply(); }
}

// Ajuste de placeholder cuando no hay escaneo: mantener solo input + selector
document.addEventListener('DOMContentLoaded', ()=>{
  const inp = document.getElementById('scan-codigo-repuesto');
  if(inp) inp.setAttribute('placeholder', 'Escribir codigo de producto y Enter');
});
document.addEventListener('view:changed', (e)=>{
  if(e && e.detail==='planilla'){
    const inp = document.getElementById('scan-codigo-repuesto');
    if(inp) inp.setAttribute('placeholder', 'Escribir codigo de producto y Enter');
  }
});





