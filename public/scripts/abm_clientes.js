// ======= [ABM CLIENTES CON API - PERSISTENCIA EN clientes.json] =======

// Cargar Clientes al iniciar la página
document.addEventListener('DOMContentLoaded', cargarClientes);

document.addEventListener('DOMContentLoaded', () => {
  const rol = localStorage.getItem('rol');
  if (rol && rol.toLowerCase() === 'cliente' && !window.location.pathname.includes('reparaciones-vigentes')) {
    window.location.href = '/reparaciones-vigentes';
  }
});


async function cargarClientes() {
    try {
        const response = await fetch('/api/clientes');
        const clientes = await response.json();
        console.log("CLIENTES DESDE API:", clientes); // <-- ACA
        renderizarClientes(clientes);
    } catch (error) {
        console.error('Error al cargar clientes:', error);
    }
}


function renderizarClientes(clientes = []) {
    const tbody = document.getElementById("clientes-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    clientes.forEach((cliente, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td data-label="Código">${cliente.codigo || ''}</td>
            <td data-label="Razón Social">${cliente.razonSocial || ''}</td>
            <td data-label="Nombre de Fantasía">${cliente.fantasia || ''}</td>
            <td data-label="Domicilio">${cliente.domicilio || ''}</td>
            <td data-label="Localidad">${cliente.localidad || ''}</td>
            <td data-label="Provincia">${cliente.provincia || ''}</td>
            <td data-label="Teléfono">${cliente.telefono || ''}</td>
            <td data-label="Mail">${cliente.mail || ''}</td>
            <td data-label="DNI/CUIT">${cliente.documento || ''}</td>
        `;

        row.addEventListener("click", () => seleccionarFila(index, "clientes-tbody"));

        tbody.appendChild(row);
    });
}


function seleccionarFila(index, tbodyId = "clientes-tbody") {
    const filas = document.querySelectorAll(`#${tbodyId} tr`);
    filas.forEach(f => f.classList.remove("seleccionado"));
    filas[index].classList.add("seleccionado");
}

function obtenerClienteSeleccionado() {
    const filas = document.querySelectorAll(".tabla-clientes tbody tr");
    let index = -1;
    filas.forEach((fila, i) => {
        if (fila.classList.contains("seleccionado")) index = i;
    });
    if (index === -1) {
        alert("Selecciona un cliente primero.");
        return null;
    }
    const row = filas[index].querySelectorAll("td");
    return {
        codigo: row[0].innerText,
        razonSocial: row[1].innerText,
        fantasia: row[2].innerText,
        domicilio: row[3].innerText,
        localidad: row[4].innerText,
        provincia: row[5].innerText,
        telefono: row[6].innerText,
        mail: row[7].innerText,
        documento: row[8].innerText,
    };
}

async function agregarCliente() {
    const form = document.getElementById("form-agregar");
    const formData = new FormData(form);
    const nuevoCliente = {};
    formData.forEach((value, key) => nuevoCliente[key] = value);

    // Validar código duplicado (del lado del cliente)
    const clientesExistentes = document.querySelectorAll("#clientes-tbody tr");
    for (const row of clientesExistentes) {
        const codigoExistente = row.children[0].innerText.trim();
        if (codigoExistente === nuevoCliente.codigo.trim()) {
            alert(`El código ${nuevoCliente.codigo} ya existe. Por favor ingresa uno diferente.`);
            return;
        }
    }

    try {
        const response = await fetch('/api/clientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nuevoCliente),
        });

        if (!response.ok) {
            const error = await response.json();
            alert(error.error || 'Error al agregar cliente.');
            return;
        }

        cerrarModalAgregar();
        cargarClientes();
        form.reset();
    } catch (error) {
        console.error('Error al agregar cliente:', error);
    }
}


async function modificarCliente() {
    const cliente = obtenerClienteSeleccionado();
    if (!cliente) return;

    const form = document.getElementById("form-modificar");
    const formData = new FormData(form);
    const datosActualizados = {};
    formData.forEach((value, key) => datosActualizados[key] = value);

    try {
        const response = await fetch(`/api/clientes/${cliente.codigo}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datosActualizados),
        });

        if (!response.ok) {
            const error = await response.json();
            alert(error.error || 'Error al modificar cliente.');
            return;
        }

        cerrarModalModificar();
        cargarClientes();
    } catch (error) {
        console.error('Error al modificar cliente:', error);
    }
}

async function eliminarCliente() {
    const cliente = obtenerClienteSeleccionado();
    if (!cliente) return;

    if (!confirm(`¿Seguro que deseas eliminar al cliente "${cliente.razonSocial}"?`)) return;

    try {
        const response = await fetch(`/api/clientes/${cliente.codigo}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            alert(error.error || 'Error al eliminar cliente.');
            return;
        }

        cargarClientes();
    } catch (error) {
        console.error('Error al eliminar cliente:', error);
    }
}

// Modales
function abrirModalAgregar() {
    document.getElementById("modal-agregar").style.display = "flex";
}

function cerrarModalAgregar() {
    document.getElementById("modal-agregar").style.display = "none";
}

function abrirModalModificar() {
    const cliente = obtenerClienteSeleccionado();
    if (!cliente) return;

    const form = document.getElementById("form-modificar");
    Object.keys(cliente).forEach(key => {
        if (form.elements[key]) {
            form.elements[key].value = cliente[key];
        }
    });

    document.getElementById("modal-modificar").style.display = "flex";
}

function cerrarModalModificar() {
    document.getElementById("modal-modificar").style.display = "none";
}

function visualizarCliente() {
    const cliente = obtenerClienteSeleccionado();
    if (!cliente) return;

    const contenedor = document.getElementById("datos-cliente");
    contenedor.innerHTML = "";

    Object.entries(cliente).forEach(([key, value]) => {
        const p = document.createElement("p");
        p.textContent = `${formatearCampo(key)}: ${value}`;
        contenedor.appendChild(p);
    });

    document.getElementById("modal-visualizar").classList.add("mostrar");
}

function cerrarModalVisualizar() {
    document.getElementById("modal-visualizar").classList.remove("mostrar");
}

function formatearCampo(campo) {
    const nombres = {
        codigo: "Código",
        razonSocial: "Razón Social",
        fantasia: "Nombre de Fantasía",
        domicilio: "Domicilio",
        localidad: "Localidad",
        provincia: "Provincia",
        telefono: "Teléfono",
        mail: "Mail",
        documento: "DNI/CUIT"
    };
    return nombres[campo] || campo;
}

const formAgregar = document.getElementById("form-agregar");
if (formAgregar) {
    formAgregar.addEventListener("submit", function (e) {
        e.preventDefault();
        agregarCliente();
    });
}

const formModificar = document.getElementById("form-modificar");
if (formModificar) {
    formModificar.addEventListener("submit", function (e) {
        e.preventDefault();
        modificarCliente();
    });
}

