import { getEffectiveApiKey, isLocalOpenAI, SUPPORTED_LANGUAGES } from './config.mjs';

function targetLangPromptName(code) {
  const found = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return found ? found.promptName : code;
}

function buildSystemPrompt(targetLang, context = '') {
  const langName = targetLangPromptName(targetLang);
  const lines = [
    `You are a concise, accurate technical translator. Translate the following AI model's internal reasoning/thinking text into ${langName}.`,
    'Rules:',
    '1. Output ONLY the translated text. Do not add preambles, explanations, quotes, or notes.',
    '2. Preserve code blocks, inline code, file paths, CLI commands, API/function/variable names, and technical identifiers verbatim.',
    '3. Keep paragraph structure, bullet points, and markdown formatting intact.',
    '4. Use natural, idiomatic phrasing suitable for a software engineer.',
  ];
  if (context && context.trim()) {
    lines.push(
      '',
      'Previous translated context (for terminology and tone continuity ONLY — do NOT repeat or include it in your output):',
      context.trim().slice(-240),
    );
  }
  return lines.join('\n');
}

async function readSSELines(response, onDataLine) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (data) onDataLine(data);
      }
    }
  }
  if (buffer.trim().startsWith('data:')) {
    const data = buffer.trim().slice(5).trim();
    if (data) onDataLine(data);
  }
}

async function translateGemini({ text, targetLang, context, config, signal, onChunk }) {
  const { key } = getEffectiveApiKey(config, 'gemini');
  if (!key) {
    throw new Error('Missing Gemini API key. Open Settings or set GEMINI_API_KEY.');
  }
  const model = config.gemini.model || 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildSystemPrompt(targetLang, context) }],
      },
      contents: [
        { role: 'user', parts: [{ text }] },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 240)}`);
  }

  let full = '';
  await readSSELines(res, (data) => {
    try {
      const parsed = JSON.parse(data);
      const parts = parsed?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (typeof part?.text === 'string' && part.text) {
            full += part.text;
            onChunk?.(part.text, full);
          }
        }
      }
    } catch {}
  });

  if (!full.trim()) {
    throw new Error('Gemini returned empty translation.');
  }
  return { translation: full.trim(), provider: 'gemini', model };
}

async function translateOpenAI({ text, targetLang, context, config, signal, onChunk }) {
  const { key } = getEffectiveApiKey(config, 'openai');
  if (!key && !isLocalOpenAI(config)) {
    throw new Error('Missing OpenAI-compatible API key. Open Settings or set OPENAI_API_KEY.');
  }
  const baseUrl = (config.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = config.openai.model || 'gpt-4o-mini';
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: 'system', content: buildSystemPrompt(targetLang, context) },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 240)}`);
  }

  let full = '';
  await readSSELines(res, (data) => {
    if (data === '[DONE]') return;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        full += delta;
        onChunk?.(delta, full);
      }
    } catch {}
  });

  if (!full.trim()) {
    throw new Error('OpenAI-compatible endpoint returned empty translation.');
  }
  return { translation: full.trim(), provider: 'openai', model };
}

function mapDeepLTarget(code) {
  switch (code) {
    case 'zh-TW': return 'ZH-HANT';
    case 'zh-CN': return 'ZH-HANS';
    case 'ja': return 'JA';
    case 'ko': return 'KO';
    case 'en': return 'EN-US';
    default: return code.toUpperCase();
  }
}

async function translateDeepL({ text, targetLang, config, signal, onChunk }) {
  const { key } = getEffectiveApiKey(config, 'deepl');
  if (!key) {
    throw new Error('Missing DeepL API key. Open Settings or set DEEPL_API_KEY.');
  }
  const endpoint = config.deepl.endpoint || 'https://api-free.deepl.com/v2/translate';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `DeepL-Auth-Key ${key}`,
    },
    signal,
    body: JSON.stringify({
      text: [text],
      target_lang: mapDeepLTarget(targetLang),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepL API ${res.status}: ${errText.slice(0, 240)}`);
  }

  const parsed = await res.json();
  const translated = parsed?.translations?.[0]?.text || '';
  if (!translated.trim()) {
    throw new Error('DeepL returned empty translation.');
  }
  onChunk?.(translated, translated);
  return { translation: translated.trim(), provider: 'deepl', model: 'deepl' };
}

export async function translateStream({ text, targetLang, context = '', config, signal, onChunk }) {
  const provider = config.provider || 'gemini';
  if (provider === 'gemini') {
    return translateGemini({ text, targetLang, context, config, signal, onChunk });
  }
  if (provider === 'openai') {
    return translateOpenAI({ text, targetLang, context, config, signal, onChunk });
  }
  if (provider === 'deepl') {
    return translateDeepL({ text, targetLang, config, signal, onChunk });
  }
  throw new Error(`Unsupported provider: ${provider}`);
}
