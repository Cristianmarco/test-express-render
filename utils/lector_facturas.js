// utils/lector_facturas.js
// Lee una factura de compra (PDF o foto) con Claude y devuelve sus datos con un
// esquema fijo (salida estructurada) para completar el formulario de carga.
// Necesita ANTHROPIC_API_KEY en el servidor. Modelo configurable con
// ANTHROPIC_MODELO_FACTURAS (por defecto claude-opus-5-5).
const { Anthropic } = require('@anthropic-ai/sdk');

const MODELO = process.env.ANTHROPIC_MODELO_FACTURAS || 'claude-opus-5-5';
// Precio por millon de tokens del modelo por defecto (para mostrar el costo aproximado)
const PRECIO_ENTRADA = 4;
const PRECIO_SALIDA = 20;

const TIPOS = { 'application/pdf': 'document', 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image' };

const numero = { type: 'number' };
const textoONulo = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['es_factura', 'emisor_razon_social', 'emisor_cuit', 'comprobante', 'letra', 'punto_venta', 'numero', 'fecha',
    'vencimiento', 'cae', 'moneda', 'importes', 'items', 'observaciones'],
  properties: {
    es_factura: { type: 'boolean' },
    emisor_razon_social: textoONulo,
    emisor_cuit: textoONulo,
    comprobante: { type: 'string', enum: ['FC', 'NC', 'ND'] },
    letra: { type: 'string', enum: ['A', 'B', 'C', 'M'] },
    punto_venta: { type: 'integer' },
    numero: { type: 'integer' },
    fecha: textoONulo,
    vencimiento: textoONulo,
    cae: textoONulo,
    moneda: { type: 'string' },
    importes: {
      type: 'object',
      additionalProperties: false,
      required: ['neto_21', 'iva_21', 'neto_105', 'iva_105', 'neto_27', 'iva_27', 'no_gravado', 'exento',
        'percepcion_iva', 'percepcion_iibb', 'impuestos_internos', 'otros_tributos', 'total'],
      properties: {
        neto_21: numero, iva_21: numero, neto_105: numero, iva_105: numero, neto_27: numero, iva_27: numero,
        no_gravado: numero, exento: numero, percepcion_iva: numero, percepcion_iibb: numero,
        impuestos_internos: numero, otros_tributos: numero, total: numero,
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'descripcion', 'cantidad', 'precio_unitario', 'bonificacion_pct', 'alicuota_iva'],
        properties: {
          codigo: textoONulo,
          descripcion: { type: 'string' },
          cantidad: numero,
          precio_unitario: numero,
          bonificacion_pct: numero,
          alicuota_iva: { type: 'number', enum: [21, 10.5, 27, 0] },
        },
      },
    },
    observaciones: textoONulo,
  },
};

const INSTRUCCIONES = `Vas a leer un comprobante de compra argentino (factura, nota de crédito o nota de débito) que un taller recibió de un proveedor, y devolver sus datos para cargarlo en el sistema.

Criterios:
- emisor_*: el proveedor que EMITE el comprobante (no el cliente/receptor). CUIT con el formato que figure.
- comprobante: FC factura, NC nota de crédito, ND nota de débito. letra: A, B, C o M (el recuadro grande del encabezado).
- punto_venta y numero: solo los números, sin ceros a la izquierda.
- fecha y vencimiento: AAAA-MM-DD. vencimiento es el de pago, no el del CAE; null si no figura.
- cae: los 14 dígitos del CAE (o CAI); null si no figura.
- moneda: "PES" para pesos; si no, el código que figure (por ejemplo "DOL").
- importes: tal como los informa el pie del comprobante, en números (sin separadores de miles; punto decimal). 0 si no figura.
  - En A y M: netos gravados e IVA por alícuota, no gravado, exento, percepciones de IVA y de IIBB (sumá todas las jurisdicciones), impuestos internos y otros tributos.
  - En B y C no se discrimina IVA: todos los netos e IVA en 0 y el importe sin percepciones va en no_gravado.
  - total: el importe total del comprobante.
- items: un elemento por renglón de artículo, en el orden del comprobante.
  - codigo: el código de artículo del proveedor tal como figura (null si no tiene).
  - precio_unitario: en A y M el precio unitario SIN IVA; en B y C el precio final. Si el renglón trae bonificación/descuento, el precio ANTES del descuento y el porcentaje en bonificacion_pct (0 si no hay).
  - alicuota_iva: la del renglón (21 si no se indica en una A); 0 en B y C.
  - No incluyas como renglones los subtotales, percepciones ni totales.
- observaciones: algo que convenga revisar (texto ilegible, importes que no cierran, renglones dudosos), o null.
- es_factura: false si la imagen no es un comprobante de compra; en ese caso completá el resto con valores vacíos.`;

let cliente = null;
function clienteApi() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cliente) cliente = new Anthropic();
  return cliente;
}

const configurado = () => !!process.env.ANTHROPIC_API_KEY;

class ErrorLector extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// archivo: { data: 'data:<mime>;base64,...' }. Devuelve { datos, modelo, uso, costo_usd }
async function leerFactura(archivo) {
  const client = clienteApi();
  if (!client) throw new ErrorLector(503, 'La lectura con IA no está configurada: falta la clave ANTHROPIC_API_KEY en el servidor.');
  const m = String((archivo && archivo.data) || '').match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m || !TIPOS[m[1]]) throw new ErrorLector(400, 'El archivo tiene que ser PDF, JPG, PNG o WEBP');
  const [, mime, b64] = m;
  if (b64.length > 20 * 1024 * 1024) throw new ErrorLector(400, 'El archivo es demasiado grande para leerlo');

  const adjunto = TIPOS[mime] === 'document'
    ? { type: 'document', source: { type: 'base64', media_type: mime, data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };

  const response = await client.beta.messages.create({
    model: MODELO,
    max_tokens: 16000,
    // Si el modelo declina por sus filtros de seguridad, la API reintenta con otro
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
    system: INSTRUCCIONES,
    messages: [{ role: 'user', content: [adjunto, { type: 'text', text: 'Extraé los datos de este comprobante.' }] }],
  });

  if (response.stop_reason === 'refusal') throw new ErrorLector(422, 'La IA no pudo procesar este archivo. Cargalo a mano.');
  if (response.stop_reason === 'max_tokens') throw new ErrorLector(422, 'El comprobante es demasiado largo para leerlo de una vez. Cargalo a mano.');
  const texto = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (_) {
    throw new ErrorLector(502, 'La respuesta de la IA no se pudo interpretar. Probá de nuevo.');
  }
  const uso = response.usage || {};
  const costo = ((uso.input_tokens || 0) * PRECIO_ENTRADA + (uso.output_tokens || 0) * PRECIO_SALIDA) / 1e6;
  return { datos, modelo: response.model, uso: { entrada: uso.input_tokens, salida: uso.output_tokens }, costo_usd: Math.round(costo * 1000) / 1000 };
}

module.exports = { leerFactura, configurado, ErrorLector, MODELO };
