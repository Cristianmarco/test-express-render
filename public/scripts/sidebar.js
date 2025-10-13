console.log("sidebar.js ejecutado - rol:", localStorage.getItem('rol'));

document.addEventListener('DOMContentLoaded', () => {
  const rol = localStorage.getItem('rol');
  
  if (rol && rol.toLowerCase() === 'cliente') {
    // SOLO si es cliente, mostrar SOLO Reparaciones Vigentes y controlar navegación
    const sidebar = document.querySelector('.sidebar nav ul');
    if (sidebar) {
      sidebar.innerHTML = `
        <li>
          <button class="sidebar-btn" onclick="irA('reparaciones-vigentes')">
            <i class="fas fa-tools"></i> Reparaciones Vigentes
          </button>
        </li>
      `;
    }
    // Forzá navegación solo si NO está en reparaciones-vigentes.html
    const path = window.location.pathname;
    if (!path.endsWith('reparaciones-vigentes.html')) {
      window.location.href = '/views/reparaciones-vigentes.html';
    }
  }
  // Handlers globales para modales clásicos (.modal)
  bindGlobalClassicModals();
});

// Cierre suave genérico para modales clásicos
function smoothCloseClassicModal(modal) {
  if (!modal) return;
  const content = modal.querySelector('.modal-contenido');
  modal.classList.add('closing');
  if (content) content.classList.add('closing');
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('closing', 'open', 'mostrar');
    if (content) content.classList.remove('closing');
  }, 180);
}

function bindGlobalClassicModals() {
  if (window.__classicModalsBound) return;
  window.__classicModalsBound = true;

  // Cerrar al clickear el overlay
  document.addEventListener('click', (e) => {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
      if (!modal || (modal.style.display !== 'flex' && modal.style.display !== 'block' && !modal.classList.contains('mostrar') && !modal.classList.contains('open'))) return;
      const content = modal.querySelector('.modal-contenido');
      if (e.target === modal && (!content || !content.contains(e.target))) {
        smoothCloseClassicModal(modal);
      }
    });
  });

  // Cerrar con tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
      if (modal && (modal.style.display === 'flex' || modal.style.display === 'block' || modal.classList.contains('mostrar') || modal.classList.contains('open'))) {
        smoothCloseClassicModal(modal);
      }
    });
  });
}

// Función global para navegación de sidebar
function irA(seccion) {
  if (seccion === 'dota-inicio') {
    window.location.href = '/views/main.html';
  } else if (seccion === 'dota-licitacion') {
    window.location.href = '/views/dota.html';
  } else if (seccion === 'dota-reparaciones') {
    window.location.href = '/views/reparaciones_dota.html';
  } else if (seccion === 'dota-garantias') {
    window.location.href = '/views/garantias_dota.html';
  } else if (seccion === 'externos') {
    window.location.href = '/views/externos.html';
  } else if (seccion === 'clientes') {
    window.location.href = '/views/clientes.html';
  } else if (seccion === 'reparaciones-vigentes') {
    window.location.href = '/views/reparaciones-vigentes.html';
  } else if (seccion === 'historial') {
    window.location.href = '/views/historial.html';
  } else {
    window.location.href = '/views/main.html';
  }
}
window.irA = irA;

function logout() {
  if (confirm('¿Seguro que deseas salir?')) {
    localStorage.removeItem('rol');
    localStorage.removeItem('username');
    localStorage.removeItem('cliente');
    window.location.href = '/';
  }
}
