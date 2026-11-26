(() => {
  // Clean up previous hot-reloaded instance if any
  if (typeof window.__ttCleanup === 'function') {
    try { window.__ttCleanup(); } catch {}
  }

  const THOUGHT_BTN_RE = /^(Thought for|Thinking for|Still thinking|Thinking\b|已思考|仍在思考|思考中)/i;
  const THOUGHT_DONE_RE = /^(Thought for|已思考)/i;
  const STYLE_ID = 'tt-injected-style';
  const MODAL_ID = 'tt-settings-modal-root';

  let config = window.__TT_INIT_CONFIG__ || {
    provider: 'gemini',
    targetLang: 'zh-TW',
    autoTranslate: true,
    defaultDisplayMode: 'translation',
    ready: false,
    languages: [
      { code: 'zh-TW', label: '繁體中文（台灣）' },
      { code: 'zh-CN', label: '简体中文' },
      { code: 'ja', label: '日本語' },
      { code: 'ko', label: '한국어' },
      { code: 'en', label: 'English' },
    ],
    gemini: { model: 'gemini-2.5-flash-lite', apiKeyMasked: '', keySource: 'none' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKeyMasked: '', keySource: 'none', isLocal: false },
    deepl: { endpoint: 'https://api-free.deepl.com/v2/translate', apiKeyMasked: '', keySource: 'none' },
  };

  // Bridge RPC layer over CDP Runtime.addBinding
  let reqSeq = 1;
  const pendingReqs = new Map(); // reqId -> { resolve, reject, onStream }

  window.__ttOnHostEvent = (evt) => {
    if (!evt || typeof evt !== 'object') return;
    if (evt.type === 'stream') {
      const p = pendingReqs.get(evt.reqId);
      if (p?.onStream) p.onStream(evt.text);
      return;
    }
    if (evt.type === 'response') {
      const p = pendingReqs.get(evt.reqId);
      if (!p) return;
      pendingReqs.delete(evt.reqId);
      if (evt.ok) p.resolve(evt.data);
      else p.reject(new Error(evt.error || 'Bridge error'));
      return;
    }
    if (evt.type === 'configUpdated' && evt.config) {
      config = evt.config;
      refreshAllCardsForConfig();
    }
  };

  function hostCall(action, payload = {}, onStream) {
    return new Promise((resolve, reject) => {
      if (typeof window.__ttHostCall !== 'function') {
        reject(new Error('Host bridge unavailable'));
        return;
      }
      const reqId = `tt_${Date.now()}_${reqSeq++}`;
      pendingReqs.set(reqId, { resolve, reject, onStream });
      window.__ttHostCall(JSON.stringify({ reqId, action, payload }));
    });
  }

  // Inject scoped CSS that blends smoothly into any Antigravity theme (light/dark/morandi/warm)
  const css = `
    .tt-hide-orig > :not(.tt-ui):not(style):not(script) {
      display: none !important;
    }
    .tt-ui.tt-box {
      font-family: inherit;
      font-size: inherit;
      line-height: 1.62;
      color: inherit;
      margin-bottom: 6px;
    }
    .tt-ui.tt-box.tt-bilingual {
      padding: 8px 10px;
      margin-bottom: 10px;
      border-radius: 8px;
      background: color-mix(in srgb, currentColor 4%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
    }
    .tt-ui .tt-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 11px;
      opacity: 0.78;
      user-select: none;
      flex-wrap: wrap;
    }
    .tt-ui .tt-bar:hover {
      opacity: 1;
    }
    .tt-ui .tt-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 500;
    }
    .tt-ui .tt-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      display: inline-block;
    }
    .tt-ui .tt-dot.streaming {
      background: #38bdf8;
      animation: tt-pulse 1.1s ease-in-out infinite;
    }
    .tt-ui .tt-dot.warn {
      background: #f59e0b;
    }
    .tt-ui .tt-dot.err {
      background: #ef4444;
    }
    @keyframes tt-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.8); }
    }
    .tt-ui .tt-controls {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .tt-ui .tt-seg {
      display: inline-flex;
      border-radius: 6px;
      padding: 1px;
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      background: color-mix(in srgb, currentColor 4%, transparent);
    }
    .tt-ui .tt-btn {
      border: none;
      background: transparent;
      color: inherit;
      font-size: 11px;
      line-height: 1.3;
      padding: 2px 6px;
      border-radius: 5px;
      cursor: pointer;
      font-family: inherit;
      opacity: 0.75;
      transition: opacity 0.12s, background 0.12s;
    }
    .tt-ui .tt-btn:hover {
      opacity: 1;
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .tt-ui .tt-btn.active {
      opacity: 1;
      font-weight: 600;
      background: color-mix(in srgb, currentColor 14%, transparent);
    }
    .tt-ui .tt-icon-btn {
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      background: transparent;
      color: inherit;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 6px;
      cursor: pointer;
      opacity: 0.75;
    }
    .tt-ui .tt-icon-btn:hover {
      opacity: 1;
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    .tt-ui .tt-content {
      font-family: 'Anthropic Serif', 'Anthropic Serif Web', 'Anthropic Serif Web Text Light', 'anthropic-serif', 'Tiempos Text', 'Tiempos', 'Noto Serif TC', 'Source Han Serif TC', 'Songti TC', 'Hiragino Mincho ProN', 'YuMincho', Georgia, Cambria, 'Times New Roman', serif !important;
      font-weight: 400;
      -webkit-text-stroke: 0.18px currentColor;
      line-height: 1.7;
      letter-spacing: 0.015em;
    }
    .tt-ui .tt-content code, .tt-ui .tt-content pre {
      -webkit-text-stroke: 0;
    }
    .tt-ui .tt-content p {
      margin: 0 0 6px;
    }
    .tt-ui .tt-content p:last-child {
      margin-bottom: 0;
    }
    .tt-ui .tt-seg-item {
      margin-bottom: 8px;
    }
    .tt-ui .tt-seg-item:last-child {
      margin-bottom: 0;
    }
    .tt-ui .tt-seg-pending {
      opacity: 0.6;
      font-style: italic;
      font-size: 0.92em;
    }
    .tt-ui .tt-content ul, .tt-ui .tt-content ol {
      margin: 4px 0 6px;
      padding-left: 18px;
    }
    .tt-ui .tt-content code {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.92em;
      padding: 1px 4px;
      border-radius: 4px;
      background: color-mix(in srgb, currentColor 8%, transparent);
    }
    .tt-ui .tt-content pre {
      margin: 6px 0;
      padding: 8px 10px;
      border-radius: 6px;
      overflow-x: auto;
      background: color-mix(in srgb, currentColor 7%, transparent);
    }
    .tt-ui .tt-content pre code {
      background: transparent;
      padding: 0;
    }
    .tt-ui .tt-cursor {
      display: inline-block;
      width: 5px;
      height: 12px;
      background: currentColor;
      opacity: 0.65;
      vertical-align: -2px;
      margin-left: 2px;
      animation: tt-blink 0.9s steps(2, start) infinite;
    }
    @keyframes tt-blink { to { visibility: hidden; } }
    .tt-ui .tt-err-msg {
      margin-top: 6px;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 11.5px;
      background: rgba(239, 68, 68, 0.12);
      color: #ef4444;
    }

    /* Settings modal */
    #${MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(3px);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang TC", "Noto Sans TC", sans-serif;
    }
    #${MODAL_ID}.tt-hidden { display: none; }
    #${MODAL_ID} .tt-modal {
      width: min(390px, 92vw);
      max-height: 86vh;
      overflow-y: auto;
      border-radius: 12px;
      padding: 16px 18px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(128, 128, 128, 0.25);
      font-size: 13px;
      line-height: 1.5;
    }
    #${MODAL_ID} .tt-modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    #${MODAL_ID} .tt-modal-title {
      font-size: 14.5px;
      font-weight: 600;
      margin: 0;
    }
    #${MODAL_ID} .tt-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 11px;
    }
    #${MODAL_ID} .tt-field label {
      font-size: 12px;
      opacity: 0.78;
      display: flex;
      justify-content: space-between;
    }
    #${MODAL_ID} .tt-field input,
    #${MODAL_ID} .tt-field select {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 9px;
      border-radius: 7px;
      border: 1px solid rgba(128, 128, 128, 0.32);
      background: transparent;
      color: inherit;
      font-size: 12.5px;
      font-family: inherit;
      outline: none;
    }
    #${MODAL_ID} .tt-group {
      padding: 10px 11px;
      border-radius: 8px;
      border: 1px solid rgba(128, 128, 128, 0.22);
      margin-bottom: 12px;
    }
    #${MODAL_ID} .tt-row-check {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      font-size: 12.5px;
      cursor: pointer;
    }
    #${MODAL_ID} .tt-test-box {
      padding: 8px 10px;
      border-radius: 7px;
      font-size: 12px;
      margin-bottom: 12px;
      border: 1px solid rgba(128, 128, 128, 0.22);
    }
    #${MODAL_ID} .tt-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 6px;
    }
    #${MODAL_ID} .tt-act-btn {
      padding: 6px 13px;
      border-radius: 7px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      border: 1px solid rgba(128, 128, 128, 0.35);
      background: transparent;
      color: inherit;
    }
    #${MODAL_ID} .tt-act-btn.primary {
      background: #0284c7;
      border-color: #0284c7;
      color: #ffffff;
    }
  `;

  let styleEl = document.getElementById(STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;

  // Safe lightweight markdown renderer
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(text) {
    const src = String(text ?? '');
    if (!src.trim()) return '';
    const blocks = [];
    const replaced = src.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
      const idx = blocks.length;
      blocks.push(`<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`);
      return `\u0000BLOCK${idx}\u0000`;
    });
    const inlineFmt = (s) => escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    const out = [];
    let inUl = false;
    for (const rawLine of replaced.split('\n')) {
      const line = rawLine.trimEnd();
      const bm = /^\u0000BLOCK(\d+)\u0000$/.exec(line.trim());
      if (bm) {
        if (inUl) { out.push('</ul>'); inUl = false; }
        out.push(blocks[Number(bm[1])]);
        continue;
      }
      const ul = /^\s*[-*•]\s+(.+)$/.exec(line);
      if (ul) {
        if (!inUl) { out.push('<ul>'); inUl = true; }
        out.push(`<li>${inlineFmt(ul[1])}</li>`);
        continue;
      }
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!line.trim()) continue;
      out.push(`<p>${inlineFmt(line)}</p>`);
    }
    if (inUl) out.push('</ul>');
    return out.join('');
  }

  // Extract clean original thinking text while ignoring <style>, <script>, and our own .tt-ui nodes
  function extractOriginalText(contentEl) {
    const parts = [];
    for (const child of contentEl.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.textContent || '');
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT' || child.classList.contains('tt-ui')) continue;
      // Use innerText when attached & visible, fallback to recursive clean text when hidden
      const txt = extractElementText(child);
      if (txt) parts.push(txt);
    }
    return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function extractElementText(el) {
    const chunks = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        chunks.push(node.textContent || '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT' || node.classList.contains('tt-ui')) return;
      if (tag === 'BR') { chunks.push('\n'); return; }
      const isParaBlock = /^(P|PRE|BLOCKQUOTE|H[1-6])$/.test(tag);
      const isLineBlock = /^(DIV|LI)$/.test(tag);
      for (const c of node.childNodes) walk(c);
      if (isParaBlock) chunks.push('\n\n');
      else if (isLineBlock) chunks.push('\n');
    };
    walk(el);
    return chunks.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Split text into logical paragraphs while keeping fenced code blocks intact
  function splitParagraphs(text) {
    const src = String(text ?? '').trim();
    if (!src) return [];
    const lines = src.split('\n');
    const paras = [];
    let buf = [];
    let inFence = false;

    const flush = () => {
      const joined = buf.join('\n').trim();
      if (joined) paras.push(joined);
      buf = [];
    };

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        buf.push(line);
        continue;
      }
      if (!inFence && line.trim() === '') {
        flush();
      } else {
        buf.push(line);
      }
    }
    flush();
    return paras;
  }

  function findScrollContainer(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      const style = getComputedStyle(cur);
      if (/(auto|scroll)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight + 2) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return el;
  }

  function withScrollPreserved(contentEl, fn) {
    const scroller = findScrollContainer(contentEl);
    const prevTop = scroller ? scroller.scrollTop : 0;
    const atBottom = scroller
      ? (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 36)
      : false;
    fn();
    if (scroller) {
      if (atBottom) {
        scroller.scrollTop = scroller.scrollHeight;
      } else {
        scroller.scrollTop = prevTop;
      }
    }
  }

  // Track state per expanded thinking content element
  const cardStates = new WeakMap(); // contentEl -> state object
  const activeContentEls = new Set();

  function getCardState(contentEl) {
    let st = cardStates.get(contentEl);
    if (!st) {
      st = {
        mode: config.defaultDisplayMode || 'translation', // 'translation' | 'bilingual' | 'original'
        isDone: false,
        segments: [], // [{ orig, translatedOrig, translation, status, error, domEl, dirtyRender }]
        running: false,
        pendingRescan: false,
        tailTimer: null,
        boxEl: null,
      };
      cardStates.set(contentEl, st);
      activeContentEls.add(contentEl);
    }
    return st;
  }

  function ensureBox(contentEl, st) {
    if (st.boxEl && st.boxEl.parentElement === contentEl) return st.boxEl;
    const box = document.createElement('div');
    box.className = 'tt-ui tt-box';
    box.innerHTML = `
      <div class="tt-bar">
        <span class="tt-status"><span class="tt-dot"></span><span class="tt-status-text"></span></span>
        <span class="tt-controls">
          <span class="tt-seg">
            <button type="button" class="tt-btn" data-mode="translation">譯文</button>
            <button type="button" class="tt-btn" data-mode="bilingual">雙語</button>
            <button type="button" class="tt-btn" data-mode="original">原文</button>
          </span>
          <button type="button" class="tt-icon-btn" data-act="retranslate" title="重新翻譯">↻</button>
          <button type="button" class="tt-icon-btn" data-act="settings" title="翻譯設定 (Alt+Shift+T)">⚙</button>
        </span>
      </div>
      <div class="tt-content"></div>
      <div class="tt-err-msg" style="display:none"></div>
    `;

    box.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('button[data-mode]');
      if (modeBtn) {
        e.stopPropagation();
        st.mode = modeBtn.dataset.mode;
        renderCard(contentEl, st);
        if (st.mode !== 'original') {
          drainSegments(contentEl, st, false);
        }
        return;
      }
      const actBtn = e.target.closest('button[data-act]');
      if (actBtn) {
        e.stopPropagation();
        if (actBtn.dataset.act === 'retranslate') {
          // Mark all segments dirty for forced re-translation without clearing visible text
          for (const seg of st.segments) {
            seg.translatedOrig = '';
            seg.status = 'pending';
            seg.error = '';
            seg.forceOnce = true;
          }
          drainSegments(contentEl, st, true);
        } else if (actBtn.dataset.act === 'settings') {
          openSettingsModal();
        }
      }
    });

    contentEl.prepend(box);
    st.boxEl = box;
    return box;
  }

  function computeOverallStatus(st) {
    if (!st.segments.length) return 'idle';
    if (st.segments.some((s) => s.status === 'streaming')) return 'streaming';
    if (st.segments.some((s) => s.status === 'error')) return 'error';
    if (st.segments.every((s) => s.status === 'skipped')) return 'skipped';
    if (st.segments.some((s) => s.status === 'translated')) {
      if (st.segments.some((s) => s.status === 'pending' || s.translatedOrig !== s.orig)) {
        return st.running ? 'streaming' : 'translated';
      }
      return 'translated';
    }
    return 'idle';
  }

  function renderCard(contentEl, st) {
    withScrollPreserved(contentEl, () => {
      const box = ensureBox(contentEl, st);
      const dot = box.querySelector('.tt-dot');
      const statusText = box.querySelector('.tt-status-text');
      const contentDiv = box.querySelector('.tt-content');
      const errDiv = box.querySelector('.tt-err-msg');

      for (const b of box.querySelectorAll('button[data-mode]')) {
        b.classList.toggle('active', b.dataset.mode === st.mode);
      }

      const overall = computeOverallStatus(st);
      const hasAnyTranslated = st.segments.some((s) => s.translation || s.status === 'streaming');
      const hideOrig = st.mode === 'translation' && overall !== 'skipped' && overall !== 'idle' && hasAnyTranslated;
      contentEl.classList.toggle('tt-hide-orig', hideOrig);
      box.classList.toggle('tt-bilingual', st.mode === 'bilingual' && hasAnyTranslated);

      dot.className = 'tt-dot';
      if (overall === 'streaming') {
        dot.classList.add('streaming');
        statusText.textContent = '翻譯中…';
      } else if (overall === 'translated') {
        statusText.textContent = st.isDone ? '已翻譯' : '同步翻譯中…';
      } else if (overall === 'skipped') {
        statusText.textContent = '已是目標語言';
      } else if (overall === 'error') {
        dot.classList.add('err');
        statusText.textContent = '翻譯失敗';
      } else if (!config.ready) {
        dot.classList.add('warn');
        statusText.textContent = '未設定 API Key';
      } else {
        dot.classList.add('warn');
        statusText.textContent = '等待翻譯';
      }

      if (st.mode === 'original' || overall === 'skipped' || (!hasAnyTranslated && overall === 'idle')) {
        contentDiv.style.display = 'none';
      } else {
        contentDiv.style.display = '';
        // Sync per-segment DOM nodes incrementally so already-translated paragraphs never flicker
        while (contentDiv.children.length > st.segments.length) {
          contentDiv.lastElementChild.remove();
        }
        st.segments.forEach((seg, idx) => {
          let el = seg.domEl;
          if (!el || el.parentElement !== contentDiv) {
            el = contentDiv.children[idx] || document.createElement('div');
            el.className = 'tt-seg-item';
            if (!el.parentElement) contentDiv.appendChild(el);
            seg.domEl = el;
            seg.dirtyRender = true;
          }
          if (!seg.dirtyRender) return;
          seg.dirtyRender = false;

          if (seg.status === 'translated') {
            el.innerHTML = renderMarkdown(seg.translation);
          } else if (seg.status === 'skipped') {
            el.innerHTML = renderMarkdown(seg.orig);
          } else if (seg.status === 'streaming') {
            const partial = seg.streamingText || seg.translation;
            if (partial) {
              el.innerHTML = `${renderMarkdown(partial)}<span class="tt-cursor"></span>`;
            } else {
              el.innerHTML = `<span class="tt-seg-pending">正在翻譯此段…</span><span class="tt-cursor"></span>`;
            }
          } else if (seg.translation) {
            // Keep existing translation visible while waiting for tail update
            el.innerHTML = renderMarkdown(seg.translation);
          } else {
            el.innerHTML = '';
          }
        });
      }

      const firstErr = st.segments.find((s) => s.status === 'error' && s.error);
      if (firstErr) {
        errDiv.style.display = '';
        errDiv.textContent = firstErr.error;
      } else {
        errDiv.style.display = 'none';
        errDiv.textContent = '';
      }
    });
  }

  function syncSegments(st, paragraphs) {
    // Update existing segments in-place without clearing already-translated text
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      if (i < st.segments.length) {
        const seg = st.segments[i];
        if (seg.orig !== p) {
          seg.orig = p;
          // Only mark pending if not currently streaming; keep seg.translation intact!
          if (seg.status !== 'streaming') {
            seg.status = 'pending';
          }
        }
      } else {
        st.segments.push({
          orig: p,
          translatedOrig: '',
          translation: '',
          streamingText: '',
          status: 'pending',
          error: '',
          forceOnce: false,
          domEl: null,
          dirtyRender: true,
        });
      }
    }
    if (st.segments.length > paragraphs.length) {
      st.segments.length = paragraphs.length;
    }
  }

  function pickNextSegmentIndex(st, includeTail) {
    const lastIdx = st.segments.length - 1;
    for (let i = 0; i <= lastIdx; i++) {
      const seg = st.segments[i];
      const needsWork = seg.forceOnce || seg.translatedOrig !== seg.orig;
      if (!needsWork) continue;
      if (seg.status === 'skipped' && seg.translatedOrig === seg.orig) continue;
      // While thinking is still streaming, translate finalized earlier paragraphs immediately;
      // only translate the growing tail paragraph when includeTail is true (after pause or done).
      if (i === lastIdx && !st.isDone && !includeTail) continue;
      return i;
    }
    return -1;
  }

  async function drainSegments(contentEl, st, includeTail) {
    if (st.running) {
      st.pendingRescan = true;
      return;
    }
    if (!config.ready) {
      renderCard(contentEl, st);
      return;
    }

    st.running = true;
    try {
      while (document.contains(contentEl)) {
        const idx = pickNextSegmentIndex(st, includeTail || st.isDone);
        if (idx === -1) break;

        const seg = st.segments[idx];
        const targetText = seg.orig;
        const force = Boolean(seg.forceOnce);
        seg.forceOnce = false;
        seg.status = 'streaming';
        seg.streamingText = '';
        seg.error = '';
        seg.dirtyRender = true;
        renderCard(contentEl, st);

        // Gather previous translated paragraph as optional terminology/tone context
        let prevContext = '';
        for (let k = idx - 1; k >= 0; k--) {
          if (st.segments[k].translation) {
            prevContext = st.segments[k].translation;
            break;
          }
        }

        try {
          const res = await hostCall('translate', { text: targetText, context: prevContext, force }, (partial) => {
            seg.streamingText = partial;
            seg.status = 'streaming';
            seg.dirtyRender = true;
            renderCard(contentEl, st);
          });
          seg.translatedOrig = targetText;
          seg.streamingText = '';
          if (res.status === 'skipped') {
            seg.status = 'skipped';
            seg.translation = '';
          } else {
            seg.status = 'translated';
            seg.translation = res.translation || '';
          }
          seg.dirtyRender = true;
          renderCard(contentEl, st);
        } catch (err) {
          seg.streamingText = '';
          seg.status = 'error';
          seg.error = err.message || String(err);
          seg.dirtyRender = true;
          renderCard(contentEl, st);
          break;
        }
      }
    } finally {
      st.running = false;
      if (st.pendingRescan && document.contains(contentEl)) {
        st.pendingRescan = false;
        drainSegments(contentEl, st, st.isDone);
      }
    }
  }

  function processThinkingBlock(btn, contentEl) {
    const st = getCardState(contentEl);
    const text = extractOriginalText(contentEl);
    if (!text) return;

    const btnText = (btn.textContent || '').trim();
    const isDone = THOUGHT_DONE_RE.test(btnText);
    st.isDone = isDone;

    ensureBox(contentEl, st);

    const paragraphs = splitParagraphs(text);
    syncSegments(st, paragraphs);
    renderCard(contentEl, st);

    if (!config.autoTranslate || !config.ready || st.mode === 'original') {
      return;
    }

    // 1. Finalized earlier paragraphs (0 .. n-2) start translating immediately without waiting!
    if (paragraphs.length > 1 && pickNextSegmentIndex(st, false) !== -1) {
      drainSegments(contentEl, st, false);
    }

    // 2. For the growing tail paragraph: translate quickly (250ms) once thinking finishes,
    //    or after a calm pause (1600ms) while still thinking.
    clearTimeout(st.tailTimer);
    st.tailTimer = setTimeout(() => {
      if (!document.contains(contentEl)) return;
      const latestText = extractOriginalText(contentEl);
      if (latestText) {
        syncSegments(st, splitParagraphs(latestText));
      }
      drainSegments(contentEl, st, true);
    }, isDone ? 250 : 1600);
  }

  function scanThinkingBlocks() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const label = (btn.textContent || '').trim();
      if (!label || label.length > 48 || !THOUGHT_BTN_RE.test(label)) continue;
      // The expanded thinking body is the sibling DIV directly after the "Thought for / 已思考" button
      const contentEl = btn.nextElementSibling;
      if (!contentEl || contentEl.tagName !== 'DIV') continue;
      // Ensure it has actual text content (expanded)
      if (!extractOriginalText(contentEl)) continue;
      processThinkingBlock(btn, contentEl);
    }
  }

  function refreshAllCardsForConfig() {
    for (const el of [...activeContentEls]) {
      if (!document.contains(el)) {
        activeContentEls.delete(el);
        continue;
      }
      const st = cardStates.get(el);
      if (!st) continue;
      renderCard(el, st);
    }
    scanThinkingBlocks();
  }

  // Settings modal (adapts to current page background & text color)
  function ensureModal() {
    let root = document.getElementById(MODAL_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = MODAL_ID;
    root.className = 'tt-hidden';
    root.innerHTML = `
      <div class="tt-modal" role="dialog" aria-label="Thought Translator Settings">
        <div class="tt-modal-head">
          <h3 class="tt-modal-title">思考自動翻譯設定</h3>
          <button type="button" class="tt-act-btn" data-close="1" style="padding:2px 8px">✕</button>
        </div>
        <form id="tt-cfg-form">
          <label class="tt-row-check">
            <input type="checkbox" id="tt-m-auto" />
            <span>展開或產生新思考區塊時自動翻譯</span>
          </label>
          <div class="tt-field">
            <label for="tt-m-lang">目標語言</label>
            <select id="tt-m-lang"></select>
          </div>
          <div class="tt-field">
            <label for="tt-m-mode">預設顯示模式</label>
            <select id="tt-m-mode">
              <option value="translation">純譯文（原地替換，可隨時切回原文）</option>
              <option value="bilingual">雙語對照（譯文＋原文同時顯示）</option>
            </select>
          </div>
          <div class="tt-field">
            <label for="tt-m-provider">翻譯後端</label>
            <select id="tt-m-provider">
              <option value="gemini">Gemini API（預設）</option>
              <option value="openai">OpenAI-Compatible（OpenAI / DeepSeek / Ollama…）</option>
              <option value="deepl">DeepL API</option>
            </select>
          </div>

          <div id="tt-g-gemini" class="tt-group">
            <div class="tt-field">
              <label><span>Gemini API Key</span><span id="tt-src-gemini"></span></label>
              <input id="tt-m-gemini-key" type="password" placeholder="留空則讀取 GEMINI_API_KEY 環境變數" autocomplete="off" />
            </div>
            <div class="tt-field" style="margin-bottom:0">
              <label>模型</label>
              <input id="tt-m-gemini-model" type="text" placeholder="gemini-2.5-flash-lite" />
            </div>
          </div>

          <div id="tt-g-openai" class="tt-group" style="display:none">
            <div class="tt-field">
              <label>Base URL</label>
              <input id="tt-m-openai-url" type="text" placeholder="https://api.openai.com/v1 或 http://localhost:11434/v1" />
            </div>
            <div class="tt-field">
              <label><span>API Key</span><span id="tt-src-openai"></span></label>
              <input id="tt-m-openai-key" type="password" placeholder="本機 Ollama 可留空；雲端讀取 OPENAI_API_KEY" autocomplete="off" />
            </div>
            <div class="tt-field" style="margin-bottom:0">
              <label>模型</label>
              <input id="tt-m-openai-model" type="text" placeholder="gpt-4o-mini / deepseek-chat / qwen2.5:7b" />
            </div>
          </div>

          <div id="tt-g-deepl" class="tt-group" style="display:none">
            <div class="tt-field">
              <label><span>DeepL API Key</span><span id="tt-src-deepl"></span></label>
              <input id="tt-m-deepl-key" type="password" placeholder="留空則讀取 DEEPL_API_KEY 環境變數" autocomplete="off" />
            </div>
            <div class="tt-field" style="margin-bottom:0">
              <label>Endpoint</label>
              <select id="tt-m-deepl-endpoint">
                <option value="https://api-free.deepl.com/v2/translate">Free API (api-free.deepl.com)</option>
                <option value="https://api.deepl.com/v2/translate">Pro API (api.deepl.com)</option>
              </select>
            </div>
          </div>

          <div id="tt-m-test-box" class="tt-test-box" style="display:none"></div>

          <div class="tt-modal-actions">
            <button type="button" id="tt-m-test" class="tt-act-btn">測試連線</button>
            <button type="submit" class="tt-act-btn primary">儲存設定</button>
          </div>
        </form>
      </div>
    `;

    root.addEventListener('click', (e) => {
      if (e.target === root || e.target.closest('[data-close]')) {
        root.classList.add('tt-hidden');
      }
    });

    const syncGroups = (p) => {
      root.querySelector('#tt-g-gemini').style.display = p === 'gemini' ? '' : 'none';
      root.querySelector('#tt-g-openai').style.display = p === 'openai' ? '' : 'none';
      root.querySelector('#tt-g-deepl').style.display = p === 'deepl' ? '' : 'none';
    };

    root.querySelector('#tt-m-provider').addEventListener('change', (e) => syncGroups(e.target.value));

    const collectPayload = () => ({
      autoTranslate: root.querySelector('#tt-m-auto').checked,
      targetLang: root.querySelector('#tt-m-lang').value,
      defaultDisplayMode: root.querySelector('#tt-m-mode').value,
      provider: root.querySelector('#tt-m-provider').value,
      gemini: {
        apiKey: root.querySelector('#tt-m-gemini-key').value.trim(),
        model: root.querySelector('#tt-m-gemini-model').value.trim(),
      },
      openai: {
        baseUrl: root.querySelector('#tt-m-openai-url').value.trim(),
        apiKey: root.querySelector('#tt-m-openai-key').value.trim(),
        model: root.querySelector('#tt-m-openai-model').value.trim(),
      },
      deepl: {
        apiKey: root.querySelector('#tt-m-deepl-key').value.trim(),
        endpoint: root.querySelector('#tt-m-deepl-endpoint').value,
      },
    });

    root.querySelector('#tt-cfg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      config = await hostCall('saveConfig', collectPayload());
      root.classList.add('tt-hidden');
      refreshAllCardsForConfig();
    });

    root.querySelector('#tt-m-test').addEventListener('click', async () => {
      const box = root.querySelector('#tt-m-test-box');
      box.style.display = '';
      box.style.color = '';
      box.textContent = '儲存並測試連線中…';
      try {
        config = await hostCall('saveConfig', collectPayload());
        const res = await hostCall('testProvider');
        box.style.color = '#10b981';
        box.textContent = `連線成功（${res.provider} / ${res.model}）：${res.translation}`;
      } catch (err) {
        box.style.color = '#ef4444';
        box.textContent = `測試失敗：${err.message}`;
      }
    });

    document.body.appendChild(root);
    return root;
  }

  function keySourceLabel(src) {
    if (src === 'config') return '已儲存';
    if (src === 'env') return '環境變數';
    return '未設定';
  }

  async function openSettingsModal() {
    const root = ensureModal();
    try {
      config = await hostCall('getConfig');
    } catch {}

    // Match current Antigravity theme surface colors dynamically
    const bodyStyle = getComputedStyle(document.body);
    const modal = root.querySelector('.tt-modal');
    modal.style.background = bodyStyle.backgroundColor || '#1e1e24';
    modal.style.color = bodyStyle.color || '#f1f5f9';

    root.querySelector('#tt-m-auto').checked = Boolean(config.autoTranslate);
    const langSel = root.querySelector('#tt-m-lang');
    langSel.innerHTML = (config.languages || [])
      .map((l) => `<option value="${escapeHtml(l.code)}">${escapeHtml(l.label)}</option>`)
      .join('');
    langSel.value = config.targetLang || 'zh-TW';
    root.querySelector('#tt-m-mode').value = config.defaultDisplayMode || 'translation';
    root.querySelector('#tt-m-provider').value = config.provider || 'gemini';

    root.querySelector('#tt-g-gemini').style.display = config.provider === 'gemini' ? '' : 'none';
    root.querySelector('#tt-g-openai').style.display = config.provider === 'openai' ? '' : 'none';
    root.querySelector('#tt-g-deepl').style.display = config.provider === 'deepl' ? '' : 'none';

    root.querySelector('#tt-m-gemini-key').value = config.gemini?.apiKeyMasked || '';
    root.querySelector('#tt-m-gemini-model').value = config.gemini?.model || '';
    root.querySelector('#tt-src-gemini').textContent = keySourceLabel(config.gemini?.keySource);

    root.querySelector('#tt-m-openai-url').value = config.openai?.baseUrl || '';
    root.querySelector('#tt-m-openai-key').value = config.openai?.apiKeyMasked || '';
    root.querySelector('#tt-m-openai-model').value = config.openai?.model || '';
    root.querySelector('#tt-src-openai').textContent = config.openai?.isLocal ? '本機免 Key' : keySourceLabel(config.openai?.keySource);

    root.querySelector('#tt-m-deepl-key').value = config.deepl?.apiKeyMasked || '';
    root.querySelector('#tt-m-deepl-endpoint').value = config.deepl?.endpoint || 'https://api-free.deepl.com/v2/translate';
    root.querySelector('#tt-src-deepl').textContent = keySourceLabel(config.deepl?.keySource);

    root.querySelector('#tt-m-test-box').style.display = 'none';
    root.classList.remove('tt-hidden');
  }

  // Keyboard shortcut: Alt+Shift+T opens settings modal
  const onKeyDown = (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyT') {
      e.preventDefault();
      openSettingsModal();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // Throttled MutationObserver watching for new/expanded thinking blocks
  let scanScheduled = false;
  const scheduleScan = () => {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scanThinkingBlocks();
    });
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.target && m.target.nodeType === Node.ELEMENT_NODE && m.target.closest?.('.tt-ui')) {
        continue;
      }
      scheduleScan();
      break;
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Initial scan
  scanThinkingBlocks();

  // Register cleanup for seamless hot reload
  window.__ttCleanup = () => {
    observer.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    for (const el of activeContentEls) {
      el.classList.remove('tt-hide-orig');
      const st = cardStates.get(el);
      if (st) clearTimeout(st.tailTimer);
      if (st?.boxEl) st.boxEl.remove();
    }
    activeContentEls.clear();
    document.getElementById(MODAL_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  };
})();
