/**
 * BotLogin Plugin for Revenge (Vendetta/Bunny-compatible)
 * Correct API: window.vendetta
 * - No DOM (React Native, not a browser)
 * - No BdApi / BetterDiscord APIs
 * - No localStorage → use vendetta.storage.createProxy
 * - No alert() → use showToast / showConfirmationAlert
 * - No document.createElement → use React Native components
 * - Lifecycle: onLoad() / onUnload(), not start() / stop()
 * - Settings UI: exported settings React component
 */

const {
    metro: { findByProps },
    patcher,
    storage: { createProxy },
    ui: {
        toasts: { showToast },
        alerts: { showConfirmationAlert },
    },
    React,
    ReactNative: { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert },
} = window.vendetta;

// ─── Persistent Storage ───────────────────────────────────────────────────────
// createProxy wraps an object in a reactive proxy backed by Revenge's file storage.
// Reads/writes to it are automatically persisted across restarts.
const storage = createProxy({
    botToken: "",
    intents: 3276799, // All common intents bitmask
});

// ─── Styles (React Native StyleSheet, not CSS) ────────────────────────────────
const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
        backgroundColor: "#2b2d31",
    },
    label: {
        color: "#ffffff",
        fontSize: 14,
        marginBottom: 6,
        fontWeight: "600",
    },
    hint: {
        color: "#aaaaaa",
        fontSize: 12,
        marginBottom: 14,
    },
    input: {
        backgroundColor: "#424549",
        color: "#ffffff",
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 4,
        borderWidth: 1,
        borderColor: "#36393f",
        fontSize: 14,
    },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 20,
        gap: 10,
    },
    btnConnect: {
        flex: 1,
        backgroundColor: "#5865F2",
        paddingVertical: 12,
        borderRadius: 6,
        alignItems: "center",
    },
    btnDisconnect: {
        flex: 1,
        backgroundColor: "#ED4245",
        paddingVertical: 12,
        borderRadius: 6,
        alignItems: "center",
    },
    btnText: {
        color: "#ffffff",
        fontWeight: "600",
        fontSize: 14,
    },
    statusText: {
        color: "#57F287",
        fontSize: 13,
        marginTop: 16,
        textAlign: "center",
    },
    statusDisconnected: {
        color: "#ED4245",
    },
    sectionTitle: {
        color: "#ffffff",
        fontSize: 18,
        fontWeight: "700",
        marginBottom: 16,
    },
});

// ─── Connection State (module-level, reset on unload) ─────────────────────────
let ws = null;
let heartbeatInterval = null;
let sequence = null;
let sessionId = null;
let reconnectAttempts = 0;
let isStopping = false;
let gatewayUrl = null;
let unpatchers = [];

// ─── Gateway Logic ────────────────────────────────────────────────────────────

function sendHeartbeat() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 1, d: sequence }));
    }
}

function startHeartbeat(interval) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    sendHeartbeat();
    heartbeatInterval = setInterval(sendHeartbeat, interval);
}

function resetConnectionState() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    ws = null;
    sequence = null;
    sessionId = null;
    reconnectAttempts = 0;
    isStopping = false;
}

function sendIdentify(token, intents) {
    ws.send(JSON.stringify({
        op: 2,
        d: {
            token: token.startsWith("Bot ") ? token : `Bot ${token}`,
            intents,
            properties: { os: "android", browser: "BotLogin", device: "BotLogin" },
            compress: false,
            large_threshold: 250,
        },
    }));
}

function sendResume() {
    const token = storage.botToken;
    if (!token || !sessionId || sequence === null) {
        connectAsBot(token, storage.intents);
        return;
    }
    ws.send(JSON.stringify({
        op: 6,
        d: {
            token: token.startsWith("Bot ") ? token : `Bot ${token}`,
            session_id: sessionId,
            seq: sequence,
        },
    }));
}

function handleDispatch(t, d) {
    switch (t) {
        case "READY":
            sessionId = d.session_id;
            reconnectAttempts = 0;
            showToast(`✅ Connected as ${d.user.username}#${d.user.discriminator}`);
            console.log("[BotLogin] READY:", d.user.username);
            break;
        case "MESSAGE_CREATE":
            console.log(`[BotLogin] MSG #${d.channel_id} <${d.author.username}>: ${d.content}`);
            break;
    }
}

function handleGatewayMessage(data) {
    const { op, d, s, t } = data;
    if (s != null) sequence = s;

    switch (op) {
        case 0:  return handleDispatch(t, d);
        case 1:  return sendHeartbeat();
        case 7:  return reconnect(false);
        case 9:
            if (d) sendResume();
            else   reconnect(true);
            break;
        case 10:
            startHeartbeat(d.heartbeat_interval);
            break;
        case 11:
            break; // heartbeat ACK
    }
}

function handleDisconnect(code) {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }

    if (code === 1000 || isStopping) {
        resetConnectionState();
        return;
    }

    if (reconnectAttempts < 5) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        setTimeout(() => reconnect(false), delay);
    } else {
        showToast("❌ Bot disconnected. Max reconnects reached.");
        resetConnectionState();
    }
}

function reconnect(forceIdentify) {
    if (ws) { ws.close(); ws = null; }
    const token = storage.botToken;
    const intents = storage.intents;
    if (!token) { resetConnectionState(); return; }

    if (forceIdentify) {
        sessionId = null; sequence = null;
        connectAsBot(token, intents);
    } else if (sessionId && sequence !== null && gatewayUrl) {
        establishConnection(gatewayUrl, token, intents);
    } else {
        connectAsBot(token, intents);
    }
}

