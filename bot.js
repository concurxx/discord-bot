const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Your Discord channel ID
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
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.error("❌ Error reading bridge list:", err);
}

let listMessages = []; // Track all list messages for deletion

// Save bridge list
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.error("❌ Error saving bridge list:", err);
    }
}

// Clean channel (keep only bot list messages)
async function cleanChannel(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !listMessages.includes(m));
        if (toDelete.size > 0) await channel.bulkDelete(toDelete, true);
    } catch (err) {
        console.error("❌ Error cleaning channel:", err);
    }
}

// Format list and split into multiple messages (~1900 chars)
async function updateBridgeListMessage(channel) {
    // Delete old list messages
    if (listMessages.length) {
        for (const msg of listMessages) {
            try { await msg.delete(); } catch {}
        }
    }
    listMessages = [];

    if (!bridgeList.length) {
        const emptyMsg = await channel.send("Bridge list is currently empty.");
        listMessages.push(emptyMsg);
        await cleanChannel(channel);
        return;
    }

    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    const sorted = [...bridgeList].sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    // Build chunks
    let chunks = [];
    let currentChunk = "";
    for (let i = 0; i < sorted.length; i++) {
        const b = sorted[i];
        const line = `${b.number}. ${b.name}\n${b.bridge}\n[LNK](${b.vercel})\n\n`;
        if ((currentChunk + line).length > 1900) {
            chunks.push(currentChunk.trim());
            currentChunk = line;
        } else {
            currentChunk += line;
        }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());

    // Send chunks
    for (let i = 0; i < chunks.length; i++) {
        const header = chunks.length > 1 ? `**Bridge List #${i + 1}:**\n\n` : "**Bridge List:**\n\n";
        const msg = await channel.send(header + chunks[i]);
        listMessages.push(msg);
    }

    await cleanChannel(channel);
}

// Add bridge blocks from message content
async function processBridgeBlocks(message) {
    const blocks = message.content.split(/\n\s*\n/); // Split by empty line
    let added = 0;

    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const link = bridgeMatch[0];
        const code = link.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;
        const isDuplicate = bridgeList.some(entry => entry.bridgeLink === link);
        if (isDuplicate) continue;

        const structureLine = block.split("\n").find(line => line.includes(":"));
        const displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";

        // Assign persistent number
        const maxNumber = bridgeList.length ? Math.max(...bridgeList.map(b => b.number)) : 0;

        bridgeList.push({
            number: maxNumber + 1,
            name: displayName,
            bridge: link,
            vercel: vercelLink,
            bridgeLink: link,
            color: ""
        });

        added++;
    }

    if (added > 0) {
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
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

    const content = message.content.toLowerCase();

    // ---------- COLOR COMMANDS ----------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = content.split(" ");
        const num = parseInt(numStr, 10);
        const target = bridgeList.find(b => b.number === num);
        if (!target) return;

        const colorMap = { "!red": "🔴", "!yellow": "🟡", "!green": "🟢" };
        target.color = colorMap[cmd.toLowerCase()] || "";
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }

    // ---------- PURGE ----------
    if (content === "!purgeall") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
        await cleanChannel(message.channel);
        return;
    }

    // ---------- REMOVE / CLEAR ----------
    if (content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const num = parseInt(content.split(" ")[1]);
        bridgeList = bridgeList.filter(b => b.number !== num);
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }
    if (content === "!clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        bridgeList = [];
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }

    // ---------- LISTME DM COMMAND ----------
    if (content.startsWith("!listme")) {
        let args = content.split(" ");
        let subset = [];
        if (args[1] === "all") {
            subset = bridgeList;
        } else if (args[1]?.includes("-")) {
            const [start, end] = args[1].split("-").map(n => parseInt(n, 10));
            subset = bridgeList.filter(b => b.number >= start && b.number <= end);
        } else {
            const n = parseInt(args[1]);
            subset = bridgeList.filter(b => b.number === n);
        }

        if (subset.length === 0) return;

        let dmText = subset.map(b => `${b.number}. ${b.name}\n${b.bridge}`).join("\n\n");
        try {
            await message.author.send(dmText);
        } catch {}
        return;
    }

    // ---------- PROCESS BRIDGE BLOCKS ----------
    await processBridgeBlocks(message);
});

client.login(process.env.DISCORD_TOKEN);
