document.addEventListener("DOMContentLoaded", async () => {
  // 👤 Cargar nombre de usuario (si existe)
  const username = localStorage.getItem("username");
  if (username) {
    console.log(`Bienvenido ${username}`);
  }

  // 🧮 Cargar estadísticas del dashboard
  await cargarEstadisticas();
});

async function cargarEstadisticas() {
  try {
    // Ejemplo: traer desde API (luego lo conectamos a Supabase)
    const data = await fetch("/api/dashboard/resumen").then(res => res.json());

    actualizarCard("externos", data.externos);
    actualizarCard("dota", data.dota);
    actualizarTotales(data.totales);
  } catch (err) {
    console.error("Error cargando estadísticas:", err);
  }
}

function actualizarCard(tipo, valores) {
  document.getElementById(`vigentes-${tipo}`).textContent = valores.vigentes;
  document.getElementById(`garantias-${tipo}`).textContent = valores.garantias;
  document.getElementById(`vencidos-${tipo}`).textContent = valores.vencidos;
  document.getElementById(`badge-${tipo}`).textContent =
    valores.vigentes + valores.garantias + valores.vencidos;
}

function actualizarTotales(valores) {
  document.getElementById("total-vigentes").textContent = valores.vigentes;
  document.getElementById("total-garantias").textContent = valores.garantias;
  document.getElementById("total-vencidos").textContent = valores.vencidos;
}
