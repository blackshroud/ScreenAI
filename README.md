# ScreenCopilot

<div align="center">
  <img src="logo.png" alt="ScreenCopilot Logo" width="300" />
</div>

**A general-purpose AI assistant that floats on top of your screen.** Ask questions by typing or speaking, send screenshots for analysis, and switch between specialised personas (general chat, developer, researcher, writer). ScreenCopilot learns your preferences over time and can suggest next steps and automations.

> **Status:** active rewrite. ScreenCopilot started life as an interview-coaching tool ("Aura") and has been reworked into a general AI helper. Some parts of the new code are not fully wired together yet. See [Known Issues](#-known-issues) before relying on a feature.

---

## ✨ Features

### 🎭 Personas
Pick an AI persona from the dropdown in the header. The persona sets the system prompt, and `general_chat` is the default. Defined in `core/personas.py`:

| Persona ID | Name | Focus |
|:--|:--|:--|
| `general_chat` | General Chat | ChatGPT-style general questions and conversation |
| `developer_copilot` | Developer/Coding Copilot | Reads code, terminal output and docs on screen; debugging, refactoring, tests |
| `research_assistant` | Research Assistant | Summaries, factual answers, key-information extraction, data analysis |
| `writer_editor` | Writer/Editor | Drafting, rephrasing, grammar and style |

You can also supply **custom instructions**, which are appended to the persona prompt for every request.

### 🧠 Contextual memory
`services/memory_service.py` keeps a persistent, thread-safe JSON store (`screenai_memory.json`, written atomically to the working directory):

- **User profile**: name, role, company, communication style, preferred tools, skills, projects
- **Task history**, **learned patterns** and an **automation catalog**
- **Conversation summaries** (the last 50 are kept)
- `consolidate()` turns repeated task categories into patterns and automation suggestions

A short memory summary is injected into prompts so answers get more relevant over time. Learning is controlled by `ENABLE_LEARNING`.

### 💡 Suggestions and automation detection
- `services/suggestion_engine.py` proposes related tasks, recent task sequences, pending automations and next steps.
- `core/prompts.py` provides prompt templates for chat, quick (short-form) answers, real-time suggestions and automation detection.
- `GENERATE_FULL_ANSWERS=false` switches to short, direct answers.

### 🪟 Overlay window (Windows)
`services/overlay_service.py` uses Win32 APIs to provide:

- **Capture protection** (`WDA_EXCLUDEFROMCAPTURE`): the window is excluded from screen capture and recording. Set `DEV_MODE=true` to disable this while developing.
- **Hidden from the taskbar and Alt+Tab**
- **Always on top**
- **Ghost mode**: click-through, so mouse input reaches the app underneath
- **Adjustable opacity**: 40% / 70% / 100% presets, or any value from 10 to 100%
- **Keyboard-driven movement** without stealing focus

On non-Windows platforms every overlay operation is a safe no-op, so the app still runs but without these window behaviours.

### 🎤 Voice, 📸 vision and ⚡ multi-provider LLMs
- **Speech-to-text**: Deepgram real-time transcription (`services/stt_service.py`)
- **Vision**: screenshot queue and analysis (`services/vision_service.py`, `web/js/screenshot-service.js`)
- **LLMs**: any OpenAI-compatible provider (Cerebras, Groq, Gemini, OpenRouter) with multiple API keys per provider, key rotation, failover and health checks (`services/llm_service.py`)
- **Streaming markdown** rendering with syntax highlighting (Prism.js)

---

## ⌨️ Global Hotkeys

Hotkeys are system-wide (registered with `pynput`), so you never need to focus the window. Implemented in `services/hotkey_service.py`:

| Category | Hotkey | Action |
|:--|:--|:--|
| **Window** | `Alt + Z` | Show / hide the overlay |
| | `Alt + X` | Toggle ghost mode (click-through) |
| | `Alt + 1` / `2` / `3` | Opacity 40% / 70% / 100% |
| | `Alt + ←` / `→` | Move window left / right |
| | `Alt + I` / `J` | Move window up / down |
| **Scrolling** | `Alt + ↑` / `↓` | Scroll the conversation (hold for continuous scroll) |
| **Screenshots** | `Alt + S` | Capture a screenshot |
| | `Alt + P` | Process the screenshot queue |
| | `Alt + R` | Clear the screenshot queue |
| **Audio / session** | `Alt + M` | Toggle microphone mute |
| | `Alt + U` | Pause / resume all audio |
| | `Alt + O` | Reset the session |

Scroll speed is configurable with `SCROLL_SPEED_PX` (default 150) and `SCROLL_INTERVAL_MS` (default 50, minimum 10) in `.env`.

---

## 🏗️ Architecture

`pywebview` owns the main thread and shows the UI. FastAPI and Uvicorn run in a background thread on a free local port (preferring 8002), together with the session-cleanup task. Hotkeys start once the native window has been created.

| Component | Path | Role |
|:--|:--|:--|
| Entry point | `main.py` | Starts the server thread, creates the window, applies overlay settings, starts hotkeys |
| WebSocket API | `api/websocket.py` | Routes `{type, payload}` messages to `handle_<type>` methods on the session |
| Session manager | `api/session_manager.py` | Session lifecycle, chat, task completion, suggestions, memory and status handlers |
| Config API | `api/config_api.py` | REST endpoints for settings, providers and overlay |
| Overlay service | `services/overlay_service.py` | Win32 window behaviour |
| Hotkey service | `services/hotkey_service.py` | Global hotkeys |
| LLM service | `services/llm_service.py` | Multi-provider LLM manager with rotation and failover |
| STT service | `services/stt_service.py` | Deepgram transcription |
| Vision service | `services/vision_service.py` | Screenshot analysis |
| Context manager | `services/context_manager.py` | Per-session persona, custom instructions and conversation history |
| Memory service | `services/memory_service.py` | Persistent learned memory |
| Suggestion engine | `services/suggestion_engine.py` | Suggestions and automation detection |
| Personas / prompts | `core/personas.py`, `core/prompts.py` | System prompts and prompt templates |
| Settings | `core/config.py` | `pydantic-settings` configuration loaded from `.env` |
| Frontend | `web/` | Vanilla HTML/CSS/JS served at `/static`, entry module `web/js/main.js` |
| Legacy | `utils/deprecated_window_manager.py` | Old window manager, kept for reference only |

### REST endpoints
`GET /api/config`, `GET /api/ai-providers`, `GET /api/ai-providers/full`, `POST /api/save-ai-providers`, `GET /api/deepgram-key`, `POST /api/save-deepgram-key`, `POST /api/verify-provider`, `POST /api/verify-vision-provider`, `GET|POST /api/opacity`, `POST /api/opacity/preset/{level}`, `POST /api/ghost-mode`.

### WebSocket message types (`/ws`)
`verify_deepgram`, `start_session`, `audio_chunk`, `config_update`, `switch_preset`, `vision_analysis`, `end_session`, `reset_session`, `chat`, `task_completed`, `get_suggestions`, `learn_preference`, `get_memory_summary`, `get_system_status`.

---

## 🚀 Getting Started

### Requirements
- **Windows 10/11** for the overlay features (capture protection, ghost mode, taskbar hiding). Other platforms run without them.
- **Python 3.8+**
- A **Deepgram** API key (speech-to-text) and at least one LLM provider key (Cerebras, Groq, Gemini or OpenRouter all have free tiers)

### Install and run
```bash
git clone https://github.com/blackshroud/ScreenAI
cd ScreenAI

python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
cp ai_providers.example.json ai_providers.json
# add your keys to .env and ai_providers.json

python main.py
```

On Windows you can also double-click `run.bat` (creates the venv, installs dependencies and launches the app) or `silent_run.vbs` (launches with no visible terminal window). `.env` is created automatically from `.env.example` on first launch if it is missing.

### Configuration (`.env`)

| Setting | Default | Purpose |
|:--|:--|:--|
| `DEEPGRAM_API_KEY` | *(required)* | Speech-to-text key |
| `LOG_LEVEL` | `INFO` | Logging level |
| `DEV_MODE` | `false` | Developer mode: disables capture protection and enables debug output |
| `TRACK_USER_RESPONSES` | `true` | Record the user's spoken responses in conversation history |
| `INCLUDE_CONVERSATION_HISTORY` | `true` | Include history in prompts |
| `MAX_CONVERSATION_HISTORY` | `6` | Number of exchanges kept |
| `GENERATE_FULL_ANSWERS` | `true` | Full answers vs. short answers |
| `PERSONALIZE_ANSWERS` | `true` | Personalise answers |
| `ENABLE_LEARNING` | `true` | Learn from conversations into memory |
| `ENABLE_SUGGESTIONS` | `true` | Enable the suggestion engine |
| `ENABLE_AUTOMATION_DETECTION` | `true` | Detect automation opportunities |
| `MAX_TASK_HISTORY` | `200` | Task history cap |
| `SUGGESTION_COOLDOWN_SECONDS` | `300` | Minimum gap between suggestions |
| `SCROLL_SPEED_PX` | `150` | Pixels per scroll tick |
| `SCROLL_INTERVAL_MS` | `50` | Milliseconds between scroll ticks |

> `.env.example` has not been updated for the new settings yet, so add the learning and suggestion variables above manually if you want to change them. The defaults apply when they are absent.

### AI providers (`ai_providers.json`)
Copy `ai_providers.example.json` and replace the placeholder keys. Each provider supports a single `apiKey` or an `apiKeys` array for rotation, plus `models`, `visionModels`, `supportsVision`, `defaultModel` and `defaultVisionModel`. The file is git-ignored so your keys stay private. A single provider with one key is enough to start.

---

## ⚠️ Known Issues

This is a work-in-progress rewrite. The following were found while updating this document and are **not yet fixed**:

1. **Frontend will not load.** `web/js/main.js` imports `./preset-manager.js`, which was removed in the rewrite.
2. **Session start fails.** `handle_start_session` in `api/session_manager.py` references an undefined `onboarding_context`.
3. **Message mismatch.** The UI sends `user_question` and `toggle_mic_mute`, which have no backend handlers (the backend implements `chat`), and `handle_chat` calls `llm_manager.get_prompts()`, which does not exist.
4. **Memory API mismatch.** `session_manager.py` and `suggestion_engine.py` call `memory_service.add_task_history()` and `get_automations()`. The service defines `record_task()` and `get_automation_catalog()`.
5. **Opacity hotkeys in the page** (`web/js/hotkeys.js`, `Alt+[` / `Alt+]`) call `/api/transparency`, which no longer exists. Use `Alt+1/2/3` or `/api/opacity`.
6. **Stale config template.** `.env.example` still has `TRACK_CANDIDATE_RESPONSES` instead of `TRACK_USER_RESPONSES` and omits the learning settings.
7. **Leftover interview-era files.** `web/css/live-interview.css`, `PROCTORING_STEALTH_GUIDE.md` and `CONTRIBUTING.md` (which mentions `window_manager.py`) have not been updated.
8. **Personas list is hard-coded** in `web/js/ui_manager.js` rather than loaded from the backend.
9. `screenai_memory.json` is written to the working directory and is not in `.gitignore`.

---

## 📦 Tech Stack

| Layer | Technology |
|:--|:--|
| Runtime | Python 3.8+, asyncio |
| Web framework | FastAPI + Uvicorn |
| Desktop shell | pywebview (WinForms backend) |
| Speech-to-text | Deepgram SDK v3 |
| LLM clients | OpenAI-compatible SDK (Cerebras, Groq, Gemini, OpenRouter) |
| Global hotkeys | pynput |
| Window management | Win32 via ctypes |
| Frontend | Vanilla HTML/CSS/JS with WebSocket streaming |
| Config | pydantic-settings + python-dotenv |

---

## 🤝 Contributing

Bug reports, ideas and pull requests are welcome. Fixing the [Known Issues](#-known-issues) is the most useful place to start.

- **Bugs**: open an issue with steps to reproduce and the terminal output
- **Features**: describe the use case and expected behaviour
- **Pull requests**: fork, branch, commit, open a PR

Please use PEP 8 for Python, vanilla JS and CSS for the frontend, and never commit `.env` or `ai_providers.json`.

---

## ⚖️ Responsible Use

You are responsible for complying with the laws, workplace rules, and exam or platform policies that apply where you use this software. Capture protection hides the overlay from screen recordings; it is intended for privacy and focus, not for violating the rules of any exam or interview. AI output can be wrong, so verify anything important.

---

## 📄 License

See [LICENSE](LICENSE).
