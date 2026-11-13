// Envio de mails con Brevo (API de emails transaccionales).
// Variables de entorno: BREVO_API_KEY (clave con permiso "Emails transaccionales") y
// BREVO_REMITENTE ("Nombre <mail@...>", un remitente verificado en Brevo).
const URL_ENVIO = 'https://api.brevo.com/v3/smtp/email';

function remitente() {
  const txt = String(process.env.BREVO_REMITENTE || '').trim();
  const m = txt.match(/^\s*(.*?)\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2] };
  if (/^[^\s@]+@[^\s@]+$/.test(txt)) return { email: txt };
  return null;
}

const configurado = () => !!(process.env.BREVO_API_KEY && remitente());

// para: { email, name? }. Devuelve el messageId de Brevo.
async function enviar({ para, asunto, html, texto, responderA }) {
  if (!process.env.BREVO_API_KEY) throw new Error('Falta BREVO_API_KEY en la configuración del servidor');
  const de = remitente();
  if (!de) throw new Error('Falta BREVO_REMITENTE (ej: "Repuestos Amorim <mail@gmail.com>") en la configuración del servidor');
  const cuerpo = {
    sender: de,
    to: [para.name ? { email: para.email, name: para.name } : { email: para.email }],
    subject: asunto,
    htmlContent: html,
    replyTo: responderA || de,
  };
  if (texto) cuerpo.textContent = texto;
  const res = await fetch(URL_ENVIO, {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error(`Brevo rechazó la clave de API (${msg}). Revisá BREVO_API_KEY.`);
    throw new Error(`Brevo no pudo enviar el mail: ${msg}`);
  }
  return data.messageId || null;
}

module.exports = { enviar, remitente, configurado };
