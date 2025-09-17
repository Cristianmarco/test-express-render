document.addEventListener("DOMContentLoaded", () => {
  let equipoSeleccionado = null;
  let modoEdicion = false;

  // === Cargar equipos ===
  async function cargarEquipos() {
    const tbody = document.getElementById("tbody-equipos");
    tbody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
      const res = await fetch("/api/equipos");
      const equipos = await res.json();

      document.getElementById("total-equipos").textContent = equipos.length;
      tbody.innerHTML = "";

      equipos.forEach(e => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${e.id}</td>
          <td>${e.id_dota || "-"}</td>
          <td>${e.marca}</td>
          <td>${e.modelo}</td>
          <td>${e.descripcion || "-"}</td>
        `;
        tr.onclick = () => {
          document.querySelectorAll("#tbody-equipos tr").forEach(x => x.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
          equipoSeleccionado = e;
          mostrarFicha(e);
        };
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error(err);
      tbody.innerHTML = '<tr><td colspan="5">Error al cargar</td></tr>';
    }
  }

  // === Mostrar ficha lateral ===
  function mostrarFicha(eq) {
    const resumen = document.querySelector(".erp-card-resumen");
    resumen.innerHTML = `
      <div class="erp-card-titulo"><i class="fas fa-info-circle"></i> Ficha del Equipo</div>
      <div class="erp-resumen-dato"><b>ID:</b> ${eq.id}</div>
      <div class="erp-resumen-dato"><b>ID Dota:</b> ${eq.id_dota || "-"}</div>
      <div class="erp-resumen-dato"><b>Marca:</b> ${eq.marca}</div>
      <div class="erp-resumen-dato"><b>Modelo:</b> ${eq.modelo}</div>
      <div class="erp-resumen-dato"><b>Descripción:</b> ${eq.descripcion || "-"}</div>
    `;
  }

  // === Modal ===
  function abrirModal(titulo) {
    document.getElementById("modal-titulo").textContent = titulo;
    document.getElementById("modal-equipo").classList.add("mostrar");
  }
  window.cerrarModal = () => {
    document.getElementById("modal-equipo").classList.remove("mostrar");
    document.getElementById("form-equipo").reset();
    modoEdicion = false;
  };

  // === Botones ===
  document.getElementById("btn-agregar").onclick = () => {
    modoEdicion = false;
    document.getElementById("form-equipo").reset();
    abrirModal("Nuevo Equipo");
  };

  document.getElementById("btn-modificar").onclick = () => {
    if (!equipoSeleccionado) return alert("Selecciona un equipo primero");
    modoEdicion = true;
    const form = document.getElementById("form-equipo");
    form.id_dota.value = equipoSeleccionado.id_dota || "";
    form.marca.value = equipoSeleccionado.marca;
    form.modelo.value = equipoSeleccionado.modelo;
    form.descripcion.value = equipoSeleccionado.descripcion || "";
    abrirModal("Editar Equipo");
  };

  document.getElementById("btn-eliminar").onclick = async () => {
    if (!equipoSeleccionado) return alert("Selecciona un equipo primero");
    if (!confirm(`¿Eliminar equipo ${equipoSeleccionado.marca} ${equipoSeleccionado.modelo}?`)) return;

    try {
      const res = await fetch(`/api/equipos/${equipoSeleccionado.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      alert("Equipo eliminado ✔");
      equipoSeleccionado = null;
      cargarEquipos();
    } catch (err) {
      console.error(err);
      alert("Error al eliminar");
    }
  };

  // === Guardar ===
  document.getElementById("form-equipo").onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target).entries());

    let url = "/api/equipos";
    let method = "POST";
    if (modoEdicion && equipoSeleccionado) {
      url = `/api/equipos/${equipoSeleccionado.id}`;
      method = "PUT";
    }

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      if (!res.ok) throw new Error("Error al guardar");
      alert(modoEdicion ? "Equipo modificado ✔" : "Equipo agregado ✔");
      cerrarModal();
      cargarEquipos();
    } catch (err) {
      console.error(err);
      alert("Error al guardar");
    }
  };

  // Inicial
  cargarEquipos();
});
