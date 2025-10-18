// === Configuracion -> Tablas Generales ===
(function () {
  let thead, tbody, tabs, modal, form, fieldsWrap, title;

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
      ],
      form: [
        { name: 'codigo', label: 'Codigo', type: 'text', required: true },
        { name: 'descripcion', label: 'Nombre', type: 'text', required: true },
        { name: 'categoria_id', label: 'Categoria', type: 'select', required: false, endpoint: '/api/categoria', map: { value: 'id', label: 'descripcion' } },
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
        { name: 'familias', label: 'Familias', type: 'multiselect', required: false, endpoint: '/api/familias', map: { value: 'id', label: 'descripcion' } },
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
  };

  function renderHead() {
    const cols = entidades[entidad].columns;
    thead.innerHTML = cols.map(c => `<th>${c.label}</th>`).join('');
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
    const meta = entidades[entidad];
    title.innerHTML = `<i class="fas fa-database"></i> ${edit ? 'Editar' : 'Nuevo'} ${entidad}`;
    fieldsWrap.innerHTML = meta.form.map(f => {
      const req = f.required ? 'required' : '';
      if (f.type === 'select' || f.type === 'multiselect') {
        const opts = (f.options || []).map(o => `<option value="${o.value}">${o.label}</option>`).join('');
        const multiple = f.type === 'multiselect' ? ' multiple size="6"' : '';
        return `<div><label>${f.label}${f.required ? ' *' : ''}</label><select name="${f.name}" ${req}${multiple}>${opts}</select></div>`;
      }
      const typeAttr = f.type ? `type="${f.type}"` : '';
      return `<div><label>${f.label}${f.required ? ' *' : ''}</label><input name="${f.name}" ${typeAttr} ${req} /></div>`;
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
        if (input) input.value = seleccionado[f.name] || '';
      });
    } else {
      form.reset();
    }
    modal.style.display = 'flex';
    // Completar selects remotos (endpoint)
    meta.form.forEach(async (f) => {
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
    // Adaptar multiselects a arrays de valores
    meta.form.forEach(f => {
      if (f.type === 'multiselect') {
        const sel = form.querySelector(`[name='${f.name}']`);
        if (sel) {
          const vals = Array.from(sel.selectedOptions).map(o => o.value);
          data[f.name] = vals;
        }
      }
    });
    const isEdit = !!(seleccionado && seleccionado[meta.pk]);
    const url = isEdit ? `${meta.endpoint}/${encodeURIComponent(seleccionado[meta.pk])}` : meta.endpoint;
    const method = isEdit ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'include' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Error al guardar');
      modal.style.display = 'none';
      form.reset();
      await cargarLista();
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

    document.getElementById('btn-conf-agregar').onclick = () => openModal(false);
    document.getElementById('btn-conf-modificar').onclick = () => {
      if (!seleccionado) return alert('Selecciona un elemento');
      openModal(true);
    };
    document.getElementById('btn-conf-eliminar').onclick = eliminar;
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
