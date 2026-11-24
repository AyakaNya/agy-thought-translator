import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-TW', label: '繁體中文（台灣）', promptName: 'Traditional Chinese (Taiwanese technical phrasing)' },
  { code: 'zh-CN', label: '简体中文', promptName: 'Simplified Chinese' },
  { code: 'ja', label: '日本語', promptName: 'Japanese' },
  { code: 'ko', label: '한국어', promptName: 'Korean' },
  { code: 'en', label: 'English', promptName: 'English' },
];

export const DEFAULT_CONFIG = {
  provider: 'gemini',
  targetLang: 'zh-TW',
  autoTranslate: true,
  defaultDisplayMode: 'translation', // 'translation' | 'bilingual'
  gemini: {
    apiKey: '',
    model: 'gemini-2.5-flash-lite',
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  deepl: {
    apiKey: '',
    endpoint: 'https://api-free.deepl.com/v2/translate',
  },
};

export function getDataDir() {
  const dir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR
    || join(homedir(), '.gemini', 'antigravity', 'sidecar_data', 'thought-translator', 'translator', 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigPath() {
  return join(getDataDir(), 'config.json');
}

function deepMergeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    provider: ['gemini', 'openai', 'deepl'].includes(src.provider) ? src.provider : DEFAULT_CONFIG.provider,
    targetLang: typeof src.targetLang === 'string' && src.targetLang ? src.targetLang : DEFAULT_CONFIG.targetLang,
    autoTranslate: typeof src.autoTranslate === 'boolean' ? src.autoTranslate : DEFAULT_CONFIG.autoTranslate,
    defaultDisplayMode: src.defaultDisplayMode === 'bilingual' ? 'bilingual' : 'translation',
    gemini: {
      apiKey: typeof src.gemini?.apiKey === 'string' ? src.gemini.apiKey : DEFAULT_CONFIG.gemini.apiKey,
      model: typeof src.gemini?.model === 'string' && src.gemini.model.trim()
        ? src.gemini.model.trim() : DEFAULT_CONFIG.gemini.model,
    },
    openai: {
      apiKey: typeof src.openai?.apiKey === 'string' ? src.openai.apiKey : DEFAULT_CONFIG.openai.apiKey,
      baseUrl: typeof src.openai?.baseUrl === 'string' && src.openai.baseUrl.trim()
        ? src.openai.baseUrl.trim().replace(/\/+$/, '') : DEFAULT_CONFIG.openai.baseUrl,
      model: typeof src.openai?.model === 'string' && src.openai.model.trim()
        ? src.openai.model.trim() : DEFAULT_CONFIG.openai.model,
    },
    deepl: {
      apiKey: typeof src.deepl?.apiKey === 'string' ? src.deepl.apiKey : DEFAULT_CONFIG.deepl.apiKey,
      endpoint: typeof src.deepl?.endpoint === 'string' && src.deepl.endpoint.trim()
        ? src.deepl.endpoint.trim() : DEFAULT_CONFIG.deepl.endpoint,
    },
  };
}

export function loadConfig() {
  const file = getConfigPath();
  if (!existsSync(file)) return deepMergeConfig({});
  try {
    return deepMergeConfig(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return deepMergeConfig({});
  }
}

export function saveConfig(patch) {
  const current = loadConfig();
  const next = deepMergeConfig({
    ...current,
    ...patch,
    gemini: { ...current.gemini, ...(patch.gemini || {}) },
    openai: { ...current.openai, ...(patch.openai || {}) },
    deepl: { ...current.deepl, ...(patch.deepl || {}) },
  });

  // Preserve existing saved key unless explicitly replaced or cleared with "__CLEAR__"
  for (const p of ['gemini', 'openai', 'deepl']) {
    const incoming = patch?.[p]?.apiKey;
    if (incoming === '__CLEAR__') {
      next[p].apiKey = '';
    } else if (incoming === undefined || incoming === '' || incoming === maskKey(current[p].apiKey)) {
      next[p].apiKey = current[p].apiKey;
    }
  }

  const file = getConfigPath();
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, file);
  return next;
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function getEffectiveApiKey(cfg, provider = cfg.provider) {
  if (provider === 'gemini') {
    if (cfg.gemini.apiKey) return { key: cfg.gemini.apiKey, source: 'config' };
    const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    if (envKey) return { key: envKey, source: 'env' };
    return { key: '', source: 'none' };
  }
  if (provider === 'openai') {
    if (cfg.openai.apiKey) return { key: cfg.openai.apiKey, source: 'config' };
    const envKey = process.env.OPENAI_API_KEY || '';
    if (envKey) return { key: envKey, source: 'env' };
    return { key: '', source: 'none' };
  }
  if (provider === 'deepl') {
    if (cfg.deepl.apiKey) return { key: cfg.deepl.apiKey, source: 'config' };
    const envKey = process.env.DEEPL_API_KEY || '';
    if (envKey) return { key: envKey, source: 'env' };
    return { key: '', source: 'none' };
  }
  return { key: '', source: 'none' };
}

export function isLocalOpenAI(cfg) {
  try {
    const u = new URL(cfg.openai.baseUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return false;
  }
}

export function getPublicConfig(cfg = loadConfig()) {
  const geminiKey = getEffectiveApiKey(cfg, 'gemini');
  const openaiKey = getEffectiveApiKey(cfg, 'openai');
  const deeplKey = getEffectiveApiKey(cfg, 'deepl');
  const activeKey = getEffectiveApiKey(cfg, cfg.provider);
  const ready = Boolean(activeKey.key) || (cfg.provider === 'openai' && isLocalOpenAI(cfg));

  return {
    provider: cfg.provider,
    targetLang: cfg.targetLang,
    autoTranslate: cfg.autoTranslate,
    defaultDisplayMode: cfg.defaultDisplayMode,
    ready,
    languages: SUPPORTED_LANGUAGES,
    gemini: {
      model: cfg.gemini.model,
      apiKeyMasked: maskKey(cfg.gemini.apiKey),
      keySource: geminiKey.source,
    },
    openai: {
      baseUrl: cfg.openai.baseUrl,
      model: cfg.openai.model,
      apiKeyMasked: maskKey(cfg.openai.apiKey),
      keySource: openaiKey.source,
      isLocal: isLocalOpenAI(cfg),
    },
    deepl: {
      endpoint: cfg.deepl.endpoint,
      apiKeyMasked: maskKey(cfg.deepl.apiKey),
      keySource: deeplKey.source,
    },
  };
}
