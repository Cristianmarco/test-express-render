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

// Etapa del taller en la que esta el equipo
function estadoEquipo(r) {
  const clase = r.etapa === 'listo' ? 'badge-verde' : r.etapa === 'presupuesto' ? 'badge-naranja' : 'badge-azul';
  return `<span class="badge ${clase}">${esc(r.etapa_nombre || 'En reparación')}</span>`;
}

// Hay columna Empresa cuando el usuario ve varias razones sociales (Dota)
const variasEmpresas = (lista) => new Set(lista.map(r => r.empresa || '')).size > 1;

function botonFotos(tipo, r) {
  if (!r.fotos) return '<span class="portal-sub">—</span>';
  return `<button type="button" class="portal-btn-fotos" data-fotos="${tipo}" data-id="${r.id}" title="Ver fotos">
    <img src="/portal/api/${tipo}/foto/${r.foto_id}?mini=1" alt="" loading="lazy">${r.fotos > 1 ? `<span>${r.fotos}</span>` : ''}
  </button>`;
}

// ── Resumen ──
let resumen = null;

async function cargarResumen() {
  const caja = document.getElementById('portal-resumen');
  try {
    const res = await fetch('/portal/api/resumen', { credentials: 'include' });
    if (!res.ok) throw new Error();
    resumen = await res.json();
  } catch {
    caja.innerHTML = '';
    return;
  }
  const tarjeta = (icono, valor, texto, tab, alerta) => `
    <button type="button" class="portal-card${alerta ? ' portal-card-alerta' : ''}" data-ir="${tab}">
      <i class="fas ${icono}"></i>
      <b>${Number(valor || 0).toLocaleString('es-AR')}</b>
      <span>${texto}</span>
    </button>`;
  caja.innerHTML = [
    tarjeta('fa-tools', resumen.en_taller, 'equipos en el taller', 'reparaciones'),
    tarjeta('fa-check-circle', resumen.listos, 'listos para retirar', 'reparaciones', resumen.listos > 0),
    tarjeta('fa-shield-alt', resumen.garantias_pendientes, 'garantías pendientes', 'garantias'),
    tarjeta('fa-file-invoice-dollar', resumen.presupuestos_por_responder, 'presupuestos para aprobar', 'presupuestos', resumen.presupuestos_por_responder > 0)
  ].join('');
}

// Avance de una licitacion: reparados de la cantidad total
function tarjetaLicitacion(l) {
  const reparados = Math.max(0, l.cantidad - l.pendientes);
  const pct = l.cantidad ? Math.round((reparados / l.cantidad) * 100) : 0;
  return `
    <button type="button" class="portal-lici" data-filtro="licitacion" data-valor="${esc(l.licitacion_nro)}">
      <div class="portal-lici-titulo">Licitación ${esc(l.licitacion_nro)}<span>${pct}%</span></div>
      <div class="portal-lici-barra"><div style="width:${pct}%"></div></div>
      <div class="portal-sub">${reparados} de ${l.cantidad} reparados · <b>${l.pendientes} pendientes</b></div>
      ${l.entrega ? `<div class="portal-sub">Entrega estimada ${fmt(l.entrega)}</div>` : ''}
    </button>`;
}

// Equipos vigentes en el taller. En las tandas se ve cuantos quedan pendientes.
// Se pueden filtrar por licitacion y por empresa.
function reparaciones(data) {
  if (!data.length) return `
    <div class="portal-section-title"><i class="fas fa-tools"></i> Equipos en reparación</div>
    ${empty('No tenés equipos en reparación.')}`;
  const conEmpresa = variasEmpresas(data);
  const licitaciones = resumen?.licitaciones || [];
  const porEmpresa = {};
  data.forEach(r => { porEmpresa[r.empresa || '-'] = (porEmpresa[r.empresa || '-'] || 0) + Number(r.pendientes || 0); });
  const filtro = { licitacion: '', empresa: '' };

  setTimeout(() => {
    const wrap = document.getElementById('portal-equipos');
    if (!wrap) return;
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-filtro]');
      if (!b) return;
      const campo = b.dataset.filtro;
      // Clic de nuevo en la misma licitacion: se saca el filtro
      filtro[campo] = campo === 'licitacion' && filtro.licitacion === b.dataset.valor ? '' : b.dataset.valor;
      wrap.querySelectorAll(`[data-filtro="${campo}"]`).forEach(x => x.classList.toggle('activo', x.dataset.valor === filtro[campo]));
      const lista = data.filter(r =>
        (!filtro.licitacion || String(r.licitacion_nro || '') === filtro.licitacion) &&
        (!filtro.empresa || (r.empresa || '-') === filtro.empresa));
      document.getElementById('portal-equipos-tabla').innerHTML = lista.length
        ? tablaEquipos(lista, conEmpresa) : empty('No hay equipos con ese filtro.');
    });
  }, 0);

  return `
    <div id="portal-equipos">
      ${licitaciones.length ? `
        <div class="portal-section-title"><i class="fas fa-layer-group"></i> Licitaciones en curso</div>
        <div class="portal-licis">${licitaciones.map(tarjetaLicitacion).join('')}</div>` : ''}
      <div class="portal-section-title"><i class="fas fa-tools"></i> Equipos en reparación</div>
      ${conEmpresa ? `
        <div class="portal-chips">
          <button type="button" class="portal-chip activo" data-filtro="empresa" data-valor="">Todas</button>
          ${Object.entries(porEmpresa).sort((a, b) => b[1] - a[1]).map(([empresa, n]) =>
            `<button type="button" class="portal-chip" data-filtro="empresa" data-valor="${esc(empresa)}">${esc(empresa)} <span>${n}</span></button>`).join('')}
        </div>` : ''}
      <div id="portal-equipos-tabla">${tablaEquipos(data, conEmpresa)}</div>
    </div>`;
}

