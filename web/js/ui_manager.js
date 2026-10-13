import { devLog } from './config.js';
import { StreamingMarkdownParser } from './streaming-markdown-parser.js';

const FALLBACK_PERSONAS = [
    { id: 'general_chat', name: 'General Chat', description: 'Standard AI assistant' },
    { id: 'developer_copilot', name: 'Developer/Coding Copilot', description: 'Helps with code' },
    { id: 'research_assistant', name: 'Research Assistant', description: 'Summarizes, extracts data' },
    { id: 'writer_editor', name: 'Writer/Editor', description: 'Drafts, rephrases, corrects' }
];
const SENDER_LABELS = { user: 'You', ai: 'ScreenCopilot', other: 'Other' };
const NEAR_BOTTOM_PX = 80;

export class UIManager {
    constructor(stateManager, webSocketHandler, providerManager) {
        this.stateManager = stateManager;
        this.webSocketHandler = webSocketHandler;
        this.providerManager = providerManager;

        this.conversationStream = null;
        this.activityIndicator = null;
        this.statusIndicator = null;
        this.statusText = null;
        this.personaSelect = null;

        this.currentUserElement = null; // live transcript bubble being updated
        this.currentAIElement = null;   // AI bubble being streamed into
        this.aiParser = null;
        this.listening = false;
        this.sessionReady = false;
        this.onListeningState = null; // set by main.js

        this.personas = {};
        this.selectedPersona = 'general_chat';
    }

    init() {
        this.conversationStream = document.getElementById('conversation-stream');
        this.activityIndicator = document.getElementById('activity-indicator');
        this.statusIndicator = document.querySelector('.copilot-status .status-indicator');
        this.statusText = document.getElementById('status-text');
        this.personaSelect = document.getElementById('persona-select');
        devLog('UIManager initialized.');
    }

