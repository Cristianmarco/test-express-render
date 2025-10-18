// === Proveedores (Refactor) ===
(function () {
  let proveedorSel = null; // { id, codigo, razon_social/nombre, telefono, email, web, fantasia? }

  function el(id) { return document.getElementById(id); }

  function mapProveedorRow(p) {
    const razon = p.razon_social || p.nombre || "";
    const fantasia = p.fantasia || razon; // fallback si no hay fantasia
    return { id: p.id, codigo: p.codigo, razon_social: razon, fantasia, telefono: p.telefono || "", email: p.email || "", web: p.web || "" };
  }

  async function cargarProveedores(filtro = "") {
    const tbody = el("tbody-proveedores-ref");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888; padding:10px;"><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>`;
    try {
      const res = await fetch('/api/proveedores');
      const data = await res.json();
      if (!res.ok) throw new Error("Error al cargar proveedores");
      const lista = (Array.isArray(data) ? data : []).map(mapProveedorRow);
      const t = (filtro || "").toLowerCase();
      const filtrado = t
        ? lista.filter(p =>
            (p.codigo || "").toLowerCase().includes(t) ||
            (p.fantasia || "").toLowerCase().includes(t) ||
            (p.razon_social || "").toLowerCase().includes(t)
          )
        : lista;

      tbody.innerHTML = "";
      filtrado.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${p.codigo}</td>
          <td>${p.fantasia || '-'}</td>
          <td>${p.razon_social || '-'}</td>
        `;
        tr.addEventListener('click', () => seleccionarFilaProveedor(p, tr));
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error(e);
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#c33; padding:10px;">Error al cargar</td></tr>`;
    }
  }

  function seleccionarFilaProveedor(p, tr) {
    proveedorSel = p;
    document.querySelectorAll('#tbody-proveedores-ref tr').forEach(r => r.classList.remove('selected'));
    tr.classList.add('selected');
    // Ficha
    el('prov-codigo').textContent = p.codigo || '-';
    el('prov-fantasia').textContent = p.fantasia || '-';
    el('prov-razon').textContent = p.razon_social || '-';
    el('prov-telefono').textContent = p.telefono || '-';
    el('prov-email').textContent = p.email || '-';
    if (p.web) {
      el('prov-web').innerHTML = `<a href="${p.web}" target="_blank">${p.web}</a>`;
    } else {
      el('prov-web').textContent = '-';
    }
  }

  function bindAcciones() {
    const btnBuscar = el('btn-buscar-proveedor');
    if (btnBuscar) btnBuscar.onclick = () => cargarProveedores(el('buscar-proveedor')?.value || "");

    const btnAgregar = el('btn-prov-agregar');
    if (btnAgregar) btnAgregar.onclick = () => {
      const form = el('form-proveedor-ref');
      if (form) form.reset();
      proveedorSel = null;
      el('modal-proveedor-ref').style.display = 'flex';
    };

    const btnEditar = el('btn-prov-modificar');
    if (btnEditar) btnEditar.onclick = () => {
      if (!proveedorSel) return alert('Selecciona un proveedor');
      const form = el('form-proveedor-ref');
      if (!form) return;
      form.codigo.value = proveedorSel.codigo || '';
      form.razon_social.value = proveedorSel.razon_social || '';
      form.telefono.value = proveedorSel.telefono || '';
      form.email.value = proveedorSel.email || '';
      form.web.value = proveedorSel.web || '';
      el('modal-proveedor-ref').style.display = 'flex';
    };

    const btnEliminar = el('btn-prov-eliminar');
    if (btnEliminar) btnEliminar.onclick = async () => {
      if (!proveedorSel) return alert('Selecciona un proveedor');
      if (!confirm('¿Eliminar proveedor?')) return;
      try {
        const res = await fetch(`/api/proveedores/${encodeURIComponent(proveedorSel.codigo)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        proveedorSel = null;
        await cargarProveedores(el('buscar-proveedor')?.value || "");
        // Limpiar ficha
        ['prov-codigo','prov-fantasia','prov-razon','prov-telefono','prov-email','prov-web'].forEach(id => el(id).textContent = '-');
      } catch (e) {
        console.error(e);
        alert('No se pudo eliminar');
      }
    };
  }

  function bindForm() {
    const form = el('form-proveedor-ref');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const datos = Object.fromEntries(new FormData(form).entries());
      const editMode = !!(proveedorSel && proveedorSel.id);
      const url = editMode ? `/api/proveedores/${proveedorSel.id}` : '/api/proveedores';
      const method = editMode ? 'PUT' : 'POST';
      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        el('modal-proveedor-ref').style.display = 'none';
        form.reset();
        await cargarProveedores(el('buscar-proveedor')?.value || "");
      } catch (e) {
        console.error(e);
        alert('No se pudo guardar el proveedor');
      }
    };
  }

  function initProveedores() {
    if (!el('tbody-proveedores-ref')) { setTimeout(initProveedores, 100); return; }
    bindAcciones();
    bindForm();
    cargarProveedores();
  }

  // arranque según vista dinámica
  if (document.querySelector('.tab-content[data-view="proveedores"]')) {
    initProveedores();
  }
  document.addEventListener('view:changed', (e) => {
    if (e.detail === 'proveedores') initProveedores();
  });
})();

