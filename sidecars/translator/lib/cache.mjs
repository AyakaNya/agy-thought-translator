import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from './config.mjs';

const MAX_ENTRIES = 2000;
let memCache = null;

function cacheFile() {
  const dir = join(getDataDir(), 'cache');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'translations.json');
}

export function hashText(text) {
  return createHash('sha256').update(String(text ?? '').trim()).digest('hex').slice(0, 16);
}

export function makeCacheKey(text, targetLang) {
  return `${hashText(text)}:${targetLang}`;
}

function loadStore() {
  if (memCache) return memCache;
  const file = cacheFile();
  memCache = {};
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'));
      if (parsed && typeof parsed === 'object') memCache = parsed;
    } catch {
      memCache = {};
    }
  }
  return memCache;
}

function saveStore(store) {
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => (store[a]?.ts || 0) - (store[b]?.ts || 0));
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) {
      delete store[k];
    }
  }
  const file = cacheFile();
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmp, file);
}

export function getCachedTranslation(text, targetLang) {
  const store = loadStore();
  return store[makeCacheKey(text, targetLang)] || null;
}

export function setCachedTranslation(text, targetLang, entry) {
  const store = loadStore();
  store[makeCacheKey(text, targetLang)] = {
    translation: entry.translation,
    provider: entry.provider,
    model: entry.model,
    targetLang,
    ts: Date.now(),
  };
  saveStore(store);
}
