// Entry point for ScreenCopilot: wires the managers together and owns the session lifecycle.
import { StateManager } from './state-manager.js';
import { WebSocketHandler } from './websocket-handler.js';
import { ProviderManager } from './provider-manager.js';
import { UIManager } from './ui_manager.js';
import {
    startAudioProcessing,
    stopAudioProcessing,
    getScreenVideoTrack,
    isScreenSharingAvailable
} from './audio_handler.js';
import muteManager from './mute-manager.js';
import { loadConfig, devLog, devError, applyConsoleGate } from './config.js';
import './hotkeys.js'; // registers the page-level Alt+[ / Alt+] opacity keys
import screenshotService from './screenshot-service.js';
import { ConfigManager } from './config-manager.js';

const stateManager = new StateManager();
const webSocketHandler = new WebSocketHandler(stateManager);
const providerManager = new ProviderManager(stateManager, webSocketHandler);
const configManager = new ConfigManager(stateManager);
const uiManager = new UIManager(stateManager, webSocketHandler, providerManager);

let listening = false;

// --- Provider selection (defaults come from ai_providers.json) ---
function modelName(model) {
    return typeof model === 'string' ? model : model?.modelName;
}

function textChoice(provider) {
    if (!provider) return null;
    const model = provider.defaultModel || modelName(provider.models?.[0]);
    return model ? { provider: provider.name, model } : null;
}

function visionChoice(provider) {
    if (!provider || !provider.supportsVision || !provider.visionModels?.length) return null;
    const model = provider.defaultVisionModel || modelName(provider.visionModels[0]);
    return model ? { provider: provider.name, model, maxImages: provider.maxImages } : null;
}

function pickProviders(providers) {
    const flagged = (flag) => providers.find(p => p[flag]);
    const primary = flagged('defaultPrimary') || providers[0] || null;
    let secondary = flagged('defaultSecondary');
    if (secondary && secondary === primary) secondary = null;
    const visionProviders = providers.filter(p => visionChoice(p));
    const visionPrimary = flagged('defaultVisionPrimary') || visionProviders[0] || null;
    let visionSecondary = flagged('defaultVisionSecondary');
    if (visionSecondary === visionPrimary) visionSecondary = null;
    return {
        primary: textChoice(primary),
        secondary: textChoice(secondary),
        visionPrimary: visionChoice(visionPrimary),
        visionSecondary: visionChoice(visionSecondary)
    };
}

async function fetchProviders() {
    try {
        const response = await fetch('/api/ai-providers');
        const list = await response.json();
        return Array.isArray(list) ? list : [];
    } catch (error) {
        devError('Could not load AI providers:', error);
        return [];
    }
}

// --- Session lifecycle ---
async function startSession() {
    uiManager.sessionReady = false;
    uiManager.setStatus('Starting AI session...');

    const choice = pickProviders(await fetchProviders());
    if (!choice.primary) {
        uiManager.setStatus('No AI provider configured', 'error');
        uiManager.showNotification('No AI provider found. Copy ai_providers.example.json to ai_providers.json and add an API key.', 'error');
        return;
    }
    if (choice.visionPrimary) {
        const v = choice.visionPrimary;
        screenshotService.setVisionConfig(v.provider, v.model, v.maxImages);
    }

    webSocketHandler.sendMessage('start_session', {
        aiProvider: choice.primary,
        aiSecondaryProvider: choice.secondary,
        visionProvider: choice.visionPrimary,
        visionSecondaryProvider: choice.visionSecondary,
        is_muted: muteManager.isMicrophoneMuted(),
        process_all_speakers: true,
        is_universally_muted: muteManager.isUniversallyMuted(),
        settings: {
            persona_id: uiManager.getSelectedPersona(),
            custom_instructions: '',
            selectedLanguages: []
        }
    });
}

function sendUserQuestion() {
    const input = document.getElementById('user-question-input');
    const question = input.value.trim();
    if (!question) return;
    if (!uiManager.sessionReady) {
        uiManager.showNotification('The AI session is not ready yet - please wait a moment.', 'error');
        return;
    }
    // Only show the bubble and clear the box once the message really left, so a
    // dropped connection never swallows what the user typed.
    const sent = webSocketHandler.sendMessage('chat', { message: question, persona_id: uiManager.getSelectedPersona() });
    if (!sent) {
        uiManager.showNotification('Not connected to the backend. Your message was kept - try again shortly.', 'error');
        return;
    }
    uiManager.addUserMessage(question);
    input.value = '';
    input.style.height = 'auto';
}

function resetSession() {
    uiManager.clearConversation();
    webSocketHandler.sendMessage('reset_session', {});
}

