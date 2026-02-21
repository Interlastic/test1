const {
    metro: { findByProps },
    patcher,
    storage: { createProxy },
    ui: {
        toasts: { showToast },
        alerts: { showConfirmationAlert },
    },
    React,
    ReactNative: { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView },
} = window.vendetta;

const storage = createProxy({
    botToken: "",
    intents: 3276799,
});

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: "#2b2d31" },
    label: { color: "#ffffff", fontSize: 14, marginBottom: 6, fontWeight: "600" },
    hint: { color: "#aaaaaa", fontSize: 12, marginBottom: 14 },
    input: {
        backgroundColor: "#424549", color: "#ffffff", borderRadius: 6,
        paddingHorizontal: 12, paddingVertical: 8, marginBottom: 4,
        borderWidth: 1, borderColor: "#36393f", fontSize: 14,
    },
    row: { flexDirection: "row", justifyContent: "space-between", marginTop: 20, gap: 10 },
    btnConnect: { flex: 1, backgroundColor: "#5865F2", paddingVertical: 12, borderRadius: 6, alignItems: "center" },
    btnDisconnect: { flex: 1, backgroundColor: "#ED4245", paddingVertical: 12, borderRadius: 6, alignItems: "center" },
    btnText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
    statusConnected: { color: "#57F287", fontSize: 13, marginTop: 16, textAlign: "center" },
    statusDisconnected: { color: "#ED4245", fontSize: 13, marginTop: 16, textAlign: "center" },
    sectionTitle: { color: "#ffffff", fontSize: 18, fontWeight: "700", marginBottom: 16 },
});

let ws = null;
let heartbeatInterval = null;
let sequence = null;
let sessionId = null;
let reconnectAttempts = 0;
let isStopping = false;
let gatewayUrl = null;
let unpatchers = [];

function sendHeartbeat() {
    if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ op: 1, d: sequence }));
}

function startHeartbeat(interval) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    sendHeartbeat();
    heartbeatInterval = setInterval(sendHeartbeat, interval);
}

function resetConnectionState() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    ws = null; sequence = null; sessionId = null;
    reconnectAttempts = 0; isStopping = false;
}

function sendIdentify(token, intents) {
    ws.send(JSON.stringify({
        op: 2,
        d: {
            token: token.startsWith("Bot ") ? token : ("Bot " + token),
            intents: intents,
            properties: { os: "android", browser: "BotLogin", device: "BotLogin" },
            compress: false,
            large_threshold: 250,
        },
    }));
}

function sendResume() {
    var token = storage.botToken;
    if (!token || !sessionId || sequence === null) { connectAsBot(token, storage.intents); return; }
    ws.send(JSON.stringify({
        op: 6,
        d: { token: token.startsWith("Bot ") ? token : ("Bot " + token), session_id: sessionId, seq: sequence },
    }));
}

function handleDispatch(t, d) {
    if (t === "READY") {
        sessionId = d.session_id;
        reconnectAttempts = 0;
        showToast("✅ Connected as " + d.user.username + "#" + d.user.discriminator);
    } else if (t === "MESSAGE_CREATE") {
        console.log("[BotLogin] MSG #" + d.channel_id + " <" + d.author.username + ">: " + d.content);
    }
}

function handleGatewayMessage(data) {
    var op = data.op, d = data.d, s = data.s, t = data.t;
    if (s != null) sequence = s;
    if (op === 0) handleDispatch(t, d);
    else if (op === 1) sendHeartbeat();
    else if (op === 7) reconnect(false);
    else if (op === 9) { if (d) sendResume(); else reconnect(true); }
    else if (op === 10) startHeartbeat(d.heartbeat_interval);
}

function handleDisconnect(code) {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (code === 1000 || isStopping) { resetConnectionState(); return; }
    if (reconnectAttempts < 5) {
        reconnectAttempts++;
        var delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        setTimeout(function() { reconnect(false); }, delay);
    } else {
        showToast("❌ Bot disconnected. Max reconnects reached.");
        resetConnectionState();
    }
}

function reconnect(forceIdentify) {
    if (ws) { ws.close(); ws = null; }
    var token = storage.botToken, intents = storage.intents;
    if (!token) { resetConnectionState(); return; }
    if (forceIdentify) { sessionId = null; sequence = null; connectAsBot(token, intents); }
    else if (sessionId && sequence !== null && gatewayUrl) establishConnection(gatewayUrl, token, intents);
    else connectAsBot(token, intents);
}

