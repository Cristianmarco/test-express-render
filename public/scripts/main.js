document.addEventListener('DOMContentLoaded', () => {
  const rol = localStorage.getItem('rol');
  if (rol && rol.toLowerCase() === 'cliente' && !window.location.pathname.includes('reparaciones-vigentes')) {
    window.location.href = '/reparaciones-vigentes';
  }
});

function irA(seccion) {
  switch (seccion) {
    case 'externos':
      window.location.href = '/externos';
      break;
    case 'dota':
      window.location.href = '/dota';
      break;
    case 'usuarios':
      window.location.href = '/usuarios';
      break;
    default:
      console.warn('Sección no reconocida:', seccion);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const username = localStorage.getItem('username');
  if (username) {
    document.getElementById('user-name').textContent = `Bienvenido, ${username}`;
  }
});

function toggleSubmenuTablas(e) {
  e.preventDefault();
  var submenu = document.getElementById('submenu-tablas-generales');
  submenu.style.display = submenu.style.display === "none" ? "block" : "none";
}


