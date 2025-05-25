/// <reference types="../CTAutocomplete" />
/// <reference lib="es2015" />

// State variables
let broodmother_state = undefined;
let protector_state = undefined;
let broodmother_state_from_scoreboard = false;
let protector_state_from_scoreboard = false;

// Boss state constants
const BROODMOTHER_STATES = ["Dead", "Imminent", "Alive"];
const PROTECTOR_STATES = ["Dead", "Awakening", "Summoned"];

// Utility functions
function getScoreboardLinesSafe() {
    try {
        return Scoreboard.getLines();
    } catch (e) {
        return [];
    }
}

function getTabListNamesSafe() {
    try {
        return TabList.getNames();
    } catch (e) {
        return [];
    }
}

function getBroodmotherState() {
    let lines = getScoreboardLinesSafe();
    if (!lines || lines.length === 0) return;

    let i = 0;
    for (;i < lines.length && !lines[i]?.getName().startsWith("§4Broodmother§7:🎁§7 "); i++);
    if (i === lines.length) { // get tab instead
        let names = getTabListNamesSafe();
        if (!names || names.length === 0) return undefined;
        
        let idx = 20;
        for (; !names[idx]?.startsWith("§r Broodmother: §r") && idx < names.length; idx++);
        
        if (idx === names.length) return undefined;
        
        let tab_state = names[idx]?.slice("§r Broodmother: §r".length, -2);
        if (broodmother_state_from_scoreboard && BROODMOTHER_STATES.indexOf(tab_state) < BROODMOTHER_STATES.indexOf(broodmother_state))
            return broodmother_state;
        
        broodmother_state_from_scoreboard = false;
        return tab_state;
    }

    broodmother_state_from_scoreboard = true;
    return lines[i]?.getName().slice("§4Broodmother§7:🎁§7 ".length);
}

function getProtectorState() {
    let lines = getScoreboardLinesSafe();
    if (!lines || lines.length === 0) return;

    let i = 0;
    for (;i < lines.length && !lines[i]?.getName().startsWith("§4Protector§7:🎁§7 "); i++);
    if (i === lines.length) { // get tab instead
        let names = getTabListNamesSafe();
        if (!names || names.length === 0) return undefined;
        
        let idx = 20;
        for (; !names[idx]?.startsWith("§r Protector: §r") && idx < names.length; idx++);
        
        if (idx === names.length) return undefined;
        
        let tab_state = names[idx]?.slice("§r Protector: §r".length, -2);
        if (protector_state_from_scoreboard && PROTECTOR_STATES.indexOf(tab_state) < PROTECTOR_STATES.indexOf(protector_state))
            return protector_state;
        
        protector_state_from_scoreboard = false;
        return tab_state;
    }

    protector_state_from_scoreboard = true;
    return lines[i]?.getName().slice("§4Protector§7:🎁§7 ".length);
}

// Party and cycling state
let party_in_progress = false;
let party_members_joined = new Set();
let party_timeout = null;
let waiting_for_protector = false;
let waiting_for_broodmother = false;
let cycling_enabled = false;
let location_cycle_timer = null;
let current_location = "top"; // can be "top" or "drag"
let warp_in_progress = false; // Track if we're in the middle of a warp

// Constants
const PARTY_WARP_DELAY = 5000; // 5 seconds after party creation before warping
const PARTY_DISBAND_DELAY = 5000; // 5 seconds after warp before disbanding
const LOCATION_CYCLE_DELAY = 5000; // 5 seconds between location changes
const WARP_COOLDOWN = 4000; // 4 seconds cooldown between warps

// File paths
const CONFIG_FILE = "./config/ChatTriggers/modules/EndBrood/warp_lists.json";

// Load warp lists from JSON
function loadWarpLists() {
    try {
        return JSON.parse(FileLib.read(CONFIG_FILE));
    } catch (e) {
        // Return default structure if file doesn't exist or is invalid
        return {
            broodmother: {
                enabled: true,
                players: []
            },
            protector: {
                enabled: true,
                players: []
            }
        };
    }
}