function establishConnection(url, token, intents) {
    gatewayUrl = url;
    var fullUrl = url.startsWith("wss://") ? url : ("wss://" + url);
    ws = new WebSocket(fullUrl + "?v=10&encoding=json");
    ws.onopen    = function() { sendIdentify(token, intents); };
    ws.onmessage = function(e) { handleGatewayMessage(JSON.parse(e.data)); };
    ws.onclose   = function(e) { handleDisconnect(e.code); };
    ws.onerror   = function(e) { console.error("[BotLogin] WS error:", e); };
}

function connectAsBot(token, intents) {
    if (ws && ws.readyState === WebSocket.OPEN) { showToast("⚠️ Already connected."); return; }
    isStopping = false;
    fetch("https://discord.com/api/v10/gateway/bot", {
        headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
    })
    .then(function(res) {
        if (!res.ok) return res.json().then(function(e) { throw new Error(e.message); });
        return res.json();
    })
    .then(function(data) {
        if (!data.url) throw new Error("No gateway URL in response");
        establishConnection(data.url, token, intents);
    })
    .catch(function(err) {
        console.error("[BotLogin] Gateway fetch failed:", err);
        showToast("❌ Connect failed: " + err.message);
    });
}

function disconnectBot() {
    isStopping = true;
    if (ws) ws.close(1000, "User disconnected");
    resetConnectionState();
    showToast("🔌 Bot disconnected.");
}

function applyPatches() {
    var tokenModule = findByProps("getToken");
    if (tokenModule) {
        unpatchers.push(patcher.instead("BotLogin", tokenModule, "getToken", function(_, _args, original) {
            if (ws && ws.readyState === WebSocket.OPEN) return null;
            return original();
        }));
    }
}

function Settings() {
    var state = React.useState(storage.botToken || "");
    var token = state[0], setToken = state[1];
    var intentsState = React.useState(String(storage.intents || 3276799));
    var intents = intentsState[0], setIntents = intentsState[1];
    var connState = React.useState(false);
    var connected = connState[0], setConnected = connState[1];

    React.useEffect(function() {
        var id = setInterval(function() {
            setConnected(!!(ws && ws.readyState === WebSocket.OPEN));
        }, 1000);
        return function() { clearInterval(id); };
    }, []);

    function handleConnect() {
        if (!token.trim()) { showToast("⚠️ Please enter a bot token."); return; }
        storage.botToken = token.trim();
        storage.intents = parseInt(intents) || 3276799;
        connectAsBot(storage.botToken, storage.intents);
    }

    function handleDisconnect() {
        showConfirmationAlert({
            title: "Disconnect Bot",
            content: "Are you sure you want to disconnect?",
            confirmText: "Disconnect",
            confirmColor: "red",
            onConfirm: disconnectBot,
        });
    }

    return React.createElement(ScrollView, { style: styles.container },
        React.createElement(Text, { style: styles.sectionTitle }, "🤖 BotLogin"),
        React.createElement(Text, { style: styles.label }, "Bot Token"),
        React.createElement(TextInput, {
            style: styles.input, value: token, onChangeText: setToken,
            placeholder: "Your bot token", placeholderTextColor: "#888",
            secureTextEntry: true, autoCorrect: false, autoCapitalize: "none",
        }),
        React.createElement(Text, { style: styles.label }, "Gateway Intents (bitmask)"),
        React.createElement(TextInput, {
            style: styles.input, value: intents, onChangeText: setIntents,
            placeholder: "e.g. 3276799", placeholderTextColor: "#888", keyboardType: "numeric",
        }),
        React.createElement(Text, { style: styles.hint }, "See Discord API docs for intent values."),
        React.createElement(View, { style: styles.row },
            React.createElement(TouchableOpacity, { style: styles.btnConnect, onPress: handleConnect },
                React.createElement(Text, { style: styles.btnText }, "Connect")),
            React.createElement(TouchableOpacity, { style: styles.btnDisconnect, onPress: handleDisconnect },
                React.createElement(Text, { style: styles.btnText }, "Disconnect"))
        ),
        React.createElement(Text, { style: connected ? styles.statusConnected : styles.statusDisconnected },
            connected ? "● Bot is connected" : "● Not connected")
    );
}

module.exports = {
    onLoad: function() {
        applyPatches();
        if (storage.botToken) connectAsBot(storage.botToken, storage.intents);
    },
    onUnload: function() {
        isStopping = true;
        if (ws) { ws.close(1000, "Plugin unloading"); ws = null; }
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
        unpatchers.forEach(function(up) { up(); });
        unpatchers = [];
        resetConnectionState();
    },
    settings: Settings,
};
