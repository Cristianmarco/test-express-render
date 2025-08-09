let familias = [];
let seleccionado = null;

document.addEventListener("DOMContentLoaded", () => {
  cargarFamilias();

  document.getElementById("form-familia").onsubmit = async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target).entries());
    const metodo = seleccionado ? "PATCH" : "POST";
    const url = seleccionado ? `/api/familia/${seleccionado.id}` : "/api/familia";

    const resp = await fetch(url, {
      method: metodo,
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
});

async function cargarFamilias() {
  const tbody = document.getElementById("tbody-familias");
  tbody.innerHTML = "<tr><td colspan='2'>Cargando...</td></tr>";
  const resp = await fetch("/api/familia");
  familias = await resp.json();
  tbody.innerHTML = "";
  familias.forEach(f => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${f.codigo}</td><td>${f.nombre}</td>`;
    tr.onclick = () => {
      document.querySelectorAll("#tbody-familias tr").forEach(r => r.classList.remove("seleccionado"));
      tr.classList.add("seleccionado");
      seleccionado = f;
    };
    tbody.appendChild(tr);
  });
}

function abrirModal() {
  seleccionado = null;
  document.getElementById("modal-titulo").textContent = "Nueva Familia";
  document.getElementById("form-familia").reset();
  document.getElementById("modal-familia").classList.add("mostrar");
}

function editarSeleccionado() {
  if (!seleccionado) return alert("Seleccione una familia");
  document.getElementById("modal-titulo").textContent = "Editar Familia";
  const form = document.getElementById("form-familia");
  form.codigo.value = seleccionado.codigo;
  form.nombre.value = seleccionado.nombre;
  document.getElementById("modal-familia").classList.add("mostrar");
}

function eliminarSeleccionado() {
  if (!seleccionado) return alert("Seleccione una familia");
  if (!confirm("¿Eliminar esta familia?")) return;
  fetch(`/api/familia/${seleccionado.id}`, { method: "DELETE" })
    .then(r => {
      if (r.ok) cargarFamilias();
      else alert("Error al eliminar");
    });
}

function cerrarModal() {
  document.getElementById("modal-familia").classList.remove("mostrar");
}
