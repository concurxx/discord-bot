const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Discord channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Vercel URL
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
const DATA_DIR = path.dirname(DATA_FILE);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Load bridge list
let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (err) {
    console.error("Error reading bridge list:", err);
}

let lastListMessage = null;

// Save to JSON
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.error("Error saving bridge list:", err);
    }
}

// Format and sort
function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);
    const formatted = bridgeList
        .map((b, i) => `${i + 1}. ${b.color}${b.name}\n${b.bridge}\n${b.vercel}`)
        .join("\n\n");
    return formatted + "\n"; // ensure last line isn't cut
}

// Update list message in channel
async function updateBridgeListMessage(channel) {
    const content = bridgeList.length === 0
        ? "Bridge list is currently empty.\n"
        : "**Bridge List:**\n\n" + formatBridgeList();

    try {
        if (lastListMessage) {
            await lastListMessage.edit(content);
        } else {
            lastListMessage = await channel.send(content);
        }
    } catch (err) {
        console.error("Error updating bridge list message:", err);
    }

    // Clean channel: delete all except the list
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => m.id !== lastListMessage.id);
        if (toDelete.size > 0) await channel.bulkDelete(toDelete, true);
    } catch (err) {
        console.error("Error cleaning channel:", err);
    }
}

// Process incoming bridge messages
async function processBridgeLinks(message) {
    const blocks = message.content.split(/\n\s*\n/);
    let added = 0;

    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const bridgeLink = bridgeMatch[0];
        const code = bridgeLink.split("?")[1]?.trim();
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        const isDuplicate = bridgeList.some(entry => entry.bridgeLink === bridgeLink);
        if (isDuplicate) continue;

        // Grab line with "Castle:" for display name
        const structureLine = block.split("\n").find(line => line.includes("Castle:"));
        const displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";

        bridgeList.push({
            bridgeLink,
            vercelLink,
            bridge: bridgeLink,
            vercel: vercelLink,
            name: displayName,
            color: ""
        });

        added++;
    }

    if (added > 0) {
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
    }
}

// Bot ready
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    try {
        const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        if (channel?.isTextBased()) await updateBridgeListMessage(channel);
    } catch (err) {
        console.error("Error fetching channel:", err);
    }
});

// Message handler
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content.toLowerCase();

    // ----------------- COLOR TAGS -----------------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = message.content.split(" ");
        const num = parseInt(numStr, 10);
        if (num < 1 || num > bridgeList.length) return;

        const colors = { "!red": "🔴", "!yellow": "🟡", "!green": "🟢" };
        bridgeList[num - 1].color = colors[cmd.toLowerCase()] || "";
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }

    // ----------------- PURGE ALL NON-BOT -----------------
    if (content === "!purgeall") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
        let fetched;
        do {
            fetched = await message.channel.messages.fetch({ limit: 100 });
            const toDelete = fetched.filter(m => m.author.id !== client.user.id);
            if (toDelete.size > 0) await message.channel.bulkDelete(toDelete, true);
        } while (fetched.size >= 2);
        return;
    }

    // ----------------- REMOVE / CLEAR -----------------
    if (content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const num = parseInt(message.content.split(" ")[1]);
        if (!num || num < 1 || num > bridgeList.length) return;
        bridgeList.splice(num - 1, 1);
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

    // ----------------- LISTME DM -----------------
    if (content.startsWith("!listme")) {
        let args = message.content.split(" ")[1];
        let selected = [];

        if (!args || args.toLowerCase() === "all") {
            selected = bridgeList.map((b, i) => ({ ...b, originalIndex: i + 1 }));
        } else if (/^\d+-\d+$/.test(args)) {
            const [start, end] = args.split("-").map(Number);
            selected = bridgeList.map((b, i) => ({ ...b, originalIndex: i + 1 }))
                                 .filter(b => b.originalIndex >= start && b.originalIndex <= end);
        }

        if (selected.length > 0) {
            const dmText = selected.map(b => `${b.originalIndex}. ${b.name}\n${b.bridge}`).join("\n\n");
            await message.author.send(dmText);
        }
        return;
    }

    // ----------------- PROCESS NEW BRIDGES -----------------
    await processBridgeLinks(message);
});

client.login(process.env.DISCORD_TOKEN);
