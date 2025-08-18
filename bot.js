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

// ----------------- SAVE TO JSON -----------------
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.log("Error saving bridge list:", err);
    }
}

// ----------------- FORMAT & SORT LIST -----------------
function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    return bridgeList
        .map((b, i) => {
            const displayName = `${i + 1}. ${b.color}${b.name}`;
            const bridgeLine = b.bridge;             // original l+k:// link
            const vercelLine = `[LNK](${b.vercel})`; // clickable "LNK"
            return `${displayName}\n${bridgeLine}\n${vercelLine}`;
        })
        .join("\n\n");
}

// ----------------- CLEAN CHANNEL -----------------
async function cleanChannel(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => m.id !== lastListMessage.id);
        if (toDelete.size > 0) {
            await channel.bulkDelete(toDelete, true);
        }
    } catch (err) {
        console.error("❌ Error cleaning channel:", err);
    }
}

// ----------------- UPDATE LIST MESSAGE -----------------
async function updateBridgeListMessage(channel) {
    // Delete previous list message if it exists
    if (lastListMessage) {
        try {
            await lastListMessage.delete();
        } catch {}
    }

    if (bridgeList.length === 0) {
        lastListMessage = await channel.send("Bridge list is currently empty.");
    } else {
        lastListMessage = await channel.send("**Bridge List:**\n\n" + formatBridgeList());
    }

    // Keep only the list in the channel
    await cleanChannel(channel);
}

// ----------------- BOT READY -----------------
client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content;

    // ----------------- COLOR TAG COMMANDS -----------------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = content.split(" ");
        const num = parseInt(numStr, 10);

        if (num > 0 && num <= bridgeList.length) {
            let color = "";
            if (cmd.toLowerCase() === "!red") color = "🔴";
            if (cmd.toLowerCase() === "!yellow") color = "🟡";
            if (cmd.toLowerCase() === "!green") color = "🟢";

            bridgeList[num - 1].color = color;
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    // ----------------- ADMIN REMOVE & CLEAR COMMANDS -----------------
    if (content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const num = parseInt(content.split(" ")[1]);
        if (isNaN(num) || num < 1 || num > bridgeList.length) return;

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

    // ----------------- BRIDGE LINK DETECTION -----------------
    const blocks = content.split(/\n\s*\n/); // Split message by empty lines

    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const link = bridgeMatch[0];
        const code = link.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        // Skip duplicates
        const isDuplicate = bridgeList.some(entry => entry.bridgeLink?.includes(code));
        if (isDuplicate) continue;

        // Grab the first line in the block with a colon for display name
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