async function endSession() {
    if (!confirm('End this session and start a new one?')) return;
    stopListening(false);
    uiManager.clearConversation();
    webSocketHandler.sendMessage('end_session', {});
    uiManager.sessionReady = false;
    uiManager.setStatus('Starting a new session...');
    try {
        await webSocketHandler.restart();
    } catch (error) {
        uiManager.showErrorNotification('Could not start a new session. Please restart the app.');
    }
}

// --- Voice input (opt-in; typed chat never opens a microphone) ---
function renderListenButton() {
    const btn = document.getElementById('listen-btn');
    if (!btn) return;
    btn.classList.toggle('active', listening);
    btn.querySelector('.listen-text').textContent = listening ? 'Stop' : 'Listen';
    btn.title = listening ? 'Stop voice input' : 'Start voice input';
}

function setListening(on) {
    listening = on;
    uiManager.setListening(on);
    renderListenButton();
}

async function startListening() {
    if (listening) return;
    if (!uiManager.sessionReady) {
        uiManager.showNotification('The AI session is not ready yet.', 'error');
        return;
    }
    muteManager.setMicrophoneMute(false);
    const started = await startAudioProcessing(null, (audioData) => {
        if (listening) webSocketHandler.sendAudioChunk(audioData, muteManager.isMicrophoneMuted());
    });
    if (!started) {
        uiManager.showNotification('Could not start the microphone. Check permissions and try again.', 'error');
        return;
    }
    setListening(true);
    webSocketHandler.sendMessage('start_listening', {});
}

function stopListening(notifyBackend = true) {
    stopAudioProcessing();
    if (notifyBackend && listening) webSocketHandler.sendMessage('stop_listening', {});
    setListening(false);
}

function toggleListening() {
    return listening ? stopListening() : startListening();
}

function handleListeningState(payload) {
    if (payload.listening) return;
    stopAudioProcessing();
    setListening(false);
    if (payload.error) uiManager.showNotification(payload.error, 'error');
}

function renderMuteButton() {
    const btn = document.getElementById('mute-btn');
    if (!btn) return;
    const muted = muteManager.isMicrophoneMuted();
    btn.classList.toggle('muted', muted);
    btn.querySelector('.mute-text').textContent = muted ? 'Unmute' : 'Mute';
    btn.querySelector('.mute-icon').textContent = muted ? '🔇' : '🎤';
}

function toggleMicMute() {
    muteManager.toggleMicrophoneMute(); // the stateChange listener re-renders the button
}

// --- DOM wiring ---
function setupUIEventListeners() {
    const on = (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler);

    on('persona-select', 'change', (e) => {
        uiManager.setSelectedPersona(e.target.value);
        webSocketHandler.sendMessage('set_persona', { persona_id: e.target.value });
    });
    on('send-question-btn', 'click', sendUserQuestion);
    on('listen-btn', 'click', toggleListening);
    on('mute-btn', 'click', toggleMicMute);
    on('reset-session-btn', 'click', resetSession);
    on('end-session-btn', 'click', endSession);

    const input = document.getElementById('user-question-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendUserQuestion();
            }
        });
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = `${input.scrollHeight}px`;
        });
    }

    muteManager.on('stateChange', renderMuteButton);
    renderMuteButton();
    renderListenButton();
}

async function initializeApp() {
    // Load config first: applyConsoleGate() depends on DEV_MODE.
    await loadConfig();
    applyConsoleGate();
    devLog('Initializing ScreenCopilot...');

    uiManager.init();
    await uiManager.loadPersonas();
    muteManager.setMicrophoneMute(false); // voice input is opt-in, so start unmuted

    webSocketHandler.setUIManager(uiManager);
    webSocketHandler.onDisconnect = () => stopListening(false);
    webSocketHandler.onSessionCreated = () => startSession();
    uiManager.onListeningState = handleListeningState;
    setupUIEventListeners();

    uiManager.setStatus('Connecting...');
    try {
        await webSocketHandler.connect();
    } catch (error) {
        // handleReconnect() keeps retrying in the background.
        devError('Initial WebSocket connection failed:', error);
        uiManager.showErrorNotification('Could not reach the backend. Retrying...');
    }
}

// --- Globals used by hotkeys, screenshot-service and mute-manager ---
window.stateManager = stateManager;
window.providerManager = providerManager;
window.configManager = configManager;
window.uiManager = uiManager;
window.webSocketHandler = webSocketHandler;
window.sendSocketMessage = (type, payload) => webSocketHandler.sendMessage(type, payload);
window.getScreenVideoTrack = getScreenVideoTrack;
window.isScreenSharingAvailable = isScreenSharingAvailable;
window.toggleMicMute = toggleMicMute;
window.resetSession = resetSession;
window.endSession = endSession;

document.addEventListener('DOMContentLoaded', initializeApp);