    // --- Personas ---
    async loadPersonas() {
        let list = FALLBACK_PERSONAS;
        try {
            const response = await fetch('/api/personas');
            if (response.ok) list = await response.json();
        } catch (error) {
            devLog('Could not load personas from backend, using built-in list.', error);
        }
        this.personas = {};
        list.forEach(p => { this.personas[p.id] = p; });

        if (this.personaSelect) {
            this.personaSelect.innerHTML = '';
            list.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                option.title = p.description || '';
                this.personaSelect.appendChild(option);
            });
            this.personaSelect.value = this.selectedPersona;
        }
    }

    setSelectedPersona(personaId) {
        this.selectedPersona = personaId;
        devLog(`Selected persona: ${personaId}`);
    }

    getSelectedPersona() {
        return this.selectedPersona;
    }

    // --- Status and activity ---
    setStatus(text, state = 'pending') {
        if (this.statusText) this.statusText.textContent = text;
        if (this.statusIndicator) {
            this.statusIndicator.classList.remove('recording', 'connected', 'error');
            this.statusIndicator.classList.add(state === 'pending' ? 'recording' : state);
        }
    }

    setListening(isListening) {
        this.listening = isListening;
        this.hideActivity();
    }

    showActivity(text) {
        if (!this.activityIndicator) return;
        const label = this.activityIndicator.querySelector('span');
        if (label) label.textContent = text;
        this.activityIndicator.classList.add('active');
    }

    hideActivity() {
        if (!this.activityIndicator) return;
        if (this.listening) {
            this.showActivity('Listening...');
        } else {
            this.activityIndicator.classList.remove('active');
        }
    }

    // --- Conversation stream ---
    renderMarkdown(text) {
        const parser = new StreamingMarkdownParser();
        parser.buffer = text || '';
        return parser.finalize();
    }

    _contentOf(messageElement) {
        return messageElement.querySelector('.message-content');
    }

    isNearBottom() {
        const s = this.conversationStream;
        return !s || s.scrollHeight - s.scrollTop - s.clientHeight < NEAR_BOTTOM_PX;
    }

    scrollToBottom() {
        if (this.conversationStream) {
            this.conversationStream.scrollTop = this.conversationStream.scrollHeight;
        }
    }

    clearWelcome() {
        const welcome = this.conversationStream?.querySelector('.initial-message');
        if (welcome) welcome.remove();
    }

    addMessage(sender, text, { markdown = false } = {}) {
        if (!this.conversationStream) return null;
        this.clearWelcome();

        const element = document.createElement('div');
        element.classList.add('chat-message', `${sender}-message`);

        const header = document.createElement('div');
        header.className = 'message-sender';
        header.textContent = SENDER_LABELS[sender] || sender;

        const content = document.createElement('div');
        content.className = 'message-content';
        if (markdown) {
            content.innerHTML = this.renderMarkdown(text);
        } else {
            content.textContent = text || '';
        }

        element.append(header, content);
        const stick = this.isNearBottom();
        this.conversationStream.appendChild(element);
        if (stick) this.scrollToBottom();
        return element;
    }

    addUserMessage(text) {
        this.addMessage('user', text);
    }

    // Live transcript from speech-to-text: interim results update one bubble.
    updateUserMessage(interimTranscript) {
        if (!this.currentUserElement) {
            this.currentUserElement = this.addMessage('user', '');
            this.currentUserElement?.classList.add('interim');
        }
        if (this.currentUserElement) {
            this._contentOf(this.currentUserElement).textContent = interimTranscript;
        }
    }

    finalizeUserMessage(finalTranscript) {
        if (this.currentUserElement) {
            this._contentOf(this.currentUserElement).textContent = finalTranscript;
            this.currentUserElement.classList.remove('interim');
            this.currentUserElement = null;
        } else {
            this.addMessage('user', finalTranscript);
        }
    }

    updateOtherMessage(interimTranscript) {
        this.updateUserMessage(interimTranscript);
    }

    finalizeOtherMessage(finalTranscript) {
        this.finalizeUserMessage(finalTranscript);
    }

    // --- AI answers (streamed) ---
    beginAIMessage() {
        this.currentAIElement = this.addMessage('ai', '');
        this.currentAIElement?.classList.add('streaming');
        this.aiParser = new StreamingMarkdownParser();
    }

    appendAIChunk(chunk) {
        if (!this.currentAIElement) this.beginAIMessage();
        if (!this.currentAIElement) return;
        const stick = this.isNearBottom();
        this._contentOf(this.currentAIElement).innerHTML = this.aiParser.processChunk(chunk);
        if (stick) this.scrollToBottom();
    }

    finalizeAIResponse(answer) {
        if (this.currentAIElement) {
            this._contentOf(this.currentAIElement).innerHTML = this.renderMarkdown(answer);
            this.currentAIElement.classList.remove('streaming');
            this.currentAIElement = null;
            this.aiParser = null;
        } else {
            this.addMessage('ai', answer, { markdown: true });
        }
        this.scrollToBottom();
    }

    discardEmptyAIMessage() {
        if (this.currentAIElement && !this._contentOf(this.currentAIElement).textContent.trim()) {
            this.currentAIElement.remove();
        }
        this.currentAIElement = null;
        this.aiParser = null;
    }

    // --- Backend messages ---
    handleMessage(type, payload) {
        switch (type) {
            case 'preset_initialized': {
                this.sessionReady = true;
                const preset = payload.current_preset || {};
                const anyHealthy = Object.values(payload.health_status || {}).some(Boolean);
                if (anyHealthy) {
                    this.setStatus(`Ready - ${preset.provider || 'AI'} ${preset.model || ''}`.trim(), 'connected');
                } else {
                    this.setStatus('No working AI provider - add an API key to ai_providers.json', 'error');
                    this.showNotification('No AI provider responded. Add a valid API key to ai_providers.json and restart.', 'error');
                }
                break;
            }
            case 'listening_state':
                if (this.onListeningState) this.onListeningState(payload);
                break;
            case 'ai_processing_started':
                this.currentAIElement = null;
                this.aiParser = null;
                this.showActivity('Thinking...');
                break;
            case 'ai_answer_chunk':
                this.appendAIChunk(payload.chunk || '');
                break;
            case 'ai_answer_complete':
                this.finalizeAIResponse(payload.answer || '');
                this.hideActivity();
                if (payload.error) this.showNotification('The AI provider reported an error.', 'error');
                break;
            case 'vision_analysis_result':
                this.hideActivity();
                if (payload.success) {
                    this.addMessage('ai', payload.analysis || '', { markdown: true });
                } else {
                    this.showNotification(payload.error || payload.analysis || 'Screenshot analysis failed.', 'error');
                }
                if (typeof window.visionAnalysisResolver === 'function') window.visionAnalysisResolver(payload);
                break;
            case 'error':
                this.discardEmptyAIMessage();
                this.hideActivity();
                this.showNotification(payload.message || 'Something went wrong.', 'error');
                if (!this.sessionReady) this.setStatus('Not connected to an AI provider', 'error');
                break;
            case 'persona_updated':
                this.showNotification(`Switched to ${this.personas[payload.persona_id]?.name || payload.persona_id} persona.`);
                break;
            case 'session_reset_complete':
                this.showNotification('Session has been reset.');
                break;
            case 'api_key_status':
                devLog(`API key status for ${payload.service}: ${payload.valid}`);
                break;
            default:
                devLog(`[UIManager] Unhandled message type: ${type}`, payload);
        }
    }

    // --- Utilities ---
    clearConversation() {
        this.currentUserElement = null;
        this.currentAIElement = null;
        this.aiParser = null;
        if (this.conversationStream) {
            this.conversationStream.innerHTML = `
                <div class="initial-message">
                    <h1>Welcome to ScreenCopilot!</h1>
                    <p>Select a persona above to get started or just ask me anything.</p>
                    <p>Use global hotkeys for seamless interaction (e.g., Alt+S to screenshot).</p>
                </div>`;
        }
    }

    showNotification(message, type = 'info') {
        console.log(`[Notification - ${type.toUpperCase()}]: ${message}`);
        const area = document.getElementById('notification-area');
        if (!area) return;
        const toast = document.createElement('div');
        toast.classList.add('notification', type);
        toast.textContent = message;
        area.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    showErrorNotification(message) {
        this.showNotification(message, 'error');
    }
}
