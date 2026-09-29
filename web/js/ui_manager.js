import { devLog, isDev } from './config.js';
import { LiveStreaming } from './live-streaming.js';
import muteManager from './mute-manager.js';
import { StreamingMarkdownParser } from './streaming-markdown-parser.js';

export class UIManager {
    constructor(stateManager, webSocketHandler, providerManager) {
        this.stateManager = stateManager;
        this.webSocketHandler = webSocketHandler;
        this.providerManager = providerManager;

        this.conversationStream = null;
        this.activityIndicator = null;
        this.personaSelect = null;
        this.userQuestionInput = null;
        this.sendQuestionBtn = null;
        this.muteButton = null;
        this.resetSessionButton = null;
        this.endSessionButton = null;

        this.currentInterlocutorElement = null; // General element for who is speaking to the AI
        this.currentAIElement = null; // Track AI message separately
        this.isStreaming = false;

        this.streaming = new LiveStreaming({
            enableStreaming: true,
            streamingSpeed: 15,
            aiStreamingSpeed: 5
        });
        this.markdownParser = new StreamingMarkdownParser();
        this.thinkingFilterEnabled = true; // Still useful for internal AI thoughts

        this.personas = {}; // To store loaded personas
        this.selectedPersona = 'general_chat';
    }

    init() {
        this.conversationStream = document.getElementById('conversation-stream');
        this.activityIndicator = document.getElementById('activity-indicator');
        this.personaSelect = document.getElementById('persona-select');
        this.userQuestionInput = document.getElementById('user-question-input');
        this.sendQuestionBtn = document.getElementById('send-question-btn');
        this.muteButton = document.getElementById('mute-btn');
        this.resetSessionButton = document.getElementById('reset-session-btn');
        this.endSessionButton = document.getElementById('end-session-btn');

        // Setup basic event listeners that are now managed by main.js's setupUIEventListeners
        // No direct listeners here, main.js will wire them up.
        devLog("UIManager initialized.");
    }

    async loadPersonas() {
        // Fetch personas from backend or a local config
        // For now, hardcode or fetch dynamically later
        this.personas = {
            "general_chat": { name: "General Chat", description: "Standard AI assistant" },
            "developer_copilot": { name: "Developer/Coding Copilot", description: "Helps with code" },
            "research_assistant": { name: "Research Assistant", description: "Summarizes, extracts data" },
            "writer_editor": { name: "Writer/Editor", description: "Drafts, rephrases, corrects" }
        };

        if (this.personaSelect) {
            for (const id in this.personas) {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = this.personas[id].name;
                this.personaSelect.appendChild(option);
            }
            this.personaSelect.value = this.selectedPersona; // Set default
        }
    }

    setSelectedPersona(personaId) {
        this.selectedPersona = personaId;
        devLog(`Selected persona: ${this.selectedPersona}`);
    }

    getSelectedPersona() {
        return this.selectedPersona;
    }

    // --- Conversation Stream Management ---
    addMessage(sender, text, type = 'text') {
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', `${sender}-message`);

        const senderHeader = document.createElement('div');
        senderHeader.classList.add('message-sender');
        senderHeader.textContent = sender === 'user' ? 'You' : (sender === 'ai' ? 'ScreenCopilot' : 'Other');
        messageElement.appendChild(senderHeader);

        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');
        // Initial content can be raw text or simple markdown
        contentElement.innerHTML = this.markdownParser.parse(text || '');
        messageElement.appendChild(contentElement);

        this.conversationStream.appendChild(messageElement);
        this.scrollToBottom();
        return messageElement; // Return for live updates
    }

    addUserMessage(text) {
        this.currentInterlocutorElement = this.addMessage('user', text);
    }

    updateUserMessage(interimTranscript) {
        if (this.currentInterlocutorElement) {
            const contentDiv = this.currentInterlocutorElement.querySelector('.message-content');
            contentDiv.innerHTML = this.markdownParser.parse(interimTranscript);
            this.scrollToBottom();
        } else {
            this.currentInterlocutorElement = this.addMessage('user', interimTranscript);
        }
    }

    finalizeUserMessage(finalTranscript) {
        if (this.currentInterlocutorElement) {
            const contentDiv = this.currentInterlocutorElement.querySelector('.message-content');
            contentDiv.innerHTML = this.markdownParser.parse(finalTranscript);
            this.currentInterlocutorElement = null; // Clear reference
        } else {
            this.addMessage('user', finalTranscript);
        }
        this.scrollToBottom();
    }

