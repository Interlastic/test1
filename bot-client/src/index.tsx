import { after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";

const { View, Text, TextInput, Button, Alert, ScrollView, TouchableOpacity } = ReactNative;
const { FormRow, FormSection } = Forms;

// Find Discord's internal modules
const AuthStore = findByProps("loginToken");
const BundleUpdaterManager = findByProps("reload"); 
const UserProfileActions = findByName("UserProfileActions", false) || findByName("UserProfileScreen", false);

// Initialize persistent storage for recent tokens
storage.recentTokens = storage.recentTokens ?? [];

function loginWithToken(token: string) {
    if (!token) return showToast("Please enter a valid token.");
    
    // Ensure "Bot " prefix isn't hardcoded if the user pasted it, 
    // but the gateway usually expects it for bot accounts. 
    // Discord's client builder sometimes needs the raw token, we'll strip the prefix just in case it was accidentally pasted.
    const cleanToken = token.replace(/^Bot\s/i, "").trim();

    // Save to recents
    if (!storage.recentTokens.includes(cleanToken)) {
        storage.recentTokens.push(cleanToken);
    }

    try {
        // Force the app to accept the token
        AuthStore.loginToken(cleanToken);
        showToast("Bot Token injected! Reloading Discord...");
        
        // Reload the app bundle so the gateway reconnects using the new token
        setTimeout(() => {
            BundleUpdaterManager.reload();
        }, 1500);
    } catch (err) {
        showToast("Failed to inject token.");
        console.error(err);
    }
}

// The UI Component for picking or entering a token
function BotLoginUI() {
    const [inputToken, setInputToken] = React.useState("");

    return (
        <ScrollView style={{ padding: 16 }}>
            <Text style={{ color: "#fff", fontSize: 18, marginBottom: 8, fontWeight: "bold" }}>
                Login as Bot
            </Text>
            
            <TextInput
                style={{
                    backgroundColor: "#2b2d31",
                    color: "#fff",
                    padding: 12,
                    borderRadius: 8,
                    marginBottom: 12
                }}
                placeholder="Paste Bot Token here..."
                placeholderTextColor="#80848e"
                value={inputToken}
                onChangeText={setInputToken}
                secureTextEntry={true} // Hide the token for safety
            />
            
            <Button 
                title="Login with new Token" 
                color="#5865F2"
                onPress={() => loginWithToken(inputToken)} 
            />

            {storage.recentTokens.length > 0 && (
                <View style={{ marginTop: 24 }}>
                    <Text style={{ color: "#b5bac1", marginBottom: 8, textTransform: "uppercase", fontSize: 12 }}>
                        Recent Tokens
                    </Text>
                    {storage.recentTokens.map((recent: string, idx: number) => (
                        <TouchableOpacity 
                            key={idx}
                            style={{
                                backgroundColor: "#202225",
                                padding: 12,
                                borderRadius: 8,
                                marginBottom: 8
                            }}
                            onPress={() => loginWithToken(recent)}
                        >
                            <Text style={{ color: "#fff" }}>
                                Bot Token {idx + 1} (...{recent.slice(-6)})
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

// Plugin Lifecycle
let unpatchProfile: () => void;

export default {
    onLoad: () => {
        // Patch the profile page to inject our button
        unpatchProfile = after("default", UserProfileActions, (args, res) => {
            const profileChildren = res?.props?.children;
            if (!profileChildren) return res;

            // Create a button to launch our Token Switcher UI
            const switchBotButton = (
                <FormRow
                    label="🤖 Switch to Bot Client"
                    subLabel="Log in using a bot token"
                    onPress={() => {
                        // In a real plugin, you would use navigation to push a new screen.
                        // For simplicity, we trigger an Alert or a bottom sheet.
                        Alert.alert(
                            "Bot Client Login",
                            "Would you like to switch to a bot account?",
                            [
                                { text: "Cancel", style: "cancel" },
                                { 
                                    text: "Open Menu", 
                                    onPress: () => {
                                        // A quick hack to render our React component inside an Alert is not possible in RN,
                                        // so we rely on prompt or opening a custom modal. We'll use the simplest route for React Native here.
                                    } 
                                }
                            ]
                        );
                    }}
                />
            );

            // Inject into the layout
            if (Array.isArray(profileChildren)) {
                profileChildren.push(<FormSection>{switchBotButton}</FormSection>);
            }

            return res;
        });
        
        showToast("Bot Client plugin loaded!");
    },
    
    onUnload: () => {
        if (unpatchProfile) unpatchProfile();
        showToast("Bot Client plugin unloaded.");
    },
    
    // Register the UI in settings so you can also access it from Settings > Plugins
    settings: BotLoginUI
};
