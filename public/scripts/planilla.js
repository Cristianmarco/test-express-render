// Abrir modal
function abrirModalReparacion(titulo = "Nueva Reparación", datos = null) {
  document.getElementById("modal-titulo-reparacion").textContent = titulo;
  document.getElementById("modal-reparacion").classList.add("mostrar");

  const form = document.getElementById("form-reparacion");
  if (datos) {
    for (const [k, v] of Object.entries(datos)) {
      if (form[k]) form[k].value = v;
    }
  } else {
    form.reset();
  }

  cargarOpcionesSelect("/api/equipos", "equipo_id", "id", "modelo");
  cargarOpcionesSelect("/api/tecnicos", "tecnico_id", "id", "nombre");
}

// Cerrar modal
function cerrarModalReparacion() {
  document.getElementById("modal-reparacion").classList.remove("mostrar");
  document.getElementById("form-reparacion").reset();
}

// Helper para cargar selects
async function cargarOpcionesSelect(url, selectId, campoValor, campoTexto) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error cargando ${url}`);
    const data = await res.json();
    const select = document.getElementById(selectId);
    select.innerHTML = `<option value="">Seleccione</option>`;
    data.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item[campoValor];
      opt.textContent = item[campoTexto];
      select.appendChild(opt);
    });
  } catch (err) {
    console.error(err);
  }
}