// Save warp lists to JSON
function saveWarpLists(data) {
    try {
        FileLib.write(CONFIG_FILE, JSON.stringify(data, null, 4));
        return true;
    } catch (e) {
        ChatLib.chat("&cError saving warp lists: " + e);
        return false;
    }
}

// Function to cleanup party state
function cleanupParty() {
    if (party_timeout) {
        clearTimeout(party_timeout);
        party_timeout = null;
    }
    ChatLib.command("p disband");
    party_in_progress = false;
    
    // Resume location cycling after party cleanup
    if (cycling_enabled && !location_cycle_timer) {
        location_cycle_timer = setTimeout(cycleLocation, LOCATION_CYCLE_DELAY);
    }
}

// Function to handle party creation
function handleParty(players, bossType) {
    if (party_in_progress) {
        ChatLib.chat("&7[Debug] Party already in progress");
        return;
    }
    
    party_in_progress = true;
    
    // Create party command with all players
    const partyCommand = "p " + players.join(" ");
    ChatLib.chat(`&7[Debug] Running command: ${partyCommand}`);
    ChatLib.command(partyCommand);
    
    // Set timeout to warp after fixed delay
    ChatLib.chat(`&7[Debug] Will warp in ${PARTY_WARP_DELAY/1000} seconds...`);
    party_timeout = setTimeout(() => {
        ChatLib.chat("&7[Debug] Warping party...");
        ChatLib.command("p warp");
        
        // Set timeout to disband after warp
        setTimeout(() => {
            ChatLib.chat("&7[Debug] Disbanding party...");
            cleanupParty();
        }, PARTY_DISBAND_DELAY);
    }, PARTY_WARP_DELAY);
}

// Handle party chat messages
register("chat", (event) => {
    if (!party_in_progress) return;
    
    const message = ChatLib.removeFormatting(event);
    
    // Handle failed invites and errors
    if (message.includes("couldn't invite that player!") || 
        message.includes("is already in another party!") ||
        message.includes("is not online!")) {
        ChatLib.chat("&cFailed to invite player - cancelling party");
        cleanupParty();
        return;
    }
    
    // Log joins for debug purposes only
    if (message.includes("has joined the party.")) {
        const fullJoinMessage = message.split(" has joined")[0];
        ChatLib.chat(`&7[Debug] Player joined: ${fullJoinMessage}`);
    }
}).setCriteria("${player} has joined the party.");

// Register handlers for Protector messages
register("chat", (event) => {
    if (!cycling_enabled) return;
    
    const message = ChatLib.removeFormatting(event);
    
    // Check for the initial spawn message
    if (message.includes("The ground begins to shake as an Endstone Protector rises from below!") && waiting_for_protector) {
        ChatLib.chat("&7[Debug] Protector rising, preparing party...");
        const lists = loadWarpLists();
        if (lists.protector.enabled && lists.protector.players.length > 0) {
            handleParty(lists.protector.players, "protector");
        }
    }
    // Check for actual spawn
    else if (message.includes("The Protector has spawned!")) {
        waiting_for_protector = false;
        ChatLib.chat("&7[Debug] Protector fully spawned");
    }
    // Check for death
    else if (message.includes("ENDSTONE PROTECTOR DOWN!")) {
        ChatLib.chat("&7[Debug] Protector killed, waiting before resuming cycle...");
        protector_state = "Dead";
        waiting_for_protector = false;
        
        // Wait 5 seconds before resuming cycle to avoid instant warping
        setTimeout(() => {
            if (cycling_enabled) {
                ChatLib.chat("&7[Debug] Resuming normal cycle...");
                // Force location to drag so next cycle goes to top
                current_location = "drag";
                cycleLocation();
            }
        }, 5000);
    }
}).setCriteria("${message}");



