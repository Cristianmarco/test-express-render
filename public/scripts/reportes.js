document.addEventListener('DOMContentLoaded', () => {
  console.log('reportes.js cargado');
  const btn = document.getElementById('btn-menu-reportes');
  const menu = document.getElementById('lista-reportes');
  const titulo = document.getElementById('titulo-reporte');
  const btnAplicar = document.getElementById('aplicar-fechas');
  const desde = document.getElementById('fecha-desde');
  const hasta = document.getElementById('fecha-hasta');

  // Toggle del menú
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const abierto = menu.classList.toggle('abierto');
    btn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    menu.setAttribute('aria-hidden', abierto ? 'false' : 'true');
  });

  // Cerrar al clickear fuera
  document.addEventListener('click', (e) => {
    if (!menu) return;
    const target = e.target;
    if (menu.classList.contains('abierto') && !menu.contains(target) && target !== btn) {
      menu.classList.remove('abierto');
      btn?.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
    }
  });

  // Selección de reporte
  menu?.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => {
      menu.querySelectorAll('li').forEach(x => x.classList.remove('activo'));
      li.classList.add('activo');
      const nombre = li.textContent?.trim() || 'Reporte';
      if (titulo) titulo.textContent = `Reporte: ${nombre}`;
      menu.classList.remove('abierto');
      btn?.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');
      // Hook para integrar carga de datos según reporte seleccionado
      console.log('Reporte seleccionado:', li.dataset.report);
    });
  });

  // Aplicar filtro de fechas (hook)
  btnAplicar?.addEventListener('click', () => {
    const fDesde = desde?.value || null;
    const fHasta = hasta?.value || null;
    console.log('Aplicar fechas:', { desde: fDesde, hasta: fHasta });
    // Aquí podrías disparar una recarga de datos según el reporte activo y el rango
  });
});
