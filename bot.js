const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Replace with your Discord channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Replace with your Vercel URL
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

// Load bridge list from JSON file
let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.error("❌ Error reading bridge list file:", err);
}

// ----------------- SAVE TO JSON -----------------
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.error("❌ Error saving bridge list:", err);
    }
}

// ----------------- FORMAT & SEND MULTIPLE LIST MESSAGES -----------------
async function updateBridgeListMessage(channel) {
    // Delete previous bot list messages
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const botMessages = messages.filter(m => m.author.id === client.user.id);
        for (const msg of botMessages.values()) {
            await msg.delete().catch(() => {});
        }
    } catch (err) {
        console.error("❌ Error deleting old list messages:", err);
    }

    if (bridgeList.length === 0) {
        await channel.send("Bridge list is currently empty.");
        return;
    }

    // Sort by color
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    const sortedList = [...bridgeList].sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    const MAX_CHARS = 1900; // leave margin for formatting
    let content = "";
    let messageCount = 1;

    for (let i = 0; i < sortedList.length; i++) {
        const item = sortedList[i];
        const line = `${i + 1}. ${item.color}${item.name}\n${item.bridgeLink}\n[LNK](${item.vercelLink})\n\n`;

        if (content.length + line.length > MAX_CHARS) {
            await channel.send(`**Bridge List #${messageCount}:**\n\n${content.trim()}`);
            content = "";
            messageCount++;
        }
        content += line;
    }

    if (content.length > 0) {
        await channel.send(`**Bridge List #${messageCount}:**\n\n${content.trim()}`);
    }
}

// ----------------- DM SUB-LIST -----------------
async function sendListDM(user, start, end) {
    if (bridgeList.length === 0) return user.send("Bridge list is currently empty.");

    const slice = bridgeList.slice(start, end);
    const lines = slice.map((item, i) => `${start + i + 1}. ${item.color}${item.name}\n${item.bridgeLink}`);
    const chunks = [];
    const MAX_CHARS = 1900;
    let currentChunk = "";

    for (const line of lines) {
        if ((currentChunk + line + "\n\n").length > MAX_CHARS) {
            chunks.push(currentChunk);
            currentChunk = "";
        }
        currentChunk += line + "\n\n";
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    for (const chunk of chunks) {
        await user.send(chunk.trim());
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

    const content = message.content;

    // ----------------- COLOR TAG COMMANDS -----------------
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

    // ----------------- PURGE ALL NON-BOT MESSAGES -----------------
    if (content === "!purgeall") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
        try {
            let fetched;
            do {
                fetched = await message.channel.messages.fetch({ limit: 100 });
                const toDelete = fetched.filter(m => m.author.id !== client.user.id);
                if (toDelete.size > 0) await message.channel.bulkDelete(toDelete, true);
            } while (fetched.size >= 2);
        } catch (err) {
            console.error("❌ Error purging messages:", err);
        }
        return;
    }

    // ----------------- REMOVE & CLEAR -----------------
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

    // ----------------- LISTME COMMAND -----------------
    if (/^!listme\s+(.+)$/i.test(content)) {
        const match = content.match(/^!listme\s+(.+)$/i);
        if (match) {
            const param = match[1].trim();
            if (param.toLowerCase() === "all") {
                await sendListDM(message.author, 0, bridgeList.length);
            } else if (/^\d+-\d+$/.test(param)) {
                const [start, end] = param.split("-").map(n => parseInt(n, 10) - 1);
                if (start >= 0 && end < bridgeList.length && start <= end) {
                    await sendListDM(message.author, start, end + 1);
                }
            }
        }
        return;
    }

    // ----------------- BRIDGE LINK DETECTION -----------------
    const blocks = content.split(/\n\s*\n/);

    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const link = bridgeMatch[0];
        const code = link.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        // Skip duplicates
        const isDuplicate = bridgeList.some(entry => entry.bridgeLink === link);
        if (isDuplicate) continue;

        const structureLine = block.split("\n").find(line => line.includes(":"));
        const displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";

        bridgeList.push({
            bridgeLink: link,
            vercelLink,
            bridgeLinkDisplay: link,
            vercelLinkDisplay: `[LNK](${vercelLink})`,
            name: displayName,
            color: ""
        });
    }

    saveBridgeList();
    await updateBridgeListMessage(message.channel);
});

// ----------------- LOGIN -----------------
client.login(process.env.DISCORD_TOKEN);
