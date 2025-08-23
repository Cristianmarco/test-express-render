document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("tbody-grupo");
  const modal = document.getElementById("modal-grupo");
  const form = document.getElementById("form-grupo");
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

  async function cargarGrupos() {
    try {
      const res = await fetch("/api/grupo");
      const data = await res.json();
      tbody.innerHTML = "";
      document.getElementById("total-grupo").textContent = data.length;
      data.forEach(g => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${g.codigo}</td><td>${g.descripcion}</td>`;
        tr.onclick = () => {
          document.querySelectorAll("#tbody-grupo tr").forEach(x => x.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
        };
        tr.dataset.id = g.id;
        tbody.appendChild(tr);
      });
    } catch {
      tbody.innerHTML = `<tr><td colspan="2">Error al cargar</td></tr>`;
    }
  }

  document.getElementById("btn-agregar").onclick = () => abrirModal("Nuevo Grupo");
  document.getElementById("btn-modificar").onclick = () => {
    const sel = document.querySelector("#tbody-grupo tr.seleccionado");
    if (!sel) return alert("Selecciona un grupo");
    abrirModal("Modificar Grupo", {
      id: sel.dataset.id,
      codigo: sel.children[0].textContent,
      descripcion: sel.children[1].textContent
    });
  };
  document.getElementById("btn-eliminar").onclick = async () => {
    const sel = document.querySelector("#tbody-grupo tr.seleccionado");
    if (!sel) return alert("Selecciona un grupo");
    if (confirm("¿Eliminar grupo?")) {
      await fetch(`/api/grupo/${sel.dataset.id}`, { method: "DELETE" });
      cargarGrupos();
    }
  };

  form.onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());
    const method = editando ? "PUT" : "POST";
    const url = editando ? `/api/grupo/${editando}` : "/api/grupo";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos)
    });
    cerrarModal();
    cargarGrupos();
  };

  cargarGrupos();
});
