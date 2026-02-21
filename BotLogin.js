/**
 * BotLogin Plugin for Revenge/Shiggy
 * Allows logging in as a bot by manually connecting to Discord Gateway
 */

module.exports = {
    start() {
        console.log('[BotLogin] Starting...');

        // Store WebSocket and related state
        this.ws = null;
        this.heartbeatInterval = null;
        this.sequence = null;
        this.sessionId = null;
        this.reconnectAttempts = 0;
        this.isStopping = false; // Flag to prevent unwanted reconnects

        // Find and patch necessary modules
        this.findGatewayModule();
        this.createSettingsUI();
        this.patchTokenStorage();

        console.log('[BotLogin] Started successfully!');
    },

    stop() {
        console.log('[BotLogin] Stopping...');

        this.isStopping = true; // Set flag before closing
        
        // Disconnect if connected
        if (this.ws) {
            this.ws.close(1000, 'Plugin stopping'); // Clean close
            this.ws = null;
        }

        // Clear heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Unpatch modules - Placeholder for actual unpatching logic
        if (this.originalTokenStorage) {
            // Restore original token storage if patched
            this.originalTokenStorage = null;
        }

        // Remove UI
        if (this.settingsButton) {
            this.settingsButton.remove();
        }

        console.log('[BotLogin] Stopped!');
    },

    // Find the Gateway/Connection module in Webpack
    findGatewayModule() {
        // Search for gateway-related modules
        // This is a common pattern - we look for modules that handle WebSocket connections
        const modules = BdApi.Webpack.getModules(m =>
            m.prototype && m.prototype.connect && m.prototype.disconnect
        );
        if (modules.length > 0) {
            this.gatewayModule = modules[0];
            console.log('[BotLogin] Found gateway module:', this.gatewayModule.name);
        } else {
            console.warn('[BotLogin] Could not find gateway module');
        }
    },

    // Create a simple UI for bot token input
    createSettingsUI() {
        // Create a button in settings or add to existing mod settings
        const settingsContainer = document.querySelector('.layer-86YKbF') || document.body;

        this.settingsButton = document.createElement('button');
        this.settingsButton.textContent = '🤖 Bot Login';
        this.settingsButton.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            padding: 10px 20px;
            background: #5865F2;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
        `;

        this.settingsButton.onclick = () => this.showLoginModal();
        settingsContainer.appendChild(this.settingsButton);
    },

    // Show login modal
    showLoginModal() {
        const savedToken = localStorage.getItem('botlogin_token') || '';
        const savedIntents = localStorage.getItem('botlogin_intents') || '3276799'; // Default all intents for common bots

        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div style="background: #2b2d31; padding: 20px; border-radius: 10px; width: 400px; max-width: 90%;">
                <h2 style="color: white; margin-top: 0;">🤖 Bot Login</h2>
                <p style="color: #ccc;">Enter your bot token and desired gateway intents.</p>
                <div style="margin-bottom: 15px;">
                    <label for="botTokenInput" style="color: white; display: block; margin-bottom: 5px;">Bot Token:</label>
                    <input type="password" id="botTokenInput" value="${savedToken}" placeholder="Enter your bot token here"
                           style="width: 100%; padding: 8px; border: 1px solid #36393f; border-radius: 4px; background: #424549; color: white;">
                </div>
                <div style="margin-bottom: 20px;">
                    <label for="intentsInput" style="color: white; display: block; margin-bottom: 5px;">Gateway Intents (Bitmask):</label>
                    <input type="number" id="intentsInput" value="${savedIntents}" placeholder="e.g., 3276799 for common intents"
                           style="width: 100%; padding: 8px; border: 1px solid #36393f; border-radius: 4px; background: #424549; color: white;">
                    <small style="color: #aaa;">Refer to Discord API docs for intent bitmasks.</small>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <button id="connectBtn" style="padding: 10px 15px; background: #5865F2; color: white; border: none; border-radius: 5px; cursor: pointer;">Connect</button>
                    <button id="disconnectBtn" style="padding: 10px 15px; background: #ED4245; color: white; border: none; border-radius: 5px; cursor: pointer;">Disconnect</button>
                    <button id="closeModal" style="padding: 10px 15px; background: #424549; color: white; border: none; border-radius: 5px; cursor: pointer;">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Add event listeners after modal is in DOM
        document.getElementById('connectBtn').onclick = () => {
            const token = document.getElementById('botTokenInput').value.trim();
            const intents = parseInt(document.getElementById('intentsInput').value) || 3276799; // Default all intents
            if (token) {
                localStorage.setItem('botlogin_token', token);
                localStorage.setItem('botlogin_intents', intents);
                this.connectAsBot(token, intents);
                modal.remove(); // Close modal on connect attempt
            } else {
                alert('Please enter a bot token.');
            }
        };

        document.getElementById('disconnectBtn').onclick = () => {
            this.disconnectBot();
            modal.remove(); // Close modal on disconnect
        };

        document.getElementById('closeModal').onclick = () => modal.remove();

        // Click outside to close
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    },

    // Connect to Discord Gateway as a bot
    connectAsBot(token, intents) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.warn('[BotLogin] Already connected');
            alert('Already connected as a bot.');
            return;
        }

        console.log('[BotLogin] Connecting as bot...');
        this.isStopping = false; // Ensure this is false when connecting

        // Get gateway URL first
        fetch('https://discord.com/api/v10/gateway/bot', {
            headers: {
                'Authorization': `Bot ${token}`,
                'Content-Type': 'application/json'
            }
        })
        .then(res => {
            if (!res.ok) {
                return res.json().then(errorData => {
                    throw new Error(errorData.message || 'Failed to fetch gateway URL.');
                });
            }
            return res.json();
        })
        .then(data => {
            if (data.url) {
                this.establishConnection(data.url, token, intents);
            } else {
                throw new Error('No gateway URL provided in response.');
            }
        })
        .catch(err => {
            console.error('[BotLogin] Failed to get gateway URL:', err);
            alert(`Failed to connect. Check your token and intents. Error: ${err.message}`);
        });
    },

    // Establish WebSocket connection
    establishConnection(gatewayUrl, token, intents) {
        const url = gatewayUrl.startsWith('wss://') ? gatewayUrl : `wss://${gatewayUrl}`;
        this.ws = new WebSocket(`${url}?v=10&encoding=json`); // Ensure API version and encoding

        this.ws.onopen = () => {
            console.log('[BotLogin] WebSocket connected');
            this.sendIdentify(token, intents);
        };

        this.ws.onmessage = (event) => {
            this.handleGatewayMessage(JSON.parse(event.data));
        };

        this.ws.onclose = (event) => {
            console.log('[BotLogin] WebSocket closed:', event.code, event.reason);
            this.handleDisconnect(event.code);
        };

        this.ws.onerror = (error) => {
            console.error('[BotLogin] WebSocket error:', error);
            // Additional error handling could go here
        };
    },

    // Send IDENTIFY payload
    sendIdentify(token, intents) {
        const identifyPayload = {
            op: 2, // IDENTIFY
            d: {
                token: token.startsWith('Bot ') ? token : `Bot ${token}`, // Ensure 'Bot ' prefix
                intents: intents,
                properties: {
                    os: 'linux', // Can be anything, but reflects a server environment more
                    browser: 'BotLogin',
                    device: 'BotLogin'
                },
                compress: false,
                large_threshold: 250 // Max members in a guild to receive presence for
            }
        };

        this.ws.send(JSON.stringify(identifyPayload));
        console.log('[BotLogin] Sent IDENTIFY with intents:', intents);
    },

    // Handle incoming gateway messages
    handleGatewayMessage(data) {
        const { op, d, s, t } = data;

        if (s) this.sequence = s; // Update sequence for resuming/heartbeats

        switch (op) {
            case 0: // DISPATCH
                console.log('[BotLogin] Event:', t);
                this.handleDispatch(t, d);
                break;

            case 1: // HEARTBEAT
                console.log('[BotLogin] Received HEARTBEAT request from server');
                this.sendHeartbeat();
                break;

            case 7: // RECONNECT
                console.log('[BotLogin] Server requests reconnect');
                this.reconnect();
                break;

            case 9: // INVALID SESSION
                console.warn('[BotLogin] Invalid session, resumable:', d);
                if (d) { // 'd' is true if session is resumable
                    this.sendResume();
                } else {
                    console.error('[BotLogin] Non-resumable invalid session. Full reconnect.');
                    this.reconnect(true); // Force a new IDENTIFY
                }
                break;

            case 10: // HELLO
                console.log('[BotLogin] Received HELLO. Heartbeat interval:', d.heartbeat_interval);
                this.startHeartbeat(d.heartbeat_interval);
                break;

            case 11: // HEARTBEAT ACK
                // console.log('[BotLogin] Heartbeat acknowledged'); // Too noisy for constant logging
                break;

            default:
                console.log(`[BotLogin] Unhandled opcode ${op}:`, d);
                break;
        }
    },

    // Handle dispatch events
    handleDispatch(event, data) {
        switch (event) {
            case 'READY':
                console.log('[BotLogin] Ready! Bot:', data.user.username);
                this.sessionId = data.session_id;
                this.reconnectAttempts = 0; // Reset reconnect attempts on successful ready
                alert(`Connected as ${data.user.username}#${data.user.discriminator}`);
                // Here you might trigger UI updates or further bot logic
                break;

            case 'MESSAGE_CREATE':
                // Log messages for demonstration
                // Consider how to display these in the client UI for a better experience
                console.log(`[BotLogin] Message in ${data.channel_id} from ${data.author.username}: ${data.content}`);
                // Example: If you wanted to show this in the current channel (very basic, likely buggy):
                // BdApi.ShowToast(`[BOT] ${data.author.username}: ${data.content}`, { type: "info" });
                break;

            // Add more event handlers as needed
            // e.g., GUILD_CREATE, INTERACTION_CREATE (if you handle interactions)
        }
    },

    // Start heartbeat interval
    startHeartbeat(interval) {
        console.log('[BotLogin] Starting heartbeat, interval:', interval);

        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        // Send first heartbeat immediately upon starting, then at interval
        this.sendHeartbeat();
        
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeat();
        }, interval);
    },

    // Send heartbeat
    sendHeartbeat() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                op: 1, // HEARTBEAT
                d: this.sequence // Send the last sequence number received
            }));
            // console.log('[BotLogin] Sent heartbeat'); // Too noisy for constant logging
        }
    },

    // Send RESUME payload
    sendResume() {
        const token = localStorage.getItem('botlogin_token');
        if (!token || !this.sessionId || this.sequence === null) {
            console.warn('[BotLogin] Cannot resume, missing token, session ID, or sequence. Reconnecting fully.');
            this.reconnect(true); // Force full reconnect
            return;
        }

        const resumePayload = {
            op: 6, // RESUME
            d: {
                token: token.startsWith('Bot ') ? token : `Bot ${token}`,
                session_id: this.sessionId,
                seq: this.sequence
            }
        };

        this.ws.send(JSON.stringify(resumePayload));
        console.log('[BotLogin] Sent RESUME');
    },

    // Handle disconnect
    handleDisconnect(code) {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Don't reconnect on clean close (1000) or if we're explicitly stopping
        if (code === 1000 || this.isStopping) {
            console.log('[BotLogin] Clean disconnect or plugin stopping, no reconnect.');
            this.resetConnectionState();
            return;
        }

        // Attempt reconnection for other codes (e.g., 1001, 1006, server restarts)
        if (this.reconnectAttempts < 5) { // Limit reconnection attempts
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s
            console.log(`[BotLogin] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}, code ${code})`);
            setTimeout(() => this.reconnect(), delay);
        } else {
            console.error('[BotLogin] Max reconnect attempts reached. Giving up.');
            alert('Bot disconnected and failed to reconnect after multiple attempts.');
            this.resetConnectionState();
        }
    },

    // Reconnect to gateway
    reconnect(forceIdentify = false) {
        if (this.ws) {
            this.ws.close(); // Close existing connection before re-establishing
            this.ws = null;
        }
        
        const token = localStorage.getItem('botlogin_token');
        const intents = parseInt(localStorage.getItem('botlogin_intents')) || 3276799;

        if (!token) {
            console.error('[BotLogin] No bot token found for reconnect.');
            this.resetConnectionState();
            return;
        }

        if (forceIdentify) {
            console.log('[BotLogin] Forcing full IDENTIFY reconnect.');
            this.sessionId = null; // Clear session ID to ensure a new IDENTIFY
            this.sequence = null;
            this.connectAsBot(token, intents);
        } else if (this.sessionId && this.sequence !== null) {
            console.log('[BotLogin] Attempting to RESUME session.');
            this.establishConnection(localStorage.getItem('botlogin_gateway_url'), token, intents); // Need to store gateway URL
        } else {
            console.log('[BotLogin] No session to resume, performing full IDENTIFY reconnect.');
            this.connectAsBot(token, intents);
        }
    },

    // Disconnect bot
    disconnectBot() {
        this.isStopping = true; // Set flag to prevent reconnect attempts

        if (this.ws) {
            this.ws.close(1000, 'User disconnected'); // Clean close code
        }

        // Clear intervals and reset state
        this.resetConnectionState();
        
        console.log('[BotLogin] Disconnected');
        alert('Disconnected from bot session');
    },

    // Helper to reset connection-related state variables
    resetConnectionState() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.ws = null;
        this.heartbeatInterval = null;
        this.sessionId = null;
        this.sequence = null;
        this.reconnectAttempts = 0;
        this.isStopping = false; // Reset to false after full stop/reset
    },

    // Patch token storage to prevent interference
    patchTokenStorage() {
        // This is a placeholder - actual implementation depends on the mod's internals
        // and how it stores/retrieves the user token.
        // The goal is to prevent the client from trying to use our bot token as a user token
        // or overwriting our bot connection when the user client connects.
        console.log('[BotLogin] Token storage patching logic would go here. This is complex.');
        // Example (conceptual using BdApi.Patcher if available):
        /*
        const tokenModule = BdApi.Webpack.getModule(m => m.getToken && m.setToken);
        if (tokenModule) {
            this.originalTokenStorage = BdApi.Patcher.instead('BotLogin', tokenModule, 'getToken', (_, args, original) => {
                // If we're connected as a bot, perhaps return null or a dummy token to prevent user client ops
                if (this.ws && this.ws.readyState === WebSocket.OPEN) return null;
                return original(...args); // Otherwise, let the client get its real user token
            });
            BdApi.Patcher.instead('BotLogin', tokenModule, 'setToken', (_, args, original) => {
                // Prevent client from setting a user token if we're a bot
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    console.warn('[BotLogin] Prevented user token overwrite while bot is active.');
                    return;
                }
                return original(...args);
            });
        }
        */
    }
};