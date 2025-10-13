// === ERP Refactor - Control dinámico de vistas y tabs ===

const mainContent = document.getElementById("main-content");
const tabsContainer = document.getElementById("tabs");
let openTabs = [];

async function loadView(view) {
  // Si ya existe, solo activarla
  const existing = openTabs.find(t => t.view === view);
  if (existing) return activateTab(view);

  // Crear pestaña
  const tab = document.createElement("button");
  tab.className = "tab";
  tab.textContent = view.charAt(0).toUpperCase() + view.slice(1);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.className = "tab-close";
  closeBtn.addEventListener("click", e => {
    e.stopPropagation();
    closeTab(view);
  });

  tab.appendChild(closeBtn);
  tab.addEventListener("click", () => activateTab(view));
  tabsContainer.appendChild(tab);
  openTabs.push({ view, tab });

  // Cargar contenido de la vista
  const res = await fetch(`/refactor/view/${view}`);
  const html = await res.text();

  const section = document.createElement("div");
  section.className = "tab-content";
  section.dataset.view = view;
  section.innerHTML = html;
  mainContent.appendChild(section);

  // Mostrar la pestaña
  activateTab(view);

  // 🔔 Avisar a otros scripts que una nueva vista fue cargada
  const event = new CustomEvent("view:changed", { detail: view });
  document.dispatchEvent(event);

  // Ejecutar el JS asociado si aplica
  ejecutarScriptVista(view);
} 

  // === Activar pestaña
  function activateTab(view) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => (c.style.display = "none"));

    const current = openTabs.find(t => t.view === view);
    if (current) current.tab.classList.add("active");

    const content = mainContent.querySelector(`.tab-content[data-view="${view}"]`);
    if (content) content.style.display = "block";
  }

  // === Cerrar pestaña
  function closeTab(view) {
    const idx = openTabs.findIndex(t => t.view === view);
    if (idx === -1) return;

    const { tab } = openTabs[idx];
    tab.remove();

    const content = mainContent.querySelector(`.tab-content[data-view="${view}"]`);
    if (content) content.remove();

    openTabs.splice(idx, 1);
    if (openTabs.length > 0) activateTab(openTabs[openTabs.length - 1].view);
    else mainContent.innerHTML = "";
  }

  // === Ejecutar JS específico según la vista cargada
  function ejecutarScriptVista(view) {
    console.log(`🚀 Ejecutando script para vista: ${view}`);

    switch (view) {
      case "planilla":
        cargarScript("/static/scripts/planilla.js");
        break;

      case "inicio":
        cargarScript("/static/scripts/inicio.js");
        break;

      // ⚡ Podés agregar más casos a medida que agregues vistas
      default:
        console.log(`ℹ️ No hay script específico para ${view}`);
    }
  }

  // === Cargar y ejecutar script externo
  function cargarScript(src) {
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    document.body.appendChild(script);
  }

  // === Eventos de menú
document.querySelectorAll(".menu-link").forEach(btn => {
  btn.addEventListener("click", e => {
    e.preventDefault();
    const view = btn.dataset.view;
    if (view) loadView(view);
  });
});

// === Cargar inicio automáticamente
document.addEventListener("DOMContentLoaded", () => loadView("inicio"));


