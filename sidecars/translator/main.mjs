/**
 * Thought Translator — Headless CDP Injector & Translation Bridge
 *
 * 1. Discovers running Antigravity Electron windows via DevToolsActivePort (Stable & Insiders).
 * 2. Connects via native Node WebSocket (zero external dependencies) and attaches
 *    a Runtime.addBinding bridge (__ttHostCall) + injects inject/runtime.js.
 * 3. Handles streaming translation requests (Gemini / OpenAI-Compatible / DeepL),
 *    language-skip checks, disk caching, and secure config storage locally in Node.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPublicConfig, loadConfig, saveConfig } from './lib/config.mjs';
import { getCachedTranslation, setCachedTranslation } from './lib/cache.mjs';
import { shouldSkipTranslation } from './lib/lang.mjs';
import { translateStream } from './lib/providers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_FILE = join(__dirname, 'inject', 'runtime.js');
const POLL_TARGETS_MS = 3000;
const BINDING_NAME = '__ttHostCall';

// Active CDP sessions keyed by target id
const sessions = new Map(); // targetId -> CdpTargetSession
const activeAbortControllers = new Map(); // reqId -> AbortController

function getPortFileCandidates() {
  const home = homedir();
  const names = ['Antigravity', 'Antigravity - Insiders'];
  const files = [];
  for (const appName of names) {
    if (process.platform === 'darwin') {
      files.push(join(home, 'Library', 'Application Support', appName, 'DevToolsActivePort'));
    } else if (process.platform === 'win32') {
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      files.push(join(appData, appName, 'DevToolsActivePort'));
    } else {
      const xdg = process.env.XDG_CONFIG_HOME || join(home, '.config');
      files.push(join(xdg, appName, 'DevToolsActivePort'));
    }
  }
  return files;
}

function discoverCdpPorts() {
  const ports = new Set();
  for (const file of getPortFileCandidates()) {
    if (!existsSync(file)) continue;
    try {
      const firstLine = readFileSync(file, 'utf-8').trim().split(/\r?\n/)[0];
      const port = parseInt(firstLine, 10);
      if (port > 0 && port < 65536) ports.add(port);
    } catch {}
  }
  // Fallback well-known ports if DevToolsActivePort wasn't written
  if (ports.size === 0) {
    ports.add(9222);
    ports.add(9223);
  }
  return [...ports];
}

function readRuntimePayload() {
  const code = readFileSync(RUNTIME_FILE, 'utf-8');
  const sig = createHash('sha256').update(code).digest('hex').slice(0, 12);
  return { code, sig };
}

function isChatPageTarget(t) {
  if (!t || t.type !== 'page' || !t.webSocketDebuggerUrl) return false;
  const url = String(t.url || '');
  if (!url || url.startsWith('data:') || url.startsWith('devtools:') || url.startsWith('about:')) {
    return false;
  }
  // Antigravity chat windows run on local loopback https/http or app origin
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url) || url.startsWith('vscode-file://');
}

class CdpTargetSession {
  constructor(target) {
    this.targetId = target.id;
    this.wsUrl = target.webSocketDebuggerUrl;
    this.url = target.url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.injectedSig = '';
    this.closed = false;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 5000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = (err) => { clearTimeout(timer); reject(err); };
    });

    this.ws.onmessage = (evt) => this.#onMessage(evt.data);
    this.ws.onclose = () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
      sessions.delete(this.targetId);
    };

    await this.send('Runtime.enable');
    await this.send('Runtime.addBinding', { name: BINDING_NAME });
    await this.injectIfNeeded();
  }

  send(method, params = {}) {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP socket not open'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async injectIfNeeded() {
    const { code, sig } = readRuntimePayload();
    if (this.injectedSig === sig) return;
    const initConfig = JSON.stringify(getPublicConfig());
    const wrapped = `
      (() => {
        window.__TT_SIG__ = ${JSON.stringify(sig)};
        window.__TT_INIT_CONFIG__ = ${initConfig};
      })();
      ${code}
    `;
    await this.send('Runtime.evaluate', {
      expression: wrapped,
      awaitPromise: false,
      returnByValue: false,
    });
    this.injectedSig = sig;
    console.log(`[thought-translator] injected runtime (${sig}) into ${this.url.slice(0, 60)}`);
  }

  pushEvent(eventObj) {
    if (this.closed) return;
    const expr = `window.__ttOnHostEvent && window.__ttOnHostEvent(${JSON.stringify(eventObj)});`;
    this.send('Runtime.evaluate', { expression: expr }).catch(() => {});
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return;
    }

    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
      else resolve(msg.result);
      return;
    }

    if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === BINDING_NAME) {
      this.#handleBindingCall(msg.params.payload).catch((err) => {
        console.error('[thought-translator] binding error:', err.message);
      });
    }

    // Re-inject automatically if the page navigated or reloaded
    if (msg.method === 'Runtime.executionContextCreated' && msg.params?.context?.auxData?.isDefault) {
      this.injectedSig = '';
      setTimeout(() => {
        if (!this.closed) {
          this.send('Runtime.addBinding', { name: BINDING_NAME })
            .then(() => this.injectIfNeeded())
            .catch(() => {});
        }
      }, 300);
    }
  }

  async #handleBindingCall(payloadStr) {
    let req;
    try {
      req = JSON.parse(payloadStr);
    } catch {
      return;
    }
    const { reqId, action, payload } = req || {};
    if (!reqId || !action) return;

    const reply = (ok, data, error) => {
      this.pushEvent({ type: 'response', reqId, ok, data, error });
    };

    try {
      if (action === 'getConfig') {
        reply(true, getPublicConfig());
        return;
      }

      if (action === 'saveConfig') {
        const updated = saveConfig(payload || {});
        const pub = getPublicConfig(updated);
        reply(true, pub);
        // Broadcast updated config to all attached windows
        for (const s of sessions.values()) {
          s.pushEvent({ type: 'configUpdated', config: pub });
        }
        return;
      }

      if (action === 'testProvider') {
        const cfg = loadConfig();
        const sample = 'Checking the configuration file and verifying the translation pipeline.';
        const result = await translateStream({
          text: sample,
          targetLang: cfg.targetLang,
          config: cfg,
        });
        reply(true, { sample, ...result });
        return;
      }

      if (action === 'cancelTranslate') {
        const targetReqId = payload?.reqId;
        const ac = activeAbortControllers.get(targetReqId);
        if (ac) {
          ac.abort();
          activeAbortControllers.delete(targetReqId);
        }
        reply(true, { cancelled: Boolean(ac) });
        return;
      }

      if (action === 'translate') {
        const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
        const context = typeof payload?.context === 'string' ? payload.context : '';
        const force = Boolean(payload?.force);
        const cfg = loadConfig();
        const targetLang = cfg.targetLang;

        if (!text) {
          reply(true, { status: 'skipped', translation: '' });
          return;
        }

        if (!force) {
          const skipCheck = shouldSkipTranslation(text, targetLang);
          if (skipCheck.skip) {
            reply(true, { status: 'skipped', translation: text, reason: skipCheck.reason });
            return;
          }
          const cached = getCachedTranslation(text, targetLang);
          if (cached) {
            reply(true, {
              status: 'translated',
              cached: true,
              translation: cached.translation,
              provider: cached.provider,
              model: cached.model,
            });
            return;
          }
        }

        const ac = new AbortController();
        activeAbortControllers.set(reqId, ac);

        let lastPush = 0;
        try {
          const result = await translateStream({
            text,
            targetLang,
            context,
            config: cfg,
            signal: ac.signal,
            onChunk: (_delta, full) => {
              const now = Date.now();
              if (now - lastPush >= 80) {
                lastPush = now;
                this.pushEvent({ type: 'stream', reqId, text: full });
              }
            },
          });
          setCachedTranslation(text, targetLang, result);
          reply(true, {
            status: 'translated',
            cached: false,
            translation: result.translation,
            provider: result.provider,
            model: result.model,
          });
        } finally {
          activeAbortControllers.delete(reqId);
        }
        return;
      }

      reply(false, null, `Unknown action: ${action}`);
    } catch (err) {
      if (err?.name === 'AbortError') {
        reply(false, null, 'Cancelled');
      } else {
        reply(false, null, err instanceof Error ? err.message : String(err));
      }
    }
  }
}

async function scanAndAttach() {
  const ports = discoverCdpPorts();
  for (const port of ports) {
    let targets;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) continue;
      targets = await res.json();
    } catch {
      continue;
    }

    if (!Array.isArray(targets)) continue;
    for (const t of targets) {
      if (!isChatPageTarget(t)) continue;
      if (sessions.has(t.id)) {
        // Hot-reload runtime.js if file changed on disk during development
        sessions.get(t.id).injectIfNeeded().catch(() => {});
        continue;
      }
      const session = new CdpTargetSession(t);
      sessions.set(t.id, session);
      session.connect().catch(() => {
        sessions.delete(t.id);
      });
    }
  }
}

console.log('[thought-translator] headless CDP injector started.');
scanAndAttach();
setInterval(scanAndAttach, POLL_TARGETS_MS);

// Graceful shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
