// Portal de clientes Amorim

const content = document.getElementById('portal-content');
const tabs = document.getElementById('portal-tabs');

function fmt(d) {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('es-AR'); } catch { return d; }
}

function badge(estado) {
  if (!estado) return '<span class="badge badge-gris">-</span>';
  const e = estado.toLowerCase();
  if (e.includes('entreg') || e.includes('finaliz') || e.includes('complet'))
    return `<span class="badge badge-verde">${estado}</span>`;
  if (e.includes('proceso') || e.includes('repar') || e.includes('trabajo') || e.includes('taller'))
    return `<span class="badge badge-azul">${estado}</span>`;
  if (e.includes('espera') || e.includes('presup') || e.includes('cotiz'))
    return `<span class="badge badge-naranja">${estado}</span>`;
  if (e.includes('cancel') || e.includes('rechaz'))
    return `<span class="badge badge-rojo">${estado}</span>`;
  return `<span class="badge badge-gris">${estado}</span>`;
}

function empty(msg) {
  return `<div class="portal-empty"><i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:10px;"></i>${msg}</div>`;
}

function spinner() {
  content.innerHTML = '<div class="portal-spinner">Cargando</div>';
}

async function loadTab(tab) {
  spinner();
  try {
    const res = await fetch(`/portal/api/${tab}`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) {
      window.location.href = '/portal/login';
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    const renderers = { reparaciones, historial, garantias, presupuestos };
    content.innerHTML = (renderers[tab] || (() => empty('Sección no disponible.')))(data);
  } catch (err) {
    content.innerHTML = `<div class="portal-empty" style="color:#dc2626;"><i class="fas fa-exclamation-circle"></i> ${err.message || 'Error al cargar los datos.'}</div>`;
  }
}

function reparaciones(data) {
  if (!data.length) return empty('No hay reparaciones registradas en los últimos 90 días.');
  return `
    <div class="portal-section-title"><i class="fas fa-tools"></i> Equipos en Reparación</div>
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            <th>N° Reparación</th>
            <th>Equipo</th>
            <th>Último trabajo</th>
            <th>Técnico</th>
            <th>Fecha</th>
            <th>Garantía</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td><b>${esc(r.id_reparacion)}</b></td>
              <td>${esc(r.equipo)}</td>
              <td>${esc(r.trabajo)}</td>
              <td>${esc(r.tecnico)}</td>
              <td>${fmt(r.fecha)}</td>
              <td>${String(r.garantia||'').toLowerCase()==='si' ? '<span class="badge badge-naranja">Garantía</span>' : '<span class="badge badge-gris">No</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function historial(data) {
  if (!data.length) return empty('No hay reparaciones en el historial.');
  return `
    <div class="portal-section-title"><i class="fas fa-history"></i> Historial de Reparaciones</div>
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            <th>N° Reparación</th>
            <th>Equipo</th>
            <th>Último trabajo</th>
            <th>Técnico</th>
            <th>Fecha</th>
            <th>Garantía</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td><b>${esc(r.id_reparacion)}</b></td>
              <td>${esc(r.equipo)}</td>
              <td>${esc(r.trabajo)}</td>
              <td>${esc(r.tecnico)}</td>
              <td>${fmt(r.fecha)}</td>
              <td>${String(r.garantia||'').toLowerCase()==='si' ? '<span class="badge badge-naranja">Garantía</span>' : '<span class="badge badge-gris">No</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function garantias(data) {
  if (!data.length) return empty('No hay garantías registradas.');
  return `
    <div class="portal-section-title"><i class="fas fa-shield-alt"></i> Garantías</div>
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Ingreso</th>
            <th>Código</th>
            <th>Equipo</th>
            <th>Cantidad</th>
            <th>Colocado</th>
            <th>Detalle</th>
            <th>Resolución</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((g, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${fmt(g.ingreso)}</td>
              <td>${esc(g.codigo)}</td>
              <td>${esc(g.alt)}</td>
              <td>${g.cantidad ?? '-'}</td>
              <td>${fmt(g.notificacion)}</td>
              <td>${esc(g.detalle)}</td>
              <td>${badge(g.resolucion)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function presupuestos(data) {
  if (!data.length) return empty('No hay presupuestos emitidos.');
  return `
    <div class="portal-section-title"><i class="fas fa-file-invoice-dollar"></i> Presupuestos</div>
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Número</th>
            <th>Fecha</th>
            <th>Equipo</th>
            <th>Falla Reportada</th>
            <th>Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(p => `
            <tr>
              <td><b>${esc(p.numero || String(p.id))}</b></td>
              <td>${fmt(p.fecha)}</td>
              <td>${esc(p.equipo_texto)}</td>
              <td>${esc(p.falla_reportada)}</td>
              <td>${p.total != null ? '$' + Number(p.total).toLocaleString('es-AR') : '-'}</td>
              <td>${badge(p.estado)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function esc(v) {
  if (v == null) return '-';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Navegación entre tabs
tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.portal-tab-btn');
  if (!btn) return;
  tabs.querySelectorAll('.portal-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadTab(btn.dataset.tab);
});

// Cargar tab inicial
loadTab('reparaciones');

// Logout
document.getElementById('btn-portal-logout').addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  } catch (_) {}
  window.location.href = '/portal/login';
});
