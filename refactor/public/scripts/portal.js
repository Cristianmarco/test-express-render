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

// Estado que ve el cliente: la etapa del taller, o reparado / devuelto
function estadoEquipo(r) {
  if (r.devuelto) return '<span class="badge badge-gris">Devuelto sin reparar</span>';
  if (Number(r.pendientes) <= 0) {
    return `<span class="badge badge-verde">Reparado</span>${r.fecha_reparado ? `<div class="portal-sub">${fmt(r.fecha_reparado)}</div>` : ''}`;
  }
  const clase = r.etapa === 'listo' ? 'badge-verde' : r.etapa === 'presupuesto' ? 'badge-naranja' : 'badge-azul';
  const parcial = Number(r.pendientes) < Number(r.cantidad)
    ? `<div class="portal-sub">${Number(r.cantidad) - Number(r.pendientes)} de ${r.cantidad} reparados</div>` : '';
  return `<span class="badge ${clase}">${esc(r.etapa_nombre || 'En reparación')}</span>${parcial}`;
}

function botonFotos(tipo, r) {
  if (!r.fotos) return '<span class="portal-sub">—</span>';
  return `<button type="button" class="portal-btn-fotos" data-fotos="${tipo}" data-id="${r.id}" title="Ver fotos">
    <img src="/portal/api/${tipo}/foto/${r.foto_id}?mini=1" alt="" loading="lazy">${r.fotos > 1 ? `<span>${r.fotos}</span>` : ''}
  </button>`;
}

function tablaEquipos(lista) {
  return `
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Nro Pedido</th>
            <th>Equipo</th>
            <th>Cant.</th>
            <th>Ingreso</th>
            <th>Entrega estimada</th>
            <th>Estado</th>
            <th>Fotos</th>
          </tr>
        </thead>
        <tbody>
          ${lista.map(r => `
            <tr>
              <td><b>${esc(r.nro_pedido)}</b></td>
              <td>${esc(r.descripcion)}${r.codigo ? `<div class="portal-sub">${esc(r.codigo)}</div>` : ''}</td>
              <td>${r.cantidad ?? '-'}</td>
              <td>${fmt(r.fecha_ingreso)}</td>
              <td>${fmt(r.fecha_limite_entrega)}</td>
              <td>${estadoEquipo(r)}</td>
              <td>${botonFotos('vigente', r)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

function reparaciones(data) {
  const enTaller = data.filter(r => !r.devuelto && Number(r.pendientes) > 0);
  const terminados = data.filter(r => !enTaller.includes(r));
  return `
    <div class="portal-section-title"><i class="fas fa-tools"></i> En el taller</div>
    ${enTaller.length ? tablaEquipos(enTaller) : empty('No tenés equipos en reparación.')}
    ${terminados.length ? `
      <div class="portal-section-title" style="margin-top:28px;"><i class="fas fa-check-circle"></i> Reparados y devueltos <small>(últimos 90 días)</small></div>
      ${tablaEquipos(terminados)}` : ''}`;
}

function historial(data) {
  const tabla = (lista) => lista.length ? `
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            <th>N° Reparación</th>
            <th>Coche</th>
            <th>Equipo</th>
            <th>Último trabajo</th>
            <th>Fecha</th>
            <th>Garantía</th>
          </tr>
        </thead>
        <tbody>
          ${lista.map(r => `
            <tr>
              <td><b>${esc(r.id_reparacion)}</b></td>
              <td>${esc(r.coche_numero)}</td>
              <td>${esc(r.equipo)}</td>
              <td>${esc(r.trabajo)}</td>
              <td>${fmt(r.fecha)}</td>
              <td>${String(r.garantia||'').toLowerCase()==='si' ? '<span class="badge badge-naranja">Garantía</span>' : '<span class="badge badge-gris">No</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : empty('No se encontraron reparaciones con ese criterio.');

  if (!data.length) return `
    <div class="portal-section-title"><i class="fas fa-history"></i> Historial de Reparaciones</div>
    ${empty('No hay reparaciones en el historial.')}`;

  setTimeout(() => {
    const input = document.getElementById('portal-historial-buscar');
    const wrap = document.getElementById('portal-historial-tabla');
    if (!input || !wrap) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      const filtrado = !q ? data : data.filter(r =>
        [r.id_reparacion, r.coche_numero, r.equipo, r.trabajo].some(v => String(v||'').toLowerCase().includes(q))
      );
      wrap.innerHTML = tabla(filtrado);
    });
  }, 0);

  return `
    <div class="portal-section-title"><i class="fas fa-history"></i> Historial de Reparaciones</div>
    <div class="portal-buscador">
      <input type="text" id="portal-historial-buscar" placeholder="Buscar por N° reparación, coche, equipo o trabajo..." />
    </div>
    <div id="portal-historial-tabla">${tabla(data)}</div>`;
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
            <th>Interno</th>
            <th>Cantidad</th>
            <th>Observaciones</th>
            <th>Estado</th>
            <th>Fotos</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((g, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${fmt(g.ingreso)}</td>
              <td>${esc(g.codigo)}</td>
              <td>${esc(g.equipo)}</td>
              <td>${esc(g.interno)}</td>
              <td>${g.cantidad ?? '-'}</td>
              <td>${esc(g.observaciones)}</td>
              <td>${Number(g.pendiente) > 0 ? '<span class="badge badge-naranja">Pendiente</span>' : '<span class="badge badge-verde">Resuelta</span>'}</td>
              <td>${botonFotos(g.tipo_fotos || 'garantia', g)}</td>
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
            <th>Coche</th>
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
              <td>${esc(p.coche_numero)}</td>
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

// ── Visor de fotos ──
async function abrirFotos(tipo, id) {
  let visor = document.getElementById('portal-visor');
  if (!visor) {
    visor = document.createElement('div');
    visor.id = 'portal-visor';
    visor.className = 'portal-visor';
    document.body.appendChild(visor);
    visor.addEventListener('click', (e) => {
      const t = e.target.closest('[data-foto]');
      if (t) { visor.querySelector('.portal-visor-img').src = t.dataset.foto; return; }
      if (e.target === visor || e.target.closest('.portal-visor-cerrar')) visor.style.display = 'none';
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') visor.style.display = 'none'; });
  }
  visor.innerHTML = '<div class="portal-visor-caja"><div class="portal-spinner">Cargando</div></div>';
  visor.style.display = 'flex';
  try {
    const res = await fetch(`/portal/api/${tipo}/${id}/fotos`, { credentials: 'include' });
    const fotos = await res.json();
    if (!res.ok || !fotos.length) throw new Error(fotos.error || 'Sin fotos');
    visor.innerHTML = `
      <div class="portal-visor-caja">
        <button type="button" class="portal-visor-cerrar" title="Cerrar">&times;</button>
        <img class="portal-visor-img" src="${fotos[0].url}" alt="Foto del equipo">
        ${fotos.length > 1 ? `<div class="portal-visor-thumbs">${fotos.map(f => `<img src="${f.url}?mini=1" data-foto="${f.url}" alt="">`).join('')}</div>` : ''}
      </div>`;
  } catch (err) {
    visor.innerHTML = `<div class="portal-visor-caja"><button type="button" class="portal-visor-cerrar">&times;</button>${empty(esc(err.message))}</div>`;
  }
}

content.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fotos]');
  if (b) abrirFotos(b.dataset.fotos, b.dataset.id);
});

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
