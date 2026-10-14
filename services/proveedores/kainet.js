// services/proveedores/kainet.js
// Lector para catalogos hechos sobre la plataforma de Kainet (Exintrader, Rodaser...).
// Todos exponen la misma API JSON: login con email/clave -> token Bearer,
// /articulos/listar (busqueda), /articulos/{codigo} (ficha),
// /articulos/aplicaciones/listar y articulos relacionados.
// Cada proveedor se crea con crearLectorKainet({...}) con su API, prefijo y credenciales.

// "Aro colector (Ø mm)" -> { nombre: "Aro colector", unidad: "mm" }
function separarUnidad(nombre) {
  const m = String(nombre || '').match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { nombre: String(nombre || '').trim(), unidad: null };
  const dentro = m[2].trim();
  let unidad = null;
  if (/mm/i.test(dentro)) unidad = 'mm';
  else if (/^v$/i.test(dentro)) unidad = 'V';
  else if (/^a$/i.test(dentro)) unidad = 'A';
  else if (/ohm|Ω/i.test(dentro)) unidad = 'Ω';
  else if (/^w$/i.test(dentro)) unidad = 'W';
  else if (/^kw$/i.test(dentro)) unidad = 'kW';
  return { nombre: m[1].trim(), unidad: unidad || dentro };
}

