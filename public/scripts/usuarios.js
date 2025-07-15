let usuarios = [];
let usuarioSeleccionado = null;

// --- Helper para fetch autenticado ---
function fetchAuth(url, options = {}) {
  const user = localStorage.getItem('username');
  const role = localStorage.getItem('rol');
  options.headers = {
    ...(options.headers || {}),
    'x-user': user,
    'x-role': role,
    'Content-Type': 'application/json',
  };
  return fetch(url, options);
}

// ========== CLIENTES SELECT HELPERS ==========
// Llena un select (por id de DIV contenedor) con las opciones de clientes, preseleccionando uno si corresponde
async function llenarSelectClientesDesdeAPI(idDiv, selected = "") {
  try {
    const res = await fetch('/api/clientes');
    if (!res.ok) throw new Error('No se pudieron cargar clientes');
    const clientes = await res.json();
    const div = document.getElementById(idDiv);
    if (div) {
      div.innerHTML = `
        <select name="cliente" required>
          <option value="">Seleccione cliente</option>
          ${clientes.map(
        c => `<option value="${c.codigo}" ${selected === c.codigo ? 'selected' : ''}>${c.fantasia || c.razonSocial || c.codigo}</option>`
      ).join('')}
        </select>
      `;
    }
  } catch (err) {
    console.error("Error llenando clientes:", err);
  }
}


// Muestra/oculta el select de cliente en el modal agregar
function toggleClienteSelect(rol) {
  const selectDiv = document.getElementById('select-cliente-agregar');
  if (rol === "cliente") {
    selectDiv.style.display = "block";
    llenarSelectClientesDesdeAPI('select-cliente-agregar');
  } else {
    selectDiv.style.display = "none";
    selectDiv.innerHTML = "";
  }
}

// Muestra/oculta y selecciona el cliente correcto en modal modificar
function toggleClienteSelectEdit(rol, selectedCliente = "") {
  const selectDiv = document.getElementById('select-cliente-modificar');
  if (rol === "cliente") {
    selectDiv.style.display = "block";
    llenarSelectClientesDesdeAPI('select-cliente-modificar', selectedCliente);
  } else {
    selectDiv.style.display = "none";
    selectDiv.innerHTML = "";
  }
}

// ========== DOM READY ==========
document.addEventListener("DOMContentLoaded", async () => {
  const rol = localStorage.getItem('rol');
  if (!rol || rol.toLowerCase() !== 'admin') {
    window.location.href = '/reparaciones-vigentes';
    return;
  }

  await cargarUsuarios();

  // AGREGAR USUARIO
  document.getElementById("form-agregar-usuario").onsubmit = async e => {
    e.preventDefault();
    await agregarUsuario();
  };

  // MODIFICAR USUARIO
  document.getElementById("form-modificar-usuario").onsubmit = async e => {
    e.preventDefault();
    await modificarUsuario();
  };

  // Evento mostrar/ocultar select cliente (agregar)
  document.querySelector("#form-agregar-usuario select[name='rol']").addEventListener('change', e => {
    toggleClienteSelect(e.target.value);
  });

  // Evento mostrar/ocultar select cliente (modificar)
  document.querySelector("#form-modificar-usuario select[name='rol']").addEventListener('change', e => {
    toggleClienteSelectEdit(e.target.value);
  });
});

async function cargarUsuarios() {
  try {
    const res = await fetchAuth("/api/usuarios");
    usuarios = await res.json();

    const tbody = document.getElementById("usuarios-tbody");
    tbody.innerHTML = "";

    usuarios.forEach((usuario, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${usuario.email}</td>
        <td>${usuario.rol}</td>
        <td>${usuario.cliente || ''}</td>
      `;
      tr.addEventListener("click", () => seleccionarFila(i));
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error al cargar usuarios:", err);
  }
}

function seleccionarFila(index) {
  const filas = document.querySelectorAll("#usuarios-tbody tr");
  filas.forEach(f => f.classList.remove("seleccionado"));
  filas[index].classList.add("seleccionado");
  usuarioSeleccionado = usuarios[index];
}

function abrirModalAgregarUsuario() {
  document.getElementById("form-agregar-usuario").reset();
  document.getElementById("modal-agregar-usuario").style.display = "flex";
  toggleClienteSelect(""); // Oculta select cliente al abrir
}

function cerrarModalAgregarUsuario() {
  document.getElementById("modal-agregar-usuario").style.display = "none";
}

function abrirModalModificarUsuario() {
  if (!usuarioSeleccionado) {
    alert("Selecciona un usuario.");
    return;
  }
  const form = document.getElementById("form-modificar-usuario");
  form.email.value = usuarioSeleccionado.email;
  form.rol.value = usuarioSeleccionado.rol;
  toggleClienteSelectEdit(usuarioSeleccionado.rol, usuarioSeleccionado.cliente || "");
  document.getElementById("modal-modificar-usuario").style.display = "flex";
}

function cerrarModalModificarUsuario() {
  document.getElementById("modal-modificar-usuario").style.display = "none";
}

async function agregarUsuario() {
  const form = document.getElementById("form-agregar-usuario");
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.rol === "cliente") {
    const clienteSelect = document.querySelector('#select-cliente-agregar select[name="cliente"]');
    if (!clienteSelect || !clienteSelect.value) {
      alert("Debe seleccionar un cliente.");
      return;
    }
    data.cliente = clienteSelect.value;
  }
  const res = await fetchAuth("/api/usuarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    alert(error.error || "Error al agregar usuario.");
    return;
  }

  cerrarModalAgregarUsuario();
  await cargarUsuarios();
}

async function modificarUsuario() {
  const form = document.getElementById("form-modificar-usuario");
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.rol === "cliente") {
    const cliente = document.querySelector('#select-cliente-modificar select[name="cliente"]').value;
    if (!cliente) {
      alert("Debe seleccionar un cliente.");
      return;
    }
    data.cliente = cliente;
  }

  const res = await fetchAuth(`/api/usuarios/${usuarioSeleccionado.email}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    alert(error.error || "Error al modificar usuario.");
    return;
  }

  cerrarModalModificarUsuario();
  await cargarUsuarios();
}

async function eliminarUsuario() {
  if (!usuarioSeleccionado) {
    alert("Selecciona un usuario para eliminar.");
    return;
  }

  if (!confirm(`¿Eliminar a ${usuarioSeleccionado.email}?`)) return;

  const res = await fetchAuth(`/api/usuarios/${usuarioSeleccionado.email}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const error = await res.json();
    alert(error.error || "Error al eliminar usuario.");
    return;
  }

  usuarioSeleccionado = null;
  await cargarUsuarios();
}

function togglePassword(inputId, iconSpan) {
  const input = document.getElementById(inputId);
  if (!input) return; // no existe el input
  let icon = iconSpan.querySelector('i');
  if (!icon) {
    // si no encuentra <i>, lo agrega
    icon = document.createElement('i');
    icon.className = 'fa fa-eye';
    iconSpan.appendChild(icon);
  }
  if (input.type === "password") {
    input.type = "text";
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    input.type = "password";
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}


