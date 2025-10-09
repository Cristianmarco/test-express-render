// === PLANILLA DIARIA (Refactor ERP) ===
console.log("✅ planilla.js ejecutado");

// Esperar a que los elementos del DOM de la planilla existan
function iniciarPlanilla() {
  const calendarGrid = document.getElementById("calendarGrid");
  const calendarTitle = document.getElementById("calendarTitle");
  const prevMonthBtn = document.getElementById("prevMonth");
  const nextMonthBtn = document.getElementById("nextMonth");
  const modalPlanilla = document.getElementById("modal-planilla");
  const fechaPlanillaSpan = document.getElementById("fecha-planilla");
  const tbodyReparaciones = document.getElementById("tbody-reparaciones");

  if (!calendarGrid || !calendarTitle) {
    console.warn("⏳ Esperando que la vista Planilla esté lista...");
    setTimeout(iniciarPlanilla, 200);
    return;
  }

  console.log("🗓️ Iniciando Planilla Diaria...");

  let currentDate = new Date();

  // === Renderizar calendario ===
  function renderCalendar(date) {
    if (!calendarGrid || !calendarTitle) return;

    const year = date.getFullYear();
    const month = date.getMonth();

    const monthNames = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];

    calendarTitle.textContent = `${monthNames[month]} de ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startDay = firstDay.getDay();
    if (startDay === 0) startDay = 7;

    calendarGrid.innerHTML = "";

    // Espacios vacíos
    for (let i = 1; i < startDay; i++) {
      const empty = document.createElement("div");
      empty.classList.add("day", "empty");
      calendarGrid.appendChild(empty);
    }

    // Días del mes
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const cell = document.createElement("div");
      cell.classList.add("day");
      cell.textContent = d;

      const today = new Date();
      if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
        cell.classList.add("today");
      }

      cell.addEventListener("click", () => abrirModalPlanilla(`${d}/${month + 1}/${year}`));
      calendarGrid.appendChild(cell);
    }
  }

  // === Modal principal ===
  function abrirModalPlanilla(fecha) {
    if (!modalPlanilla) return;

    modalPlanilla.style.display = "flex";
    fechaPlanillaSpan.textContent = fecha;

    // Simulación de datos
    const reparacionesDummy = [
      { cliente: "Dota", id: "R-1023", coche: "321", equipo: "Alternador", tecnico: "Carlos", garantia: "No", obs: "-" },
      { cliente: "Externo", id: "R-1024", coche: "100", equipo: "Arranque", tecnico: "Lucas", garantia: "Sí", obs: "Cambió relé" }
    ];

    tbodyReparaciones.innerHTML = reparacionesDummy.map(rep => `
      <tr>
        <td>${rep.cliente}</td>
        <td>${rep.id}</td>
        <td>${rep.coche}</td>
        <td>${rep.equipo}</td>
        <td>${rep.tecnico}</td>
        <td>${rep.garantia}</td>
        <td>${rep.obs}</td>
      </tr>
    `).join("");
  }

  function cerrarModalPlanilla() {
    modalPlanilla.style.display = "none";
  }

  // === Navegación entre meses ===
  prevMonthBtn.addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar(currentDate);
  });

  nextMonthBtn.addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar(currentDate);
  });

  // === Inicializar calendario ===
  renderCalendar(currentDate);
  window.cerrarModalPlanilla = cerrarModalPlanilla;
}

// Ejecutar cuando se carga dinámicamente
setTimeout(iniciarPlanilla, 300);
