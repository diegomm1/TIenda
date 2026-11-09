// api/gemini.js · Vercel Serverless Function (Node.js)
// Puente entre el frontend y la API de Gemini: la key solo vive en el servidor.

// Modelo rápido y económico para consultas de chat y valoraciones.
// Mantenerlo en un modelo publicado evita que la función falle antes de procesar
// la petición cuando se retire o no exista un alias experimental.
const MODEL = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Límites para que nadie pueda usar el endpoint como un proxy abierto a Gemini
const LIMITS = {
  maxMessages: 19,
  maxPartChars: 4000,
  maxTotalChars: 20000,
  maxSystemChars: 2000,
  maxOutputTokens: 800,
  timeoutMs: 8000 // por intento: 3 intentos + esperas caben en los 30 s de maxDuration
};

// Reintentos automáticos cuando Gemini está saturado (503) o falla internamente (500)
const RETRY_STATUS = new Set([500, 503]);
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Valida el cuerpo y construye el payload que se enviará a Gemini
function buildPayload(body) {
  if (!body || typeof body !== 'object') return { error: 'Cuerpo de la petición no válido.' };

  const { system, contents } = body;
  const generationConfig = body.generationConfig || {};

  if (!Array.isArray(contents) || contents.length === 0 || contents.length > LIMITS.maxMessages) {
    return { error: 'La lista de mensajes no es válida.' };
  }

  let total = 0;
  const cleanContents = [];
  for (const item of contents) {
    const role = item && item.role;
    const text = item && Array.isArray(item.parts) && item.parts[0] && item.parts[0].text;
    if ((role !== 'user' && role !== 'model') || typeof text !== 'string' || !text.trim()) {
      return { error: 'Hay un mensaje con formato no válido.' };
    }
    if (text.length > LIMITS.maxPartChars) return { error: 'Un mensaje es demasiado largo.' };
    total += text.length;
    cleanContents.push({ role, parts: [{ text }] });
  }
  if (total > LIMITS.maxTotalChars) return { error: 'La conversación es demasiado larga.' };
  if (cleanContents[0].role !== 'user') return { error: 'La conversación debe empezar con un mensaje del usuario.' };

  const payload = {
    contents: cleanContents,
    generationConfig: {
      temperature: clamp(
        generationConfig.temperature !== undefined ? generationConfig.temperature : body.temperature,
        0,
        1,
        0.7
      ),
      maxOutputTokens: Math.round(clamp(
        generationConfig.maxOutputTokens !== undefined
          ? generationConfig.maxOutputTokens
          : body.maxOutputTokens,
        1,
        LIMITS.maxOutputTokens,
        500
      ))
    }
  };

  if (system !== undefined) {
    if (typeof system !== 'string' || system.length > LIMITS.maxSystemChars) {
      return { error: 'La instrucción de sistema no es válida.' };
    }
    if (system.trim()) payload.systemInstruction = { parts: [{ text: system }] };
  }

  return { payload };
}

async function fetchGemini(apiKey, payload) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs);
    try {
      const upstream = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const data = await upstream.json().catch(() => ({}));
      const result = { ok: upstream.ok, status: upstream.status, data };

      if (result.ok || !RETRY_STATUS.has(result.status) || attempt === MAX_ATTEMPTS) return result;
      console.warn(`Gemini devolvió ${result.status}; reintento ${attempt}/${MAX_ATTEMPTS - 1}`);
    } finally {
      clearTimeout(timer);
    }
    await sleep(800 * attempt); // 0,8 s y 1,6 s entre intentos
  }
}

// Mensajes en español para los errores más habituales (el original queda en los logs)
function upstreamMessage(status, data) {
  if (status === 503) return 'La IA está saturada en este momento. Inténtalo de nuevo en unos segundos.';
  if (status === 429) return 'Se ha alcanzado el límite de uso de la IA. Espera un momento e inténtalo de nuevo.';
  if (status === 401 || status === 403) return 'La clave de la IA no es válida o no tiene acceso a Gemini.';
  if (status === 404) return 'El modelo de IA configurado no está disponible. Revisa la configuración del servidor.';
  return (data.error && data.error.message) || `Gemini respondió con el error ${status}.`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Falta la variable de entorno GEMINI_API_KEY');
    return res.status(500).json({ error: 'El servidor no tiene configurada la clave de la IA.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }

  const { error, payload } = buildPayload(body);
  if (error) return res.status(400).json({ error });

  try {
    const { ok, status, data } = await fetchGemini(apiKey, payload);

    if (!ok) {
      console.error('Error de Gemini:', status, data.error && data.error.message);
      return res.status(status).json({ error: upstreamMessage(status, data) });
    }

    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
                   data.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || '').join('').trim();

    if (!text) {
      const blocked = data.promptFeedback && data.promptFeedback.blockReason;
      return res.status(502).json({
        error: blocked ? 'La IA no puede responder a esa consulta.' : 'La IA no ha devuelto respuesta.'
      });
    }

    return res.status(200).json({ text });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'La IA ha tardado demasiado en responder. Inténtalo de nuevo.' });
    }
    console.error('No se pudo contactar con Gemini:', err);
    return res.status(502).json({ error: 'No se pudo contactar con la IA.' });
  }
};