const limpiar = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const sinHtml = (s) => limpiar(String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));
const codigoNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function crearLectorKainet(cfg) {
  const { ID, NOMBRE, PREFIJO, EJEMPLO, API, SITIO, ENV_EMAIL, ENV_PASSWORD, ENV_DESCUENTO, DESCUENTO, PROVEEDOR_NOMBRE } = cfg;
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
  const sitioHost = new URL(SITIO).hostname.replace(/^www\./, '');
  const HOST_RE = new RegExp(`^(www\\.)?${sitioHost.replace(/\./g, '\\.')}$`, 'i');
  // El token dura bastante; se renueva cada 6 horas o si la API responde 401
  const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
  let token = null;
  let tokenDesde = 0;
  let loginEnCurso = null;

  const descuento = (apiPct) => {
    const api = Number(apiPct);
    if (Number.isFinite(api) && api > 0) return api; // si la cuenta trae descuento propio, manda ese
    const n = Number(process.env[ENV_DESCUENTO]);
    return Number.isFinite(n) && n >= 0 && n < 100 ? n : DESCUENTO;
  };

  async function fetchApi(url, opts = {}) {
    let ultimo;
    for (let intento = 0; intento < 2; intento++) {
      try {
        return await fetch(url, { ...opts, signal: AbortSignal.timeout(25000) });
      } catch (e) {
        ultimo = e;
        if (intento === 0) await new Promise((r) => setTimeout(r, 800));
      }
    }
    const causa = ultimo && ultimo.cause ? (ultimo.cause.code || ultimo.cause.message) : null;
    const timeout = ultimo && (ultimo.name === 'TimeoutError' || ultimo.name === 'AbortError');
    throw new Error(timeout
      ? `${NOMBRE} no respondió a tiempo. Probá de nuevo en un momento.`
      : `No se pudo conectar con ${NOMBRE}${causa ? ` (${causa})` : ''}. Probá de nuevo en un momento.`);
  }

  const headers = (conToken) => ({
    'User-Agent': UA,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Origin: SITIO,
    ...(conToken && token ? { Authorization: `Bearer ${token}` } : {})
  });

  async function login() {
    const email = process.env[ENV_EMAIL];
    const password = process.env[ENV_PASSWORD];
    if (!email || !password) throw new Error(`Faltan las credenciales de ${NOMBRE} (${ENV_EMAIL} / ${ENV_PASSWORD})`);
    const res = await fetchApi(`${API}/auth/login`, { method: 'POST', headers: headers(false), body: JSON.stringify({ email, password }) });
    const j = await res.json().catch(() => ({}));
    const t = j && j.data && j.data.access_token;
    if (!res.ok || !t) throw new Error(`${NOMBRE}: no se pudo iniciar sesión${j && j.message ? ` (${j.message})` : ''}`);
    token = t;
    tokenDesde = Date.now();
  }

  async function asegurarToken(forzar = false) {
    if (!forzar && token && Date.now() - tokenDesde < TOKEN_TTL_MS) return;
    if (!loginEnCurso) loginEnCurso = login().finally(() => { loginEnCurso = null; });
    await loginEnCurso;
  }

  // GET a la API con parametros anidados (filtros[x]=..., opciones[with_relation][0]=...)
  async function get(ruta, params = {}) {
    const qs = new URLSearchParams();
    const agregar = (prefijo, valor) => {
      if (valor == null) return;
      if (Array.isArray(valor)) valor.forEach((v, i) => agregar(`${prefijo}[${i}]`, v));
      else if (typeof valor === 'object') Object.entries(valor).forEach(([k, v]) => agregar(`${prefijo}[${k}]`, v));
      else qs.append(prefijo, String(valor));
    };
    Object.entries(params).forEach(([k, v]) => agregar(k, v));
    const url = `${API}${ruta}${qs.toString() ? `?${qs}` : ''}`;
    await asegurarToken();
    let res = await fetchApi(url, { headers: headers(true) });
    if (res.status === 401) {
      await asegurarToken(true);
      res = await fetchApi(url, { headers: headers(true) });
    }
    const j = await res.json().catch(() => ({}));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${NOMBRE}: error ${res.status}${j && j.message ? ` (${j.message})` : ''}`);
    return j;
  }

  const urlConsulta = (codigo) => `${SITIO}/articulos/${encodeURIComponent(codigo)}/consultar`;

  // Acepta la URL de la ficha del sitio: /articulos/<codigo>/consultar
  function urlFicha(url) {
    let u;
    try { u = new URL(String(url || '').trim()); } catch { return null; }
    if (!HOST_RE.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/articulos\/([^/]+)\/consultar\/?$/);
    return m ? urlConsulta(decodeURIComponent(m[1])) : null;
  }

  const fotoDe = (a) => (a.multimedia && a.multimedia[0] ? (a.multimedia[0].urlCard || a.multimedia[0].url) : null);
  const precioLista = (a) => {
    const n = Number(a.precio != null ? a.precio : a.precioVenta);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  function itemBusqueda(a) {
    const lista = precioLista(a);
    const d = descuento(a.porcentajeDescuento);
    return {
      id: String(a.id),
      url: urlConsulta(a.codigo_visual),
      codigo: limpiar(a.codigo_visual),
      descripcion: limpiar(a.nombre),
      foto: fotoDe(a),
      stock: a.etiqueta_stock && a.etiqueta_stock.textoEtiqueta ? a.etiqueta_stock.textoEtiqueta : null,
      precio_lista: lista,
      precio_costo: lista != null ? Math.round(lista * (1 - d / 100) * 100) / 100 : null
    };
  }

  async function buscar(texto) {
    const q = limpiar(texto);
    if (!q) return [];
    if (/^https?:\/\//i.test(q)) {
      const url = urlFicha(q);
      if (!url) return [];
      const f = await leerFicha(url);
      return [{ id: f.proveedor_id, url: f.url, codigo: f.codigo, descripcion: f.descripcion, foto: f.fotos[0] || null, precio_costo: f.precio ? f.precio.precio_costo : null }];
    }
    const opciones = { with_relation: ['multimedia'] };
    // Primero por codigo/nombre; si no hay nada, la busqueda general del sitio
    let r = await get('/articulos/listar', { filtros: { busqueda_codigo_visual_nombre: q }, opciones, limit: 20 });
    let lista = (r && r.data) || [];
    if (!lista.length) {
      r = await get('/articulos/listar', { filtros: { busqueda: q }, opciones, limit: 20 });
      lista = (r && r.data) || [];
    }
    const qn = codigoNorm(q);
    return lista.map(itemBusqueda)
      .sort((a, b) => (codigoNorm(b.codigo) === qn) - (codigoNorm(a.codigo) === qn));
  }

  async function leerFicha(urlEntrada) {
    const url = urlFicha(urlEntrada);
    if (!url) throw new Error(`URL de ${NOMBRE} inválida`);
    const codigo = decodeURIComponent(url.match(/\/articulos\/([^/]+)\/consultar/)[1]);
    const r = await get(`/articulos/${encodeURIComponent(codigo)}`, {
      opciones: { with_relation: ['multimedia', 'atributos.atributo_linea.atributo', 'linea.grupo'] }
    });
    const a = r && (r.data || r);
    if (!a || !a.id) throw new Error(`${NOMBRE}: no se encontró el artículo ${codigo}`);

    const [apl, rel] = await Promise.all([
      get('/articulos/aplicaciones/listar', {
        filtros: { articulo_id: a.id },
        opciones: { with_relation: ['modelo.marca', 'marca'] },
        limit: 500
      }).catch(() => null),
      get('/articulos/listar', { filtros: { articulo_relacionado_id: a.id }, limit: 50 }).catch(() => null)
    ]);

    const especificaciones = [];
    (a.atributos || []).forEach((x) => {
      const valor = limpiar(x.valor);
      const atr = x.atributo_linea && x.atributo_linea.atributo;
      if (!valor || !atr || !atr.nombre) return;
      const { nombre, unidad } = separarUnidad(atr.nombre);
      especificaciones.push({ clave: nombre, valor, unidad });
    });
    if (a.linea && a.linea.nombre) especificaciones.push({ clave: 'Línea', valor: limpiar(a.linea.nombre) });

    const aplicaciones = ((apl && apl.data) || []).map((x) => {
      const marca = (x.marca && x.marca.nombre) || (x.modelo && x.modelo.marca && x.modelo.marca.nombre) || '';
      const anios = x.anio_desde || x.anio_hasta
        ? (x.anio_desde === x.anio_hasta ? `${x.anio_desde}` : `${x.anio_desde || ''}-${x.anio_hasta || ''}`)
        : '';
      return {
        marca: limpiar(marca),
        modelo: limpiar(x.modelo && x.modelo.nombre),
        detalle: limpiar([anios, x.motor, x.comentario].filter(Boolean).join(' · '))
      };
    }).filter((x) => x.marca || x.modelo);

    // "Sinonimos": otros codigos con los que se conoce el articulo
    const equivalencias = sinHtml(a.sinonimos).split(/[,;\n]+/).map(limpiar).filter(Boolean)
      .map((c) => ({ fabricante: 'Sinónimo', codigo: c }));

    const partes = ((rel && rel.data) || []).map((x) => ({
      fabricante: PROVEEDOR_NOMBRE,
      codigo: limpiar(x.codigo_visual),
      tipo: limpiar(x.nombre),
      url: urlConsulta(x.codigo_visual)
    }));

    const lista = precioLista(a);
    const d = descuento(a.porcentajeDescuento);
    const iva = Number(a.porcentaje_iva);

    return {
      proveedor: ID,
      // Nombre para vincular con el proveedor del ERP (razon social)
      proveedor_nombre: PROVEEDOR_NOMBRE,
      proveedor_id: String(a.id),
      url,
      codigo: limpiar(a.codigo_visual),
      prefijo: PREFIJO,
      descripcion: limpiar(a.nombre),
      marca: null,
      ean: null,
      stock: a.etiqueta_stock && a.etiqueta_stock.textoEtiqueta ? a.etiqueta_stock.textoEtiqueta : null,
      fotos: (a.multimedia || []).filter((m) => !m.tipo || m.tipo === 'image').map((m) => m.url).filter(Boolean),
      precio: lista != null ? {
        moneda: '$',
        cotizacion: 1,
        precio_lista: lista,
        bonificacion_pct: d,
        pronto_pago_pct: 0,
        precio_costo: Math.round(lista * (1 - d / 100) * 100) / 100,
        rentabilidad_pct: null,
        iva_pct: Number.isFinite(iva) && iva > 0 ? iva : null,
        incluye_iva: false,
        precio_oferta: 0
      } : null,
      especificaciones,
      aplicaciones,
      equivalencias,
      partes
    };
  }

  // Las fotos estan en un CDN (cloudfront) que publica el propio catalogo
  async function descargarImagen(url) {
    let u;
    try { u = new URL(url); } catch { throw new Error('URL de imagen inválida'); }
    if (u.protocol !== 'https:' || !/(\.cloudfront\.net|\.amazonaws\.com)$/i.test(u.hostname) && !HOST_RE.test(u.hostname)) {
      throw new Error(`Imagen fuera del catálogo de ${NOMBRE}`);
    }
    const res = await fetchApi(u.href, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\//.test(mime)) throw new Error('El archivo descargado no es una imagen');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) throw new Error('Imagen demasiado grande');
    return { data: buf, mime };
  }

  return {
    ID,
    NOMBRE,
    PREFIJO,
    EJEMPLO,
    AYUDA: `Código ${NOMBRE} (ej: ${EJEMPLO}), descripción o URL de la ficha`,
    credencialesCargadas: () => !!(process.env[ENV_EMAIL] && process.env[ENV_PASSWORD]),
    buscar,
    leerFicha,
    descargarImagen,
    urlFicha
  };
}

module.exports = { crearLectorKainet };
