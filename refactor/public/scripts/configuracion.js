// === Configuracion -> Tablas Generales ===
(function () {
  let thead, tbody, tabs, modal, form, fieldsWrap, title;
  let btnAgregar, btnModificar, btnEliminar;

  let entidad = 'familias';
  let seleccionado = null; // objeto actual

  const entidades = {
    familias: {
      endpoint: '/api/familias',
      pk: 'id',
      columns: [
        { key: 'codigo', label: 'Codigo' },
        { key: 'descripcion', label: 'Nombre' },
        { key: 'categoria', label: 'Categoria' },
        { key: 'tipo', label: 'Tipo' },
      ],
      form: [
        { name: 'codigo', label: 'Codigo', type: 'text', required: true },
        { name: 'descripcion', label: 'Nombre', type: 'text', required: true },
        { name: 'categoria_id', label: 'Categoria', type: 'select', required: false, endpoint: '/api/categoria', map: { value: 'id', label: 'descripcion' } },
        { name: 'tipo', label: 'Tipo', type: 'select', required: false, options: [
          { value: '', label: '(No asignado)' },
          { value: 'chico', label: 'Chico' },
          { value: 'grande', label: 'Grande' },
        ]},
      ],
    },
    grupo: {
      endpoint: '/api/grupo',
      pk: 'id',
      columns: [
        { key: 'codigo', label: 'Codigo' },
        { key: 'descripcion', label: 'Nombre' },
        { key: 'familia', label: 'Familia' },
      ],
      form: [
        { name: 'codigo', label: 'Codigo', type: 'text', required: true },
        { name: 'descripcion', label: 'Nombre', type: 'text', required: true },
        { name: 'familias', label: 'Familias', type: 'familias_checklist', required: false, endpoint: '/api/familias', map: { value: 'id', label: 'descripcion' } },
      ],
    },
    marca: {
      endpoint: '/api/marca',
      pk: 'id',
      columns: [
        { key: 'codigo', label: 'Codigo' },
        { key: 'descripcion', label: 'Nombre' },
      ],
      form: [
        { name: 'codigo', label: 'Codigo', type: 'text', required: true },
        { name: 'descripcion', label: 'Nombre', type: 'text', required: true },
      ],
    },
    categoria: {
      endpoint: '/api/categoria',
      pk: 'id',
      columns: [
        { key: 'codigo', label: 'Codigo' },
        { key: 'descripcion', label: 'Nombre' },
      ],
      form: [
        { name: 'codigo', label: 'Codigo', type: 'text', required: true },
        { name: 'descripcion', label: 'Nombre', type: 'text', required: true },
      ],
    },
    tecnicos: {
      endpoint: '/api/tecnicos',
      pk: 'id',
      columns: [
        { key: 'id', label: 'Codigo' },
        { key: 'nombre', label: 'Nombre' },
        { key: 'dni', label: 'DNI' },
        { key: 'telefono', label: 'Telefono' },
        { key: 'mail', label: 'Mail' },
      ],
      form: [
        { name: 'nombre', label: 'Nombre', type: 'text', required: true },
        { name: 'dni', label: 'DNI', type: 'text', required: true },
        { name: 'direccion', label: 'Direccion', type: 'text', required: false },
        { name: 'telefono', label: 'Telefono', type: 'text', required: false },
        { name: 'mail', label: 'Mail', type: 'email', required: false },
      ],
    },
    depositos: {
      endpoint: '/api/depositos',
      pk: 'id',
      columns: [
        { key: 'id', label: 'Codigo' },
        { key: 'nombre', label: 'Nombre' },
      ],
      form: [
        { name: 'nombre', label: 'Nombre', type: 'text', required: true },
        { name: 'ubicacion', label: 'Ubicacion', type: 'text', required: false },
      ],
    },
    pendientes: {
      endpoint: '/api/reparaciones_dota',
      pk: 'id',
      columns: [
        { key: 'nro_pedido', label: 'Nro Pedido' },
        { key: 'pendientes', label: 'Pendientes' },
      ],
      form: [
        { name: 'nro_pedido', label: 'Nro Pedido', type: 'text', required: false, attrs: 'readonly' },
        { name: 'pendientes', label: 'Pendientes', type: 'number', required: true, attrs: 'min="0" step="1"' },
      ],
    },
  };

  function isPendientes() {
    return entidad === 'pendientes';
  }

  function updateToolbarState() {
    if (!btnAgregar || !btnEliminar) return;
    const hide = isPendientes();
    btnAgregar.style.display = hide ? 'none' : '';
    btnEliminar.style.display = hide ? 'none' : '';
    if (btnAgregar) btnAgregar.disabled = hide;
    if (btnEliminar) btnEliminar.disabled = hide;
  }

  function renderHead() {
    const cols = entidades[entidad].columns;
    thead.innerHTML = cols.map(c => `<th>${c.label}</th>`).join('');
    updateToolbarState();
  }

  async function cargarLista() {
    tbody.innerHTML = `<tr><td colspan="${entidades[entidad].columns.length}" style="text-align:center; padding:10px; color:#888"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    try {
      const res = await fetch(entidades[entidad].endpoint, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error('Error de servidor');
      tbody.innerHTML = '';
      const cols = entidades[entidad].columns;
      (Array.isArray(data) ? data : []).forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = cols.map(c => `<td>${item[c.key] ?? '-'}</td>`).join('');
        tr.addEventListener('click', () => seleccionar(item, tr));
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="${entidades[entidad].columns.length}" style="text-align:center; padding:10px; color:#c33">Error al cargar</td></tr>`;
    }
  }

  function seleccionar(item, tr) {
    seleccionado = item;
    tbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
    tr.classList.add('selected');
  }

  function openModal(edit = false) {
    if (isPendientes() && !edit) {
      alert('Solo se puede editar el numero pendiente de pedidos existentes.');
      return;
    }
    const meta = entidades[entidad];
    if (form) {
      form.dataset.mode = edit ? 'edit' : 'create';
      form.dataset.editId = edit && seleccionado ? seleccionado[meta.pk] : '';
    }
    title.innerHTML = `<i class="fas fa-database"></i> ${edit ? 'Editar' : 'Nuevo'} ${entidad}`;
    fieldsWrap.innerHTML = meta.form.map(f => {
      const req = f.required ? 'required' : '';
      if (f.type === 'familias_checklist') {
        return `
          <div style="grid-column: 1 / -1; width: 100%; min-width: 0;">
            <label>${f.label}${f.required ? ' *' : ''}</label>
            <div style="margin-top:8px; border:1px solid #dbe3ee; border-radius:10px; background:#fff;">
              <div class="familias-quick-actions" style="display:flex; flex-wrap:wrap; gap:6px; padding:10px 10px 8px; border-bottom:1px solid #eef2f7;">
                <button type="button" class="btn-secundario" data-family-bulk="arranque" style="padding:6px 10px; font-size:12px;">Todos los Arranques</button>
                <button type="button" class="btn-secundario" data-family-bulk="alternador" style="padding:6px 10px; font-size:12px;">Todos los Alternadores</button>
                <button type="button" class="btn-secundario" data-family-bulk="clear" style="padding:6px 10px; font-size:12px;">Limpiar</button>
              </div>
              <details open>
                <summary style="cursor:pointer; list-style:none; padding:8px 10px; font-size:12px; font-weight:600; color:#475569;">Seleccionar familias</summary>
                <div id="familias-checklist" style="width:100%; max-height:220px; overflow:auto; padding:6px 10px 10px; background:#fff; box-sizing:border-box;">
                  <div style="color:#64748b; font-size:12px;">Cargando familias...</div>
                </div>
              </details>
            </div>
          </div>`;
      }
      if (f.type === 'select' || f.type === 'multiselect') {
        const opts = (f.options || []).map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        const multiple = f.type === 'multiselect' ? ' multiple size="6"' : '';
        const extraAttrs = f.attrs ? ` ${f.attrs}` : '';
        return `<div><label>${f.label}${f.required ? ' *' : ''}</label><select name="${f.name}" ${req}${multiple}${extraAttrs}>${opts}</select></div>`;
      }
      const typeAttr = f.type && f.type !== 'textarea' ? `type="${f.type}"` : '';
      const extraAttrs = f.attrs ? ` ${f.attrs}` : '';
      if (f.type === 'textarea') {
        return `<div><label>${f.label}${f.required ? ' *' : ''}</label><textarea name="${f.name}" ${req}${extraAttrs}></textarea></div>`;
      }
      return `<div><label>${f.label}${f.required ? ' *' : ''}</label><input name="${f.name}" ${typeAttr} ${req}${extraAttrs} /></div>`;
    }).join('');

    // Extra para tecnicos: mostrar QR si existe
    if (entidad === 'tecnicos' && edit && seleccionado && seleccionado.qr_code) {
      const qrBlock = document.createElement('div');
      qrBlock.className = 'section';
      qrBlock.innerHTML = `
        <div class="section-title">Codigo QR asignado</div>
        <div style="display:flex; align-items:center; gap:12px;">
          <img id="qr-preview" src="${seleccionado.qr_code}" alt="QR Tecnico" style="width:140px; height:140px; border:1px solid #e5e7eb; border-radius:8px; background:#fff" />
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button type="button" id="btn-qr-descargar" class="btn-guardar" style="background:#3b82f6;">Descargar PNG</button>
            <button type="button" id="btn-qr-imprimir" class="btn-guardar" style="background:#6b7280;">Imprimir</button>
          </div>
        </div>
      `;
      fieldsWrap.appendChild(qrBlock);
      setTimeout(() => {
        const btnDown = document.getElementById('btn-qr-descargar');
        const btnPrint = document.getElementById('btn-qr-imprimir');
        if (btnDown) btnDown.onclick = () => downloadDataUrl(seleccionado.qr_code, `tecnico-${seleccionado.id}.png`);
        if (btnPrint) btnPrint.onclick = () => printDataUrl(seleccionado.qr_code);
      }, 0);
    }

    if (edit && seleccionado) {
      meta.form.forEach(f => {
        const input = form.querySelector(`[name='${f.name}']`);
        if (input) input.value = seleccionado[f.name] ?? '';
      });
    } else {
      form.reset();
    }
    modal.style.display = 'flex';
    // Completar selects remotos (endpoint)
    meta.form.forEach(async (f) => {
      if (f.type === 'familias_checklist' && f.endpoint) {
        const box = document.getElementById('familias-checklist');
        if (!box) return;
        try {
          const res = await fetch(f.endpoint, { credentials: 'include' });
          const data = await res.json();
          const list = Array.isArray(data) ? data : [];
          const selectedIds = edit && seleccionado && Array.isArray(seleccionado[f.name])
            ? new Set(seleccionado[f.name].map(x => String(x.id ?? x)))
            : new Set();
          box.innerHTML = `<div style="display:grid; width:100%; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px 12px; box-sizing:border-box;">` + list.map((item) => {
            const id = String(item.id ?? '');
            const code = item.codigo != null ? String(item.codigo).trim() : '';
            const desc = (item.descripcion || item.nombre || '').toString().trim();
            const categoria = (item.categoria || '').toString().trim().toLowerCase();
            const text = code && desc ? `${code} - ${desc}` : (desc || code || `Familia ${id}`);
            const checked = selectedIds.has(id) ? 'checked' : '';
            return `
              <label style="display:flex; align-items:flex-start; gap:8px; padding:6px 8px; border:1px solid #eef2f7; border-radius:8px; min-width:0;">
                <input type="checkbox" name="familias" value="${id}" data-categoria="${categoria}" ${checked} style="margin-top:2px; flex:0 0 auto;" />
                <span style="font-size:12px; line-height:1.25; color:#334155;">${text}</span>
              </label>`;
          }).join('') + `</div>` || '<div style="color:#64748b;">(sin datos)</div>';

          fieldsWrap.querySelectorAll('[data-family-bulk]').forEach((btn) => {
            if (btn._bound) return;
            btn._bound = true;
            btn.addEventListener('click', () => {
              const mode = btn.getAttribute('data-family-bulk');
              const checks = Array.from(box.querySelectorAll('input[type="checkbox"][name="familias"]'));
              if (mode === 'clear') {
                checks.forEach(ch => { ch.checked = false; });
                return;
              }
              checks.forEach(ch => {
                const cat = String(ch.dataset.categoria || '');
                ch.checked = mode === 'arranque'
                  ? cat.includes('arranque')
                  : cat.includes('alternador');
              });
            });
          });
        } catch (e) {
          console.error('Checklist familias error', e);
          box.innerHTML = '<div style="color:#64748b;">(sin datos)</div>';
        }
        return;
      }
      if ((f.type === 'select' || f.type === 'multiselect') && f.endpoint) {
        const sel = form.querySelector(`[name='${f.name}']`);
        if (!sel) return;
        sel.innerHTML = '<option value="">Cargando...</option>';
        try {
          const res = await fetch(f.endpoint, { credentials: 'include' });
          const data = await res.json();
          const list = Array.isArray(data) ? data : [];
          const getVal = (o) => f.map?.value ? o[f.map.value] : (o.id ?? o.codigo);
          const getLabel = (o) => f.map?.label ? o[f.map.label] : (o.descripcion || o.nombre || o.codigo);
          sel.innerHTML = f.type === 'multiselect' ? '' : '<option value="">Seleccione</option>';
          list.forEach(o => {
            const opt = document.createElement('option');
            opt.value = getVal(o);
            opt.textContent = getLabel(o);
            sel.appendChild(opt);
          });
          if (edit && seleccionado && seleccionado[f.name] != null) {
            if (Array.isArray(seleccionado[f.name])) {
              const ids = seleccionado[f.name].map(x => String(x.id ?? x));
              Array.from(sel.options).forEach(op => { op.selected = ids.includes(String(op.value)); });
            } else {
              sel.value = String(seleccionado[f.name]);
            }
          }
          // Mejor UX para multiselect: alterna con click sin CTRL
          if (f.type === 'multiselect') {
            if (!sel._enhanced) {
              sel._enhanced = true;
              sel.addEventListener('mousedown', (e) => {
                const opt = e.target;
                if (opt && opt.tagName === 'OPTION') {
                  e.preventDefault();
                  opt.selected = !opt.selected;
                  const ev = new Event('change', { bubbles: true });
                  sel.dispatchEvent(ev);
                }
              });
            }
          }
        } catch (e) {
          console.error('Select remoto error', f.name, e);
          sel.innerHTML = '<option value="">(sin datos)</option>';
        }
      }
    });
  }

  async function guardar(e) {
    e.preventDefault();
    const meta = entidades[entidad];
    const data = Object.fromEntries(new FormData(form).entries());
    const refreshDashboard = () => {
      try {
        document.dispatchEvent(new CustomEvent('dashboard:refresh'));
        if (typeof window.refreshInicioStats === 'function') window.refreshInicioStats();
      } catch (_) {}
    };
    // Adaptar multiselects a arrays de valores
    meta.form.forEach(f => {
      if (f.type === 'familias_checklist') {
        const checks = form.querySelectorAll(`input[type="checkbox"][name='${f.name}']:checked`);
        data[f.name] = Array.from(checks).map(ch => ch.value);
      } else if (f.type === 'multiselect') {
        const sel = form.querySelector(`[name='${f.name}']`);
        if (sel) {
          const vals = Array.from(sel.selectedOptions).map(o => o.value);
          data[f.name] = vals;
        }
      } else if (f.type === 'number') {
        const val = data[f.name];
        if (val === '' || val === undefined) data[f.name] = null;
        else {
          const num = Number(val);
          data[f.name] = Number.isNaN(num) ? null : num;
        }
      }
    });
    if (isPendientes()) {
      if (!seleccionado) return alert('Selecciona un pedido para ajustar el pendiente.');
      try {
        const res = await fetch(`${meta.endpoint}/${encodeURIComponent(seleccionado[meta.pk])}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendientes: data.pendientes }),
          credentials: 'include',
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || 'Error al actualizar pendiente');
        modal.style.display = 'none';
        await cargarLista();
        refreshDashboard();
      } catch (err) {
        console.error(err);
        alert('No se pudo actualizar el pendiente');
      }
      return;
    }

    const isEdit = form.dataset.mode === 'edit' && seleccionado && seleccionado[meta.pk];
    const url = isEdit ? `${meta.endpoint}/${encodeURIComponent(seleccionado[meta.pk])}` : meta.endpoint;
    const method = isEdit ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'include' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Error al guardar');
      modal.style.display = 'none';
      form.reset();
      form.dataset.mode = 'create';
      form.dataset.editId = '';
      await cargarLista();
      if (meta.endpoint === '/api/reparaciones_dota') refreshDashboard();
    } catch (err) {
      console.error(err);
      alert('No se pudo guardar');
    }
  }

  async function eliminar() {
    const meta = entidades[entidad];
    if (!seleccionado) return alert('Selecciona un elemento');
    if (!confirm('Eliminar elemento?')) return;
    try {
      const res = await fetch(`${meta.endpoint}/${encodeURIComponent(seleccionado[meta.pk])}`, { method: 'DELETE', credentials: 'include' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok && !payload.success) throw new Error(payload.error || 'Error al eliminar');
      seleccionado = null;
      await cargarLista();
    } catch (e) {
      console.error(e);
      alert('No se pudo eliminar');
    }
  }

  function bindUI() {
    // Subtabs
    tabs.querySelectorAll('.subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('.subtab').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        entidad = btn.dataset.entity;
        seleccionado = null;
        renderHead();
        cargarLista();
      });
    });

    btnAgregar = document.getElementById('btn-conf-agregar');
    btnModificar = document.getElementById('btn-conf-modificar');
    btnEliminar = document.getElementById('btn-conf-eliminar');

    btnAgregar.onclick = () => {
      if (isPendientes()) {
        alert('Solo se permite editar pendientes cargados.');
        return;
      }
      openModal(false);
    };
    btnModificar.onclick = () => {
      if (!seleccionado) return alert('Selecciona un elemento');
      openModal(true);
    };
    btnEliminar.onclick = () => {
      if (isPendientes()) {
        alert('No se pueden eliminar pendientes desde este modulo.');
        return;
      }
      eliminar();
    };
    updateToolbarState();
    form.onsubmit = guardar;
  }

  function init() {
    // (Re)capturar elementos porque la vista se carga dinamicamente
    thead = document.getElementById('thead-config');
    tbody = document.getElementById('tbody-config');
    tabs = document.getElementById('subtabs-config');
    modal = document.getElementById('modal-config-item');
    form = document.getElementById('form-config-item');
    fieldsWrap = document.getElementById('form-config-fields');
    title = document.getElementById('modal-config-title');

    if (!thead || !tbody || !tabs) {
      // La vista aun no esta en el DOM; reintentar pronto
      setTimeout(init, 100);
      return;
    }
    renderHead();
    cargarLista();
    bindUI();
  }

  // Utilidades: descargar/imprimir data URL
  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename || 'qr.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function printDataUrl(dataUrl) {
    const w = window.open('');
    if (!w) return;
    w.document.write(`<img src="${dataUrl}" onload="window.print(); window.close();" />`);
    w.document.close();
  }

  // arranca al cargar la vista
  if (document.querySelector('.tab-content[data-view="configuracion"]')) {
    init();
  }
  document.addEventListener('view:changed', (e) => {
    if (e.detail === 'configuracion') init();
  });
})();
