// Modular main.js - Entry point and coordination for ScreenCopilot
import { StateManager } from './state-manager.js';
import { WebSocketHandler } from './websocket-handler.js';
import { ProviderManager } from './provider-manager.js';
import { UIManager } from './ui_manager.js';
import {
    setupMicrophone,
    startAudioProcessing,
    stopAudioProcessing,
    getScreenVideoTrack,
    isScreenSharingAvailable
} from './audio_handler.js';
import muteManager from './mute-manager.js';
import { loadConfig, isDev, devLog, devWarn, devError, applyConsoleGate } from './config.js';
import hotkeyManager from './hotkeys.js';
import presetManager from './preset-manager.js'; // Still used for AI provider management
import screenshotService from './screenshot-service.js';
import { ConfigManager } from './config-manager.js';
import { testStreamingMarkdown, testSampleMarkdown } from './streaming-markdown-demo.js';

// Initialize managers
const stateManager = new StateManager();
const webSocketHandler = new WebSocketHandler(stateManager);
const providerManager = new ProviderManager(stateManager, webSocketHandler); // ProviderManager is now backend-focused
const configManager = new ConfigManager(stateManager);
const uiManager = new UIManager(stateManager, webSocketHandler, providerManager); // UI Manager handles all UI interactions

// Expose to window for inter-module integration
window.providerManager = providerManager;
window.configManager = configManager;
window.uiManager = uiManager; // Expose UI Manager

// --- Dependency Injection ---
// Wire the managers together to avoid race conditions and reliance on globals.
webSocketHandler.setProviderManager(providerManager);

// --- DOM Elements ---
const views = {
    copilot: document.getElementById('copilot-view'),
};

// --- Core Functions ---
async function initializeApp() {
    applyConsoleGate(); // Apply console logging gate based on DEV_MODE
    devLog('🚀 Initializing ScreenCopilot...');

    await loadConfig(); // Load initial config (mostly for dev mode detection)

    // Initialize UI Manager after config is loaded
    uiManager.init();

    // Connect WebSocket
    try {
        await webSocketHandler.connect();
        devLog('WebSocket connected successfully.');
    } catch (error) {
        devError('WebSocket connection failed:', error);
        uiManager.showErrorNotification('Failed to connect to backend. Please restart the app.');
        return;
    }

    // Setup event listeners for UI interactions
    setupUIEventListeners();

    // Initialize audio
    await setupAudio();

    // Setup hotkeys
    hotkeyManager.init(webSocketHandler, stateManager, uiManager); // Pass uiManager

    // Initial status check and persona loading
    await uiManager.loadPersonas();
    await getSystemStatus();

    devLog('ScreenCopilot initialized.');
}

function setupUIEventListeners() {
    const personaSelect = document.getElementById('persona-select');
    const sendQuestionBtn = document.getElementById('send-question-btn');
    const userQuestionInput = document.getElementById('user-question-input');
    const muteBtn = document.getElementById('mute-btn');
    const resetSessionBtn = document.getElementById('reset-session-btn');
    const endSessionBtn = document.getElementById('end-session-btn');

    if (personaSelect) {
        personaSelect.addEventListener('change', (e) => {
            uiManager.setSelectedPersona(e.target.value);
            // Optionally, send update to backend if backend needs to know immediately
            webSocketHandler.sendMessage('set_persona', { persona_id: e.target.value });
        });
    }

    if (sendQuestionBtn) {
        sendQuestionBtn.addEventListener('click', sendUserQuestion);
    }

    if (userQuestionInput) {
        userQuestionInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendUserQuestion();
            }
        });
        // Auto-resize textarea
        userQuestionInput.addEventListener('input', () => {
            userQuestionInput.style.height = 'auto';
            userQuestionInput.style.height = userQuestionInput.scrollHeight + 'px';
        });
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', toggleMicMute);
        muteManager.on('stateChange', (status) => {
            muteBtn.querySelector('.mute-text').textContent = status ? 'Unmute' : 'Mute';
        });
    }

    if (resetSessionBtn) {
        resetSessionBtn.addEventListener('click', resetSession);
    }

    if (endSessionBtn) {
        endSessionBtn.addEventListener('click', endSession);
    }
}

async function setupAudio() {
    devLog('🎤 Setting up audio...');
    try {
        await setupMicrophone();
        await startAudioProcessing(webSocketHandler);
        devLog('✅ Microphone and audio processing ready.');
    } catch (error) {
        devError('❌ Audio setup failed:', error);
        uiManager.showErrorNotification('Microphone setup failed. Please check your microphone and permissions.');
    }
}

function sendUserQuestion() {
    const inputElement = document.getElementById('user-question-input');
    const question = inputElement.value.trim();
    if (question) {
        uiManager.addUserMessage(question);
        webSocketHandler.sendMessage('user_question', { question: question, persona_id: uiManager.getSelectedPersona() });
        inputElement.value = '';
        inputElement.style.height = 'auto'; // Reset textarea height
    }
}

async function getSystemStatus() {
    webSocketHandler.sendMessage('get_system_status', {});
}

async function resetSession() {
    if (confirm("Are you sure you want to reset the current session?")) {
        devLog('🔄 Resetting session...');
        uiManager.clearConversation();
        await webSocketHandler.sendMessage('reset_session', {});
        uiManager.showNotification('Session has been reset.');
    }
}

async function endSession() {
    if (confirm("Are you sure you want to end the current session?")) {
        devLog('🛑 Ending session...');
        stopAudioProcessing();
        webSocketHandler.sendMessage('end_session', {});
        // Optionally, close the window or switch to a 'session ended' view
        uiManager.showNotification('Session ended. You can restart by refreshing.');
        // For now, let's just disable input and clear conversation
        document.getElementById('user-question-input').disabled = true;
        document.getElementById('send-question-btn').disabled = true;
        uiManager.clearConversation();
    }
}

function toggleMicMute() {
    muteManager.toggleMute();
    webSocketHandler.sendMessage('toggle_mic_mute', { is_muted: muteManager.isMicrophoneMuted() });
}

// --- Global Exports (for hotkeys and direct access if needed) ---
window.webSocketHandler = webSocketHandler;
window.stateManager = stateManager;
window.uiManager = uiManager;
window.getSystemStatus = getSystemStatus;
window.resetSession = resetSession;
window.endSession = endSession;
window.toggleMicMute = toggleMicMute;

// Removed interview-specific exports:
// window.switchPreset, window.setTransparency, etc.
// These will be handled via a refactored hotkeyManager and uiManager

// Initialize the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);
