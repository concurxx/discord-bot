const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1407022766967881759"; // Replace with your channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Replace with your Vercel URL
const DATA_FILE = path.join(__dirname, "data", "bridgeList.json");
const COMMAND_LOG_FILE = path.join(__dirname, "data", "commandLog.json");
// =========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Ensure data folder exists
if (!fs.existsSync(path.join(__dirname, "data"))) fs.mkdirSync(path.join(__dirname, "data"));

// Load bridge list
let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.log("Error reading bridge list file:", err);
}

// Load command log
let commandLog = {};
try {
    if (fs.existsSync(COMMAND_LOG_FILE)) {
        commandLog = JSON.parse(fs.readFileSync(COMMAND_LOG_FILE, "utf8"));
    }
} catch (err) {
    console.error("❌ Error reading command log file:", err);
}

let lastListMessages = []; // stores message objects for editing

// ----------------- SAVE FUNCTIONS -----------------
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.log("Error saving bridge list:", err);
    }
}

function saveCommandLog() {
    try {
        fs.writeFileSync(COMMAND_LOG_FILE, JSON.stringify(commandLog, null, 2), "utf8");
    } catch (err) {
        console.error("❌ Error saving command log:", err);
    }
}

// ----------------- FORMAT & SORT LIST -----------------
function formatBridgeList(includeVercel = true) {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    return bridgeList.map((b, i) => {
        const displayName = `${i + 1}. ${b.color}${b.name}`;
        const bridgeLine = b.bridge;
        const vercelLine = includeVercel ? `[LNK](${b.vercel})` : "";
        return vercelLine ? `${displayName}\n${bridgeLine}\n${vercelLine}` : `${displayName}\n${bridgeLine}`;
    });
}

// ----------------- SPLIT INTO CHUNKS (keep entries together) -----------------
function splitMessage(entries, maxLength = 1900) {
    const chunks = [];
    let current = "";

    for (const entry of entries) {
        const entryWithSpacing = (current ? "\n\n" : "") + entry;
        if ((current + entryWithSpacing).length > maxLength) {
            if (current) chunks.push(current.trim());
            current = entry;
        } else {
            current += entryWithSpacing;
        }
    }

    if (current) chunks.push(current.trim());
    return chunks;
}

// ----------------- CLEAN CHANNEL -----------------
async function cleanChannel(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !lastListMessages.some(l => l.id === m.id));
        if (toDelete.size > 0) {
            await channel.bulkDelete(toDelete, true);
        }
    } catch (err) {
        console.error("❌ Error cleaning channel:", err);
    }
}

