(() => {
  'use strict';

  /* =========================================================
     IA: el frontend solo habla con nuestra función serverless.
     La API key de Gemini vive en Vercel (variable de entorno), nunca aquí.
     ========================================================= */
  const API_ENDPOINT = '/api/gemini';

  /* =========================================================
     DATOS DE EJEMPLO (precios y valores orientativos, por 100 g/ml)
     ========================================================= */
  const PRODUCTS = [
    {
      id: 1,
      nombre: 'Yogur griego natural',
      precio: 1.99,
      supermercado: 'Mercadona',
      imagen: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=800&q=70',
      nutricional: { energia: 115, grasas: 7.5, saturadas: 5.1, hidratos: 4.0, azucares: 3.9, fibra: 0, proteinas: 7.6, sal: 0.1 },
      puntuacion: 4.5
    },
    {
      id: 2,
      nombre: 'Copos de avena integral',
      precio: 1.29,
      supermercado: 'Lidl',
      imagen: 'https://images.unsplash.com/photo-1517093602195-b40af9688b46?auto=format&fit=crop&w=800&q=70',
      nutricional: { energia: 372, grasas: 7.0, saturadas: 1.3, hidratos: 60.0, azucares: 1.1, fibra: 10.0, proteinas: 13.5, sal: 0.02 },
      puntuacion: 4.0
    },
    {
      id: 3,
      nombre: 'Leche semidesnatada',
      precio: 0.89,
      supermercado: 'Mercadona',
      imagen: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=800&q=70',
      nutricional: { energia: 46, grasas: 1.6, saturadas: 1.1, hidratos: 4.8, azucares: 4.8, fibra: 0, proteinas: 3.2, sal: 0.1 },
      puntuacion: 3.5
    },
    {
      id: 4,
      nombre: 'Muesli crujiente con frutos secos',
      precio: 2.49,
      supermercado: 'Lidl',
      imagen: 'https://images.unsplash.com/photo-1495214783159-3503fd1b572d?auto=format&fit=crop&w=800&q=70',
      nutricional: { energia: 430, grasas: 14.0, saturadas: 2.4, hidratos: 61.0, azucares: 18.0, fibra: 7.5, proteinas: 9.5, sal: 0.1 },
      puntuacion: 3.0
    }
  ];

  const NUTRI_ROWS = [
    { key: 'energia',    label: 'Energía',               unit: 'kcal' },
    { key: 'grasas',     label: 'Grasas',                unit: 'g' },
    { key: 'saturadas',  label: 'de las cuales saturadas', unit: 'g', sub: true },
    { key: 'hidratos',   label: 'Hidratos de carbono',   unit: 'g' },
    { key: 'azucares',   label: 'de los cuales azúcares', unit: 'g', sub: true },
    { key: 'fibra',      label: 'Fibra',                 unit: 'g' },
    { key: 'proteinas',  label: 'Proteínas',             unit: 'g' },
    { key: 'sal',        label: 'Sal',                   unit: 'g' }
  ];

  const FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#eef7f1"/>' +
    '<text x="200" y="158" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#5d6b63">Sin imagen</text></svg>'
  );

  const STAR_PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8L12 2.5z';

  /* =========================================================
     REFERENCIAS Y ESTADO
     ========================================================= */
  const overlay = document.getElementById('welcome-overlay');
  const closeBtn = document.getElementById('welcome-close');
  const startBtn = document.getElementById('welcome-start');
  const cartButton = document.getElementById('cart-button');
  const cartTotal = document.getElementById('cart-total');
  const app = document.getElementById('app-content');

  const cart = { items: [] };          // { id, nombre, price, qty }
  const state = { productId: null };   // null = catálogo

  /* =========================================================
     UTILIDADES
     ========================================================= */
  const formatPrice = (n) => n.toFixed(2) + ' €';
  const formatNum = (n) => String(n).replace('.', ',');
  const findProduct = (id) => PRODUCTS.find((p) => p.id === id);

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const storeClass = (name) => 'store store--' + name.toLowerCase().replace(/[^a-z0-9]/g, '');

  /* Estrellas: cada estrella lleva una capa dorada recortada al 0 %, 50 % o 100 % */
  function starsHTML(rating) {
    const starSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;
    let html = '';
    for (let i = 0; i < 5; i++) {
      const fill = Math.max(0, Math.min(1, rating - i));
      const pct = (Math.round(fill * 2) / 2) * 100;
      html += `<span class="star">${starSvg}<span class="star-fill" style="width:${pct}%">${starSvg}</span></span>`;
    }
    return `<span class="stars" role="img" aria-label="Valoración ${formatNum(rating)} de 5">${html}</span>`;
  }

  /* =========================================================
     VISTAS
     ========================================================= */
  function renderCatalog() {
    const cards = PRODUCTS.map((p) => `
      <li>
        <button class="product-card" type="button" data-product-id="${p.id}">
          <img class="product-card-img" src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy">
          <div class="product-card-body">
            <h3 class="product-card-name">${esc(p.nombre)}</h3>
            <div class="product-card-meta">
              <span class="price">${formatPrice(p.precio)}</span>
              <span class="${storeClass(p.supermercado)}">${esc(p.supermercado)}</span>
            </div>
          </div>
        </button>
      </li>`).join('');

    app.innerHTML = `
      <section class="view view-catalog" aria-labelledby="catalog-title">
        <h2 id="catalog-title" class="view-title">Productos</h2>
        <ul class="catalog-grid">${cards}</ul>
      </section>`;
  }

  function renderDetail(product) {
    const rows = NUTRI_ROWS.map((r) => `
      <tr class="${r.sub ? 'is-sub' : ''}">
        <th scope="row">${r.label}</th>
        <td>${formatNum(product.nutricional[r.key])} ${r.unit}</td>
      </tr>`).join('');

    app.innerHTML = `
      <section class="view view-detail" aria-labelledby="detail-title">
        <button class="back-btn" type="button" data-action="back" aria-label="Volver al catálogo">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>

        <div class="detail-layout">
          <img class="detail-img" src="${esc(product.imagen)}" alt="${esc(product.nombre)}">

          <div class="detail-info">
            <span class="${storeClass(product.supermercado)}">${esc(product.supermercado)}</span>
            <h2 id="detail-title" class="detail-name">${esc(product.nombre)}</h2>
            <div class="detail-rating">
              ${starsHTML(product.puntuacion)}
              <span class="rating-number">${formatNum(product.puntuacion)} / 5</span>
            </div>
            <p class="detail-price">${formatPrice(product.precio)}</p>

            <button class="add-btn" type="button" data-action="add" data-product-id="${product.id}">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 9h18l-1.6 9.2a2 2 0 0 1-2 1.8H6.6a2 2 0 0 1-2-1.8L3 9z"/>
                <path d="M8 9l3-5M16 9l-3-5"/>
              </svg>
              <span>Añadir a la cesta</span>
            </button>
            <p id="in-cart-note" class="in-cart-note" aria-live="polite"></p>
          </div>
        </div>

        <h3 class="section-title">Valores nutricionales <small>por 100 g</small></h3>
        <table class="nutri-table"><tbody>${rows}</tbody></table>

        <section id="ai-rating" class="ai-box" aria-labelledby="ai-rating-title">
          <div class="ai-box-header">
            <svg class="ai-sparkles" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>
              <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>
            </svg>
            <h3 id="ai-rating-title" class="ai-box-title">Valoración IA</h3>
            <span class="ai-badge">Estimación de IA</span>
          </div>
          <div id="ai-rating-content" class="ai-box-body" aria-live="polite"></div>
          <p class="ai-box-footer">Estimación generada por inteligencia artificial: es orientativa y puede contener errores. No sustituye el consejo de un profesional sanitario.</p>
        </section>
      </section>`;

    updateInCartNote(product.id);
    loadAIRating(product); // petición automática a Gemini al entrar en el detalle
  }

  function render() {
    if (state.productId === null) {
      renderCatalog();
    } else {
      renderDetail(findProduct(state.productId));
    }
    window.scrollTo({ top: 0 });
  }

  function showDetail(id) { state.productId = id; render(); }
  function showCatalog() { state.productId = null; render(); }

  /* =========================================================
     CARRITO
     ========================================================= */
  function getTotal() {
    return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  function renderCartTotal() {
    const text = formatPrice(getTotal());
    cartTotal.textContent = text;
    cartButton.setAttribute('aria-label', `Ver cesta. Total: ${text}`);
  }

  function addToCart(product) {
    const existing = cart.items.find((i) => i.id === product.id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.items.push({ id: product.id, nombre: product.nombre, price: product.precio, qty: 1 });
    }
    renderCartTotal();
    bumpCart();
  }

  function bumpCart() {
    cartButton.classList.remove('is-bumped');
    void cartButton.offsetWidth; // reinicia la animación
    cartButton.classList.add('is-bumped');
  }

  function updateInCartNote(id) {
    const note = document.getElementById('in-cart-note');
    if (!note) return;
    const item = cart.items.find((i) => i.id === id);
    note.textContent = item ? `En tu cesta: ${item.qty} ud.` : '';
  }

  /* =========================================================
     EVENTOS
     ========================================================= */
  app.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-action="add"]');
    if (addBtn) {
      const product = findProduct(Number(addBtn.dataset.productId));
      addToCart(product);
      updateInCartNote(product.id);
      return;
    }
    if (e.target.closest('[data-action="retry-ai"]')) {
      loadAIRating(findProduct(state.productId));
      return;
    }
    if (e.target.closest('[data-action="back"]')) {
      showCatalog();
      return;
    }
    const card = e.target.closest('.product-card');
    if (card) showDetail(Number(card.dataset.productId));
  });

  // Imagen rota -> placeholder (el evento error no burbujea, por eso se usa captura)
  app.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG' && e.target.src !== FALLBACK_IMG) e.target.src = FALLBACK_IMG;
  }, true);

  /* ---------- Modal de bienvenida ---------- */
  function openWelcome() {
    overlay.classList.add('is-open');
    document.body.classList.add('modal-open');
    startBtn.focus();
  }

  function closeWelcome() {
    overlay.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    cartButton.focus();
  }

  closeBtn.addEventListener('click', closeWelcome);
  startBtn.addEventListener('click', closeWelcome);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeWelcome(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeWelcome();
  });

  /* =========================================================
     ASISTENTE (CHAT CON GEMINI)
     ========================================================= */
  const chatToggle = document.getElementById('chat-toggle');
  const chatWindow = document.getElementById('chat-window');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');

  const CHAT_WELCOME =
    'Hola, soy el asistente de CestaSana. Puedo ayudarte a comparar productos y a elegir opciones más saludables. ¿Qué quieres saber?';

  // Historial que se envía a Gemini: { role: 'user' | 'model', parts: [{ text }] }
  const chatHistory = [];

  function buildSystemPrompt() {
    let prompt =
      'Eres el asistente de CestaSana, una web que compara precios y valores nutricionales de productos ' +
      'de supermercado (Mercadona, Lidl, etc.). Responde siempre en español, de forma breve y clara ' +
      '(unas 120 palabras como máximo) y con foco en la compra saludable. No des consejos médicos ni ' +
      'diagnósticos. Si no sabes algo, dilo.';

    if (state.productId !== null) {
      const p = findProduct(state.productId);
      prompt += ' El usuario está viendo ahora este producto: ' + JSON.stringify({
        nombre: p.nombre,
        supermercado: p.supermercado,
        precio_eur: p.precio,
        valores_por_100g: p.nutricional,
        puntuacion_sobre_5: p.puntuacion
      }) + '.';
    }
    return prompt;
  }

  // Llamada a nuestro endpoint /api/gemini: la usan el chat y la Valoración IA.
  // Recibe { system, contents, temperature, maxOutputTokens } y devuelve el texto de la respuesta.
  async function callGemini({ system, contents, temperature, maxOutputTokens }) {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, contents, temperature, maxOutputTokens })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 404 && !data.error) {
        throw new Error('No se encuentra /api/gemini. En local, arranca el proyecto con "vercel dev".');
      }
      throw new Error(data.error || `Error ${res.status} al llamar a la IA.`);
    }
    if (!data.text) throw new Error('La IA no ha devuelto respuesta. Prueba a reformular la pregunta.');
    return data.text;
  }

  function friendlyError(err) {
    return err instanceof TypeError
      ? 'No se pudo conectar con la IA. Revisa tu conexión e inténtalo de nuevo.'
      : err.message;
  }

  async function sendMessageToGemini(userText) {
    chatHistory.push({ role: 'user', parts: [{ text: userText }] });

    try {
      const text = await callGemini({
        system: buildSystemPrompt(),
        // Se envían como máximo 19 mensajes: así la lista siempre empieza con un mensaje del usuario
        contents: chatHistory.slice(-19),
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
      });
      chatHistory.push({ role: 'model', parts: [{ text }] });
      return text;
    } catch (err) {
      chatHistory.pop(); // la pregunta no obtuvo respuesta: no se queda en el historial
      throw err;
    }
  }

  // Respuesta de la IA: se escapa el HTML y solo se convierten **negritas** y viñetas "* "
  function formatAI(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\s*[*-] /gm, '• ');
  }

  function addChatMessage(role, text, isError = false) {
    const row = document.createElement('div');
    row.className = 'msg msg--' + role + (isError ? ' msg--error' : '');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (role === 'ai' && !isError) bubble.innerHTML = formatAI(text);
    else bubble.textContent = text;
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return row;
  }

  function showTyping() {
    const row = document.createElement('div');
    row.className = 'msg msg--ai';
    row.innerHTML = '<div class="bubble typing" aria-label="El asistente está escribiendo"><span></span><span></span><span></span></div>';
    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return row;
  }

  function setChatOpen(open) {
    chatWindow.hidden = !open;
    chatToggle.classList.toggle('is-open', open);
    chatToggle.setAttribute('aria-expanded', String(open));
    chatToggle.setAttribute('aria-label', open ? 'Cerrar asistente' : 'Abrir asistente');
    if (open) {
      if (!chatMessages.children.length) addChatMessage('ai', CHAT_WELCOME);
      chatInput.focus();
    }
  }

  chatToggle.addEventListener('click', () => setChatOpen(chatWindow.hidden));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !chatWindow.hidden && !overlay.classList.contains('is-open')) {
      setChatOpen(false);
      chatToggle.focus();
    }
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    addChatMessage('user', text);
    chatInput.value = '';
    chatInput.disabled = true;
    chatSend.disabled = true;
    const typing = showTyping();

    try {
      const answer = await sendMessageToGemini(text);
      typing.remove();
      addChatMessage('ai', answer);
    } catch (err) {
      typing.remove();
      addChatMessage('ai', friendlyError(err), true);
    } finally {
      chatInput.disabled = false;
      chatSend.disabled = false;
      chatInput.focus();
    }
  });

  /* =========================================================
     VALORACIÓN IA (detalle de producto)
     ========================================================= */
  const AI_QUESTION =
    'Actúa como un experto nutricionista. Haz una breve valoración de este producto y dime aproximadamente ' +
    'a cuántas personas adultas se puede alimentar con una sola unidad (o ración estándar) de este producto. ' +
    'Sé muy conciso.';

  const aiCache = new Map();     // id de producto -> texto ya recibido (evita repetir llamadas)
  const aiRequests = new Map();  // id de producto -> petición en curso (evita duplicados)

  function buildAIRatingPrompt(p) {
    const n = p.nutricional;
    return (
      `Producto: ${p.nombre}\n` +
      `Valores nutricionales por 100 g: energía ${n.energia} kcal, grasas ${n.grasas} g ` +
      `(saturadas ${n.saturadas} g), hidratos de carbono ${n.hidratos} g (azúcares ${n.azucares} g), ` +
      `fibra ${n.fibra} g, proteínas ${n.proteinas} g, sal ${n.sal} g.\n\n` +
      AI_QUESTION
    );
  }

  function getAIRating(product) {
    if (aiCache.has(product.id)) return Promise.resolve(aiCache.get(product.id));

    if (!aiRequests.has(product.id)) {
      const request = callGemini({
        system: 'Responde siempre en español, en un máximo de 4 frases, sin saludos ni introducciones.',
        contents: [{ role: 'user', parts: [{ text: buildAIRatingPrompt(product) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 500 }
      })
        .then((text) => { aiCache.set(product.id, text); return text; })
        .finally(() => aiRequests.delete(product.id));
      aiRequests.set(product.id, request);
    }
    return aiRequests.get(product.id);
  }

  async function loadAIRating(product) {
    const box = document.getElementById('ai-rating-content');
    if (!box) return;

    box.setAttribute('aria-busy', 'true');
    box.innerHTML = `
      <div class="ai-loading">
        <span class="ai-spinner" aria-hidden="true"></span>
        <span class="ai-loading-text">Analizando el producto con IA
          <span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </span>
      </div>`;

    try {
      const text = await getAIRating(product);
      if (!box.isConnected) return; // el usuario ya salió de esta vista
      box.innerHTML = `<div class="ai-text">${formatAI(text)}</div>`;
    } catch (err) {
      if (!box.isConnected) return;
      box.innerHTML = `
        <div class="ai-error">
          <p>${esc(friendlyError(err))}</p>
          <button class="ai-retry" type="button" data-action="retry-ai">Reintentar</button>
        </div>`;
    } finally {
      if (box.isConnected) box.removeAttribute('aria-busy');
    }
  }

  /* ---------- Inicio ---------- */
  renderCartTotal();
  render();
  openWelcome();
})();
