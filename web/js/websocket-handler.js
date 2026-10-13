import { devLog } from './config.js';

const MAX_RECONNECT_DELAY_MS = 15000;

export class WebSocketHandler {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.socket = null;
        this.uiManager = null;
        this.providerManager = null;
        this.session_id = null;
        this.reconnect_attempts = 0;
        this.max_reconnect_attempts = 8;
        this.is_intentionally_closing = false;
        this.reconnecting = false;

        // Hooks wired up by main.js.
        this.onDisconnect = null;       // connection lost: stop audio, etc.
        this.onSessionCreated = null;   // a brand-new server session exists: start it
    }

    setUIManager(uiManager) {
        this.uiManager = uiManager;
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

            const socket = new WebSocket(url);
            this.socket = socket;
            this.stateManager.setSocket(socket);
            this.resolveConnectionPromise = resolve;

            socket.addEventListener('open', this.onOpen.bind(this));
            socket.addEventListener('close', (event) => this.onClose(event, socket));
            socket.addEventListener('error', (err) => {
                this.onError(err);
                reject(new Error('WebSocket connection failed.'));
            });
            socket.addEventListener('message', this.onMessage.bind(this));
        });
    }

    onOpen() {
        devLog('[open] Connection established');
        this.reconnect_attempts = 0;
    }

    onClose(event, socket) {
        // Ignore close events from a socket that has already been replaced.
        if (socket !== this.socket) return;
        devLog(`[close] Connection closed. Intentional: ${this.is_intentionally_closing}`);
        if (this.is_intentionally_closing) return;
        if (this.onDisconnect) this.onDisconnect();
        this.handleReconnect();
    }

    onError(error) {
        console.error('[error] WebSocket error:', error);
    }

    handleReconnect() {
        if (this.reconnecting) return;
        if (this.reconnect_attempts >= this.max_reconnect_attempts) {
            this.uiManager?.setStatus('Disconnected - restart the app', 'error');
            return;
        }
        this.reconnecting = true;
        this.reconnect_attempts += 1;
        const delay = Math.min(1000 * 2 ** (this.reconnect_attempts - 1), MAX_RECONNECT_DELAY_MS);
        this.uiManager?.setStatus(`Connection lost - reconnecting (${this.reconnect_attempts})...`, 'error');
        setTimeout(async () => {
            try {
                await this.connect();
                this.reconnecting = false;
            } catch (err) {
                this.reconnecting = false;
                this.handleReconnect();
            }
        }, delay);
    }

    onMessage(event) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (err) {
            console.warn('Ignoring malformed message from backend', err);
            return;
        }
        devLog('Received from backend:', data);

        const resolveConnection = () => {
            if (this.resolveConnectionPromise) {
                this.resolveConnectionPromise(this.session_id);
                this.resolveConnectionPromise = null;
            }
        };

        switch (data.type) {
            case 'session_created':
                // Also fires when the server forgot our old session (e.g. it restarted).
                this.session_id = data.payload.session_id;
                resolveConnection();
                if (this.onSessionCreated) this.onSessionCreated();
                break;
            case 'session_resumed':
                this.session_id = data.payload.session_id;
                resolveConnection();
                if (this.uiManager?.sessionReady) this.uiManager.setStatus('Reconnected', 'connected');
                break;
            case 'transcript_update':
                this.handleTranscriptUpdate(data.payload);
                break;
            default:
                this.uiManager?.handleMessage(data.type, data.payload);
        }
    }

    sendMessage(type, payload) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type, payload }));
            return true;
        }
        console.warn('WebSocket not open. Message not sent:', type);
        return false;
    }

    sendAudioChunk(chunk, isMuted) {
        this.sendMessage('audio_chunk', {
            audio_b64: this.bytesToBase64(chunk),
            is_muted: isMuted
        });
    }

    /**
     * Base64-encode a PCM buffer for transport. Raw bytes as a JSON array cost
     * roughly 4 bytes of text per byte of audio; base64 costs 1.33. Encoded in
     * slices because String.fromCharCode.apply exceeds the argument limit on
     * large buffers.
     */
    bytesToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const SLICE = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += SLICE) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE));
        }
        return btoa(binary);
    }

    handleTranscriptUpdate(payload) {
        if (!this.uiManager) return;
        // Diarization is off, so every utterance arrives as speaker 0 (the user).
        if (payload.is_final) {
            this.uiManager.finalizeUserMessage(payload.transcript);
        } else {
            this.uiManager.updateUserMessage(payload.transcript);
        }
    }

    // Used by screenshot-service while a vision request is in flight.
    showVisionProcessingStatus(count) {
        this.uiManager?.showActivity(`Analyzing ${count} screenshot${count === 1 ? '' : 's'}...`);
    }

    hideVisionProcessingStatus() {
        this.uiManager?.hideActivity();
    }

    close() {
        this.is_intentionally_closing = true;
        if (this.socket) this.socket.close();
    }

    /** Drop the current session and open a fresh one on a new socket. */
    async restart() {
        this.session_id = null;
        const old = this.socket;
        this.is_intentionally_closing = true;
        try {
            await this.connect();
        } finally {
            if (old && old !== this.socket) old.close();
        }
    }
}
