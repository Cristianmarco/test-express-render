// public/scripts/proveedores.js
document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("tbody-proveedores");
  const modal = document.getElementById("modal-proveedor");
  const form = document.getElementById("form-proveedor");
  const ficha = document.getElementById("detalle-proveedor"); // ficha lateral
  let editando = null;

  // === Abrir / cerrar modal ===
  function abrirModal(titulo, datos = null) {
    document.getElementById("modal-titulo").textContent = titulo;
    modal.classList.add("mostrar");
    if (datos) {
      for (const [key, value] of Object.entries(datos)) {
        if (form[key]) form[key].value = value || "";
      }
      editando = datos.id || datos.codigo;
    } else {
      form.reset();
      editando = null;
    }
  }

  function cerrarModal() {
    modal.classList.remove("mostrar");
    form.reset();
  }
  window.cerrarModal = cerrarModal;

  // === Cargar proveedores ===
  async function cargarProveedores() {
    try {
      const res = await fetch("/api/proveedores");
      if (!res.ok) throw new Error("Error al traer proveedores");
      const data = await res.json();

      tbody.innerHTML = "";
      if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#888;">Sin datos</td></tr>`;
      }

      data.forEach(p => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${p.codigo}</td>
          <td>${p.razon_social}</td>
          <td>${p.telefono || "-"}</td>
          <td>${p.email || "-"}</td>
          <td>${p.web ? `<a href="${p.web}" target="_blank">${p.web}</a>` : "-"}</td>
        `;

        tr.onclick = () => {
          // Marcar selección en tabla
          document.querySelectorAll("#tbody-proveedores tr").forEach(x => x.classList.remove("seleccionado"));
          tr.classList.add("seleccionado");

          // Actualizar ficha lateral
          if (ficha) {
            ficha.innerHTML = `
              <h3>Ficha del Proveedor</h3>
              <p><strong>Código:</strong> ${p.codigo}</p>
              <p><strong>Razón Social:</strong> ${p.razon_social}</p>
              <p><strong>Teléfono:</strong> ${p.telefono || "-"}</p>
              <p><strong>Email:</strong> ${p.email || "-"}</p>
              <p><strong>Web:</strong> ${p.web ? `<a href="${p.web}" target="_blank">${p.web}</a>` : "-"}</p>
            `;
          }
        };

        tbody.appendChild(tr);
      });

      const total = document.getElementById("total-proveedores");
      if (total) total.textContent = data.length;
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="5">Error al cargar</td></tr>`;
    }
  }

  // === Botones de acción ===
  document.getElementById("btn-agregar").onclick = () => abrirModal("Nuevo Proveedor");

  document.getElementById("btn-modificar").onclick = async () => {
    const sel = document.querySelector("#tbody-proveedores tr.seleccionado");
    if (!sel) return alert("Selecciona un proveedor");
    const codigo = sel.children[0].textContent;
    try {
      const res = await fetch(`/api/proveedores/${codigo}`);
      if (!res.ok) throw new Error("No se encontró el proveedor");
      const data = await res.json();
      abrirModal("Modificar Proveedor", data);
    } catch (e) {
      alert("Error al obtener datos del proveedor");
    }
  };

  document.getElementById("btn-eliminar").onclick = async () => {
    const sel = document.querySelector("#tbody-proveedores tr.seleccionado");
    if (!sel) return alert("Selecciona un proveedor");
    const codigo = sel.children[0].textContent;
    if (confirm("¿Eliminar proveedor?")) {
      await fetch(`/api/proveedores/${codigo}`, { method: "DELETE" });
      cargarProveedores();
      if (ficha) ficha.innerHTML = "<p>Selecciona un proveedor para ver su ficha</p>";
    }
  };

  // === Guardar proveedor (agregar/modificar) ===
  form.onsubmit = async e => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(form).entries());
    try {
      const method = editando ? "PUT" : "POST";
      const url = editando ? `/api/proveedores/${editando}` : "/api/proveedores";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      if (!res.ok) throw new Error("Error al guardar proveedor");
      cerrarModal();
      cargarProveedores();
    } catch (err) {
      alert("Error al guardar proveedor");
      console.error(err);
    }
  };

  // === Inicial ===
  cargarProveedores();
});