function tablaEquipos(data, conEmpresa) {
  return `
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            ${conEmpresa ? '<th>Empresa</th>' : ''}
            <th>Nro Pedido</th>
            <th>Equipo</th>
            <th>Pendientes</th>
            <th>Ingreso</th>
            <th>Entrega estimada</th>
            <th>Etapa</th>
            <th>Fotos</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              ${conEmpresa ? `<td>${esc(r.empresa)}</td>` : ''}
              <td><b>${esc(r.nro_pedido)}</b>${r.licitacion_nro ? `<div class="portal-sub">Licitación ${esc(r.licitacion_nro)}</div>` : ''}</td>
              <td>${esc(r.descripcion)}${r.codigo ? `<div class="portal-sub">${esc(r.codigo)}</div>` : ''}</td>
              <td><b>${r.pendientes}</b>${Number(r.cantidad) > Number(r.pendientes) ? `<div class="portal-sub">de ${r.cantidad}</div>` : ''}</td>
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

function historial(data) {
  const conEmpresa = variasEmpresas(data);
  const tabla = (lista) => lista.length ? `
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            ${conEmpresa ? '<th>Empresa</th>' : ''}
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
              ${conEmpresa ? `<td>${esc(r.empresa)}</td>` : ''}
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
        [r.id_reparacion, r.coche_numero, r.equipo, r.trabajo, r.empresa].some(v => String(v||'').toLowerCase().includes(q))
      );
      wrap.innerHTML = tabla(filtrado);
    });
  }, 0);

  return `
    <div class="portal-section-title"><i class="fas fa-history"></i> Historial de Reparaciones</div>
    <div class="portal-buscador">
      <input type="text" id="portal-historial-buscar" placeholder="Buscar por N° reparación, coche, equipo, trabajo${conEmpresa ? ' o empresa' : ''}..." />
    </div>
    <div id="portal-historial-tabla">${tabla(data)}</div>`;
}

const CLASE_RESOLUCION = { aceptada: 'badge-verde', rechazada: 'badge-rojo', otra: 'badge-gris' };

function badgeResolucion(texto, clase) {
  return `<span class="badge ${CLASE_RESOLUCION[clase] || 'badge-gris'}">${esc(texto)}</span>`;
}

function estadoGarantia(g) {
  if (Number(g.pendiente) > 0) return '<span class="badge badge-naranja">Pendiente</span>';
  if (!g.resolucion_texto) return '<span class="badge badge-verde">Resuelta</span>';
  return `${badgeResolucion(g.resolucion_texto, g.resolucion_clase)}${g.fecha_resolucion ? `<div class="portal-sub">${fmt(g.fecha_resolucion)}</div>` : ''}`;
}

