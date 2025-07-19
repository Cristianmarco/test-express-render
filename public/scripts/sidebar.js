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
});

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
