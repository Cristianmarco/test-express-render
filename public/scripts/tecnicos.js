document.addEventListener("DOMContentLoaded", function () {
  let tecnicoSeleccionado = null;
  let modoEdicion = false;

  // === Cargar técnicos ===
  async function cargarTecnicos() {
    const tbody = document.getElementById("tbody-tecnicos");
    tbody.innerHTML = '<tr><td colspan="3">Cargando...</td></tr>';
    try {
      const resp = await fetch("/api/tecnicos");
      if (!resp.ok) throw new Error("Error al cargar técnicos");
      const tecnicos = await resp.json();

      document.getElementById("total-tecnicos").textContent = tecnicos.length;
      tbody.innerHTML = "";

      tecnicos.forEach(t => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${t.id}</td>
          <td>${t.nombre}</td>
          <td>${t.qr_code ? "✔️" : "-"}</td>
        `;
        tr.onclick = function () {
          document.querySelectorAll("#tbody-tecnicos tr").forEach(tr => tr.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
          tecnicoSeleccionado = t;
          mostrarFicha(t);
        };
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error(err);
      tbody.innerHTML = '<tr><td colspan="3">Error al cargar</td></tr>';
    }
  }

  // === Mostrar ficha lateral ===
  function mostrarFicha(tec) {
    document.getElementById("ficha-id").textContent = tec.id;
    document.getElementById("ficha-nombre").textContent = tec.nombre;
    document.getElementById("ficha-dni").textContent = tec.dni || "-";

    const qrSection = document.getElementById("qr-section");
    const qrDiv = document.getElementById("ficha-qr");
    const btnDescargar = document.getElementById("btn-descargar-qr");

    if (tec.qr_code) {
      qrDiv.innerHTML = `<img src="${tec.qr_code}" width="160">`;
      qrSection.style.display = "block";
      btnDescargar.style.display = "inline-block";
    } else {
      qrDiv.innerHTML = "-";
      qrSection.style.display = "none";
      btnDescargar.style.display = "none";
    }
  }

  // === Botón Descargar QR ===
  document.getElementById("btn-descargar-qr").onclick = () => {
    if (!tecnicoSeleccionado || !tecnicoSeleccionado.qr_code) {
      return alert("Este técnico no tiene QR");
    }
    const link = document.createElement("a");
    link.href = tecnicoSeleccionado.qr_code;
    link.download = `tecnico_${tecnicoSeleccionado.id}.png`;
    link.click();
  };

  // === Abrir modal ===
  function abrirModal(titulo) {
    document.getElementById("modal-titulo").textContent = titulo;
    document.getElementById("modal-tecnico").classList.add("mostrar");
  }

  // === Cerrar modal ===
  window.cerrarModal = function () {
    document.getElementById("modal-tecnico").classList.remove("mostrar");
    document.getElementById("form-tecnico").reset();
    modoEdicion = false;
  };

  // === Botón Agregar ===
  document.getElementById("btn-agregar").onclick = () => {
    modoEdicion = false;
    document.getElementById("form-tecnico").reset();
    abrirModal("Nuevo Técnico");
  };

  // === Botón Modificar ===
  document.getElementById("btn-modificar").onclick = () => {
    if (!tecnicoSeleccionado) return alert("Selecciona un técnico primero");
    modoEdicion = true;

    const form = document.getElementById("form-tecnico");
    form.nombre.value = tecnicoSeleccionado.nombre;
    form.dni.value = tecnicoSeleccionado.dni || "";

    abrirModal("Editar Técnico");
  };

  // === Botón Eliminar ===
  document.getElementById("btn-eliminar").onclick = async () => {
    if (!tecnicoSeleccionado) return alert("Selecciona un técnico primero");
    if (!confirm(`¿Eliminar técnico "${tecnicoSeleccionado.nombre}"?`)) return;

    try {
      const resp = await fetch(`/api/tecnicos/${tecnicoSeleccionado.id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("Error al eliminar");
      alert("Técnico eliminado ✔");
      tecnicoSeleccionado = null;
      cargarTecnicos();
    } catch (err) {
      console.error(err);
      alert("Error al eliminar técnico");
    }
  };

  // === Guardar (submit del modal) ===
  document.getElementById("form-tecnico").onsubmit = async function (e) {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(this).entries());

    let url = "/api/tecnicos";
    let method = "POST";

    if (modoEdicion && tecnicoSeleccionado) {
      url = `/api/tecnicos/${tecnicoSeleccionado.id}`;
      method = "PUT";
    }

    try {
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos)
      });
      if (!resp.ok) throw new Error("Error al guardar");
      alert(modoEdicion ? "Técnico modificado ✔" : "Técnico agregado ✔");
      cerrarModal();
      cargarTecnicos();
    } catch (err) {
      console.error(err);
      alert("Error al guardar técnico");
    }
  };

  // === Inicial ===
  cargarTecnicos();
});
