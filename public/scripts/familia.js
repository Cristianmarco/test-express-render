document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("tbody-familias");
  const modal = document.getElementById("modal-agregar-familia");
  const form = document.getElementById("form-familia");
  let editando = null; // va a guardar el id de la fila seleccionada

  // 👉 Abrir modal
  function abrirModal(titulo, datos = null) {
    document.getElementById("modal-titulo").textContent = titulo;
    document.getElementById("modal-familia").classList.add("mostrar");

    if (datos) {
      form.codigo.value = datos.codigo;
      form.descripcion.value = datos.descripcion;
      editando = datos.codigo;
    } else {
      form.reset();
      editando = null;
    }
  }

  function cerrarModal() {
    document.getElementById("modal-familia").classList.remove("mostrar");
    form.reset();
  }

  window.cerrarModal = cerrarModal;

  // 👉 Cargar familias
  async function cargarFamilias() {
    try {
      const res = await fetch("/api/familias");
      const data = await res.json();
      tbody.innerHTML = "";

      data.forEach(f => {
        const tr = document.createElement("tr");
        tr.dataset.id = f.id; // ✅ guardar id como dataset
        tr.innerHTML = `<td>${f.codigo}</td><td>${f.descripcion}</td>`;

        tr.onclick = () => {
          document.querySelectorAll("#tbody-familias tr").forEach(x => x.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
        };

        tbody.appendChild(tr);
      });

      document.getElementById("total-familias").textContent = data.length;
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="2">Error al cargar</td></tr>`;
    }
  }

  // 👉 Botón agregar
  document.querySelector(".icon-button-erp.agregar").onclick = () => abrirModal("Nueva Familia");

  // 👉 Botón modificar
  document.querySelector(".icon-button-erp.modificar").onclick = () => {
    const sel = document.querySelector("#tbody-familias tr.seleccionado");
    if (!sel) return alert("Selecciona una familia");

    abrirModal("Modificar Familia", {
      id: sel.dataset.id,
      codigo: sel.children[0].textContent,
      descripcion: sel.children[1].textContent
    });
  };

  // 👉 Botón eliminar
  document.querySelector(".icon-button-erp.eliminar").onclick = async () => {
    const sel = document.querySelector("#tbody-familias tr.seleccionado");
    if (!sel) return alert("Selecciona una familia");

    if (confirm("¿Eliminar familia?")) {
      await fetch(`/api/familias/${sel.dataset.id}`, { method: "DELETE" });
      cargarFamilias();
    }
  };

  // 👉 Guardar (crear o editar)
  form.onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());
    const url = editando ? `/api/familias/${editando}` : "/api/familias";
    const method = editando ? "PUT" : "POST";

    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos)
    });

    if (resp.ok) {
      cerrarModal();
      cargarFamilias();
    } else {
      alert("Error al guardar familia");
    }
  };

  // 👉 Inicial
  cargarFamilias();

  // 👉 Botón cerrar modal
  document.getElementById("cerrar-modal-familia").onclick = cerrarModal;
});
