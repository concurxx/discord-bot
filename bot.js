const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Your Discord channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Your Vercel URL
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
    fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
}

// ----------------- FORMAT -----------------
function formatBridgeListSegment(segment) {
    return segment
        .map(b => {
            const listNumber = bridgeList.indexOf(b) + 1;
            return `${listNumber}. ${b.color}${b.name}\n${b.bridgeLink}\n[LNK](${b.vercelLink})`;
        })
        .join("\n\n");
}

// ----------------- CLEAN CHANNEL -----------------
async function cleanChannel(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => m.id !== lastListMessage?.id);
        if (toDelete.size > 0) await channel.bulkDelete(toDelete, true);
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
        // Split into segments to stay under Discord 2000 char limit
        const MAX_CHARS = 1900;
        let content = "**Bridge List:**\n\n";
        let currentSegment = [];

        for (const b of bridgeList) {
            const line = `${bridgeList.indexOf(b)+1}. ${b.color}${b.name}\n${b.bridgeLink}\n[LNK](${b.vercelLink})\n\n`;
            if (content.length + line.length > MAX_CHARS) {
                lastListMessage = await channel.send(content.trim());
                await cleanChannel(channel);
                content = "";
            }
            content += line;
        }
        lastListMessage = await channel.send(content.trim());
    }

    await cleanChannel(channel);
}

// ----------------- PROCESS BRIDGES -----------------
async function processBridgeLinks(message) {
    const blocks = message.content.split(/\n\s*\n/);

    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const bridgeLink = bridgeMatch[0].trim();
        const code = bridgeLink.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        // Skip duplicates
        const isDuplicate = bridgeList.some(entry => entry.bridgeLink === bridgeLink);
        if (isDuplicate) continue;

        // Get first line with colon for display name
        const structureLine = block.split("\n").find(line => line.includes(":"));
        const displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";

        bridgeList.push({
            bridgeLink,
            vercelLink,
            bridgeLinkDisplay: bridgeLink,
            name: displayName,
            color: ""
        });
    }

    saveBridgeList();
    await updateBridgeListMessage(message.channel);
}

// ----------------- READY -----------------
client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    try {
        const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        if (channel?.isTextBased()) await updateBridgeListMessage(channel);
    } catch (err) {
        console.error("Error fetching channel:", err);
    }
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content;

    // ----------------- COLOR TAGS -----------------
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

    // ----------------- PURGE -----------------
    if (content === "!purgeall") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
        await cleanChannel(message.channel);
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

    // ----------------- LISTME -----------------
    if (content.startsWith("!listme")) {
        const args = content.split(" ");
        let segment = [];

        if (args[1]?.toLowerCase() === "all") {
            segment = bridgeList;
        } else if (args[1]?.includes("-")) {
            const [startStr, endStr] = args[1].split("-");
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            if (!isNaN(start) && !isNaN(end)) {
                segment = bridgeList.filter((b, idx) => {
                    const listNumber = idx + 1;
                    return listNumber >= start && listNumber <= end;
                });
            }
        }

        if (segment.length === 0) {
            return message.author.send("No bridges found for that range.");
        }

        const formatted = segment
            .map(b => {
                const listNumber = bridgeList.indexOf(b) + 1;
                return `${listNumber}. ${b.color}${b.name}\n${b.bridgeLink}`;
            })
            .join("\n\n");

        try {
            await message.author.send(`**Your requested bridge list:**\n\n${formatted}`);
        } catch (err) {
            console.error("Error DMing user:", err);
            await message.channel.send(`${message.author}, I couldn't send you a DM. Do you have DMs disabled?`);
        }

        return;
    }

    // ----------------- PROCESS NEW BRIDGES -----------------
    await processBridgeLinks(message);
});

client.login(process.env.DISCORD_TOKEN);