// Function to cycle locations
function cycleLocation() {
    if (!cycling_enabled) return;

    // Clear any existing timer to prevent duplicates
    if (location_cycle_timer) {
        clearTimeout(location_cycle_timer);
        location_cycle_timer = null;
    }

    // Don't change location if we're waiting for something
    if (party_in_progress || waiting_for_protector || waiting_for_broodmother || warp_in_progress) {
        // If we're waiting for Broodmother, show a debug message
        if (waiting_for_broodmother) {
            ChatLib.chat("&7[Debug] Holding position for Broodmother imminent spawn...");
        }
        // Check again after delay
        location_cycle_timer = setTimeout(cycleLocation, LOCATION_CYCLE_DELAY);
        return;
    }

    // Switch location
    current_location = current_location === "top" ? "drag" : "top";
    ChatLib.chat(`&7[Debug] Warping to ${current_location}...`);
    
    // Set warp in progress
    warp_in_progress = true;
    ChatLib.command(`warp ${current_location}`);
    
    // Clear warp_in_progress after cooldown
    setTimeout(() => {
        warp_in_progress = false;
        ChatLib.chat(`&7[Debug] Ready for next warp`);
    }, WARP_COOLDOWN);

    // Always schedule next location change
    location_cycle_timer = setTimeout(cycleLocation, LOCATION_CYCLE_DELAY);
}

// Command to toggle cycling
register("command", () => {
    cycling_enabled = !cycling_enabled;
    
    if (cycling_enabled) {
        ChatLib.chat("&aCycling enabled - will check boss states and party automatically");
        current_location = "top"; // Start at top
        // Start checking boss states and location cycling
        checkBossStates();
        cycleLocation();
    } else {
        ChatLib.chat("&cCycling disabled");
        // Clear any pending timers
        if (brood_imminent_timer) {
            clearTimeout(brood_imminent_timer);
            brood_imminent_timer = null;
        }
        if (location_cycle_timer) {
            clearTimeout(location_cycle_timer);
            location_cycle_timer = null;
        }
        waiting_for_protector = false;
    }
}).setName("cycle");

// Function to check boss states
function checkBossStates() {
    if (!cycling_enabled) return;

    const newBroodState = getBroodmotherState();
    const newProtectorState = getProtectorState();

    if (newBroodState !== undefined && newBroodState !== broodmother_state) {
        const oldState = broodmother_state;
        broodmother_state = newBroodState;
        ChatLib.chat(`§4Broodmother§r: ${newBroodState}`);

        // Clear timer if state changes from Imminent to something else (like Dead)
        if (oldState === "Imminent" && newBroodState !== "Imminent") {
            if (brood_imminent_timer) {
                clearTimeout(brood_imminent_timer);
                brood_imminent_timer = null;
                ChatLib.chat("&7[Debug] Cleared Broodmother timer due to state change");
            }
        }

        const lists = loadWarpLists();
        if (lists.broodmother.enabled && lists.broodmother.players.length > 0) {
            if (newBroodState.includes("Imminent")) {
                ChatLib.chat("&7[Debug] Broodmother imminent, holding position until spawn...");
                waiting_for_broodmother = true;
            } else if (newBroodState.includes("Alive")) {
                ChatLib.chat("&7[Debug] Broodmother alive, starting immediate party...");
                waiting_for_broodmother = false;
                handleParty(lists.broodmother.players, "broodmother");
            } else if (newBroodState === "Dead" || newBroodState === "None") {
                waiting_for_broodmother = false;
            }
        }
    }

    if (newProtectorState !== undefined && newProtectorState !== protector_state) {
        protector_state = newProtectorState;
        ChatLib.chat(`§4Protector§r: ${newProtectorState}`);

        const lists = loadWarpLists();
        if (lists.protector.enabled && lists.protector.players.length > 0) {
            if (newProtectorState.includes("Awakening")) {
                waiting_for_protector = true;
                ChatLib.chat("&7[Debug] Protector awakening, waiting for spawn...");
            } else if (newProtectorState.includes("Summoned")) {
                ChatLib.chat("&7[Debug] Protector summoned, starting immediate party...");
                waiting_for_protector = false;
                handleParty(lists.protector.players, "protector");
            } else if (newProtectorState === "Dead" || newProtectorState === "None") {
                if (waiting_for_protector) {
                    ChatLib.chat("&7[Debug] Protector killed, waiting before resuming cycle...");
                    waiting_for_protector = false;
                    
                    // Wait 5 seconds before resuming cycle to avoid instant warping
                    setTimeout(() => {
                        if (cycling_enabled) {
                            ChatLib.chat("&7[Debug] Resuming normal cycle...");
                            // Force location to drag so next cycle goes to top
                            current_location = "drag";
                            cycleLocation();
                        }
                    }, 5000);
                }
            }
        }
    }

    // Continue checking every 500ms
    setTimeout(checkBossStates, 500);
}

