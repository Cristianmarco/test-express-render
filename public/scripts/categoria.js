document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("tbody-categoria");
  const modal = document.getElementById("modal-categoria");
  const form = document.getElementById("form-categoria");
  const cerrarModalBtn = document.getElementById("cerrar-modal");
  let editando = null;

  function abrirModal(titulo, datos = null) {
    document.getElementById("modal-titulo").textContent = titulo;
    modal.classList.add("mostrar");
    if (datos) {
      form.codigo.value = datos.codigo;
      form.descripcion.value = datos.descripcion;
      editando = datos.id;
    } else {
      form.reset();
      editando = null;
    }
  }

  function cerrarModal() {
    modal.classList.remove("mostrar");
    form.reset();
    editando = null;
  }
  cerrarModalBtn.onclick = cerrarModal;

  async function cargarCategorias() {
    try {
      const res = await fetch("/api/categoria");
      const data = await res.json();
      tbody.innerHTML = "";
      document.getElementById("total-categoria").textContent = data.length;
      data.forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${c.codigo}</td><td>${c.descripcion}</td>`;
        tr.onclick = () => {
          document.querySelectorAll("#tbody-categoria tr").forEach(x => x.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
        };
        tr.dataset.id = c.id;
        tbody.appendChild(tr);
      });
    } catch {
      tbody.innerHTML = `<tr><td colspan="2">Error al cargar</td></tr>`;
    }
  }

  document.getElementById("btn-agregar").onclick = () => abrirModal("Nueva Categoría");
  document.getElementById("btn-modificar").onclick = () => {
    const sel = document.querySelector("#tbody-categoria tr.seleccionado");
    if (!sel) return alert("Selecciona una categoría");
    abrirModal("Modificar Categoría", {
      id: sel.dataset.id,
      codigo: sel.children[0].textContent,
      descripcion: sel.children[1].textContent
    });
  };
  document.getElementById("btn-eliminar").onclick = async () => {
    const sel = document.querySelector("#tbody-categoria tr.seleccionado");
    if (!sel) return alert("Selecciona una categoría");
    if (confirm("¿Eliminar categoría?")) {
      await fetch(`/api/categoria/${sel.dataset.id}`, { method: "DELETE" });
      cargarCategorias();
    }
  };

  form.onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());
    const method = editando ? "PUT" : "POST";
    const url = editando ? `/api/categoria/${editando}` : "/api/categoria";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos)
    });
    cerrarModal();
    cargarCategorias();
  };

  cargarCategorias();
});
