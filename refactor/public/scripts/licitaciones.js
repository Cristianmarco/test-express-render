// Licitaciones (refactor)

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
      <tr>
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
      const btn = e.target.closest('.btn-ver-licitacion');
      if (!btn) return;
      const nro = btn.getAttribute('data-nro');
      if (nro) verDetalleLicitacion(nro);
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
  if (tBody) tBody.innerHTML = "<tr><td colspan='4' style='text-align:center; padding:10px; color:#666'><i class='fas fa-spinner fa-spin'></i> Cargando...</td></tr>";
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
  // Carga cuando se abra la vista dinámicamente
  document.addEventListener('view:changed', (e)=>{
    if (e.detail === 'licitaciones') setTimeout(bindLicitacionesView, 50);
  });
  // y por si se cargó directamente
  bindLicitacionesView();
}