    updateOtherMessage(interimTranscript) {
        // This is for other speakers in the environment (e.g., in a meeting)
        // For simplicity, we'll just add it as a new message
        if (this.currentInterlocutorElement && this.currentInterlocutorElement.classList.contains('other-message')) {
            const contentDiv = this.currentInterlocutorElement.querySelector('.message-content');
            contentDiv.innerHTML = this.markdownParser.parse(interimTranscript);
        } else {
            this.currentInterlocutorElement = this.addMessage('other', interimTranscript);
        }
        this.scrollToBottom();
    }

    finalizeOtherMessage(finalTranscript) {
        if (this.currentInterlocutorElement && this.currentInterlocutorElement.classList.contains('other-message')) {
            const contentDiv = this.currentInterlocutorElement.querySelector('.message-content');
            contentDiv.innerHTML = this.markdownParser.parse(finalTranscript);
            this.currentInterlocutorElement = null; // Clear reference
        } else {
            this.addMessage('other', finalTranscript);
        }
        this.scrollToBottom();
    }

    streamAIResponse(interimResponse) {
        if (!this.currentAIElement || this.currentAIElement.sender !== 'ai') {
            this.currentAIElement = this.addMessage('ai', ''); // Create new AI message container
            this.currentAIElement.sender = 'ai'; // Mark as AI message for internal tracking
        }
        const contentDiv = this.currentAIElement.querySelector('.message-content');
        this.streaming.streamContent(contentDiv, interimResponse);
        this.scrollToBottom();
    }

    finalizeAIResponse(finalResponse) {
        if (this.currentAIElement) {
            const contentDiv = this.currentAIElement.querySelector('.message-content');
            // Ensure final response is parsed as complete markdown
            contentDiv.innerHTML = this.markdownParser.parse(finalResponse);
            this.currentAIElement = null; // Clear reference
        } else {
            this.addMessage('ai', finalResponse);
        }
        this.scrollToBottom();
    }

    // Generic message handling for backend messages
    handleMessage(type, payload) {
        switch (type) {
            case 'system_message':
                this.showNotification(payload.message, payload.type || 'info');
                break;
            case 'api_key_status':
                // Handle API key status display if needed, perhaps a subtle icon
                devLog(`API Key Status for ${payload.service}: ${payload.valid}`);
                this.showNotification(`API Key for ${payload.service} is ${payload.valid ? 'valid' : 'invalid'}`, payload.valid ? 'success' : 'error');
                break;
            case 'persona_updated':
                devLog(`Persona updated to ${payload.persona_id}`);
                this.showNotification(`Switched to ${this.personas[payload.persona_id]?.name || payload.persona_id} persona.`);
                break;
            // Add other message types as needed
            default:
                devLog(`[UIManager] Unhandled message type: ${type}`, payload);
        }
    }

    // --- Utility Functions ---
    scrollToBottom() {
        if (this.conversationStream) {
            this.conversationStream.scrollTop = this.conversationStream.scrollHeight;
        }
    }

    clearConversation() {
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
        // Implement a simple notification system or use an existing one
        console.log(`[Notification - ${type.toUpperCase()}]: ${message}`);
        // For a real UI, you'd append a temporary div to the body or a notification area
        const notificationArea = document.getElementById('notification-area'); // Assuming this exists
        if (notificationArea) {
            const notif = document.createElement('div');
            notif.classList.add('notification', type);
            notif.textContent = message;
            notificationArea.appendChild(notif);
            setTimeout(() => notif.remove(), 5000);
        } else {
            // Fallback to alert if no notification area
            alert(message);
        }
    }

    showErrorNotification(message) {
        this.showNotification(message, 'error');
    }

    showActivityIndicator() {
        if (this.activityIndicator) {
            this.activityIndicator.classList.add('active');
        }
    }

    hideActivityIndicator() {
        if (this.activityIndicator) {
            this.activityIndicator.classList.remove('active');
        }
    }

    // Replaces the check status update logic, directly manipulates UI elements if needed
    updateCheckStatus(checkElementId, status, text) {
        const checkElement = document.getElementById(checkElementId);
        if (!checkElement) {
            devWarn(`[UIManager] updateCheckStatus: Element with ID ${checkElementId} not found.`);
            return;
        }
        const indicator = checkElement.querySelector('.indicator');
        const textNode = checkElement.childNodes[1]; // Adjust if structure changes

        if (indicator) {
            indicator.textContent = status === 'success' ? '🟢' : status === 'error' ? '🔴' : '⚪';
        }
        if (textNode) {
            textNode.nodeValue = ` ${text}`;
        }
        devLog(`[UIManager] Set ${checkElementId} to ${status}: ${text}`);
    }
}
