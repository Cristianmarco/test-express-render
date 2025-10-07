document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("tbody-familias");
  const form = document.getElementById("form-familia");
  let editando = null; // guarda el id de la fila seleccionada

  // 👉 Abrir modal
  function abrirModal(titulo, datos = null) {
    document.getElementById("modal-titulo").textContent = titulo;
    document.getElementById("modal-familia").classList.add("mostrar");

    if (datos) {
      form.codigo.value = datos.codigo;
      form.descripcion.value = datos.descripcion;
      editando = datos.id; // usamos id, no codigo
    } else {
      form.reset();
      editando = null;
    }
  }

  function cerrarModal() {
    document.getElementById("modal-familia").classList.remove("mostrar");
    form.reset();
    editando = null;
  }

  window.cerrarModal = cerrarModal;

  // 👉 Cargar familias
  async function cargarFamilias() {
    try {
      const res = await fetch("/api/familias", { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Error al cargar familias: ${res.status}`);
      }

      const data = await res.json();
      if (!Array.isArray(data)) {
        console.error("❌ Respuesta inesperada:", data);
        return;
      }

      tbody.innerHTML = "";

      data.forEach(f => {
        const tr = document.createElement("tr");
        tr.dataset.id = f.id; // guardamos id en la fila
        tr.innerHTML = `
          <td>${f.codigo}</td>
          <td>${f.descripcion}</td>
          <td>
            <button class="editar">✏️</button>
            <button class="eliminar">🗑️</button>
          </td>
        `;
        // seleccionar fila
        tr.onclick = () => {
          document.querySelectorAll("#tbody-familias tr")
            .forEach(row => row.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
        };

        // botones inline
        tr.querySelector(".editar").onclick = e => {
          e.stopPropagation();
          abrirModal("Modificar Familia", f);
        };

        tr.querySelector(".eliminar").onclick = async e => {
          e.stopPropagation();
          if (confirm("¿Eliminar familia?")) {
            const resp = await fetch(`/api/familias/${f.id}`, {
              method: "DELETE",
              credentials: "include"
            });
            if (resp.ok) {
              cargarFamilias();
            } else {
              alert("Error al eliminar familia");
            }
          }
        };

        tbody.appendChild(tr);
      });

    } catch (err) {
      console.error("❌ Error en cargarFamilias:", err);
    }
  }

  // 👉 Botón agregar
  const btnAgregar = document.querySelector(".icon-button-erp.agregar");
  if (btnAgregar) {
    btnAgregar.onclick = () => abrirModal("Nueva Familia");
  }

  // 👉 Guardar (crear o editar)
  form.onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());
    const url = editando ? `/api/familias/${editando}` : "/api/familias";
    const method = editando ? "PUT" : "POST";

    const resp = await fetch(url, {
      method,
      credentials: "include",
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
  const btnCerrar = document.getElementById("cerrar-modal-familia");
  if (btnCerrar) {
    btnCerrar.onclick = cerrarModal;
  }
});
