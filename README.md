# Thought Translator (In-Place Antigravity Plugin)

Automatically translates model thinking blocks **in-place** directly inside Antigravity chat windows — no sidebar needed.

## How It Works

- **Headless Background Sidecar (`has_web_ui: false`)**: Runs silently in Node.js (zero external dependencies) and attaches to Antigravity windows via local CDP (`DevToolsActivePort`).
- **Zero-CORS / Zero-CSP Bridge**: Uses CDP `Runtime.addBinding` so API keys stay securely in Node.js (`0600` config file) and never leak into page scripts.
- **React-Safe In-Place Rendering**: Never mutates React-managed text nodes. Injects a clean scoped translation overlay into each expanded thinking block with a mini switcher: **`譯文` / `雙語` / `原文`**, plus **↻ 重翻** and **⚙ 設定** (also accessible anytime via `Alt + Shift + T`).
- **Multi-Provider Streaming**:
  - **Gemini API** (default, streaming SSE, falls back to `GEMINI_API_KEY`)
  - **OpenAI-Compatible** (OpenAI, DeepSeek, OpenRouter, local Ollama / LM Studio)
  - **DeepL API** (Free / Pro)
- **Smart Cost Control**: Skips thinking already written in the target language and caches translated blocks on disk (`translations.json`).

## Install

Clone directly into your Antigravity plugins directory:

```bash
git clone https://github.com/AyakaNya/agy-thought-translator.git ~/.gemini/config/plugins/thought-translator
```

Or clone anywhere and symlink it:

```bash
git clone https://github.com/AyakaNya/agy-thought-translator.git
ln -s "$(pwd)/agy-thought-translator" ~/.gemini/config/plugins/thought-translator
```

Then enable **Thought Translator** in Antigravity Customizations, expand any thinking block (or press `Alt + Shift + T`), and configure your API key in the settings modal. Works alongside `chuanban-antigravity-theme-patch` without conflicts.
