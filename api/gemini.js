// api/gemini.js · Vercel Serverless Function (Node.js)
// Puente entre el frontend y la API de Gemini: la key solo vive en el servidor.

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Límites para que nadie pueda usar el endpoint como un proxy abierto a Gemini
const LIMITS = {
  maxMessages: 19,
  maxPartChars: 4000,
  maxTotalChars: 20000,
  maxSystemChars: 2000,
  maxOutputTokens: 800,
  timeoutMs: 25000
};

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Valida el cuerpo y construye el payload que se enviará a Gemini
function buildPayload(body) {
  if (!body || typeof body !== 'object') return { error: 'Cuerpo de la petición no válido.' };

  const { system, contents } = body;

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
      temperature: clamp(body.temperature, 0, 1, 0.7),
      maxOutputTokens: Math.round(clamp(body.maxOutputTokens, 1, LIMITS.maxOutputTokens, 500))
    }
  };

  if (system !== undefined) {
    if (typeof system !== 'string' || system.length > LIMITS.maxSystemChars) {
      return { error: 'La instrucción de sistema no es válida.' };
    }
    if (system.trim()) payload.system_instruction = { parts: [{ text: system }] };
  }

  return { payload };
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

    if (!upstream.ok) {
      const message = (data.error && data.error.message) || `Gemini respondió con el error ${upstream.status}.`;
      console.error('Error de Gemini:', upstream.status, message);
      return res.status(upstream.status).json({ error: message });
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
  } finally {
    clearTimeout(timer);
  }
};
