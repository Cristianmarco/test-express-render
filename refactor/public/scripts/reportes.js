// Reportes de Planilla Diaria
(function(){
  const fmt = (d) => {
    try { return new Date(d).toLocaleDateString('es-AR'); }
    catch { return String(d).slice(0, 10); }
  };

  const esc = (v) => {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  let tipo = 'planilla-resumen';

  // ---------- Resumen planilla: que se reparo (por categoria y equipo) ----------
  let desglose = { categorias: [], totales: { total: 0, garantias: 0 } };
  let categoriaSel = null; // null = todas

  const ICONOS = [
    [/alternador/i, 'fa-bolt'], [/arranque/i, 'fa-gear'], [/bomba/i, 'fa-oil-can'], [/instalaci/i, 'fa-plug'],
    [/polea|maza/i, 'fa-circle-notch'], [/limpia/i, 'fa-wind'], [/calefacci/i, 'fa-fan'],
  ];
  const iconoDe = (nombre) => (ICONOS.find(([re]) => re.test(nombre)) || [null, 'fa-screwdriver-wrench'])[1];
  const pct = (n, total) => total ? `${(n / total * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%` : '';
  const claveCat = (c) => String(c.categoria_id || 0);

  function pintarDesglose(){
    const { categorias, totales } = desglose;
    const total = Number(totales.total || 0);
    const grid = document.getElementById('rep-categorias');
    if (!grid) return;
    if (categoriaSel && !categorias.some(c => claveCat(c) === categoriaSel)) categoriaSel = null;
    grid.innerHTML = categorias.length ? categorias.map(c => `
      <button type="button" class="rep-cat ${categoriaSel === claveCat(c) ? 'activa' : ''}" data-categoria="${claveCat(c)}" title="Ver el detalle por equipo">
        <i class="fas ${iconoDe(c.categoria)}"></i>
        <span class="rep-cat-nombre">${esc(c.categoria)}</span>
        <span class="rep-cat-num">${c.reparaciones}</span>
        <span class="rep-cat-sub">${pct(c.reparaciones, total)}${c.garantias ? ` · ${c.garantias} garantía${c.garantias === 1 ? '' : 's'}` : ''}</span>
      </button>`).join('') : '<div class="rep-cat-vacio">Sin reparaciones en el rango elegido</div>';

    // Control: la suma de las categorias tiene que dar los totales de arriba
    const sumaRep = categorias.reduce((a, c) => a + c.reparaciones, 0);
    const sumaGar = categorias.reduce((a, c) => a + c.garantias, 0);
    const control = document.getElementById('rep-control');
    const cierra = sumaRep === total && sumaGar === Number(totales.garantias || 0);
    control.className = `rep-cat-control ${cierra ? '' : 'mal'}`;
    control.textContent = cierra ? `${sumaRep} reparaciones y ${sumaGar} garantías en total` : `Las categorías suman ${sumaRep} / ${sumaGar}`;

    const lista = categoriaSel ? categorias.filter(c => claveCat(c) === categoriaSel) : categorias;
    document.getElementById('rep-detalle-titulo').innerHTML = categoriaSel
      ? `Detalle de ${esc(lista[0].categoria)} <a href="#" data-categoria-todas>(ver todas)</a>` : 'Detalle por equipo';
    const tb = document.getElementById('rep-detalle-equipos');
    tb.innerHTML = lista.map(c => `
      ${categoriaSel ? '' : `<tr class="rep-cat-fila"><td><i class="fas ${iconoDe(c.categoria)}"></i> ${esc(c.categoria)}</td>
        <td class="rep-num">${c.reparaciones}</td><td class="rep-num">${c.garantias}</td><td class="rep-num">${pct(c.reparaciones, total)}</td></tr>`}
      ${c.equipos.map(e => `<tr><td class="rep-equipo">${esc(e.equipo)}</td><td class="rep-num">${e.reparaciones}</td>
        <td class="rep-num">${e.garantias || ''}</td><td class="rep-num">${pct(e.reparaciones, total)}</td></tr>`).join('')}`).join('')
      || '<tr><td colspan="4">Sin datos</td></tr>';
  }

  // Top Tecnicos: todo lo que cargo cada tecnico (reparaciones y garantias que proceso) menos
  // las garantias de equipos que el habia reparado (ultimo reparador) que fueron devolucion o
  // aceptadas por falla tecnica o de repuestos. Las categorias ya vienen con el descuento.
  function pintarTecnicos(data){
    const cats = data.categoriasTecnicos || [];
    const lista = (data.porTecnico || []).filter(t => t.cargados > 0);
    const soloPropias = (data.porTecnico || []).filter(t => !t.cargados && t.descuento_total);
    const corto = (c) => c.replace(/^Bombas Dosificadoras de Urea$/i, 'Bombas').replace(/^Poleas de Motor$/i, 'Poleas')
      .replace(/^Motores? Limpiaparabrisas$/i, 'Limpiapar.').replace(/^Motore?s? de Calefacci[oó]n$/i, 'Calefacción');
    const detalleDesc = (d) => [
      d.aceptada_repuestos ? `${d.aceptada_repuestos} falla de repuestos` : '',
      d.funciona_ok ? `${d.funciona_ok} devolución${d.funciona_ok === 1 ? '' : 'es'}` : '',
      d.aceptada_tecnica ? `${d.aceptada_tecnica} falla técnica` : '',
    ].filter(Boolean).join(', ');
    document.getElementById('rep-tecnicos-cab').innerHTML = `<tr><th>Técnico</th>
      ${cats.map(c => `<th class="rep-num" title="${esc(c)}"><i class="fas ${iconoDe(c)}"></i> ${esc(corto(c))}</th>`).join('')}
      <th class="rep-num" title="Todo lo que cargó: reparaciones y garantías que procesó">Cargados</th>
      <th class="rep-num" title="Garantías de equipos que él reparó (último reparador): devoluciones, falla técnica o de repuestos">− Garantías propias</th>
      <th class="rep-num">Total</th>
      <th class="rep-num" title="Días con algún equipo cargado">Días</th><th class="rep-num">Por día</th></tr>`;
    document.getElementById('rep-top-tecnicos').innerHTML = lista.map(t => `<tr>
      <td><b>${esc(t.tecnico)}</b></td>
      ${cats.map(c => `<td class="rep-num">${t.por_categoria[c] || ''}</td>`).join('')}
      <td class="rep-num" title="${t.garantias ? `incluye ${t.garantias} garantías que procesó` : ''}">${t.cargados}</td>
      <td class="rep-num rep-desc" title="${esc(detalleDesc(t.descuento))}">${t.descuento_total ? `−${t.descuento_total}` : ''}</td>
      <td class="rep-num"><b>${t.total}</b></td>
      <td class="rep-num">${t.dias}</td>
      <td class="rep-num">${t.promedio_dia.toLocaleString('es-AR')}</td>
    </tr>`).join('') || `<tr><td colspan="${cats.length + 6}">Sin datos</td></tr>`;
    document.getElementById('rep-tecnicos-nota').textContent =
      'Total = todo lo que cargó el técnico (reparaciones y garantías que procesó) menos las garantías de equipos que él había reparado ' +
      '(último reparador) que fueron devolución o aceptadas por falla técnica o de repuestos. Pasá el mouse por el descuento para ver el detalle.' +
      (soloPropias.length ? ` Garantías propias de técnicos sin equipos en el rango: ${soloPropias.map(t => `${t.tecnico} ${t.descuento_total}`).join(', ')}.` : '');
  }

  // onclick (no addEventListener): este script se vuelve a cargar al entrar a Reportes
  // y asi el manejador se reemplaza en vez de duplicarse
  function bindDesglose(){
    const card = document.getElementById('rep-desglose');
    if (!card) return;
    card.onclick = (e) => {
      const cat = e.target.closest('[data-categoria]');
      if (cat) { categoriaSel = categoriaSel === cat.dataset.categoria ? null : cat.dataset.categoria; pintarDesglose(); return; }
      if (e.target.closest('[data-categoria-todas]')) { e.preventDefault(); categoriaSel = null; pintarDesglose(); }
    };
  }

  async function cargar(){
    const desde = document.getElementById('rep-desde');
    const hasta = document.getElementById('rep-hasta');
    const di = (desde && desde.value) ? desde.value : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
    const df = (hasta && hasta.value) ? hasta.value : new Date().toISOString().slice(0,10);
    if (desde && !desde.value) desde.value = di;
    if (hasta && !hasta.value) hasta.value = df;

    if (tipo === 'planilla-resumen') {
      const cliente = (document.getElementById('rep-cliente') || {}).value || 'todos';
      const res = await fetch(`/api/reportes/planilla/resumen?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}&cliente=${cliente}`, { credentials:'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');

      document.getElementById('rep-total').textContent = data.totales?.total ?? 0;
      document.getElementById('rep-garantias').textContent = data.totales?.garantias ?? 0;

      pintarTecnicos(data);

      const tbCli = document.getElementById('rep-por-cliente');
      tbCli.innerHTML = (data.porCliente || []).map(r => `<tr class="${r.interno ? 'rep-cat-fila' : ''}"><td>${esc(r.cliente)}</td>
        <td class="rep-num">${r.reparaciones}</td><td class="rep-num">${r.garantias || ''}</td></tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>';

      const tbEq = document.getElementById('rep-top-equipos');
      tbEq.innerHTML = (data.porEquipo || []).map(r => `<tr><td>${r.equipo}</td><td>${r.cantidad}</td></tr>`).join('') || '<tr><td colspan="2">Sin datos</td></tr>';

      const tbDia = document.getElementById('rep-por-dia');
      tbDia.innerHTML = (data.porDia || []).map(r => `<tr><td>${fmt(r.fecha)}</td><td>${r.cantidad}</td><td>${r.garantias}</td></tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>';

      desglose = { categorias: data.porCategoria || [], totales: data.totales || { total: 0, garantias: 0 } };
      bindDesglose();
      pintarDesglose();
    } else if (tipo === 'equipos-por-tecnico-promedio-diario') {
      await cargarPromedioPorTecnico(di, df);
    } else if (tipo === 'garantias-por-resolucion-reparador') {
      await cargarGarantiasPorResolucionYReparador(di, df);
    } else if (tipo === 'garantias-por-equipo') {
      await cargarGarantiasPorEquipo(di, df);
    } else if (tipo === 'tiempo-reparacion-promedio-por-equipo') {
      await cargarPromedioTiempo(di, df);
    }
  }

  function bind(){
    const btn = document.getElementById('rep-actualizar');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', cargar);
    }
    const selCliente = document.getElementById('rep-cliente');
    if (selCliente) selCliente.onchange = cargar;

    let btnMenu = document.getElementById('rep-menu-btn');
    let menu = document.getElementById('rep-menu');

    if (!btnMenu || !menu) {
      const topbar = document.querySelector('.rep-topbar');
      if (topbar) {
        const wrap = document.createElement('div');
        wrap.className = 'rep-menu-wrap';
        wrap.innerHTML = `
          <button id="rep-menu-btn" class="rep-hamburger" aria-label="Abrir menu de reportes" aria-expanded="false" aria-controls="rep-menu" type="button">
            <span></span><span></span><span></span>
          </button>
          <ul id="rep-menu" class="rep-menu" aria-hidden="true">
            <li class="${tipo==='planilla-resumen' ? 'activo' : ''}" data-report="planilla-resumen">Resumen planilla</li>
            <li data-report="garantias-por-resolucion-reparador">Garantias por resolucion / ultimo reparador</li>
            <li data-report="garantias-por-equipo">Garantias por equipo / falla</li>
            <li data-report="equipos-por-tecnico-promedio-diario">Promedio diario de equipos por tecnico</li>
            <li data-report="tiempo-reparacion-promedio-por-equipo">Promedio de tiempo de reparacion por equipo</li>
          </ul>`;
        topbar.appendChild(wrap);
        btnMenu = document.getElementById('rep-menu-btn');
        menu = document.getElementById('rep-menu');
      }
    }

    const titulo = document.getElementById('rep-titulo');
    btnMenu && btnMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const abierto = menu.classList.toggle('abierto');
      btnMenu.setAttribute('aria-expanded', abierto ? 'true' : 'false');
      menu.setAttribute('aria-hidden', abierto ? 'false' : 'true');
    });

    document.addEventListener('click', (e) => {
      if (!menu) return;
      const t = e.target;
      if (menu.classList.contains('abierto') && !menu.contains(t) && t !== btnMenu) {
        menu.classList.remove('abierto');
        btnMenu?.setAttribute('aria-expanded', 'false');
        menu.setAttribute('aria-hidden', 'true');
      }
    });

    menu?.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', () => {
        menu.querySelectorAll('li').forEach(x => x.classList.remove('activo'));
        li.classList.add('activo');
        tipo = li.dataset.report || 'planilla-resumen';
        const label = li.textContent?.trim() || 'Reporte';
        if (titulo) titulo.textContent = label.charAt(0).toUpperCase() + label.slice(1);
        menu.classList.remove('abierto');
        btnMenu?.setAttribute('aria-expanded', 'false');
        menu.setAttribute('aria-hidden', 'true');
        updateVistaSegunTipo();
        cargar();
      });
    });

    updateVistaSegunTipo();
    cargar();
  }

  function updateVistaSegunTipo(){
    const bloquePlanilla = document.getElementById('rep-planilla-resumen');
    const bloqueDynamic = document.getElementById('rep-dynamic');
    // El filtro de clientes es del resumen planilla
    const cliente = document.getElementById('rep-cliente-wrap');
    if (cliente) cliente.style.display = tipo === 'planilla-resumen' ? '' : 'none';
    if (!bloquePlanilla || !bloqueDynamic) return;
    if (tipo === 'planilla-resumen') {
      bloquePlanilla.style.display = '';
      bloqueDynamic.style.display = 'none';
    } else {
      bloquePlanilla.style.display = 'none';
      bloqueDynamic.style.display = '';
    }
  }

  async function cargarPromedioPorTecnico(di, df){
    const cont = document.getElementById('rep-dynamic-content');
    if (!cont) return;
    cont.innerHTML = 'Cargando...';
    const res = await fetch(`/api/reportes/planilla/promedios/equipos-por-tecnico?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}`, { credentials:'include' });
    const data = await res.json();
    if (!res.ok) {
      cont.textContent = data.error || 'Error al cargar.';
      return;
    }

    const renderRows = (items) => (items || []).map(r => `
      <tr>
        <td>${r.tecnico}</td>
        <td>${r.total}</td>
        <td>${r.dias_trabajados}</td>
        <td>${Number(r.promedio_diario).toFixed(2)}</td>
      </tr>`).join('') || '<tr><td colspan="4">Sin datos</td></tr>';

    cont.innerHTML = `
      <h3 style="margin-top:0;color:#2176bd;">Promedio diario de equipos por tecnico</h3>
      <p style="margin:0 0 10px 0; color:#4b5563; font-size:12px;">
        Filtro aplicado: incluye licitacion y clientes externos. En garantias se cuentan "Aceptada", "Aceptada (Falla de repuestos)" y "Rechazada (Facturada)". Se excluyen devolucion y falla tecnica.
      </p>
      <table class="tabla-erp">
        <thead><tr><th>Tecnico</th><th>Total equipos</th><th>Dias trabajados</th><th>Promedio diario</th></tr></thead>
        <tbody>${renderRows(data.items)}</tbody>
      </table>
      <div style="margin-top:18px; padding:14px; border:1px solid #dbe5f0; border-radius:12px; background:#f8fbff;">
        <h3 style="margin:0 0 8px 0; color:#2176bd;">Solo licitacion y clientes externos, sin garantias</h3>
        <p style="margin:0 0 10px 0; color:#4b5563; font-size:12px;">
          Este bloque cuenta solo reparaciones de licitacion o cliente externo, y deja afuera todas las garantias.
        </p>
        <table class="tabla-erp">
          <thead><tr><th>Tecnico</th><th>Total equipos</th><th>Dias trabajados</th><th>Promedio diario</th></tr></thead>
          <tbody>${renderRows(data.items_licitacion_externos)}</tbody>
        </table>
      </div>`;
  }

  async function cargarGarantiasPorResolucionYReparador(di, df){
    const cont = document.getElementById('rep-dynamic-content');
    if (!cont) return;
    cont.innerHTML = 'Cargando...';
    const res = await fetch(`/api/reportes/planilla/garantias-por-resolucion-reparador?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}`, { credentials:'include' });
    const data = await res.json();
    if (!res.ok) {
      cont.textContent = data.error || 'Error al cargar.';
      return;
    }

    const t = data.total || { total: 0, aceptada: 0, aceptada_repuestos: 0, aceptada_tecnica: 0, rechazada: 0, funciona_ok: 0 };
    const hdr = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin:0 0 10px 0;">
        <div class="rep-badge" style="background:#1f6fd4;">Total: ${t.total}</div>
        <div class="rep-badge" style="background:#1a9956;">Aceptadas (total): ${t.aceptada}</div>
        <div class="rep-badge" style="background:#0f766e;">Aceptada (Falla repuestos): ${t.aceptada_repuestos}</div>
        <div class="rep-badge" style="background:#0d9488;">Aceptada (Falla tecnica): ${t.aceptada_tecnica}</div>
        <div class="rep-badge" style="background:#c0392b;">Rechazadas: ${t.rechazada}</div>
        <div class="rep-badge" style="background:#8e44ad;">Funciona OK: ${t.funciona_ok}</div>
      </div>`;
    const rows = (data.porTecnico || []).map(r => `
      <tr>
        <td>${r.tecnico}</td>
        <td>${r.total}</td>
        <td>${r.aceptada}</td>
        <td>${r.aceptada_repuestos}</td>
        <td>${r.aceptada_tecnica}</td>
        <td>${r.rechazada}</td>
        <td>${r.funciona_ok}</td>
      </tr>`).join('') || '<tr><td colspan="7">Sin datos</td></tr>';

    cont.innerHTML = `
      <h3 style="margin-top:0;color:#2176bd;">Garantias por resolucion / ultimo reparador</h3>
      ${hdr}
      <table class="tabla-erp">
        <thead><tr><th>Tecnico (ultimo reparador)</th><th>Total</th><th>Aceptadas</th><th>Acep. repuestos</th><th>Acep. tecnica</th><th>Rechazadas</th><th>Funciona OK</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async function cargarGarantiasPorEquipo(di, df){
    const cont = document.getElementById('rep-dynamic-content');
    if (!cont) return;
    cont.innerHTML = 'Cargando...';
    const res = await fetch(`/api/reportes/planilla/garantias-por-equipo?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}`, { credentials:'include' });
    const data = await res.json();
    if (!res.ok) {
      cont.textContent = data.error || 'Error al cargar.';
      return;
    }

    const t = data.total || { total: 0, aceptada: 0, aceptada_repuestos: 0, aceptada_tecnica: 0, rechazada: 0, funciona_ok: 0 };
    const hdr = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin:0 0 10px 0;">
        <div class="rep-badge" style="background:#1f6fd4;">Total: ${t.total}</div>
        <div class="rep-badge" style="background:#1a9956;">Aceptadas (total): ${t.aceptada}</div>
        <div class="rep-badge" style="background:#0f766e;">Aceptada (Falla repuestos): ${t.aceptada_repuestos}</div>
        <div class="rep-badge" style="background:#0d9488;">Aceptada (Falla tecnica): ${t.aceptada_tecnica}</div>
        <div class="rep-badge" style="background:#c0392b;">Rechazadas: ${t.rechazada}</div>
        <div class="rep-badge" style="background:#8e44ad;">Funciona OK: ${t.funciona_ok}</div>
      </div>`;

    const rowsEquipo = (data.porEquipo || []).map(r => `
      <tr>
        <td>${esc(r.equipo)}</td>
        <td>${r.total}</td>
        <td>${r.aceptada}</td>
        <td>${r.aceptada_repuestos}</td>
        <td>${r.aceptada_tecnica}</td>
        <td>${r.rechazada}</td>
        <td>${r.funciona_ok}</td>
      </tr>`).join('') || '<tr><td colspan="7">Sin datos</td></tr>';

    const rowsFalla = (data.porFalla || []).map(r => `
      <tr>
        <td>${esc(r.falla)}</td>
        <td>${r.total}</td>
        <td>${r.aceptada}</td>
        <td>${r.aceptada_repuestos}</td>
        <td>${r.aceptada_tecnica}</td>
        <td>${r.rechazada}</td>
        <td>${r.funciona_ok}</td>
      </tr>`).join('') || '<tr><td colspan="7">Sin datos</td></tr>';

    // Agrupa el detalle equipo+falla en secciones por equipo (viene ordenado del
    // backend por equipo, asi que alcanza con detectar el cambio de grupo).
    const porEquipoFalla = data.porEquipoFalla || [];
    let rowsEquipoFalla = '';
    let equipoActual = null;
    for (const r of porEquipoFalla) {
      if (r.equipo !== equipoActual) {
        equipoActual = r.equipo;
        rowsEquipoFalla += `<tr class="rep-grupo-fila"><td colspan="7" style="background:#eef4fb; font-weight:700; color:#0f2e63;">${esc(equipoActual)}</td></tr>`;
      }
      rowsEquipoFalla += `
        <tr>
          <td style="padding-left:24px;">${esc(r.falla)}</td>
          <td>${r.total}</td>
          <td>${r.aceptada}</td>
          <td>${r.aceptada_repuestos}</td>
          <td>${r.aceptada_tecnica}</td>
          <td>${r.rechazada}</td>
          <td>${r.funciona_ok}</td>
        </tr>`;
    }
    if (!rowsEquipoFalla) rowsEquipoFalla = '<tr><td colspan="7">Sin datos</td></tr>';

    cont.innerHTML = `
      <h3 style="margin-top:0;color:#2176bd;">Garantias por equipo / falla</h3>
      ${hdr}
      <p style="margin:0 0 10px 0; color:#4b5563; font-size:12px;">
        "Falla" se toma de la plantilla rapida usada al cargar el informe de garantia. En garantias cargadas antes de este reporte, se infiere leyendo el texto del informe (banco/desarme); si no se reconoce ninguna plantilla figura como "(Sin falla)".
      </p>
      <h4 style="margin:8px 0;">Por modelo</h4>
      <table class="tabla-erp">
        <thead><tr><th>Equipo (modelo)</th><th>Total</th><th>Aceptadas</th><th>Acep. repuestos</th><th>Acep. tecnica</th><th>Rechazadas</th><th>Funciona OK</th></tr></thead>
        <tbody>${rowsEquipo}</tbody>
      </table>
      <h4 style="margin:18px 0 8px 0;">Por falla (todos los modelos)</h4>
      <table class="tabla-erp">
        <thead><tr><th>Falla</th><th>Total</th><th>Aceptadas</th><th>Acep. repuestos</th><th>Acep. tecnica</th><th>Rechazadas</th><th>Funciona OK</th></tr></thead>
        <tbody>${rowsFalla}</tbody>
      </table>
      <h4 style="margin:18px 0 8px 0;">Por modelo, desglosado por falla</h4>
      <table class="tabla-erp">
        <thead><tr><th>Falla</th><th>Total</th><th>Aceptadas</th><th>Acep. repuestos</th><th>Acep. tecnica</th><th>Rechazadas</th><th>Funciona OK</th></tr></thead>
        <tbody>${rowsEquipoFalla}</tbody>
      </table>`;
  }

  function fmtMinutosTotal(m){
    if (m == null || isNaN(m)) return '-';
    const total = Number(m);
    const h = Math.floor(total / 60);
    const min = Math.round(total - h * 60);
    if (h <= 0) return `${min} min`;
    return `${h} h ${min} m`;
  }

  async function cargarPromedioTiempo(di, df){
    const cont = document.getElementById('rep-dynamic-content');
    if (!cont) return;
    cont.innerHTML = 'Cargando...';
    const res = await fetch(`/api/reportes/planilla/tiempo-reparacion-promedio-por-equipo?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}`, { credentials:'include' });
    const data = await res.json();
    if (!res.ok) {
      cont.textContent = data.error || 'Error al cargar.';
      return;
    }

    const rowsTec = (data.porTecnico || []).map(r => `
      <tr>
        <td>${r.tecnico}</td>
        <td>${r.cantidad}</td>
        <td>${fmtMinutosTotal(r.promedio_min)}</td>
      </tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>';

    const rowsEq = (data.porEquipo || []).map(r => `
      <tr>
        <td>${r.equipo}</td>
        <td>${r.cantidad}</td>
        <td>${fmtMinutosTotal(r.promedio_min)}</td>
      </tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>';

    cont.innerHTML = `
      <h3 style="margin-top:0;color:#2176bd;">Promedio de tiempo de reparacion</h3>
      <div style="display:flex; gap:18px; flex-wrap:wrap;">
        <div style="flex:1 1 420px; min-width:320px;">
          <h4 style="margin:8px 0;">Por tecnico</h4>
          <table class="tabla-erp">
            <thead><tr><th>Tecnico</th><th>Reparaciones</th><th>Promedio</th></tr></thead>
            <tbody>${rowsTec}</tbody>
          </table>
        </div>
        <div style="flex:1 1 420px; min-width:320px;">
          <h4 style="margin:8px 0;">Por equipo (familia)</h4>
          <table class="tabla-erp">
            <thead><tr><th>Equipo</th><th>Reparaciones</th><th>Promedio</th></tr></thead>
            <tbody>${rowsEq}</tbody>
          </table>
        </div>
      </div>`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
