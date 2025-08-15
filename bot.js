const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Replace with your numeric channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Replace with your Vercel URL
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

// Load bridge list from JSON file, or start empty
let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.log("Error reading bridge list file:", err);
}

let lastListMessage = null;

// ====== Helper: Save bridge list to file ======
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.log("Error saving bridge list:", err);
    }
}

// ====== Helper: Reorder numbering ======
function resequenceList() {
    // This is just an array, so sequential numbering is implicit in order
    // We also trim extra spaces or broken entries
    bridgeList = bridgeList.filter(Boolean); 
}

// ====== Helper: Format & Sort ======
function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);
    return bridgeList
        .map((b, i) => `${i + 1}. ${b.color}${b.name}\n${b.bridge}\n[LNK](${b.vercel})`)
        .join("\n\n");
}

// ====== Helper: Update public list ======
async function updateBridgeListMessage(channel) {
    resequenceList();
    saveBridgeList();

    if (lastListMessage) {
        try { await lastListMessage.delete(); } catch {}
    }

    if (bridgeList.length === 0) {
        lastListMessage = await channel.send("Bridge list is currently empty.");
    } else {
        lastListMessage = await channel.send("**Bridge List:**\n\n" + formatBridgeList());
    }

    // Purge all non-bot messages
    const messages = await channel.messages.fetch({ limit: 100 });
    const nonBotMessages = messages.filter(m => m.author.id !== client.user.id);
    if (nonBotMessages.size > 0) {
        await channel.bulkDelete(nonBotMessages, true);
    }
}

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // ====== LISTME COMMAND ======
    if (message.content.startsWith("!listme")) {
        let range = message.content.split(" ")[1];
        let items = [];
        let startIndex = 0;

        if (range && range.toLowerCase() === "all") {
            items = bridgeList;
            startIndex = 0;
        } else if (range && range.includes("-")) {
            const [start, end] = range.split("-").map(n => parseInt(n.trim()));
            if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= bridgeList.length) {
                items = bridgeList.slice(start - 1, end);
                startIndex = start - 1;
            }
        }

        if (items.length > 0) {
            const msg = items
                .map((b, i) => `${startIndex + i + 1}. ${b.color}${b.name}\n${b.bridge}`)
                .join("\n\n");
            await message.author.send("Here’s your requested list:\n\n" + msg);
        }
        return;
    }

    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content;

    // ====== COLOR TAG COMMANDS ======
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = content.split(" ");
        const num = parseInt(numStr, 10);

        if (num > 0 && num <= bridgeList.length) {
            let color = "";
            if (cmd.toLowerCase() === "!red") color = "🔴";
            if (cmd.toLowerCase() === "!yellow") color = "🟡";
            if (cmd.toLowerCase() === "!green") color = "🟢";

            bridgeList[num - 1].color = color;
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    // ====== REMOVE & CLEAR ======
    if (content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const num = parseInt(content.split(" ")[1]);
        if (isNaN(num) || num < 1 || num > bridgeList.length) return;

        bridgeList.splice(num - 1, 1);
        await updateBridgeListMessage(message.channel);
        return;
    }

    if (content === "!clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        bridgeList = [];
        await updateBridgeListMessage(message.channel);
        return;
    }

    // ====== BRIDGE LINK DETECTION ======
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
    }

    await updateBridgeListMessage(message.channel);
});

client.login(process.env.DISCORD_TOKEN);