function garantias(data) {
  if (!data.length) return empty('No hay garantías registradas.');
  return `
    <div class="portal-section-title"><i class="fas fa-shield-alt"></i> Garantías</div>
    <div class="portal-table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Nro Garantía</th>
            <th>Ingreso</th>
            <th>Código</th>
            <th>Equipo</th>
            <th>Interno</th>
            <th>Cantidad</th>
            <th>Observaciones</th>
            <th>Estado / Resolución</th>
            <th>Informe</th>
            <th>Fotos</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((g) => `
            <tr>
              <td><b>${esc(g.nro_id)}</b></td>
              <td>${fmt(g.ingreso)}</td>
              <td>${esc(g.codigo)}</td>
              <td>${esc(g.equipo)}</td>
              <td>${esc(g.interno)}</td>
              <td>${g.cantidad ?? '-'}</td>
              <td>${esc(g.observaciones)}</td>
              <td>${estadoGarantia(g)}</td>
              <td>${g.tiene_informe
                ? `<button type="button" class="portal-btn-informe" data-informe="${g.tipo_fotos || 'garantia'}" data-id="${g.id}"><i class="fas fa-file-alt"></i> Ver informe</button>`
                : '<span class="portal-sub">—</span>'}</td>
              <td>${botonFotos(g.tipo_fotos || 'garantia', g)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

const pesos = (v) => v != null ? '$' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

// Estado del presupuesto y, si el cliente respondio, cuando y su comentario
function estadoPresupuesto(p) {
  const e = String(p.estado || '').toLowerCase();
  const html = {
    enviada: '<span class="badge badge-naranja">Para aprobar</span>',
    aprobada: '<span class="badge badge-verde">Aprobado</span>',
    rechazada: '<span class="badge badge-rojo">Rechazado</span>'
  }[e] || badge(p.estado);
  if (!['aprobada', 'rechazada'].includes(e) || !p.respuesta_at) return html;
  return `${html}<div class="portal-sub">Respondido el ${fmt(p.respuesta_at)}</div>${p.respuesta_comentario ? `<div class="portal-sub portal-comentario">“${esc(p.respuesta_comentario)}”</div>` : ''}`;
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
            <th></th>
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
              <td>${pesos(p.total)}</td>
              <td>${estadoPresupuesto(p)}</td>
              <td class="portal-acciones">
                <a class="portal-btn-informe" href="/portal/api/presupuestos/${p.id}/pdf" target="_blank" rel="noopener"><i class="fas fa-file-pdf"></i> PDF</a>
                ${String(p.estado || '').toLowerCase() === 'enviada' ? `
                  <button type="button" class="portal-btn-aprobar" data-responder="aprobar" data-id="${p.id}" data-numero="${esc(p.numero || p.id)}" data-total="${p.total ?? ''}"><i class="fas fa-check"></i> Aprobar</button>
                  <button type="button" class="portal-btn-rechazar" data-responder="rechazar" data-id="${p.id}" data-numero="${esc(p.numero || p.id)}" data-total="${p.total ?? ''}"><i class="fas fa-times"></i> Rechazar</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

// Confirmacion de aprobar / rechazar, con un comentario para el taller
function abrirRespuesta(b) {
  const aprobar = b.dataset.responder === 'aprobar';
  const visor = asegurarVisor();
  visor.innerHTML = `
    <div class="portal-visor-caja portal-respuesta">
      <button type="button" class="portal-visor-cerrar" title="Cerrar">&times;</button>
      <h3>${aprobar ? 'Aprobar' : 'Rechazar'} presupuesto ${esc(b.dataset.numero)}</h3>
      ${b.dataset.total ? `<p>Total: <b>${pesos(b.dataset.total)}</b></p>` : ''}
      <label for="portal-resp-comentario">${aprobar ? 'Comentario para el taller (opcional)' : 'Motivo del rechazo (opcional)'}</label>
      <textarea id="portal-resp-comentario" rows="3" maxlength="1000"></textarea>
      <div class="portal-resp-error"></div>
      <div class="portal-resp-acciones">
        <button type="button" class="portal-btn-informe portal-visor-cerrar-txt">Cancelar</button>
        <button type="button" class="${aprobar ? 'portal-btn-aprobar' : 'portal-btn-rechazar'}" id="portal-resp-confirmar">
          <i class="fas ${aprobar ? 'fa-check' : 'fa-times'}"></i> Confirmar ${aprobar ? 'aprobación' : 'rechazo'}
        </button>
      </div>
    </div>`;
  visor.querySelector('.portal-visor-cerrar-txt').addEventListener('click', () => { visor.style.display = 'none'; });
  const confirmar = visor.querySelector('#portal-resp-confirmar');
  confirmar.addEventListener('click', async () => {
    confirmar.disabled = true;
    try {
      const res = await fetch(`/portal/api/presupuestos/${b.dataset.id}/respuesta`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: b.dataset.responder, comentario: visor.querySelector('#portal-resp-comentario').value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo registrar la respuesta');
      visor.style.display = 'none';
      cargarResumen();
      loadTab('presupuestos');
    } catch (err) {
      visor.querySelector('.portal-resp-error').textContent = err.message;
      confirmar.disabled = false;
    }
  });
}

function esc(v) {
  if (v == null) return '-';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Visor de fotos ──
function asegurarVisor() {
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
  return visor;
}

// Foto grande con las miniaturas abajo (clic en una miniatura: se ve en grande)
function galeriaFotos(fotos) {
  return `
    <img class="portal-visor-img" src="${fotos[0].url}" alt="Foto del equipo">
    ${fotos.length > 1 ? `<div class="portal-visor-thumbs">${fotos.map(f => `<img src="${f.url}?mini=1" data-foto="${f.url}" alt="">`).join('')}</div>` : ''}`;
}

async function abrirFotos(tipo, id) {
  const visor = asegurarVisor();
  try {
    const res = await fetch(`/portal/api/${tipo}/${id}/fotos`, { credentials: 'include' });
    const fotos = await res.json();
    if (!res.ok || !fotos.length) throw new Error(fotos.error || 'Sin fotos');
    visor.innerHTML = `
      <div class="portal-visor-caja">
        <button type="button" class="portal-visor-cerrar" title="Cerrar">&times;</button>
        ${galeriaFotos(fotos)}
      </div>`;
  } catch (err) {
    visor.innerHTML = `<div class="portal-visor-caja"><button type="button" class="portal-visor-cerrar">&times;</button>${empty(esc(err.message))}</div>`;
  }
}

// Informe de una garantia resuelta: resolucion, informe tecnico y las fotos
async function abrirInforme(tipo, id) {
  const visor = asegurarVisor();
  try {
    const res = await fetch(`/portal/api/${tipo}/${id}/informe`, { credentials: 'include' });
    const inf = await res.json();
    if (!res.ok) throw new Error(inf.error || 'No se pudo cargar el informe');
    visor.innerHTML = `
      <div class="portal-visor-caja portal-informe">
        <button type="button" class="portal-visor-cerrar" title="Cerrar">&times;</button>
        <h3><i class="fas fa-file-alt"></i> Informe de garantía</h3>
        <div class="portal-informe-meta">
          <div><span>Equipo</span><b>${esc(inf.equipo_codigo)}${inf.equipo && inf.equipo !== inf.equipo_codigo ? ` · ${esc(inf.equipo)}` : ''}</b></div>
          ${inf.coche ? `<div><span>Coche</span><b>${esc(inf.coche)}</b></div>` : ''}
          <div><span>N° Reparación</span><b>${esc(inf.id_reparacion)}</b></div>
          <div><span>Fecha</span><b>${esc(inf.fecha)}</b></div>
        </div>
        ${inf.resolucion ? `<div class="portal-informe-resolucion">Resolución: ${badgeResolucion(inf.resolucion, inf.resolucion_clase)}</div>` : ''}
        <div class="portal-informe-texto">
          ${inf.parrafos.length ? inf.parrafos.map(p => `<p>${esc(p)}</p>`).join('') : '<p>Sin observaciones específicas.</p>'}
        </div>
        ${inf.fotos.length ? `<div class="portal-section-title" style="margin-top:14px;"><i class="fas fa-camera"></i> Fotos</div>${galeriaFotos(inf.fotos)}` : ''}
        <div style="text-align:right; margin-top:14px;">
          <a class="portal-btn-informe" href="${inf.imprimir}" target="_blank" rel="noopener"><i class="fas fa-print"></i> Imprimir / PDF</a>
        </div>
      </div>`;
  } catch (err) {
    visor.innerHTML = `<div class="portal-visor-caja"><button type="button" class="portal-visor-cerrar">&times;</button>${empty(esc(err.message))}</div>`;
  }
}

content.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fotos]');
  if (b) { abrirFotos(b.dataset.fotos, b.dataset.id); return; }
  const inf = e.target.closest('[data-informe]');
  if (inf) { abrirInforme(inf.dataset.informe, inf.dataset.id); return; }
  const resp = e.target.closest('[data-responder]');
  if (resp) abrirRespuesta(resp);
});

// Navegación entre tabs
function irATab(tab) {
  tabs.querySelectorAll('.portal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  loadTab(tab);
}

tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.portal-tab-btn');
  if (btn) irATab(btn.dataset.tab);
});

document.getElementById('portal-resumen').addEventListener('click', (e) => {
  const card = e.target.closest('[data-ir]');
  if (card) irATab(card.dataset.ir);
});

// Cargar el resumen y el tab inicial (las licitaciones en curso salen del resumen)
cargarResumen().finally(() => loadTab('reparaciones'));

// Logout
document.getElementById('btn-portal-logout').addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  } catch (_) {}
  window.location.href = '/portal/login';
});
