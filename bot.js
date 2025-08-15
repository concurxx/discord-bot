const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Discord channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Vercel URL
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bridgeList.json");
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
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Load bridge list
let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.error("Error reading bridge list:", err);
}

let lastListMessage = null;

// ----------------- SAVE -----------------
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.error("Error saving bridge list:", err);
    }
}

// ----------------- FORMAT & SORT -----------------
function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    const formatted = bridgeList
        .map((b, i) => {
            const displayName = b.name;
            const bridgeLine = b.bridge;
            const vercelLine = `[LNK](${b.vercel})`;
            return `${i + 1}. ${b.color}${displayName}\n${bridgeLine}\n${vercelLine}`;
        })
        .join("\n\n");

    return formatted + "\n"; // ensures last line isn't cut
}

// ----------------- CLEAN CHANNEL -----------------
async function cleanChannel(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => m.id !== (lastListMessage?.id));
        if (toDelete.size > 0) {
            await channel.bulkDelete(toDelete, true);
        }
    } catch (err) {
        console.error("Error cleaning channel:", err);
    }
}

// ----------------- UPDATE LIST MESSAGE -----------------
async function updateBridgeListMessage(channel) {
    if (lastListMessage) {
        try { await lastListMessage.delete(); } catch {}
    }

    if (bridgeList.length === 0) {
        lastListMessage = await channel.send("Bridge list is currently empty.");
    } else {
        lastListMessage = await channel.send("**Bridge List:**\n\n" + formatBridgeList());
    }

    await cleanChannel(channel);
}

// ----------------- PROCESS BRIDGE BLOCKS -----------------
async function processBridgeLinks(message) {
    const blocks = message.content.split(/\n\s*\n/);
    let addedCount = 0;

    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const bridgeLink = bridgeMatch[0];
        const code = bridgeLink.split("?")[1]?.trim();
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        const isDuplicate = bridgeList.some(entry => entry.bridgeLink === bridgeLink);
        if (isDuplicate) continue;

        const structureLine = block.split("\n").find(line => line.toLowerCase().startsWith("castle:"));
        const displayName = structureLine ? structureLine.split(":")[1].trim() : "Unknown Structure";

        bridgeList.push({
            bridgeLink,
            vercelLink,
            bridge: bridgeLink,
            vercel: vercelLink,
            name: displayName,
            color: ""
        });

        addedCount++;
    }

    if (addedCount > 0) {
        saveBridgeList();
        const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        if (channel?.isTextBased()) await updateBridgeListMessage(channel);
    }
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
    if (channel?.isTextBased()) await updateBridgeListMessage(channel);
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content;

    // -------------- COLOR COMMANDS --------------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = content.split(" ");
        const num = parseInt(numStr, 10);
        if (num > 0 && num <= bridgeList.length) {
            const colors = { "!red": "🔴", "!yellow": "🟡", "!green": "🟢" };
            bridgeList[num - 1].color = colors[cmd.toLowerCase()];
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    // -------------- PURGE NON-BOT MESSAGES --------------
    let fetched;
    try {
        fetched = await message.channel.messages.fetch({ limit: 100 });
        const toDelete = fetched.filter(m => m.author.id !== client.user.id);
        if (toDelete.size > 0) await message.channel.bulkDelete(toDelete, true);
    } catch (err) {}

    // -------------- LIST ME DM COMMAND --------------
    if (content.toLowerCase().startsWith("!listme")) {
        const args = content.split(" ").slice(1);
        let listToSend = [];

        if (args[0]?.toLowerCase() === "all") {
            listToSend = bridgeList;
        } else if (args[0]?.includes("-")) {
            const [start, end] = args[0].split("-").map(n => parseInt(n, 10));
            listToSend = bridgeList.slice(start - 1, end);
        } else if (args[0]) {
            const idx = parseInt(args[0], 10) - 1;
            if (!isNaN(idx) && bridgeList[idx]) listToSend.push(bridgeList[idx]);
        }

        if (listToSend.length === 0) return;

        const dmContent = listToSend.map((b, i) => `${i + 1}. ${b.name}\n${b.bridge}`).join("\n\n");
        try {
            await message.author.send(dmContent);
        } catch (err) {
            console.error("Error sending DM:", err);
        }
        return;
    }

    // -------------- PROCESS NEW BRIDGES --------------
    await processBridgeLinks(message);
});

// ----------------- LOGIN -----------------
client.login(process.env.DISCORD_TOKEN);
