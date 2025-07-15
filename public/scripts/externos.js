document.addEventListener('DOMContentLoaded', () => {
  const rol = localStorage.getItem('rol');
  if (rol && rol.toLowerCase() === 'cliente' && !window.location.pathname.includes('reparaciones-vigentes')) {
    window.location.href = '/reparaciones-vigentes';
  }
});


function mostrarSubmenuReparaciones() {
  const seccionPrincipal = document.getElementById("seccion-principal");
  const submenuReparaciones = document.getElementById("submenu-reparaciones");

  if (seccionPrincipal && submenuReparaciones) {
    seccionPrincipal.style.display = "none";
    submenuReparaciones.style.display = "flex";
  } else {
    console.warn("⚠️ Alguno de los elementos no se encontró en el DOM");
  }
}

function volverASeccionPrincipal() {
  const submenuReparaciones = document.getElementById("submenu-reparaciones");
  const principal = document.getElementById("seccion-principal");

  if (submenuReparaciones && principal) {
    submenuReparaciones.style.display = "none";
    principal.style.display = "flex";
    principal.style.flexDirection = "row";
    principal.style.gap = "20px";
  } else {
    console.warn("⚠️ Alguno de los elementos no se encontró en el DOM");
  }
}

function irAClientes() {
  window.location.href = '/clientes';
}