// Commands for managing warp lists
register("command", (type, player) => {
    if (!type || !player) {
        ChatLib.chat("&cUsage: /warpadd <brood|prot> <player>");
        return;
    }

    const lists = loadWarpLists();
    const listType = type.toLowerCase() === "brood" ? "broodmother" : "protector";

    if (!lists[listType]) {
        ChatLib.chat("&cInvalid type. Use 'brood' or 'prot'");
        return;
    }

    if (!lists[listType].players.includes(player)) {
        lists[listType].players.push(player);
        if (saveWarpLists(lists)) {
            ChatLib.chat(`&aAdded &f${player}&a to ${listType} warp list`);
        }
    } else {
        ChatLib.chat(`&cPlayer &f${player}&c is already in the ${listType} warp list`);
    }
}).setName("warpadd");

register("command", (type, player) => {
    if (!type || !player) {
        ChatLib.chat("&cUsage: /warpremove <brood|prot> <player>");
        return;
    }

    const lists = loadWarpLists();
    const listType = type.toLowerCase() === "brood" ? "broodmother" : "protector";

    if (!lists[listType]) {
        ChatLib.chat("&cInvalid type. Use 'brood' or 'prot'");
        return;
    }

    const index = lists[listType].players.indexOf(player);
    if (index > -1) {
        lists[listType].players.splice(index, 1);
        if (saveWarpLists(lists)) {
            ChatLib.chat(`&aRemoved &f${player}&a from ${listType} warp list`);
        }
    } else {
        ChatLib.chat(`&cPlayer &f${player}&c is not in the ${listType} warp list`);
    }
}).setName("warpremove");

register("command", () => {
    const lists = loadWarpLists();
    ChatLib.chat("&7Current warp lists:");
    ChatLib.chat(`&4Broodmother&r (${lists.broodmother.enabled ? "&aEnabled" : "&cDisabled"})&r: &f${lists.broodmother.players.join(", ") || "Empty"}`);
    ChatLib.chat(`&4Protector&r (${lists.protector.enabled ? "&aEnabled" : "&cDisabled"})&r: &f${lists.protector.players.join(", ") || "Empty"}`);
}).setName("warplist");

register("command", (type) => {
    if (!type) {
        ChatLib.chat("&cUsage: /warptoggle <brood|prot>");
        return;
    }

    const lists = loadWarpLists();
    const listType = type.toLowerCase() === "brood" ? "broodmother" : "protector";

    if (!lists[listType]) {
        ChatLib.chat("&cInvalid type. Use 'brood' or 'prot'");
        return;
    }

    lists[listType].enabled = !lists[listType].enabled;
    if (saveWarpLists(lists)) {
        ChatLib.chat(`&a${listType} warp list ${lists[listType].enabled ? "enabled" : "disabled"}`);
    }
}).setName("warptoggle");

// Command to show current boss states
register("command", () => {
    ChatLib.chat("&7Current boss states:");
    ChatLib.chat(`&4Broodmother&r: ${broodmother_state || "Unknown"}`);
    ChatLib.chat(`&4Protector&r: ${protector_state || "Unknown"}`);
    ChatLib.chat(`&7Cycling: ${cycling_enabled ? "&aEnabled" : "&cDisabled"}&r`);
}).setName("checkboss");

// Command to show help
register("command", () => {
    ChatLib.chat("&7=== EndBrood Commands ===");
    ChatLib.chat("&6/cycle&7 - Toggle automatic boss cycling");
    ChatLib.chat("&6/checkboss&7 - Show current boss states");
    ChatLib.chat("&6/warpadd <brood|prot> <player>&7 - Add player to warp list");
    ChatLib.chat("&6/warpremove <brood|prot> <player>&7 - Remove player from warp list");
    ChatLib.chat("&6/warplist&7 - Show current warp lists");
    ChatLib.chat("&6/warptoggle <brood|prot>&7 - Toggle warp list on/off");
    ChatLib.chat("&6/endbroodhelp&7 - Show this help message");
}).setName("endbroodhelp");