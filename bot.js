const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Your channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Your Vercel URL
const DATA_FILE = path.join(__dirname, "data", "bridgeList.json");
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
    if (fs.existsSync(DATA_FILE)) bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (err) {
    console.log("Error reading bridge list file:", err);
}

// Array to store list messages
let lastListMessage = [];

// ----------------- SAVE LIST -----------------
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.log("Error saving bridge list:", err);
    }
}

// ----------------- FORMAT & SPLIT LIST -----------------
async function updateBridgeListMessage(channel) {
    // Delete previous list messages
    if (lastListMessage.length > 0) {
        try {
            for (const msg of lastListMessage) await msg.delete();
        } catch {}
    }

    if (bridgeList.length === 0) {
        lastListMessage = [await channel.send("Bridge list is currently empty.")];
        return;
    }

    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    const sortedList = [...bridgeList].sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    let messages = [];
    let currentMessage = "**Bridge List:**\n\n";

    for (let i = 0; i < sortedList.length; i++) {
        const entry = sortedList[i];
        const line = `${i + 1}. ${entry.color}${entry.name}\n${entry.bridge}\n[LNK](${entry.vercel})\n\n`;

        // If adding this line exceeds ~1900 chars, start new message
        if ((currentMessage + line).length > 1900) {
            messages.push(currentMessage);
            currentMessage = "";
        }
        currentMessage += line;
    }

    if (currentMessage.length > 0) messages.push(currentMessage);

    lastListMessage = [];
    for (const msgContent of messages) {
        const msg = await channel.send(msgContent);
        lastListMessage.push(msg);
    }
}

// ----------------- DM SUB-LIST -----------------
async function dmBridgeList(user, range) {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    const sortedList = [...bridgeList].sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    let listToSend;
    if (range === "all") {
        listToSend = sortedList;
    } else {
        const [start, end] = range.split("-").map(n => parseInt(n, 10));
        if (isNaN(start) || isNaN(end) || start < 1 || end > sortedList.length) return;
        listToSend = sortedList.slice(start - 1, end);
    }

    const chunks = [];
    let currentChunk = "";

    for (let i = 0; i < listToSend.length; i++) {
        const entry = listToSend[i];
        const line = `${i + 1}. ${entry.name}\n${entry.bridge}\n\n`;
        if ((currentChunk + line).length > 1900) {
            chunks.push(currentChunk);
            currentChunk = "";
        }
        currentChunk += line;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    for (const chunk of chunks) {
        await user.send(chunk);
    }
}

// ----------------- BOT READY -----------------
client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content.trim();

    // -------- COLOR COMMANDS --------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = content.split(" ");
        const num = parseInt(numStr, 10);
        if (num < 1 || num > bridgeList.length) return;

        const colors = { "!red": "🔴", "!yellow": "🟡", "!green": "🟢" };
        bridgeList[num - 1].color = colors[cmd.toLowerCase()];
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }

    // -------- PURGE NON-BOT MESSAGES --------
    const fetched = await message.channel.messages.fetch({ limit: 100 });
    const toDelete = fetched.filter(m => !lastListMessage.includes(m));
    if (toDelete.size > 0) await message.channel.bulkDelete(toDelete, true);

    // -------- REMOVE & CLEAR COMMANDS --------
    if (content.startsWith("!remove") && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const num = parseInt(content.split(" ")[1]);
        if (!isNaN(num) && num >= 1 && num <= bridgeList.length) {
            bridgeList.splice(num - 1, 1);
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    if (content === "!clear" && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        bridgeList = [];
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }

    // -------- LISTME COMMAND (DMs user) --------
    if (content.startsWith("!listme")) {
        const args = content.split(" ")[1] || "all";
        await dmBridgeList(message.author, args);
        return;
    }

    // -------- BRIDGE LINK DETECTION --------
    const blocks = content.split(/\n\s*\n/);
    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const link = bridgeMatch[0];
        const code = link.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        const isDuplicate = bridgeList.some(entry => entry.bridgeLink?.includes(code));
        if (isDuplicate) continue;

        const structureLine = block.split("\n").find(line => line.includes(":"));
        const displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";

        bridgeList.push({
            bridgeLink: link,
            vercelLink,
            bridge: link,
            vercel: vercelLink,
            name: displayName,
            color: ""
        });
    }

    saveBridgeList();
    await updateBridgeListMessage(message.channel);
});

// ----------------- LOGIN -----------------
client.login(process.env.DISCORD_TOKEN);