// ----------------- UPDATE LIST MESSAGE -----------------
async function updateBridgeListMessage(channel) {
    if (bridgeList.length === 0) {
        if (lastListMessages.length > 0) {
            try {
                await lastListMessages[0].edit("Bridge list is currently empty.");
                for (let i = 1; i < lastListMessages.length; i++) {
                    try { await lastListMessages[i].delete(); } catch {}
                }
                lastListMessages = [lastListMessages[0]];
            } catch {
                const msg = await channel.send("Bridge list is currently empty.");
                lastListMessages = [msg];
            }
        } else {
            const msg = await channel.send("Bridge list is currently empty.");
            lastListMessages = [msg];
        }
        return;
    }

    const entries = formatBridgeList(true);
    const chunks = splitMessage(entries);

    if (chunks.length === lastListMessages.length) {
        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            try {
                await lastListMessages[i].edit(header + chunks[i]);
            } catch {
                const msg = await channel.send(header + chunks[i]);
                lastListMessages[i] = msg;
            }
        }
    } else {
        for (const msg of lastListMessages) {
            try { await msg.delete(); } catch {}
        }
        lastListMessages = [];
        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            const msg = await channel.send(header + chunks[i]);
            lastListMessages.push(msg);
        }
    }

    await cleanChannel(channel);
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    try {
        const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        if (!channel) {
            console.error("❌ Could not find channel for bridge list");
            return;
        }

        const messages = await channel.messages.fetch({ limit: 100 });
        const listMessages = messages
            .filter(m => m.author.id === client.user.id && m.content.startsWith("**Bridge List"))
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        if (listMessages.size > 0) {
            lastListMessages = Array.from(listMessages.values());
            console.log(`🔄 Re-synced ${lastListMessages.length} list message(s).`);
            await updateBridgeListMessage(channel);
        } else {
            await updateBridgeListMessage(channel);
            console.log("🆕 No existing list found, created new one.");
        }
    } catch (err) {
        console.error("❌ Error during startup sync:", err);
    }
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;
    const now = Date.now();
    const userId = message.author.id;

    // ----------------- LOG ALL COMMANDS -----------------
    if (!commandLog[userId]) commandLog[userId] = [];
    // Note: bridge additions will be logged separately
    if (!content.startsWith("l+k://")) { 
        commandLog[userId].push({ command: content, timestamp: now });
        const dayAgo = now - 24 * 60 * 60 * 1000;
        commandLog[userId] = commandLog[userId].filter(entry => entry.timestamp > dayAgo);
        saveCommandLog();
    }

    // Only respond in the allowed channel
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    // ----------------- !listme command -----------------
    if (content.startsWith("!listme")) {
        if (bridgeList.length === 0) {
            try {
                await message.author.send("Bridge list is currently empty.");
            } catch {
                await message.channel.send(`${message.author}, I can't DM you. Please enable DMs from server members.`);
            }
            return;
        }

        const args = content.split(" ").slice(1);
        let start = 0, end = bridgeList.length;

        if (args.length > 0) {
            const arg = args[0].toLowerCase();
            if (arg !== "all") {
                const match = arg.match(/^(\d+)-(\d+)$/);
                if (match) {
                    start = Math.max(0, parseInt(match[1], 10) - 1);
                    end = Math.min(bridgeList.length, parseInt(match[2], 10));
                }
            }
        }

        const entries = bridgeList
            .slice(start, end)
            .map((b, i) => `${i + 1}. ${b.color}${b.name}\n${b.bridge}`);

        if (entries.length === 0) {
            try {
                await message.author.send("No entries found for that range.");
            } catch {
                await message.channel.send(`${message.author}, I can't DM you. Please enable DMs.`);
            }
            return;
        }

        const chunks = splitMessage(entries);

        try {
            for (let i = 0; i < chunks.length; i++) {
                const header = i === 0
                    ? "**Your Bridge List:**\n\n"
                    : `**Your Bridge List (Part ${i+1}):**\n\n`;
                await message.author.send(header + chunks[i]);
            }

            const reply = await message.reply("✅ I've sent you the bridge list via DM!");
            setTimeout(async () => { try { await reply.delete(); } catch {} }, 5000);

        } catch {
            await message.channel.send(`${message.author}, I couldn't DM you. Please enable DMs from server members.`);
        }

        setTimeout(async () => { try { await message.delete(); } catch {} }, 3000);
        return;
    }

    // ----------------- !viewlog command -----------------
    if (content.startsWith("!viewlog")) {
        let allLogs = [];

        for (const userId in commandLog) {
            const user = await client.users.fetch(userId).catch(() => null);
            const username = user ? user.tag : userId;
            commandLog[userId].forEach(entry => {
                allLogs.push(`${username} → <t:${Math.floor(entry.timestamp / 1000)}:T> → ${entry.command}`);
            });
        }

        allLogs.sort((a, b) => {
            const timeA = parseInt(a.match(/<t:(\d+):T>/)[1]);
            const timeB = parseInt(b.match(/<t:(\d+):T>/)[1]);
            return timeA - timeB;
        });

        if (allLogs.length === 0) {
            try { await message.author.send("No commands have been logged in the last 24 hours."); }
            catch { await message.channel.send(`${message.author}, I can't DM you.`); }
            return;
        }

        const chunks = splitMessage(allLogs, 1900);

        try {
            for (let i = 0; i < chunks.length; i++) {
                const header = i === 0
                    ? "**Command Log (last 24 hours):**\n\n"
                    : `**Command Log (Part ${i + 1}):**\n\n`;
                await message.author.send(header + chunks[i]);
            }

            const reply = await message.reply("✅ I've sent you the command log via DM!");
            setTimeout(async () => { try { await reply.delete(); } catch {} }, 5000);

        } catch {
            await message.channel.send(`${message.author}, I couldn't DM you. Please enable DMs.`);
        }

        setTimeout(async () => { try { await message.delete(); } catch {} }, 3000);
        return;
    }

    // ----------------- Bridge link detection -----------------
    const blocks = content.split(/\n\s*\n/);
    let bridgesAdded = 0;
    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const link = bridgeMatch[0];
        const code = link.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        if (bridgeList.some(entry => entry.bridgeLink?.includes(code))) continue;

        const structureLine = block.split("\n").find(line => line.includes(":"));
        const displayName = structureLine
            ? structureLine.split(":").map(s => s.trim()).join("/")
            : "Unknown Structure";

        bridgeList.push({
            bridgeLink: link,
            vercelLink,
            bridge: link,
            vercel: vercelLink,
            name: displayName,
            color: ""
        });

        bridgesAdded++;
    }

    // Log bridge addition as a summary
    if (bridgesAdded > 0) {
        if (!commandLog[userId]) commandLog[userId] = [];
        commandLog[userId].push({
            command: `Added ${bridgesAdded} bridge${bridgesAdded > 1 ? "s" : ""}`,
            timestamp: now
        });
        const dayAgo = now - 24 * 60 * 60 * 1000;
        commandLog[userId] = commandLog[userId].filter(entry => entry.timestamp > dayAgo);
        saveCommandLog();
    }

    saveBridgeList();
    await updateBridgeListMessage(message.channel);
});

// ----------------- LOGIN -----------------
client.login(process.env.DISCORD_TOKEN);
