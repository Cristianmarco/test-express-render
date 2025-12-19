document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("tbody-familias");
  const form = document.getElementById("form-familia");
  const categoriaSelect = document.getElementById("categoria_id");
  const tipoSelect = document.getElementById("tipo");
  let editando = null; // id de la fila en edicion

  async function cargarCategorias() {
    if (!categoriaSelect) return;
    try {
      const res = await fetch("/api/categoria", { credentials: "include" });
      if (!res.ok) throw new Error(`Error categorias ${res.status}`);
      const lista = await res.json();
      categoriaSelect.innerHTML = '<option value="">(Sin categoria)</option>';
      (Array.isArray(lista) ? lista : []).forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.codigo} - ${c.descripcion}`;
        categoriaSelect.appendChild(opt);
      });
    } catch (err) {
      console.error("Error cargando categorias:", err);
      categoriaSelect.innerHTML = '<option value="">(Sin categoria)</option>';
    }
  }

  function abrirModal(titulo, datos = null) {
    document.getElementById("modal-titulo").textContent = titulo;
    document.getElementById("modal-familia").classList.add("mostrar");
    if (datos) {
      form.codigo.value = datos.codigo;
      form.descripcion.value = datos.descripcion;
      if (categoriaSelect) categoriaSelect.value = datos.categoria_id || "";
      if (tipoSelect) tipoSelect.value = datos.tipo || "";
      editando = datos.id;
    } else {
      form.reset();
      if (categoriaSelect) categoriaSelect.value = "";
      if (tipoSelect) tipoSelect.value = "";
      editando = null;
    }
  }

  function cerrarModal() {
    document.getElementById("modal-familia").classList.remove("mostrar");
    form.reset();
    if (categoriaSelect) categoriaSelect.value = "";
    if (tipoSelect) tipoSelect.value = "";
    editando = null;
  }
  window.cerrarModal = cerrarModal;

  async function cargarFamilias() {
    try {
      const res = await fetch("/api/familias", { credentials: "include" });
      if (!res.ok) throw new Error(`Error al cargar familias: ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) {
        console.error("Respuesta inesperada:", data);
        return;
      }

      tbody.innerHTML = "";
      data.forEach(f => {
        const tr = document.createElement("tr");
        tr.dataset.id = f.id;
        tr.innerHTML = `
          <td>${f.codigo}</td>
          <td>${f.descripcion}</td>
          <td>${f.categoria || "-"}</td>
          <td>${f.tipo ? f.tipo.toUpperCase() : "-"}</td>
          <td class="acciones">
            <button class="editar" title="Editar"><i class="fas fa-edit"></i></button>
            <button class="eliminar" title="Eliminar"><i class="fas fa-trash"></i></button>
          </td>
        `;

        tr.onclick = () => {
          document.querySelectorAll("#tbody-familias tr").forEach(row => row.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");
        };

        tr.querySelector(".editar").onclick = e => {
          e.stopPropagation();
          abrirModal("Modificar Familia", f);
        };

        tr.querySelector(".eliminar").onclick = async e => {
          e.stopPropagation();
          if (!confirm("Eliminar familia?")) return;
          const resp = await fetch(`/api/familias/${f.id}`, { method: "DELETE", credentials: "include" });
          if (resp.ok) {
            cargarFamilias();
          } else {
            alert("Error al eliminar familia");
          }
        };

        tbody.appendChild(tr);
      });

      if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#888;">Sin datos</td></tr>`;
      }
    } catch (err) {
      console.error("Error en cargarFamilias:", err);
    }
  }

  const btnAgregar = document.querySelector(".icon-button-erp.agregar");
  if (btnAgregar) btnAgregar.onclick = () => abrirModal("Nueva Familia");

  form.onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());
    if (categoriaSelect) datos.categoria_id = categoriaSelect.value || "";
    if (tipoSelect) datos.tipo = tipoSelect.value || "";
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

  cargarCategorias().then(cargarFamilias);

  const btnCerrar = document.getElementById("cerrar-modal-familia");
  if (btnCerrar) btnCerrar.onclick = cerrarModal;
});
