document.addEventListener("DOMContentLoaded", () => {
    let tecnicoSeleccionado = null;
    let modoEdicion = false;

    // ==========================
    // Cargar técnicos
    // ==========================
    async function cargarTecnicos(seleccionarId = null) {
        const tbody = document.getElementById("tbody-tecnicos");
        tbody.innerHTML = '<tr><td colspan="4">Cargando...</td></tr>';
        try {
            const res = await fetch("/api/tecnicos", { credentials: "include" });
            const tecnicos = await res.json();

            document.getElementById("total-tecnicos").textContent = tecnicos.length;
            tbody.innerHTML = "";

            tecnicos.forEach(t => {
                const tr = document.createElement("tr");
                tr.dataset.id = t.id;
                tr.innerHTML = `
          <td>${t.id}</td>
          <td>${t.nombre}</td>
          <td>${t.dni || "-"}</td>
          <td>${t.qr_code ? `<img src="${t.qr_code}" alt="QR" width="50">` : "-"}</td>
        `;

                tr.onclick = () => {
                    document.querySelectorAll("#tbody-tecnicos tr").forEach(x => x.classList.remove("seleccionado"));
                    tr.classList.add("seleccionado");
                    tecnicoSeleccionado = t;
                    mostrarFicha(t);
                };

                tbody.appendChild(tr);
            });

            // 👉 Si se pasa un ID, lo selecciona automáticamente
            if (seleccionarId) {
                const trSel = document.querySelector(`#tbody-tecnicos tr[data-id="${seleccionarId}"]`);
                if (trSel) {
                    trSel.classList.add("seleccionado");
                    const tecnico = tecnicos.find(t => t.id == seleccionarId);
                    if (tecnico) mostrarFicha(tecnico);
                    tecnicoSeleccionado = tecnico;
                }
            }

        } catch (err) {
            console.error(err);
            tbody.innerHTML = '<tr><td colspan="4">Error al cargar</td></tr>';
        }
    }

    // ==========================
    // Mostrar ficha lateral
    // ==========================
    function mostrarFicha(t) {
        document.getElementById("ficha-id").textContent = t.id;
        document.getElementById("ficha-nombre").textContent = t.nombre;
        document.getElementById("ficha-dni").textContent = t.dni || "-";

        const qrSection = document.getElementById("qr-ficha-section");
        const qrImgDiv = document.getElementById("ficha-qr-img");
        const linkDescargar = document.getElementById("link-descargar-qr");

        if (t.qr_code) {
            qrImgDiv.innerHTML = `<img src="${t.qr_code}" alt="QR Técnico" width="150">`;
            linkDescargar.href = t.qr_code;
            linkDescargar.download = `tecnico-${t.id}.png`;
            qrSection.style.display = "block";
        } else {
            qrImgDiv.innerHTML = "<p>No QR disponible</p>";
            qrSection.style.display = "none";
        }
    }

    // ==========================
    // Modal
    // ==========================
    function abrirModal(titulo) {
        document.getElementById("modal-titulo").textContent = titulo;
        document.getElementById("modal-tecnico").classList.add("mostrar");
    }

    window.cerrarModal = () => {
        document.getElementById("modal-tecnico").classList.remove("mostrar");
        document.getElementById("form-tecnico").reset();
        modoEdicion = false;
    };

    // ==========================
    // Botones
    // ==========================
    document.getElementById("btn-agregar").onclick = () => {
        modoEdicion = false;
        tecnicoSeleccionado = null;
        document.querySelectorAll("#tbody-tecnicos tr").forEach(x => x.classList.remove("seleccionado"));
        document.getElementById("form-tecnico").reset();
        abrirModal("Nuevo Técnico");
    };

    document.getElementById("btn-modificar").onclick = () => {
        if (!tecnicoSeleccionado) return alert("Selecciona un técnico primero");
        modoEdicion = true;
        const form = document.getElementById("form-tecnico");
        form.nombre.value = tecnicoSeleccionado.nombre;
        form.dni.value = tecnicoSeleccionado.dni || "";
        abrirModal("Editar Técnico");
    };

    document.getElementById("btn-eliminar").onclick = async () => {
        if (!tecnicoSeleccionado) return alert("Selecciona un técnico primero");
        if (!confirm(`¿Eliminar técnico ${tecnicoSeleccionado.nombre}?`)) return;

        try {
            const res = await fetch(`/api/tecnicos/${tecnicoSeleccionado.id}`, {
                method: "DELETE",
                credentials: "include"
            });
            if (!res.ok) throw new Error("Error al eliminar");
            alert("Técnico eliminado ✔");
            tecnicoSeleccionado = null;
            cargarTecnicos();
        } catch (err) {
            console.error(err);
            alert("Error al eliminar técnico");
        }
    };

    // ==========================
    // Guardar técnico (crear o editar)
    // ==========================
    document.getElementById("form-tecnico").onsubmit = async e => {
        e.preventDefault();
        const datos = Object.fromEntries(new FormData(e.target).entries());

        let url = "/api/tecnicos";
        let method = "POST";
        if (modoEdicion && tecnicoSeleccionado) {
            url = `/api/tecnicos/${tecnicoSeleccionado.id}`;
            method = "PUT";
        }

        try {
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(datos),
                credentials: "include"
            });

            if (!res.ok) throw new Error("Error al guardar técnico");

            const result = await res.json().catch(() => ({}));
            alert(modoEdicion ? "Técnico modificado ✔" : "Técnico agregado ✔");
            cerrarModal();

            // ✅ Si se agregó un técnico nuevo, lo selecciona automáticamente
            if (!modoEdicion && result.id) {
                await cargarTecnicos(result.id);
            } else {
                await cargarTecnicos(tecnicoSeleccionado ? tecnicoSeleccionado.id : null);
            }

        } catch (err) {
            console.error(err);
            alert("Error al guardar técnico");
        }
    };

    // ==========================
    // Inicial
    // ==========================
    cargarTecnicos();
});
