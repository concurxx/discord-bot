const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Replace with your Discord channel ID
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

// Load last list message IDs
let lastListMessages = [];
try {
    if (fs.existsSync(LIST_MESSAGE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(LIST_MESSAGE_FILE, "utf8"));
        if (saved?.ids) lastListMessages = saved.ids;
    }
} catch (err) {
    console.error("❌ Error reading list message file:", err);
}

// ----------------- SAVE TO JSON -----------------
async function saveBridgeList() {
    try {
        await fs.promises.writeFile(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.error("❌ Error saving bridge list:", err);
    }
}

// ----------------- FORMAT & SORT LIST -----------------
function formatBridgeListSegment(segment) {
    return segment
        .map((b, idx) => `${b.color}${b.name}\n${b.bridgeLink}\n[LNK](${b.vercelLink})`)
        .join("\n\n");
}

// ----------------- CLEAN CHANNEL (KEEP ONLY LIST) -----------------
async function cleanChannel(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !lastListMessages.includes(m.id));
        if (toDelete.size > 0) {
            await channel.bulkDelete(toDelete, true);
        }
    } catch (err) {
        console.error("❌ Error cleaning channel:", err);
    }
}

// ----------------- UPDATE LIST MESSAGE -----------------
async function updateBridgeListMessage(channel) {
    // Sort list by color priority but keep persistent numbering
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    const sortedList = [...bridgeList].sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    const segments = [];
    let currentSegment = [];
    let charCount = 0;

    for (const item of sortedList) {
        const itemText = `${item.color}${item.name}\n${item.bridgeLink}\n[LNK](${item.vercelLink})\n\n`;
        if (charCount + itemText.length > 1800) { // keep safe under 2000 char limit
            segments.push(currentSegment);
            currentSegment = [];
            charCount = 0;
        }
        currentSegment.push(item);
        charCount += itemText.length;
    }
    if (currentSegment.length) segments.push(currentSegment);

    // Delete old list messages
    for (const msgId of lastListMessages) {
        const oldMsg = await channel.messages.fetch(msgId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => null);
    }
    lastListMessages = [];

    // Send new list messages
    for (const segment of segments) {
        const msg = await channel.send("**Bridge List:**\n\n" + formatBridgeListSegment(segment));
        lastListMessages.push(msg.id);
    }

    fs.writeFileSync(LIST_MESSAGE_FILE, JSON.stringify({ ids: lastListMessages }), "utf8");

    await cleanChannel(channel);
}

// ----------------- BRIDGE LINK DETECTION -----------------
async function processBridgeLinks(message) {
    const blocks = message.content.split(/\n\s*\n/);
    let addedCount = 0;

    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const bridgeLink = bridgeMatch[0].trim();
        const code = bridgeLink.split("?")[1]?.trim();
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/b/${code.replace(/&/g, "-")}`;

        const isDuplicate = bridgeList.some(entry =>
            entry.bridgeLink.toLowerCase() === bridgeLink.toLowerCase() ||
            entry.vercelLink.toLowerCase() === vercelLink.toLowerCase()
        );
        if (isDuplicate) continue;

        // Grab first line with colon for display name
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
        await updateBridgeListMessage(message.channel);
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

    const content = message.content;

    // ----------------- COLOR TAG COMMANDS -----------------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = content.split(" ");
        const num = parseInt(numStr, 10);
        if (num > 0 && num <= bridgeList.length) {
            const colors = { "!red": "🔴", "!yellow": "🟡", "!green": "🟢" };
            bridgeList[num - 1].color = colors[cmd.toLowerCase()];
            await saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    // ----------------- PURGE ALL NON-BOT MESSAGES -----------------
    if (content === "!purgeall") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;

        let fetched;
        do {
            fetched = await message.channel.messages.fetch({ limit: 100 });
            const messagesToDelete = fetched.filter(m => !lastListMessages.includes(m.id));
            if (messagesToDelete.size > 0) {
                await message.channel.bulkDelete(messagesToDelete, true);
            }
        } while (fetched.size >= 2);
        return;
    }

    // ----------------- REMOVE & CLEAR -----------------
    if (content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const num = parseInt(content.split(" ")[1]);
        if (isNaN(num) || num < 1 || num > bridgeList.length) return;
        bridgeList.splice(num - 1, 1);
        await saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }

    if (content === "!clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        bridgeList = [];
        await saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }

    // ----------------- LISTME COMMAND -----------------
    if (content.startsWith("!listme")) {
        const args = content.split(" ");
        let listToSend = bridgeList;

        if (args[1]?.toLowerCase() !== "all") {
            const range = args[1]?.split("-").map(n => parseInt(n, 10));
            if (range?.length === 2) {
                listToSend = bridgeList.filter((_, idx) => idx + 1 >= range[0] && idx + 1 <= range[1]);
            }
        }

        const dmLines = listToSend.map((b, idx) => `${bridgeList.indexOf(b) + 1}. ${b.name}\n${b.bridgeLink}`);
        try {
            await message.author.send(dmLines.join("\n\n") || "No bridges to show.");
        } catch {
            await message.channel.send(`${message.author}, I couldn't DM you. Check your settings.`);
        }
        return;
    }

    // ----------------- DETECT BRIDGE LINKS -----------------
    await processBridgeLinks(message);
});

// ----------------- LOGIN -----------------
client.login(process.env.DISCORD_TOKEN);
