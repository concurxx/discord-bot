const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Replace with your channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Replace with your Vercel URL
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bridgeList.json");
const LIST_MESSAGE_FILE = path.join(DATA_DIR, "listMessage.json");
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
    console.error("❌ Error reading bridge list:", err);
}

// Load last list message ID
let lastListMessageId = null;
try {
    if (fs.existsSync(LIST_MESSAGE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(LIST_MESSAGE_FILE, "utf8"));
        if (saved?.id) lastListMessageId = saved.id;
    }
} catch (err) {
    console.error("❌ Error reading list message file:", err);
}

// ----------------- SAVE TO JSON (ASYNC) -----------------
async function saveBridgeList() {
    try {
        await fs.promises.writeFile(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.error("❌ Error saving bridge list:", err);
    }
}

// ----------------- FORMAT & SORT LIST -----------------
function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    return bridgeList
        .map((b, i) => {
            const colorSymbol = b.color || "⚪"; // placeholder for uncolored bridges
            const displayName = `**${i + 1}. ${colorSymbol}${b.name.trim()}**`;
            const linksLine = `${b.bridgeLink.trim()} [LNK](${b.vercelLink.trim()})`;
            return `${displayName}\n${linksLine}`;
        })
        .join("\n\n"); // keep single blank line between each bridge
}

// ----------------- CLEAN CHANNEL (KEEP ONLY LIST) -----------------
async function cleanChannel(channel) {
    try {
        let fetched;
        do {
            fetched = await channel.messages.fetch({ limit: 100 });
            const toDelete = fetched.filter(m => m.id !== lastListMessageId);
            if (toDelete.size > 0) {
                await channel.bulkDelete(toDelete, true);
            }
        } while (fetched.size >= 2);
    } catch (err) {
        console.error("❌ Error cleaning channel:", err);
    }
}

// ----------------- UPDATE LIST MESSAGE (PERSISTENT) -----------------
async function updateBridgeListMessage(channel) {
    let listContent;

    if (bridgeList.length === 0) {
        // Placeholder entry when list is empty
        listContent = "**Bridge List:**\n\n**1. ⚪ No bridges yet**\nBridge link here [LNK](https://example.com)";
    } else {
        listContent = "**Bridge List:**\n\n" + formatBridgeList();
    }

    try {
        if (lastListMessageId) {
            const oldMsg = await channel.messages.fetch(lastListMessageId).catch(() => null);
            if (oldMsg) {
                await oldMsg.edit(listContent);
                await cleanChannel(channel);
                return;
            }
        }
        const newMsg = await channel.send(listContent);
        lastListMessageId = newMsg.id;
        fs.writeFileSync(LIST_MESSAGE_FILE, JSON.stringify({ id: lastListMessageId }), "utf8");
        await cleanChannel(channel);
    } catch (err) {
        console.error("❌ Error updating bridge list message:", err);
    }
}

// ----------------- BRIDGE LINK DETECTION -----------------
async function processBridgeLinks(message) {
    const blocks = message.content.split(/\n\s*\n/);
    let addedCount = 0;

    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const bridgeLink = bridgeMatch[0].trim();
        const code = encodeURIComponent(bridgeLink.split("?")[1]?.trim());
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/b/${code}`;

        const isDuplicate = bridgeList.some(entry =>
            entry.bridgeLink.toLowerCase() === bridgeLink.toLowerCase() ||
            entry.vercelLink.toLowerCase() === vercelLink.toLowerCase()
        );
        if (isDuplicate) continue;

        const structureLine = block.split("\n").find(line => line.includes(":"));
        const displayName = structureLine
            ? structureLine.split(":").map(s => s.trim()).join("/")
            : "Unknown Structure";

        bridgeList.push({
            bridgeLink,
            vercelLink,
            name: displayName,
            color: ""
        });

        addedCount++;
    }

    if (addedCount > 0) {
        await saveBridgeList();
        const channel = message.channel;
        await updateBridgeListMessage(channel);
    }
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    try {
        const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        if (channel?.isTextBased()) {
            await updateBridgeListMessage(channel);
        }
    } catch (err) {
        console.error("❌ Error fetching list channel on startup:", err);
    }
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content.trim();

    // Color Tag Commands
    if (/^!(red|yellow|green)\s+\d+$/i.test(content)) {
        const [cmd, numStr] = content.split(/\s+/);
        const num = parseInt(numStr, 10);

        if (num > 0 && num <= bridgeList.length) {
            const colors = { "!red": "🔴", "!yellow": "🟡", "!green": "🟢" };
            bridgeList[num - 1].color = colors[cmd.toLowerCase()];
            await saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
    }

    // Remove Command
    if (content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const num = parseInt(content.split(" ")[1]);
        if (isNaN(num) || num < 1 || num > bridgeList.length) return;
        bridgeList.splice(num - 1, 1);
        await saveBridgeList();
        await updateBridgeListMessage(message.channel);
    }

    // Clear Command
    if (content === "!clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        bridgeList = [];
        await saveBridgeList();
        await updateBridgeListMessage(message.channel);
    }

    // Detect Bridge Links
    await processBridgeLinks(message);

    // --- REAL-TIME CLEANUP ---
    if (message.id !== lastListMessageId) {
        await message.delete().catch(() => null);
    }
});

client.login(process.env.DISCORD_TOKEN);
