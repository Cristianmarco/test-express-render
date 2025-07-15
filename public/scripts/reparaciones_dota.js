// Ejemplo de datos. Reemplazá esto por fetch('/api/reparaciones-dota')
let reparaciones = [
  {
    id: 1,
    nro_pedido: "PD-001",
    codigo: "ALT-568",
    descripcion: "Alternador 80A",
    cantidad: 5,
    destino: "Taller Central",
    razon_social: "Dota S.A.",
    entrega_parcial: 2 // cargá desde DB
  },
  {
    id: 2,
    nro_pedido: "PD-002",
    codigo: "BOM-104",
    descripcion: "Bomba de agua",
    cantidad: 3,
    destino: "Sucursal Norte",
    razon_social: "Sutrans",
    entrega_parcial: 3
  }
];

function renderReparacionesDota() {
  const tbody = document.getElementById("tbody-reparaciones-dota");
  tbody.innerHTML = '';
  reparaciones.forEach(rep => {
    const pendientes = Math.max(rep.cantidad - rep.entrega_parcial, 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${rep.nro_pedido || ''}</td>
      <td>${rep.codigo}</td>
      <td>${rep.descripcion}</td>
      <td>${rep.cantidad}</td>
      <td>${rep.destino || ''}</td>
      <td>${rep.razon_social || ''}</td>
      <td>
        <input type="number" min="0" max="${rep.cantidad}" value="${rep.entrega_parcial || 0}" 
          style="width:70px" data-id="${rep.id}" onchange="actualizarEntregaParcial(${rep.id}, this.value)">
      </td>
      <td>
        ${pendientes === 0 
          ? `<span class="badge badge-entregado">Entregado</span>`
          : `<span>${pendientes}</span>`
        }
      </td>
      <!-- QUITADO el noveno <td> -->
    `;
    tbody.appendChild(tr);
  });
}


// Simula actualización en DB y refresca tabla
function actualizarEntregaParcial(id, value) {
  const rep = reparaciones.find(r => r.id === id);
  if (!rep) return;
  const val = Math.max(0, Math.min(Number(value), rep.cantidad));
  rep.entrega_parcial = val;
  renderReparacionesDota();
}

// Simula guardar en backend (acá pondrías tu fetch/PUT)
function guardarEntregaParcial(id) {
  const rep = reparaciones.find(r => r.id === id);
  if (!rep) return;
  // fetch('/api/reparaciones-dota/'+id, {method:'PUT', ...})
  alert(`Entrega parcial de "${rep.descripcion}" actualizada a ${rep.entrega_parcial}`);
}

// Exponer para HTML inline
window.actualizarEntregaParcial = actualizarEntregaParcial;
window.guardarEntregaParcial = guardarEntregaParcial;

// Cargar tabla al iniciar
document.addEventListener("DOMContentLoaded", renderReparacionesDota);

async function cargarReparacionesDota() {
  const tbody = document.getElementById('tbody-reparaciones-dota');
  tbody.innerHTML = '<tr><td colspan="9">Cargando...</td></tr>';
  try {
    const resp = await fetch('/api/reparaciones_dota');
    const reparaciones = await resp.json();
    if (!Array.isArray(reparaciones) || !reparaciones.length) {
      tbody.innerHTML = '<tr><td colspan="9">Sin registros</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    for (const rep of reparaciones) {
      const pendientes = rep.pendientes ?? rep.cantidad;
      const entregado = pendientes <= 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${rep.nro_pedido || ''}</td>
        <td>${rep.codigo}</td>
        <td>${rep.descripcion}</td>
        <td>${rep.cantidad}</td>
        <td>${rep.destino || ''}</td>
        <td>${rep.razon_social || ''}</td>
        <td>
          <input type="number" value="0" min="0" max="${pendientes}" 
                 style="width:70px;" 
                 ${entregado ? 'disabled' : ''}>
          <button class="btn-entregar" style="margin-left:7px;" ${entregado ? 'disabled' : ''}>✔</button>
        </td>
        <td class="celda-pendientes">${entregado ? '<span class="entregado">Entregado</span>' : pendientes}</td>
      `;
      // Manejar entrega parcial
      setTimeout(() => {
        const input = tr.querySelector('input[type=number]');
        const btn = tr.querySelector('.btn-entregar');
        const celdaPendientes = tr.querySelector('.celda-pendientes');
        if (input && btn) {
          btn.onclick = async () => {
            let valor = parseInt(input.value, 10);
            if (isNaN(valor) || valor <= 0) return;
            let nuevoPendientes = pendientes - valor;
            if (nuevoPendientes < 0) nuevoPendientes = 0;

            // OPCIONAL: Actualizar en la base de datos (PUT/PATCH)
            await fetch(`/api/reparaciones_dota/${rep.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pendientes: nuevoPendientes })
            });

            // Refresca tabla
            cargarReparacionesDota();
          };
        }
      }, 100);
      tbody.appendChild(tr);
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9">Error al cargar reparaciones</td></tr>';
  }
}

// Llamá la función al cargar la página
document.addEventListener('DOMContentLoaded', cargarReparacionesDota);
