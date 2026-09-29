import { devLog } from './config.js';
import uiManager from './ui_manager.js';

export class WebSocketHandler {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.socket = null;
        this.providerManager = null; // Direct reference to the ProviderManager
        this.session_id = null;
        this.reconnect_attempts = 0;
        this.max_reconnect_attempts = 5;
        this.is_intentionally_closing = false;
        this.checks = {};
    }

    setProviderManager(providerManager) {
        this.providerManager = providerManager;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.is_intentionally_closing = false;
            // Derive the host from the page origin. main.py picks a free port at
            // startup and falls back off 8002 when it is busy, so a hardcoded port
            // would break the socket exactly when the fallback kicks in.
            const host = window.location.host || '127.0.0.1:8002';
            const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            let url = `${scheme}//${host}/ws`;
            if (this.session_id) {
                url += `?session_id=${this.session_id}`;
            }

            // uiManager handles check statuses now
            // this.updateCheckStatus(this.checks.backend, 'pending', 'Connecting...');
            this.socket = new WebSocket(url);
            this.stateManager.setSocket(this.socket);

            // Store the promise's resolver to be called when session is confirmed.
            this.resolveConnectionPromise = resolve;

            // Clear any old listeners before attaching new ones
            this.socket.onopen = null;
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onmessage = null;
            
            // Use addEventListener for all events for consistency and robustness.
            this.socket.addEventListener('open', this.onOpen.bind(this));
            this.socket.addEventListener('close', this.onClose.bind(this));
            this.socket.addEventListener('error', (err) => {
                this.onError(err);
                reject(new Error("WebSocket connection failed."));
            });
            this.socket.addEventListener('message', this.onMessage.bind(this));
        });
    }

    onOpen(event) {
        console.log("[open] Connection established");
        // This is now handled by the uiManager
        this.reconnect_attempts = 0;
    }

    onClose(event) {
        console.log(`[close] Connection closed. Intentional: ${this.is_intentionally_closing}`);
        // This is now handled by the uiManager
        if (!this.is_intentionally_closing) {
            this.handleReconnect();
        }
    }

    onError(error) {
        console.error(`[error] WebSocket error:`, error);
        // This is now handled by the uiManager
    }
    
    onMessage(event) {
        const data = JSON.parse(event.data);
        devLog("Received from backend:", data);

        if (data.type === 'session_created') {
            this.session_id = data.payload.session_id;
            console.log(`🚀 New session started: ${this.session_id}`);
            // Resolve the connection promise now that session is confirmed.
            if (this.resolveConnectionPromise) {
                this.resolveConnectionPromise(this.session_id);
                this.resolveConnectionPromise = null; // Clear the resolver
            }
        } else if (data.type === 'session_resumed') {
            this.session_id = data.payload.session_id;
            console.log(`🔗 Session resumed: ${this.session_id}`);
            if (this.resolveConnectionPromise) {
                this.resolveConnectionPromise(this.session_id);
                this.resolveConnectionPromise = null;
            }
        } else if (data.type === 'transcript_update') {
            this.handleTranscriptUpdate(data.payload);
        } else if (data.type === 'ai_response') {
            this.handleAiResponse(data.payload);
        } else if (data.type === 'api_key_status') {
            // Handled by uiManager
            devLog(`[WebSocket] API Key Status for ${data.payload.service}: ${data.payload.valid}`);
        } else {
            // Handle other messages by routing them to the UI Manager
            uiManager.handleMessage(data.type, data.payload);
        }
    }

    // Method to send messages to the backend
    sendMessage(type, payload) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this._touch();
            const message = { type, payload };
            this.socket.send(JSON.stringify(message));
        } else {
            console.warn("WebSocket not open. Message not sent:", type, payload);
        }
    }

    // Handle incoming transcript updates
    handleTranscriptUpdate(payload) {
        // With diarization disabled, all speech comes from speaker 0 and should be labeled as User
        // With diarization enabled, speaker 0 = user, speaker 1+ = other(s)
        const speakerId = payload.speaker !== undefined ? payload.speaker : 0;
        const isFinal = payload.is_final;
        const transcript = payload.transcript;

        if (speakerId === 0) { // User
            if (isFinal) {
                uiManager.finalizeUserMessage(transcript);
            } else {
                uiManager.updateUserMessage(transcript);
            }
        } else { // Other speakers
            if (isFinal) {
                uiManager.finalizeOtherMessage(transcript);
            } else {
                uiManager.updateOtherMessage(transcript);
            }
        }
    }

    // Handle incoming AI responses
    handleAiResponse(payload) {
        if (payload.response_type === 'streaming') {
            uiManager.streamAIResponse(payload.response);
        } else if (payload.response_type === 'final') {
            uiManager.finalizeAIResponse(payload.response);
        } else if (payload.response_type === 'quick') {
            uiManager.displayQuickAIResponse(payload.response);
        }
    }

    // Helper to update last activity time
    _touch() {
        // No longer tracking activity on the frontend
    }

    // In the new architecture, checks are managed by the uiManager
    updateCheckStatus(checkElement, status, text) {
        // This function is no longer directly used in websocket-handler, as uiManager handles checks
        devLog(`[WebSocketHandler] Check status update called, but handled by uiManager: ${checkElement?.id} ${status}: ${text}`);
    }
}
