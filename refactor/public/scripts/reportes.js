// Reportes de Planilla Diaria
(function(){
  const fmt = (d)=>{ try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d).slice(0,10); } };
  let tipo = 'planilla-resumen';

  async function cargar(){
    const desde = document.getElementById('rep-desde');
    const hasta = document.getElementById('rep-hasta');
    const di = (desde && desde.value) ? desde.value : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
    const df = (hasta && hasta.value) ? hasta.value : new Date().toISOString().slice(0,10);
    if (desde && !desde.value) desde.value = di; if (hasta && !hasta.value) hasta.value = df;
    if (tipo === 'planilla-resumen') {
      const res = await fetch(`/api/reportes/planilla/resumen?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}`, { credentials:'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Error');

      document.getElementById('rep-total').textContent = data.totales?.total ?? 0;
      document.getElementById('rep-garantias').textContent = data.totales?.garantias ?? 0;

      const tbTec = document.getElementById('rep-top-tecnicos');
      tbTec.innerHTML = (data.porTecnico||[]).map(r => `<tr><td>${r.tecnico}</td><td>${r.cantidad}</td></tr>`).join('') || '<tr><td colspan="2">Sin datos</td></tr>';

      const tbEq = document.getElementById('rep-top-equipos');
      tbEq.innerHTML = (data.porEquipo||[]).map(r => `<tr><td>${r.equipo}</td><td>${r.cantidad}</td></tr>`).join('') || '<tr><td colspan="2">Sin datos</td></tr>';

      const tbDia = document.getElementById('rep-por-dia');
      tbDia.innerHTML = (data.porDia||[]).map(r => `<tr><td>${fmt(r.fecha)}</td><td>${r.cantidad}</td><td>${r.garantias}</td></tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>';
    } else if (tipo === 'equipos-por-tecnico-promedio-diario') {
      await cargarPromedioPorTecnico(di, df);
    } else if (tipo === 'garantias-por-resolucion-reparador') {
      await cargarGarantiasPorResolucionYReparador(di, df);
    } else if (tipo === 'tiempo-reparacion-promedio-por-equipo') {
      await cargarPromedioTiempo(di, df);
    }
  }

  function bind(){
    const btn = document.getElementById('rep-actualizar');
    if (btn && !btn._bound){ btn._bound = true; btn.addEventListener('click', cargar); }

    // Menú hamburguesa
    let btnMenu = document.getElementById('rep-menu-btn');
    let menu = document.getElementById('rep-menu');
    // Fallback: si la vista vieja no trae el botón/menú, lo inyecto
    if (!btnMenu || !menu){
      const topbar = document.querySelector('.rep-topbar');
      if (topbar){
        const wrap = document.createElement('div');
        wrap.className = 'rep-menu-wrap';
        wrap.innerHTML = `
          <button id="rep-menu-btn" class="rep-hamburger" aria-label="Abrir menú de reportes" aria-expanded="false" aria-controls="rep-menu" type="button">
            <span></span><span></span><span></span>
          </button>
          <ul id="rep-menu" class="rep-menu" aria-hidden="true">
            <li class="${tipo==='planilla-resumen' ? 'activo' : ''}" data-report="planilla-resumen">Resumen planilla</li>
            <li data-report="garantias-por-resolucion-reparador">Garantías por resolución / último reparador</li>
            <li data-report="equipos-por-tecnico-promedio-diario">Promedio diario de equipos por técnico</li>
            <li data-report="tiempo-reparacion-promedio-por-equipo">Promedio de tiempo de reparación por equipo</li>
          </ul>`;
        topbar.appendChild(wrap);
        btnMenu = document.getElementById('rep-menu-btn');
        menu = document.getElementById('rep-menu');
      }
    }
    const titulo = document.getElementById('rep-titulo');
    btnMenu && btnMenu.addEventListener('click', (e)=>{
      e.stopPropagation();
      const abierto = menu.classList.toggle('abierto');
      btnMenu.setAttribute('aria-expanded', abierto ? 'true' : 'false');
      menu.setAttribute('aria-hidden', abierto ? 'false' : 'true');
    });
    document.addEventListener('click', (e)=>{
      if (!menu) return; const t = e.target;
      if (menu.classList.contains('abierto') && !menu.contains(t) && t !== btnMenu){
        menu.classList.remove('abierto');
        btnMenu?.setAttribute('aria-expanded','false');
        menu.setAttribute('aria-hidden','true');
      }
    });
    menu?.querySelectorAll('li').forEach(li=>{
      li.addEventListener('click', ()=>{
        menu.querySelectorAll('li').forEach(x=>x.classList.remove('activo'));
        li.classList.add('activo');
        tipo = li.dataset.report || 'planilla-resumen';
        const label = li.textContent?.trim() || 'Reporte';
        if (titulo) titulo.textContent = label.charAt(0).toUpperCase() + label.slice(1);
        menu.classList.remove('abierto');
        btnMenu?.setAttribute('aria-expanded','false');
        menu.setAttribute('aria-hidden','true');
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
    if (!bloquePlanilla || !bloqueDynamic) return;
    if (tipo === 'planilla-resumen'){
      bloquePlanilla.style.display = '';
      bloqueDynamic.style.display = 'none';
    } else {
      bloquePlanilla.style.display = 'none';
      bloqueDynamic.style.display = '';
    }
  }

  function renderMensaje(msg){
    const cont = document.getElementById('rep-dynamic-content');
    if (!cont) return; cont.innerHTML = `<p style="margin:0;color:#435;">${msg}</p>`;
  }

  async function cargarPromedioPorTecnico(di, df){
    const cont = document.getElementById('rep-dynamic-content');
    if (!cont) return;
    cont.innerHTML = 'Cargando...';
    const res = await fetch(`/api/reportes/planilla/promedios/equipos-por-tecnico?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}`, { credentials:'include' });
    const data = await res.json();
    if (!res.ok){ cont.textContent = data.error || 'Error al cargar.'; return; }
    const rows = (data.items||[]).map(r => `<tr><td>${r.tecnico}</td><td>${r.total}</td><td>${r.dias_trabajados}</td><td>${Number(r.promedio_diario).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="4">Sin datos</td></tr>';
    cont.innerHTML = `
      <h3 style="margin-top:0;color:#2176bd;">Promedio diario de equipos por técnico</h3>
      <table class="tabla-erp">
        <thead><tr><th>Técnico</th><th>Total equipos</th><th>Días trabajados</th><th>Promedio diario</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  async function cargarGarantiasPorResolucionYReparador(di, df){
    const cont = document.getElementById('rep-dynamic-content');
    if (!cont) return;
    cont.innerHTML = 'Cargando...';
    const res = await fetch(`/api/reportes/planilla/garantias-por-resolucion-reparador?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}`, { credentials:'include' });
    const data = await res.json();
    if (!res.ok){ cont.textContent = data.error || 'Error al cargar.'; return; }
    const t = data.total || { total: 0, aceptada: 0, rechazada: 0, funciona_ok: 0 };
    const hdr = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin:0 0 10px 0;">
        <div class="rep-badge" style="background:#1f6fd4;">Total: ${t.total}</div>
        <div class="rep-badge" style="background:#1a9956;">Aceptadas: ${t.aceptada}</div>
        <div class="rep-badge" style="background:#c0392b;">Rechazadas: ${t.rechazada}</div>
        <div class="rep-badge" style="background:#8e44ad;">Funciona OK: ${t.funciona_ok}</div>
      </div>`;
    const rows = (data.porTecnico||[]).map(r => `
      <tr>
        <td>${r.tecnico}</td>
        <td>${r.total}</td>
        <td>${r.aceptada}</td>
        <td>${r.rechazada}</td>
        <td>${r.funciona_ok}</td>
      </tr>`).join('') || '<tr><td colspan="5">Sin datos</td></tr>';
    cont.innerHTML = `
      <h3 style="margin-top:0;color:#2176bd;">Garantías por resolución / último reparador</h3>
      ${hdr}
      <table class="tabla-erp">
        <thead><tr><th>Técnico (último reparador)</th><th>Total</th><th>Aceptadas</th><th>Rechazadas</th><th>Funciona OK</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function fmtMinutosTotal(m){
    if (m == null || isNaN(m)) return '-';
    const total = Number(m);
    const h = Math.floor(total / 60);
    const min = Math.round(total - h*60);
    if (h <= 0) return `${min} min`;
    return `${h} h ${min} m`;
  }

  async function cargarPromedioTiempo(di, df){
    const cont = document.getElementById('rep-dynamic-content');
    if (!cont) return;
    cont.innerHTML = 'Cargando...';
    const res = await fetch(`/api/reportes/planilla/tiempo-reparacion-promedio-por-equipo?inicio=${encodeURIComponent(di)}&fin=${encodeURIComponent(df)}`, { credentials:'include' });
    const data = await res.json();
    if (!res.ok){ cont.textContent = data.error || 'Error al cargar.'; return; }

    const rowsTec = (data.porTecnico||[]).map(r => `
      <tr>
        <td>${r.tecnico}</td>
        <td>${r.cantidad}</td>
        <td>${fmtMinutosTotal(r.promedio_min)}</td>
      </tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>';

    const rowsEq = (data.porEquipo||[]).map(r => `
      <tr>
        <td>${r.equipo}</td>
        <td>${r.cantidad}</td>
        <td>${fmtMinutosTotal(r.promedio_min)}</td>
      </tr>`).join('') || '<tr><td colspan="3">Sin datos</td></tr>';

    cont.innerHTML = `
      <h3 style="margin-top:0;color:#2176bd;">Promedio de tiempo de reparación</h3>
      <div style="display:flex; gap:18px; flex-wrap:wrap;">
        <div style="flex:1 1 420px; min-width:320px;">
          <h4 style="margin:8px 0;">Por técnico</h4>
          <table class="tabla-erp">
            <thead><tr><th>Técnico</th><th>Reparaciones</th><th>Promedio</th></tr></thead>
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();

