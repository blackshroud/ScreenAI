// Page-level hotkeys for ScreenCopilot (Alt+[ / Alt+] adjust overlay opacity).
// System-wide hotkeys live in services/hotkey_service.py.

import { devLog } from './config.js';
import muteManager from './mute-manager.js';

class HotkeyManager {
    constructor() {
        this.transparencyLevels = [0.2, 0.4, 0.6, 0.8, 1.0]; // 5 levels: 20%, 40%, 60%, 80%, 100%
        this.currentTransparencyLevel = 4; // The overlay starts fully opaque (100%)
        this.isEnabled = true;
        this.isAlwaysOnTop = true; // Track always-on-top state
        
        this.setupEventListeners();
        devLog('🎹 Hotkey manager initialized');
    }

    setupEventListeners() {
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        document.addEventListener('keyup', this.handleKeyUp.bind(this));
        
        // Prevent default browser shortcuts that might interfere
        document.addEventListener('keydown', (e) => {
            // Prevent default browser actions for Alt+[ and Alt+]
            // Note: Alt+M and Alt+U are handled by global hotkeys only
            if (e.altKey && ['[', ']'].includes(e.key.toLowerCase())) {
                e.preventDefault();
            }
        });
    }

    handleKeyDown(event) {
        if (!this.isEnabled) return;

        // Note: Alt+M and Alt+U are handled by global hotkeys only to prevent conflicts
        
        // Check for Alt+[ to decrease transparency
        if (event.altKey && event.key === '[') {
            this.decreaseTransparency();
            return;
        }

        // Check for Alt+] to increase transparency
        if (event.altKey && event.key === ']') {
            this.increaseTransparency();
            return;
        }
    }

    handleKeyUp(event) {
        // This method is kept for event listener consistency, but is currently empty.
    }

    decreaseTransparency() {
        if (this.currentTransparencyLevel > 0) {
            this.currentTransparencyLevel--;
            this.applyTransparency();
        }
    }

    increaseTransparency() {
        if (this.currentTransparencyLevel < this.transparencyLevels.length - 1) {
            this.currentTransparencyLevel++;
            this.applyTransparency();
        }
    }

    async applyTransparency() {
        const percent = Math.round(this.transparencyLevels[this.currentTransparencyLevel] * 100);
        try {
            const response = await fetch('/api/opacity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ percent })
            });
            if (response.ok) {
                devLog(`🪟 Opacity set to ${percent}% via hotkey`);
                this.showTransparencyFeedback(percent);
            } else {
                this.showTransparencyFeedback(100, 'Opacity control needs the Windows overlay');
            }
        } catch (error) {
            console.error('❌ Error setting opacity via hotkey:', error);
        }
    }

    showTransparencyHint() {
        // This hint is no longer needed as the interaction is simpler
        // The feedback on change is sufficient
    }

    hideTransparencyHint() {
        // This hint is no longer needed as the interaction is simpler
    }

    showTransparencyFeedback(percent, message = null) {
        this.removeExistingFeedback();
        
        const feedback = document.createElement('div');
        feedback.id = 'transparency-feedback';
        
        if (message) {
            feedback.innerHTML = `
                <div class="transparency-feedback">
                    ℹ️ ${message}
                </div>
            `;
        } else {
            feedback.innerHTML = `
                <div class="transparency-feedback">
                    🪟 ${percent}% Opacity
                    <div class="transparency-bar">
                        ${this.generateTransparencyBar()}
                    </div>
                </div>
            `;
        }
        
        document.body.appendChild(feedback);
        
        // Auto-hide after 2 seconds
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.remove();
            }
        }, 2000);
    }

    generateTransparencyBar() {
        let bar = '';
        for (let i = 0; i < this.transparencyLevels.length; i++) {
            const isActive = i === this.currentTransparencyLevel;
            bar += `<span class="bar-segment ${isActive ? 'active' : ''}">${isActive ? '●' : '○'}</span>`;
        }
        return bar;
    }

    removeExistingHints() {
        // This hint is no longer needed
    }

    removeExistingFeedback() {
        const existing = document.getElementById('transparency-feedback');
        if (existing) existing.remove();
    }

    // Public methods for external control
    setEnabled(enabled) {
        this.isEnabled = enabled;
        devLog(`🎹 Hotkeys ${enabled ? 'enabled' : 'disabled'}`);
    }

    getCurrentTransparency() {
        return {
            level: this.currentTransparencyLevel + 1,
            percent: Math.round(this.transparencyLevels[this.currentTransparencyLevel] * 100),
            value: this.transparencyLevels[this.currentTransparencyLevel]
        };
    }

    setTransparencyLevel(level) {
        if (level >= 1 && level <= 5) {
            this.currentTransparencyLevel = level - 1;
            this.applyTransparency();
        }
    }

    // Note: Audio toggle methods removed - handled by global hotkeys only
}

// Create global instance
const hotkeyManager = new HotkeyManager();

// Global functions for console access
window.enableHotkeys = () => hotkeyManager.setEnabled(true);
window.disableHotkeys = () => hotkeyManager.setEnabled(false);
window.getTransparencyLevel = () => hotkeyManager.getCurrentTransparency();
window.setTransparencyLevel = (level) => hotkeyManager.setTransparencyLevel(level);

export default hotkeyManager; 