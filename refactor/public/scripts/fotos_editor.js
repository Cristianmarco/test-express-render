// === Fotos de equipos (R.Vigentes, garantias, planilla diaria) ===
// Script global (se carga en main.ejs): lo usan licitaciones.js y planilla.js, que se
// cargan recien al abrir su vista.
// Se achican en el navegador antes de subirlas: una foto de celular (4-8 MB) queda en
// ~300 KB, suficiente para ver el estado del equipo.
const VIG_MAX_FOTOS = 10;
const VIG_FOTO_LADO = 1600;
const VIG_FOTO_CALIDAD = 0.82;
// Miniatura para la columna "Foto" de la tabla (~8 KB)
const VIG_MINI_LADO = 160;
// Devuelve { data, mini }: la foto achicada y su miniatura, en JPEG
function achicarFotoVigente(file){
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // El navegador ya aplica la orientacion de la foto del celular (EXIF)
      const aJpeg = (lado, calidad) => {
        const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * escala);
        c.height = Math.round(img.naturalHeight * escala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', calidad);
      };
      const data = aJpeg(VIG_FOTO_LADO, VIG_FOTO_CALIDAD);
      const mini = aJpeg(VIG_MINI_LADO, 0.75);
      URL.revokeObjectURL(url);
      ok({ data, mini });
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error(`${file.name}: no es una imagen válida`)); };
    img.src = url;
  });
}

// Editor de fotos de un formulario (R.Vigentes, garantias, planilla). Los elementos se
// buscan por prefijo: <prefijo>-fotos (contenedor), <prefijo>-fotos-camara / -archivo
// (botones) y <prefijo>-fotos-input-camara / -archivo (inputs ocultos).
// Las fotos nuevas se suben, y las quitadas se borran, recien al guardar el registro.
// api: la ruta del registro; cargar() y guardar() pueden recibir otra (la planilla guarda
// las fotos en la garantia que corresponda, que recien se conoce al guardar).
function crearEditorFotos({ prefijo, api: apiBase }) {
  let api = apiBase;
  const $ = (sufijo) => document.getElementById(`${prefijo}-fotos${sufijo}`);
  // Las ya guardadas, las nuevas (sin subir: { data, mini }) y las quitadas
  let estado = { existentes: [], nuevas: [], borrar: new Set() };
  const cantidad = () => estado.existentes.filter(f => !estado.borrar.has(f.id)).length + estado.nuevas.length;

  function pintar(){
    const cont = $('');
    if (!cont) return;
    const visibles = [
      ...estado.existentes.filter(f => !estado.borrar.has(f.id)).map(f => ({ src: f.url, tipo: 'existente', id: f.id })),
      ...estado.nuevas.map((f, i) => ({ src: f.data, tipo: 'nueva', id: i }))
    ];
    cont.innerHTML = visibles.length
      ? visibles.map(f => `
          <div class="vig-foto${f.tipo === 'nueva' ? ' nueva' : ''}">
            <img src="${f.src}" alt="Foto del equipo">
            <button type="button" class="vig-foto-quitar" data-tipo="${f.tipo}" data-id="${f.id}" title="Quitar foto">&times;</button>
            ${f.tipo === 'nueva' ? '<span class="vig-foto-etiqueta">Sin guardar</span>' : ''}
          </div>`).join('')
      : '<div class="vig-fotos-vacio">Sin fotos</div>';
    ['-camara', '-archivo'].forEach(s => { const b = $(s); if (b) b.disabled = cantidad() >= VIG_MAX_FOTOS; });
  }

  function bind(){
    const agregar = async (input) => {
      const archivos = Array.from(input.files || []);
      input.value = '';
      const libres = VIG_MAX_FOTOS - cantidad();
      if (archivos.length > libres) alert(`Se pueden cargar hasta ${VIG_MAX_FOTOS} fotos por equipo: se agregan ${Math.max(libres, 0)}.`);
      for (const file of archivos.slice(0, Math.max(libres, 0))) {
        try { estado.nuevas.push(await achicarFotoVigente(file)); }
        catch (e) { alert(e.message); }
      }
      pintar();
    };
    const inCam = $('-input-camara');
    const inArch = $('-input-archivo');
    if (!inCam || inCam._bound) return;
    inCam._bound = true;
    $('-camara').addEventListener('click', () => inCam.click());
    $('-archivo').addEventListener('click', () => inArch.click());
    inCam.addEventListener('change', () => agregar(inCam));
    inArch.addEventListener('change', () => agregar(inArch));
    $('').addEventListener('click', (e) => {
      const b = e.target.closest('.vig-foto-quitar');
      if (b) {
        if (b.dataset.tipo === 'nueva') estado.nuevas.splice(Number(b.dataset.id), 1);
        else estado.borrar.add(Number(b.dataset.id));
        pintar();
        return;
      }
      const img = e.target.closest('.vig-foto img');
      if (img) window.open(img.src, '_blank');
    });
  }

  async function cargar(id, apiRegistro){
    api = apiRegistro || apiBase;
    estado = { existentes: [], nuevas: [], borrar: new Set() };
    pintar();
    if (!id) return;
    try {
      const r = await fetch(`${api}/${id}/fotos`, { credentials:'include' });
      const lista = await r.json();
      estado.existentes = Array.isArray(lista) ? lista : [];
    } catch (_) { /* sin fotos se puede editar igual */ }
    pintar();
  }

  // Sube las nuevas y borra las quitadas. Devuelve la lista de problemas (vacia si todo ok).
  async function guardar(id, boton, apiRegistro){
    if (apiRegistro) api = apiRegistro;
    const fallas = [];
    if (!id) return fallas;
    for (const fotoId of estado.borrar) {
      try {
        const r = await fetch(`${api}/${id}/fotos/${fotoId}`, { method:'DELETE', credentials:'include' });
        if (!r.ok) throw new Error();
      } catch (_) { fallas.push('No se pudo quitar una foto'); }
    }
    for (let i = 0; i < estado.nuevas.length; i++) {
      if (boton) boton.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Subiendo foto ${i + 1} de ${estado.nuevas.length}...`;
      try {
        const r = await fetch(`${api}/${id}/fotos`, {
          method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ data: estado.nuevas[i].data, miniatura: estado.nuevas[i].mini })
        });
        const js = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(js.error || 'Error');
      } catch (e) { fallas.push(`Foto ${i + 1}: ${e.message}`); }
    }
    return fallas;
  }

  // Hay fotos nuevas o quitadas sin guardar
  const hayCambios = () => estado.nuevas.length > 0 || estado.borrar.size > 0;

  return { bind, cargar, guardar, hayCambios };
}

// Bloque de fotos de un formulario (mismo marcado para todos los editores)
function bloqueFotosHtml(prefijo, titulo){
  return `
    <div class="vig-fotos-bloque">
      <label>${titulo} <small>(hasta ${VIG_MAX_FOTOS})</small></label>
      <div id="${prefijo}-fotos" class="vig-fotos"></div>
      <div class="vig-fotos-botones">
        <!-- En el celular "Tomar foto" abre la camara; en la PC los dos abren el explorador -->
        <button type="button" class="btn-secundario" id="${prefijo}-fotos-camara"><i class="fas fa-camera"></i> Tomar foto</button>
        <button type="button" class="btn-secundario" id="${prefijo}-fotos-archivo"><i class="fas fa-images"></i> Elegir archivos</button>
        <input type="file" id="${prefijo}-fotos-input-camara" accept="image/*" capture="environment" hidden />
        <input type="file" id="${prefijo}-fotos-input-archivo" accept="image/*" multiple hidden />
      </div>
    </div>`;
}
