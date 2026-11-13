// Pieza grafica de una oferta de Marketing (HTML con estilos en linea).
// La usan la pantalla de Marketing (vista previa e imagen PNG), el mail que se manda con
// Brevo y la pagina publica del pedido, asi las tres se ven igual.
// Navegador: window.MarketingPieza.html(oferta, opciones). Node: require(este archivo).
(function (raiz) {
  const PLANTILLAS = {
    azul: { nombre: 'Azul', base: '#1d4ed8', oscuro: '#1e3a8a', acento: '#facc15' },
    rojo: { nombre: 'Rojo', base: '#dc2626', oscuro: '#7f1d1d', acento: '#fde047' },
    verde: { nombre: 'Verde', base: '#15803d', oscuro: '#14532d', acento: '#fde047' },
    oscuro: { nombre: 'Oscuro', base: '#111827', oscuro: '#000000', acento: '#f59e0b' },
  };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const numero = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const fecha = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  // Formato argentino sin depender de Intl (en Node puede faltar el locale es-AR)
  function pesos(n) {
    const neg = n < 0;
    const [ent, dec] = Math.abs(n).toFixed(2).split('.');
    const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${neg ? '-' : ''}$ ${miles}${dec === '00' ? '' : ',' + dec}`;
  }

  // opciones: base (url absoluta del sistema, para el mail), link (boton), email (true =
  // sin posiciones absolutas, que los clientes de correo no respetan), fotoUrl(oferta)
  function html(o, opciones) {
    const op = opciones || {};
    const base = op.base || '';
    const t = PLANTILLAS[o.plantilla] || PLANTILLAS.azul;
    const precio = numero(o.precio);
    const antes = numero(o.precio_anterior);
    const off = precio !== null && antes && antes > precio ? Math.round((1 - precio / antes) * 100) : 0;
    const foto = o.foto_id ? (op.fotoUrl ? op.fotoUrl(o) : `${base}/api/productos/fotos/${o.foto_id}`) : null;
    const p = [];
    p.push(`<div style="max-width:600px;width:100%;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.12);color:#111827;">`);
    p.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.base};border-collapse:collapse;"><tr>
      <td style="padding:14px 20px;"><span style="display:inline-block;background:#ffffff;border-radius:8px;padding:4px 8px;"><img src="${base}/static/images/logo.png" alt="Amorim" height="30" style="height:30px;display:block;" /></span></td>
      <td style="padding:14px 20px;text-align:right;"><span style="display:inline-block;background:${t.acento};color:${t.oscuro};font-weight:800;font-size:13px;letter-spacing:2px;padding:5px 14px;border-radius:999px;">OFERTA</span></td>
    </tr></table>`);
    p.push(`<div style="background:${t.base};color:#ffffff;text-align:center;padding:6px 24px 24px;">
      <div style="font-size:30px;font-weight:800;line-height:1.15;">${esc(o.titulo || 'Título de la oferta')}</div>
      ${o.bajada ? `<div style="font-size:16px;margin-top:8px;opacity:.92;">${esc(o.bajada)}</div>` : ''}
    </div>`);
    const insignia = off && !op.email
      ? `<div style="position:absolute;top:16px;right:18px;width:74px;height:74px;border-radius:50%;background:${t.acento};color:${t.oscuro};text-align:center;font-weight:800;line-height:1;padding-top:17px;box-sizing:border-box;"><div style="font-size:24px;">${off}%</div><div style="font-size:12px;margin-top:2px;">OFF</div></div>`
      : '';
    if (foto) {
      p.push(`<div style="position:relative;text-align:center;padding:22px 24px 6px;background:#ffffff;">${insignia}
        <img src="${esc(foto)}" alt="${esc(o.producto_nombre || '')}" style="max-width:100%;max-height:300px;width:auto;height:auto;" />
      </div>`);
    }
    p.push(`<div style="padding:14px 28px 0;text-align:center;">`);
    if (o.producto_nombre) p.push(`<div style="font-size:19px;font-weight:700;color:#111827;">${esc(o.producto_nombre)}</div>`);
    if (o.producto_codigo) p.push(`<div style="font-size:12px;color:#6b7280;margin-top:3px;">Código ${esc(o.producto_codigo)}</div>`);
    if (o.descripcion) p.push(`<div style="font-size:14px;color:#374151;margin-top:10px;line-height:1.45;white-space:pre-line;">${esc(o.descripcion)}</div>`);
    p.push(`</div>`);
    if (precio !== null) {
      p.push(`<div style="margin:18px 28px 0;border:2px dashed ${t.base};border-radius:12px;padding:14px;text-align:center;">
        ${off && (op.email || !foto) ? `<div style="display:inline-block;background:${t.acento};color:${t.oscuro};font-weight:800;font-size:14px;padding:3px 12px;border-radius:999px;margin-bottom:6px;">${off}% OFF</div>` : ''}
        ${antes ? `<div style="font-size:16px;color:#6b7280;">Antes <span style="text-decoration:line-through;">${pesos(antes)}</span></div>` : ''}
        <div style="font-size:40px;font-weight:800;color:${t.base};line-height:1.1;">${pesos(precio)}${o.leyenda_precio ? ` <span style="font-size:15px;font-weight:600;color:#6b7280;">${esc(o.leyenda_precio)}</span>` : ''}</div>
      </div>`);
    } else if (!foto && !o.descripcion && !o.producto_nombre) {
      p.push(`<div style="padding:30px;text-align:center;color:#9ca3af;font-size:14px;">Elegí un producto y completá los datos</div>`);
    }
    if (o.vigencia_hasta) p.push(`<div style="text-align:center;font-size:13px;font-weight:700;color:${t.oscuro};margin-top:12px;">Válida hasta el ${fecha(o.vigencia_hasta)}</div>`);
    if (op.link !== false) {
      p.push(`<div style="text-align:center;padding:20px 24px 8px;">
        <a href="${esc(op.link || '#')}" style="display:inline-block;background:${t.base};color:#ffffff;text-decoration:none;font-weight:700;font-size:17px;padding:14px 34px;border-radius:999px;">${esc(o.boton_texto || '¡Lo quiero!')}</a>
      </div>`);
    }
    if (o.condiciones) p.push(`<div style="font-size:11px;color:#6b7280;text-align:center;padding:6px 28px 0;line-height:1.4;white-space:pre-line;">${esc(o.condiciones)}</div>`);
    p.push(`<div style="height:20px;"></div></div>`);
    return p.join('');
  }

  const api = { PLANTILLAS, html, pesos, fecha, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MarketingPieza = api;
})(typeof window !== 'undefined' ? window : this);
