document.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('/api/estadisticas');
    const stats = await resp.json();

    // Externos
    document.getElementById('vigentes-externos').textContent = stats.externos.vigentes;
    document.getElementById('garantias-externos').textContent = stats.externos.garantias;
    document.getElementById('vencidos-externos').textContent = stats.externos.vencidos;

    // Dota
    document.getElementById('vigentes-dota').textContent = stats.dota.vigentes;
    document.getElementById('garantias-dota').textContent = stats.dota.garantias;
    document.getElementById('vencidos-dota').textContent = stats.dota.vencidos;

    // Totales
    document.getElementById('total-vigentes').textContent = stats.totales.vigentes;
    document.getElementById('total-garantias').textContent = stats.totales.garantias;
    document.getElementById('total-vencidos').textContent = stats.totales.vencidos;
  } catch (e) {
    // Si hay error, pon guiones
    document.querySelectorAll('.stats span[id]').forEach(span => span.textContent = '-');
    console.error("No se pudieron cargar estadísticas", e);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('/api/estadisticas');
    const stats = await resp.json();

    // BADGES
    document.getElementById('badge-externos').textContent = stats.externos.vigentes ?? '-';
    document.getElementById('badge-dota').textContent = stats.dota.vigentes ?? '-';

    // Counters (animados) - SOLO Totales
    const counters = [
      { id: 'total-vigentes', value: stats.totales.vigentes ?? 0 },
      { id: 'total-garantias', value: stats.totales.garantias ?? 0 },
      { id: 'total-vencidos', value: stats.totales.vencidos ?? 0 }
    ];
    counters.forEach(({id, value}) => {
      animateCounter(id, value);
    });

    // Además, llená los números normales:
    document.getElementById('vigentes-externos').textContent = stats.externos.vigentes ?? '-';
    document.getElementById('garantias-externos').textContent = stats.externos.garantias ?? '-';
    document.getElementById('vencidos-externos').textContent = stats.externos.vencidos ?? '-';

    document.getElementById('vigentes-dota').textContent = stats.dota.vigentes ?? '-';
    document.getElementById('garantias-dota').textContent = stats.dota.garantias ?? '-';
    document.getElementById('vencidos-dota').textContent = stats.dota.vencidos ?? '-';

  } catch (e) {
    document.querySelectorAll('.stats span[id]').forEach(span => span.textContent = '-');
    document.getElementById('badge-externos').textContent = '-';
    document.getElementById('badge-dota').textContent = '-';
    // Si querés, podés dejar counters en cero
  }
});

// BADGE: actualiza badge en tiempo real
function setBadge(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "-";
}

// COUNTER animado (con easing)
function animateCounter(id, to) {
  const el = document.getElementById(id);
  if (!el) return;
  const from = +(el.getAttribute('data-value') || 0);
  const target = Number(to) || 0;
  const duration = 950;
  const start = performance.now();

  function step(ts) {
    const progress = Math.min((ts - start) / duration, 1);
    const value = Math.floor(from + (target - from) * progress);
    el.textContent = value;
    el.setAttribute('data-value', value);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('/api/estadisticas');
    const stats = await resp.json();

    // BADGES
    setBadge('badge-externos', stats.externos?.vigentes ?? '-');
    setBadge('badge-dota', stats.dota?.vigentes ?? '-');

    // Números simples
    document.getElementById('vigentes-externos').textContent = stats.externos?.vigentes ?? '-';
    document.getElementById('garantias-externos').textContent = stats.externos?.garantias ?? '-';
    document.getElementById('vencidos-externos').textContent = stats.externos?.vencidos ?? '-';

    document.getElementById('vigentes-dota').textContent = stats.dota?.vigentes ?? '-';
    document.getElementById('garantias-dota').textContent = stats.dota?.garantias ?? '-';
    document.getElementById('vencidos-dota').textContent = stats.dota?.vencidos ?? '-';

    // COUNTERS animados
    animateCounter('total-vigentes', stats.totales?.vigentes ?? 0);
    animateCounter('total-garantias', stats.totales?.garantias ?? 0);
    animateCounter('total-vencidos', stats.totales?.vencidos ?? 0);
  } catch (e) {
    document.querySelectorAll('.stats span[id]').forEach(span => span.textContent = '-');
    setBadge('badge-externos', '-');
    setBadge('badge-dota', '-');
    animateCounter('total-vigentes', 0);
    animateCounter('total-garantias', 0);
    animateCounter('total-vencidos', 0);
    console.error("No se pudieron cargar estadísticas", e);
  }
});


async function cargarResumenDota() {
  try {
    const resp = await fetch('/api/estadisticas');
    const stats = await resp.json();
    document.getElementById('vigentes-dota').textContent = stats.dota?.vigentes ?? '-';
    document.getElementById('garantias-dota').textContent = stats.dota?.garantias ?? '-';
    // Si querés, lo mismo para badge:
    document.getElementById('badge-dota').textContent = stats.dota?.vigentes ?? '-';
  } catch (e) {
    document.getElementById('vigentes-dota').textContent = '-';
    document.getElementById('garantias-dota').textContent = '-';
  }
}


document.addEventListener('DOMContentLoaded', cargarResumenDota);



