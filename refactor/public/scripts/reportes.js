// Reportes de Planilla Diaria
(function(){
  const fmt = (d)=>{ try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d).slice(0,10); } };

  async function cargar(){
    const desde = document.getElementById('rep-desde');
    const hasta = document.getElementById('rep-hasta');
    const di = (desde && desde.value) ? desde.value : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
    const df = (hasta && hasta.value) ? hasta.value : new Date().toISOString().slice(0,10);
    if (desde && !desde.value) desde.value = di; if (hasta && !hasta.value) hasta.value = df;

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
  }

  function bind(){
    const btn = document.getElementById('rep-actualizar');
    if (btn && !btn._bound){ btn._bound = true; btn.addEventListener('click', cargar); }
    cargar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();