function establishConnection(url, token, intents) {
    gatewayUrl = url;
    const fullUrl = url.startsWith("wss://") ? url : `wss://${url}`;
    ws = new WebSocket(`${fullUrl}?v=10&encoding=json`);

    ws.onopen    = () => sendIdentify(token, intents);
    ws.onmessage = (e) => handleGatewayMessage(JSON.parse(e.data));
    ws.onclose   = (e) => handleDisconnect(e.code);
    ws.onerror   = (e) => console.error("[BotLogin] WS error:", e);
}

function connectAsBot(token, intents) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        showToast("⚠️ Already connected as a bot.");
        return;
    }
    isStopping = false;

    fetch("https://discord.com/api/v10/gateway/bot", {
        headers: {
            Authorization: `Bot ${token}`,
            "Content-Type": "application/json",
        },
    })
        .then((res) => {
            if (!res.ok) return res.json().then((e) => { throw new Error(e.message); });
            return res.json();
        })
        .then((data) => {
            if (!data.url) throw new Error("No gateway URL in response");
            establishConnection(data.url, token, intents);
        })
        .catch((err) => {
            console.error("[BotLogin] Gateway fetch failed:", err);
            showToast(`❌ Connect failed: ${err.message}`);
        });
}

function disconnectBot() {
    isStopping = true;
    if (ws) ws.close(1000, "User disconnected");
    resetConnectionState();
    showToast("🔌 Bot disconnected.");
}

// ─── Patching (optional token guard) ─────────────────────────────────────────
function applyPatches() {
    // Prevent the user-client token module from interfering while bot WS is live.
    const tokenModule = findByProps("getToken");
    if (tokenModule) {
        unpatchers.push(
            patcher.instead("BotLogin", tokenModule, "getToken", (_, _args, original) => {
                // If our bot socket is alive, return null so Discord's normal
                // user-client code doesn't try to reconnect over us.
                if (ws && ws.readyState === WebSocket.OPEN) return null;
                return original();
            })
        );
    }
}

// ─── Settings UI (React Native) ───────────────────────────────────────────────
// Revenge renders the default-exported `settings` function/component inside its
// plugin settings page. No DOM — use RN primitives only.
function Settings() {
    const [token, setToken]       = React.useState(storage.botToken ?? "");
    const [intents, setIntents]   = React.useState(String(storage.intents ?? 3276799));
    const [connected, setConnected] = React.useState(false);

    // Sync connected state with actual WS
    React.useEffect(() => {
        const id = setInterval(() => {
            setConnected(!!(ws && ws.readyState === WebSocket.OPEN));
        }, 1000);
        return () => clearInterval(id);
    }, []);

    function handleConnect() {
        if (!token.trim()) {
            showToast("⚠️ Please enter a bot token.");
            return;
        }
        // Persist before connecting
        storage.botToken = token.trim();
        storage.intents  = parseInt(intents) || 3276799;
        connectAsBot(storage.botToken, storage.intents);
    }

    function handleDisconnect() {
        showConfirmationAlert({
            title: "Disconnect Bot",
            content: "Are you sure you want to disconnect the bot session?",
            confirmText: "Disconnect",
            confirmColor: "red",
            onConfirm: disconnectBot,
        });
    }

    return React.createElement(
        ScrollView,
        { style: styles.container },

        React.createElement(Text, { style: styles.sectionTitle }, "🤖 BotLogin"),

        React.createElement(Text, { style: styles.label }, "Bot Token"),
        React.createElement(TextInput, {
            style: styles.input,
            value: token,
            onChangeText: setToken,
            placeholder: "Bot token (kept secure in storage)",
            placeholderTextColor: "#888",
            secureTextEntry: true,
            autoCorrect: false,
            autoCapitalize: "none",
        }),

        React.createElement(Text, { style: styles.label }, "Gateway Intents (bitmask)"),
        React.createElement(TextInput, {
            style: styles.input,
            value: intents,
            onChangeText: setIntents,
            placeholder: "e.g. 3276799",
            placeholderTextColor: "#888",
            keyboardType: "numeric",
        }),
        React.createElement(Text, { style: styles.hint },
            "Refer to the Discord API docs for intent bitmasks."
        ),

        React.createElement(
            View,
            { style: styles.row },
            React.createElement(
                TouchableOpacity,
                { style: styles.btnConnect, onPress: handleConnect },
                React.createElement(Text, { style: styles.btnText }, "Connect")
            ),
            React.createElement(
                TouchableOpacity,
                { style: styles.btnDisconnect, onPress: handleDisconnect },
                React.createElement(Text, { style: styles.btnText }, "Disconnect")
            )
        ),

        React.createElement(
            Text,
            { style: [styles.statusText, connected ? {} : styles.statusDisconnected] },
            connected ? "● Bot is connected" : "● Not connected"
        )
    );
}

// ─── Plugin Lifecycle ─────────────────────────────────────────────────────────
export default {
    onLoad() {
        console.log("[BotLogin] Loading…");
        applyPatches();
        // Auto-reconnect if a token was saved from a previous session
        if (storage.botToken) {
            connectAsBot(storage.botToken, storage.intents);
        }
        console.log("[BotLogin] Loaded.");
    },

    onUnload() {
        console.log("[BotLogin] Unloading…");
        isStopping = true;
        if (ws) { ws.close(1000, "Plugin unloading"); ws = null; }
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
        // Remove all patches
        unpatchers.forEach((up) => up());
        unpatchers = [];
        resetConnectionState();
        console.log("[BotLogin] Unloaded.");
    },

    settings: Settings,
};
