document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("tbody-marca");
  const modal = document.getElementById("modal-marca");
  const form = document.getElementById("form-marca");
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

  async function cargarMarcas() {
    try {
      const res = await fetch("/api/marca");
      const data = await res.json();
      tbody.innerHTML = "";
      document.getElementById("total-marca").textContent = data.length;
      data.forEach(m => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${m.codigo}</td><td>${m.descripcion}</td>`;
        tr.onclick = () => {
          document.querySelectorAll("#tbody-marca tr").forEach(x => x.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
        };
        tr.dataset.id = m.id;
        tbody.appendChild(tr);
      });
    } catch {
      tbody.innerHTML = `<tr><td colspan="2">Error al cargar</td></tr>`;
    }
  }

  document.getElementById("btn-agregar").onclick = () => abrirModal("Nueva Marca");
  document.getElementById("btn-modificar").onclick = () => {
    const sel = document.querySelector("#tbody-marca tr.seleccionado");
    if (!sel) return alert("Selecciona una marca");
    abrirModal("Modificar Marca", {
      id: sel.dataset.id,
      codigo: sel.children[0].textContent,
      descripcion: sel.children[1].textContent
    });
  };
  document.getElementById("btn-eliminar").onclick = async () => {
    const sel = document.querySelector("#tbody-marca tr.seleccionado");
    if (!sel) return alert("Selecciona una marca");
    if (confirm("¿Eliminar marca?")) {
      await fetch(`/api/marca/${sel.dataset.id}`, { method: "DELETE" });
      cargarMarcas();
    }
  };

  form.onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());
    const method = editando ? "PUT" : "POST";
    const url = editando ? `/api/marca/${editando}` : "/api/marca";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos)
    });
    cerrarModal();
    cargarMarcas();
  };

  cargarMarcas();
});
