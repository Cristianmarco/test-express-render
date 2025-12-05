(function () {
  let host;
  let listView, detailView, backBtn;
  let grid, searchInput, filtroCat, filtroEstado, countBadge, btnRecargar;
  let tabs, tabPanels, mediaList, mediaForm, repuestosBody, repuestoForm, productosDatalist, productoInput;
  let mediaFileInput, mediaBrowseBtn, portadaFileInput, portadaBrowseBtn;
  let slidesWrap, dotsWrap, btnPrev, btnNext;
  let formFichaBasica, modalFicha, modalClose, btnEditarFicha;
  let fotoFileInput, fotoBrowseBtn, fotoUrlInput;
  let modalMedia, modalMediaClose, mediaConfigList, mediaConfigBtn;

  const state = {
    listado: [],
    detalle: null,
    productos: [],
    slideIndex: 0
  };

  function init() {
    host = document.querySelector('.tab-content[data-view="fichas"]');
    if (!host || host.dataset.fichasReady) return;
    host.dataset.fichasReady = '1';

    listView = host.querySelector('#fichas-list-view');
    detailView = host.querySelector('#ficha-detail-view');
    backBtn = host.querySelector('#ficha-volver');

    grid = host.querySelector('#fichas-grid');
    searchInput = host.querySelector('#fichas-buscar');
    filtroCat = host.querySelector('#fichas-categoria');
    filtroEstado = host.querySelector('#fichas-estado');
    countBadge = host.querySelector('#fichas-count');
    btnRecargar = host.querySelector('#fichas-recargar');

    tabs = Array.from(host.querySelectorAll('.ficha-tab'));
    tabPanels = Array.from(host.querySelectorAll('.ficha-tab-panel'));
    mediaList = host.querySelector('#ficha-media-list');
    mediaForm = host.querySelector('#ficha-media-form');
    repuestosBody = host.querySelector('#ficha-repuestos-body');
    repuestoForm = host.querySelector('#ficha-repuesto-form');
    productosDatalist = host.querySelector('#ficha-productos');
    productoInput = host.querySelector('#ficha-producto-input');
    mediaFileInput = host.querySelector('#ficha-media-file');
    mediaBrowseBtn = host.querySelector('#ficha-media-browse');
    portadaFileInput = host.querySelector('#ficha-portada-file');
    portadaBrowseBtn = host.querySelector('#ficha-portada-browse');
    slidesWrap = host.querySelector('#ficha-slides');
    dotsWrap = host.querySelector('#ficha-dots');
    btnPrev = host.querySelector('#slide-prev');
    btnNext = host.querySelector('#slide-next');

    modalFicha = host.querySelector('#modal-ficha-basica');
    modalClose = host.querySelector('#modal-ficha-close');
    formFichaBasica = host.querySelector('#form-ficha-basica');
    btnEditarFicha = host.querySelector('#btn-editar-ficha');
    fotoFileInput = host.querySelector('#ficha-foto-file');
    fotoBrowseBtn = host.querySelector('#ficha-foto-browse');
    fotoUrlInput = host.querySelector('#ficha-foto-url');
    modalMedia = host.querySelector('#modal-ficha-media');
    modalMediaClose = host.querySelector('#modal-ficha-media-close');
    mediaConfigList = host.querySelector('#ficha-media-config-list');
    mediaConfigBtn = host.querySelector('#ficha-media-config');

    bindEvents();
    cargarListado();
  }

  function bindEvents() {
    btnRecargar && (btnRecargar.onclick = () => cargarListado());
    searchInput && (searchInput.oninput = renderGrid);
    filtroCat && (filtroCat.onchange = renderGrid);
    filtroEstado && (filtroEstado.onchange = renderGrid);
    tabs.forEach(tab => tab.addEventListener('click', () => activarTab(tab.dataset.tab)));
    mediaForm && (mediaForm.onsubmit = agregarMedia);
    repuestoForm && (repuestoForm.onsubmit = agregarRepuesto);
    btnEditarFicha && (btnEditarFicha.onclick = abrirModalFicha);
    modalClose && (modalClose.onclick = () => (modalFicha.style.display = 'none'));
    formFichaBasica && (formFichaBasica.onsubmit = guardarFichaBasica);
    backBtn && (backBtn.onclick = () => mostrarListado());
    btnPrev && (btnPrev.onclick = () => moverSlide(-1));
    btnNext && (btnNext.onclick = () => moverSlide(1));
    window.addEventListener('click', (e) => { if (e.target === modalFicha) modalFicha.style.display = 'none'; });
    if (modalMediaClose) modalMediaClose.onclick = () => (modalMedia.style.display = 'none');
    window.addEventListener('click', (e) => { if (e.target === modalMedia) modalMedia.style.display = 'none'; });

    if (mediaBrowseBtn && mediaFileInput) {
      mediaBrowseBtn.onclick = () => mediaFileInput.click();
      mediaFileInput.onchange = async () => {
        if (!mediaFileInput.files || !mediaFileInput.files[0]) return;
        const urlInput = mediaForm?.querySelector('input[name="url"]');
        try {
          const url = await subirArchivo(mediaFileInput.files[0]);
          if (urlInput) urlInput.value = url;
        } catch (err) {
          alert(err.message || 'No se pudo subir el archivo');
        } finally {
          mediaFileInput.value = '';
        }
      };
    }
    if (mediaConfigBtn) {
      mediaConfigBtn.onclick = () => {
        if (!state.detalle?.media) return alert('Carga primero la ficha');
        renderMediaConfig(state.detalle.media);
        modalMedia.style.display = 'flex';
      };
    }
    if (portadaBrowseBtn && portadaFileInput) {
      portadaBrowseBtn.onclick = () => portadaFileInput.click();
      portadaFileInput.onchange = async () => {
        if (!portadaFileInput.files || !portadaFileInput.files[0]) return;
        const input = formFichaBasica?.elements['portada_url'];
        try {
          const url = await subirArchivo(portadaFileInput.files[0]);
          if (input) input.value = url;
        } catch (err) {
          alert(err.message || 'No se pudo subir la portada');
        } finally {
          portadaFileInput.value = '';
        }
      };
    }
    if (fotoBrowseBtn && fotoFileInput) {
      fotoBrowseBtn.onclick = () => fotoFileInput.click();
      fotoFileInput.onchange = async () => {
        if (!fotoFileInput.files || !fotoFileInput.files[0]) return;
        const familiaId = formFichaBasica?.elements['familia_id']?.value || state.detalle?.ficha?.familia_id;
        if (!familiaId) { alert('Selecciona una ficha antes de subir'); fotoFileInput.value = ''; return; }
        try {
          const url = await subirArchivo(fotoFileInput.files[0]);
          if (fotoUrlInput) fotoUrlInput.value = url;
          await agregarFotoCarrusel(familiaId, url);
          await cargarDetalle(familiaId);
        } catch (err) {
          alert(err.message || 'No se pudo subir la foto');
        } finally {
          fotoFileInput.value = '';
        }
      };
    }
  }

  async function cargarListado() {
    if (!grid) return;
    grid.innerHTML = `<div class="ficha-placeholder">Cargando fichas...</div>`;
    try {
      const res = await fetch('/api/fichas', { credentials: 'include' });
      const data = await res.json();
      state.listado = Array.isArray(data) ? data : [];
      poblarCategorias();
      renderGrid();
    } catch (err) {
      console.error('Error cargando fichas', err);
      grid.innerHTML = `<div class="ficha-placeholder">No se pudo cargar el listado</div>`;
    }
  }

  function poblarCategorias() {
    if (!filtroCat) return;
    const categorias = Array.from(new Set(state.listado.map(f => (f.categoria || '').trim()).filter(Boolean)));
    const current = filtroCat.value;
    filtroCat.innerHTML = '<option value="">Todas las categorias</option>';
    categorias.sort().forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      filtroCat.appendChild(opt);
    });
    filtroCat.value = current;
  }

  function aplicarFiltros() {
    const term = (searchInput?.value || '').toLowerCase();
    const cat = filtroCat?.value || '';
    const estado = filtroEstado?.value || '';
    return state.listado.filter(f => {
      const matchTerm = !term || [
        f.codigo_familia,
        f.familia,
        f.titulo,
        f.marca,
        f.id_original,
      ].some(v => (v || '').toLowerCase().includes(term));
      const matchCat = !cat || (f.categoria || '') === cat;
      const tieneFicha = !!(f.portada_url || f.descripcion_corta || f.id_original || f.marca || f.categoria || f.titulo);
      const matchEstado = !estado || (estado === 'con' ? tieneFicha : !tieneFicha);
      return matchTerm && matchCat && matchEstado;
    });
  }

  function renderGrid() {
    const items = aplicarFiltros();
    if (countBadge) countBadge.textContent = items.length;
    grid.innerHTML = '';
    if (!items.length) {
      grid.innerHTML = `<div class="ficha-placeholder">Sin resultados con el filtro actual</div>`;
      return;
    }
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'ficha-row';
      card.dataset.id = item.familia_id;
      if (state.detalle?.ficha?.familia_id === item.familia_id) card.classList.add('selected');

      const thumb = document.createElement('div');
      thumb.className = 'ficha-thumb-small';
      if (item.portada_url) {
        const img = document.createElement('img');
        img.src = item.portada_url;
        img.alt = item.titulo || item.familia || 'Portada';
        thumb.innerHTML = '';
        thumb.appendChild(img);
      } else {
        thumb.textContent = (item.titulo || item.familia || 'F').slice(0, 2).toUpperCase();
      }

      const body = document.createElement('div');
      body.className = 'ficha-row-body';
      const codeLine = document.createElement('div');
      codeLine.className = 'ficha-row-id';
      codeLine.textContent = `Codigo: ${item.codigo_familia || '-'}`;
      const sup = document.createElement('div');
      sup.className = 'ficha-row-sup';
      sup.textContent = `${item.marca || 'Sin marca'}${item.categoria ? ' - ' + item.categoria : ''}`;
      const title = document.createElement('h4');
      title.className = 'ficha-row-title';
      title.textContent = item.titulo || item.familia || 'Sin titulo';
      const id = document.createElement('div');
      id.className = 'ficha-row-id';
      id.textContent = `ID: ${item.id_original || '-'}`;
      body.appendChild(codeLine);
      body.appendChild(sup);
      body.appendChild(title);
      body.appendChild(id);

      card.appendChild(thumb);
      card.appendChild(body);
      card.addEventListener('click', () => cargarDetalle(item.familia_id));
      grid.appendChild(card);
    });
  }

  async function cargarDetalle(familiaId) {
    if (!familiaId) return;
    mostrarDetalle();
    try {
      const res = await fetch(`/api/fichas/${encodeURIComponent(familiaId)}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar la ficha');
      state.detalle = data;
      state.slideIndex = 0;
      renderDetalle();
      grid.querySelectorAll('.ficha-row').forEach(c => c.classList.toggle('selected', Number(c.dataset.id) === Number(familiaId)));
    } catch (err) {
      console.error(err);
      alert('No se pudo cargar la ficha');
    }
  }

  function mostrarListado() {
    listView.style.display = '';
    detailView.style.display = 'none';
    state.detalle = null;
  }
  function mostrarDetalle() {
    listView.style.display = 'none';
    detailView.style.display = '';
  }

  function setText(selector, value, fallback = '-') {
    const el = host.querySelector(selector);
    if (el) el.textContent = value && String(value).trim() ? value : fallback;
  }

  function setList(id, value) {
    const el = host.querySelector(`#${id}`);
    if (!el) return;
    const parts = String(value || '')
      .split(/[,;\n]/)
      .map(v => v.trim())
      .filter(Boolean);
    if (!parts.length) {
      el.innerHTML = '<span class="pill">-</span>';
      return;
    }
    el.innerHTML = parts.map(p => `<span class="pill">${escapeHtml(p)}</span>`).join(' ');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderDetalle() {
    const ficha = state.detalle?.ficha || {};
    const media = state.detalle?.media || [];
    const repuestos = state.detalle?.repuestos || [];

    setText('#ficha-titulo', ficha.titulo || ficha.familia || 'Sin titulo');
    setText('#info-codigo', ficha.codigo_familia);
    setText('#info-marca', ficha.marca || 'Sin marca');
    setText('#info-categoria', ficha.categoria || 'Sin categoria');
    setText('#ficha-voltaje', ficha.voltaje);
    setText('#ficha-amperaje', ficha.amperaje);
    setText('#info-updated', formatFecha(ficha.updated_at));
    setText('#ficha-observaciones', ficha.descripcion_corta || 'Sin observaciones');
    setList('info-id-list', ficha.id_original);
    setList('info-aplicaciones-list', ficha.aplicaciones);

    if (formFichaBasica) {
      formFichaBasica.elements['familia_id'].value = ficha.familia_id || '';
      formFichaBasica.elements['marca'].value = ficha.marca || '';
      formFichaBasica.elements['categoria'].value = ficha.categoria || '';
      formFichaBasica.elements['id_original'].value = ficha.id_original || '';
      formFichaBasica.elements['titulo'].value = ficha.titulo || '';
      formFichaBasica.elements['descripcion_corta'].value = ficha.descripcion_corta || '';
      formFichaBasica.elements['voltaje'].value = ficha.voltaje || '';
      formFichaBasica.elements['amperaje'].value = ficha.amperaje || '';
      formFichaBasica.elements['aplicaciones'].value = ficha.aplicaciones || '';
      formFichaBasica.elements['portada_url'].value = ficha.portada_url || '';
    }

    renderSlides(media, ficha);
    renderMedia(media);
    renderMediaConfig(media);
    renderRepuestos(repuestos);
  }

  function renderSlides(media, ficha) {
    const slides = [];
    if (ficha.portada_url) slides.push({ url: ficha.portada_url, titulo: ficha.titulo || ficha.familia });
    slides.push(...(media || []).filter(m => m.tipo === 'foto' || !m.tipo));
    if (!slides.length) {
      slidesWrap.innerHTML = `<div class="carousel-slide"><div class="ficha-placeholder" style="border:none;">Sin imagenes</div></div>`;
      dotsWrap.innerHTML = '';
      return;
    }
    slidesWrap.innerHTML = '';
    dotsWrap.innerHTML = '';
    slides.forEach((item, idx) => {
      const slide = document.createElement('div');
      slide.className = 'carousel-slide';
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.titulo || 'Foto';
      slide.appendChild(img);
      slidesWrap.appendChild(slide);

      const dot = document.createElement('button');
      dot.className = idx === state.slideIndex ? 'active' : '';
      dot.addEventListener('click', () => irASlide(idx));
      dotsWrap.appendChild(dot);
    });
    actualizarSlide();
  }

  function irASlide(idx) {
    const total = slidesWrap.children.length;
    if (!total) return;
    state.slideIndex = (idx + total) % total;
    actualizarSlide();
  }
  function moverSlide(delta) { irASlide(state.slideIndex + delta); }
  function actualizarSlide() {
    const total = slidesWrap.children.length;
    slidesWrap.style.transform = `translateX(-${state.slideIndex * 100}%)`;
    Array.from(dotsWrap.children).forEach((d, i) => d.classList.toggle('active', i === state.slideIndex));
  }

  function formatFecha(val) {
    if (!val) return '-';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return val;
      return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return val;
    }
  }

  function activarTab(tabName) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    tabPanels.forEach(p => p.style.display = p.dataset.tab === tabName ? 'block' : 'none');
    if (tabName === 'repuestos') ensureProductos();
  }

  async function agregarMedia(e) {
    e.preventDefault();
    if (!state.detalle?.ficha?.familia_id) return alert('Selecciona una ficha');
    const payload = Object.fromEntries(new FormData(mediaForm).entries());
    payload.orden = payload.orden === '' ? 0 : Number(payload.orden);
    try {
      const res = await fetch(`/api/fichas/${encodeURIComponent(state.detalle.ficha.familia_id)}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo agregar media');
      mediaForm.reset();
      await cargarDetalle(state.detalle.ficha.familia_id);
    } catch (err) {
      console.error(err);
      alert('No se pudo agregar el archivo');
    }
  }

  function renderMedia(list) {
    if (!mediaList) return;
    mediaList.innerHTML = '';
    // Mostrar solo despiece/plano. Usamos la primera disponible para la imagen principal.
    const items = Array.isArray(list) ? list.filter(m => m.tipo === 'despiece' || m.tipo === 'plano') : [];
    const img = host.querySelector('#despiece-img');
    if (img) {
      if (items[0]) {
        img.src = items[0].url;
        img.alt = items[0].titulo || 'Despiece';
      } else {
        img.src = '';
        img.alt = 'Sin despiece';
      }
    }
    // Ya no renderizamos cards aquí; la pestaña es solo imagen + lista fija a la derecha.
  }

  function renderMediaConfig(list) {
    if (!mediaConfigList) return;
    mediaConfigList.innerHTML = '';
    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
      mediaConfigList.innerHTML = `<div class="ficha-placeholder">Sin archivos</div>`;
      return;
    }
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'media-card';
      const header = document.createElement('div');
      header.className = 'media-header';
      const title = document.createElement('div');
      title.className = 'media-title';
      const labelTipo = item.tipo ? item.tipo.toUpperCase() : 'ARCHIVO';
      title.textContent = item.titulo || labelTipo;
      const actions = document.createElement('div');
      actions.className = 'media-actions';
      const del = document.createElement('button');
      del.title = 'Eliminar';
      del.innerHTML = '<i class="fas fa-trash"></i>';
      del.addEventListener('click', () => eliminarMedia(item.id));
      actions.appendChild(del);
      header.appendChild(title);
      header.appendChild(actions);

      const thumb = document.createElement('div');
      thumb.className = 'media-thumb';
      if (esImagen(item.url)) {
        thumb.style.backgroundImage = `url('${item.url}')`;
        thumb.textContent = '';
      } else {
        thumb.textContent = labelTipo;
      }
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.className = 'media-link';
      link.textContent = item.url;

      card.appendChild(header);
      card.appendChild(thumb);
      card.appendChild(link);
      mediaConfigList.appendChild(card);
    });
  }

  function esImagen(url) {
    return typeof url === 'string' && url.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  }

  async function eliminarMedia(id) {
    if (!state.detalle?.ficha?.familia_id) return;
    if (!confirm('Eliminar archivo?')) return;
    try {
      const res = await fetch(`/api/fichas/${encodeURIComponent(state.detalle.ficha.familia_id)}/media/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo eliminar');
      await cargarDetalle(state.detalle.ficha.familia_id);
      if (modalMedia && modalMedia.style.display === 'flex' && state.detalle?.media) {
        renderMediaConfig(state.detalle.media);
      }
    } catch (err) {
      console.error(err);
      alert('Error al eliminar archivo');
    }
  }

  async function ensureProductos() {
    if (state.productos.length) return;
    try {
      const res = await fetch('/api/productos', { credentials: 'include' });
      const data = await res.json();
      state.productos = Array.isArray(data) ? data : [];
      renderProductosDatalist();
    } catch (err) {
      console.error('No se pudieron cargar productos', err);
    }
  }

  function renderProductosDatalist() {
    if (!productosDatalist) return;
    productosDatalist.innerHTML = '';
    state.productos.forEach(p => {
      const opt = document.createElement('option');
      opt.value = `${p.codigo} - ${p.descripcion}`;
      productosDatalist.appendChild(opt);
    });
  }

  function buscarProductoId(valor) {
    if (!valor) return null;
    const val = valor.trim().toLowerCase();
    const code = val.split(' - ')[0];
    let found = state.productos.find(p => (p.codigo || '').toLowerCase() === code);
    if (found) return found.id;
    found = state.productos.find(p => (`${p.codigo} ${p.descripcion}`).toLowerCase().includes(val));
    return found ? found.id : null;
  }

  async function agregarRepuesto(e) {
    e.preventDefault();
    if (!state.detalle?.ficha?.familia_id) return alert('Selecciona una ficha');
    await ensureProductos();
    const data = Object.fromEntries(new FormData(repuestoForm).entries());
    const productoId = buscarProductoId(data.producto);
    if (!productoId) return alert('Selecciona un producto valido');
    try {
      const res = await fetch(`/api/fichas/${encodeURIComponent(state.detalle.ficha.familia_id)}/repuestos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ producto_id: productoId, alias_codigo: data.alias_codigo, nota: data.nota }),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'No se pudo vincular');
      repuestoForm.reset();
      await cargarDetalle(state.detalle.ficha.familia_id);
    } catch (err) {
      console.error(err);
      alert('No se pudo vincular el repuesto');
    }
  }

  function renderRepuestos(list) {
    if (!repuestosBody) return;
    repuestosBody.innerHTML = '';
    if (!list.length) {
      repuestosBody.innerHTML = `<tr><td colspan="5" style="text-align:center;" class="muted">Sin repuestos vinculados</td></tr>`;
      return;
    }
    list.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.codigo || '-'}</td>
        <td>${item.descripcion || '-'}</td>
        <td>${item.alias_codigo || '-'}</td>
        <td>${item.nota || '-'}</td>
        <td style="text-align:right;">
          <button class="btn-ghost" data-id="${item.id}"><i class="fas fa-trash"></i></button>
        </td>
      `;
      tr.querySelector('button').addEventListener('click', () => eliminarRepuesto(item.id));
      repuestosBody.appendChild(tr);
    });
  }

  async function eliminarRepuesto(id) {
    if (!state.detalle?.ficha?.familia_id) return;
    if (!confirm('Eliminar repuesto vinculado?')) return;
    try {
      const res = await fetch(`/api/fichas/${encodeURIComponent(state.detalle.ficha.familia_id)}/repuestos/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'No se pudo eliminar');
      await cargarDetalle(state.detalle.ficha.familia_id);
    } catch (err) {
      console.error(err);
      alert('No se pudo eliminar el repuesto');
    }
  }

  function abrirModalFicha() {
    if (!state.detalle?.ficha?.familia_id) return alert('Selecciona una ficha');
    modalFicha.style.display = 'flex';
  }

  async function guardarFichaBasica(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(formFichaBasica).entries());
    const familiaId = data.familia_id || state.detalle?.ficha?.familia_id;
    if (!familiaId) return alert('Falta familia');
    try {
      const res = await fetch(`/api/fichas/${encodeURIComponent(familiaId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'No se pudo guardar');
      modalFicha.style.display = 'none';
      await Promise.all([cargarListado(), cargarDetalle(familiaId)]);
    } catch (err) {
      console.error(err);
      alert('Error al guardar la ficha');
    }
  }

  async function subirArchivo(file) {
    if (!file) throw new Error('Archivo invalido');
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });
    const res = await fetch('/api/fichas/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, data: base64 }),
      credentials: 'include',
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.url) throw new Error(payload.error || 'Error al subir');
    return payload.url;
  }

  if (document.querySelector('.tab-content[data-view="fichas"]')) init();
  document.addEventListener('view:changed', (e) => { if (e.detail === 'fichas') init(); });

  async function agregarFotoCarrusel(familiaId, url) {
    const payload = { tipo: 'foto', url, titulo: '', orden: 0 };
    const res = await fetch(`/api/fichas/${encodeURIComponent(familiaId)}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar la foto');
    return data;
  }
})();

