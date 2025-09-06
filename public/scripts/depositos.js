// public/scripts/depositos.js
document.addEventListener("DOMContentLoaded", function () {
  let depositoSeleccionado = null;
  let modoEdicion = false;

  const modal = document.getElementById("modal-deposito");
  const form = document.getElementById("form-deposito");

  // === Abrir modal ===
  function abrirModal(titulo) {
    document.getElementById("modal-titulo").textContent = titulo;
    modal.classList.add("mostrar");
  }

  // === Cerrar modal ===
  window.cerrarModal = function () {
    modal.classList.remove("mostrar");
    form.reset();
    modoEdicion = false;
  };

  // === Botón Agregar ===
  document.getElementById("btn-agregar").addEventListener("click", () => {
    modoEdicion = false;
    form.reset();
    abrirModal("Nuevo Depósito");
  });

  // === Botón Modificar ===
  document.getElementById("btn-modificar").addEventListener("click", () => {
    if (!depositoSeleccionado) return alert("Selecciona un depósito primero");
    modoEdicion = true;
    form.nombre.value = depositoSeleccionado.nombre;
    form.ubicacion.value = depositoSeleccionado.ubicacion || "";
    abrirModal("Editar Depósito");
  });

  // === Botón Eliminar ===
  document.getElementById("btn-eliminar").addEventListener("click", async () => {
    if (!depositoSeleccionado) return alert("Selecciona un depósito primero");
    if (!confirm(`¿Eliminar depósito "${depositoSeleccionado.nombre}"?`)) return;

    try {
      const resp = await fetch(`/api/depositos/${depositoSeleccionado.id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("Error al eliminar");
      alert("Depósito eliminado ✔");
      depositoSeleccionado = null;
      cargarDepositos();
    } catch (err) {
      console.error(err);
      alert("Error al eliminar depósito");
    }
  });

  // === Guardar (submit del modal) ===
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());

    let url = "/api/depositos";
    let method = "POST";

    if (modoEdicion && depositoSeleccionado) {
      url = `/api/depositos/${depositoSeleccionado.id}`;
      method = "PUT";
    }

    try {
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos)
      });
      if (!resp.ok) throw new Error("Error al guardar");
      alert(modoEdicion ? "Depósito modificado ✔" : "Depósito agregado ✔");
      cerrarModal();
      cargarDepositos();
    } catch (err) {
      console.error(err);
      alert("Error al guardar depósito");
    }
  });

  // === Cargar depósitos ===
  async function cargarDepositos() {
    const tbody = document.getElementById("tbody-depositos");
    tbody.innerHTML = '<tr><td colspan="3">Cargando...</td></tr>';
    try {
      const resp = await fetch("/api/depositos");
      if (!resp.ok) throw new Error("Error al cargar depósitos");
      const depositos = await resp.json();

      document.getElementById("total-depositos").textContent = depositos.length;
      tbody.innerHTML = "";

      depositos.forEach(d => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${d.id}</td>
          <td>${d.nombre}</td>
          <td>${d.ubicacion || "-"}</td>
        `;
        tr.onclick = function () {
          document.querySelectorAll("#tbody-depositos tr").forEach(tr => tr.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
          depositoSeleccionado = d;
          mostrarFicha(d);
        };
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error(err);
      tbody.innerHTML = '<tr><td colspan="3">Error al cargar</td></tr>';
    }
  }

  // === Mostrar ficha lateral ===
  function mostrarFicha(dep) {
    const resumen = document.querySelector(".erp-card-resumen");
    resumen.innerHTML = `
      <div class="erp-card-titulo"><i class="fas fa-info-circle"></i> Ficha del Depósito</div>
      <div class="erp-resumen-dato"><b>ID:</b> ${dep.id}</div>
      <div class="erp-resumen-dato"><b>Nombre:</b> ${dep.nombre}</div>
      <div class="erp-resumen-dato"><b>Ubicación:</b> ${dep.ubicacion || "-"}</div>
    `;
  }

  // === Inicial ===
  cargarDepositos();
});

