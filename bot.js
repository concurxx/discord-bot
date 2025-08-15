const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049";
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/";
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

if (!fs.existsSync(path.join(__dirname, "data"))) fs.mkdirSync(path.join(__dirname, "data"));

let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.log("Error reading bridge list file:", err);
}

let lastListMessage = null;

// ====== Helpers ======
function saveBridgeList() {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8"); }
    catch (err) { console.log("Error saving bridge list:", err); }
}

function resequenceList() {
    bridgeList = bridgeList.filter(Boolean);
}

function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);
    return bridgeList
        .map((b, i) => `${i + 1}. ${b.color}${b.name}\n${b.bridge}\n[LNK](${b.vercel})`)
        .join("\n\n");
}

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

    // Purge other messages in the channel
    const messages = await channel.messages.fetch({ limit: 100 });
    const nonBotMessages = messages.filter(m => m.author.id !== client.user.id);
    if (nonBotMessages.size > 0) await channel.bulkDelete(nonBotMessages, true);
}

// ====== Ready ======
client.once("ready", () => console.log(`✅ Logged in as ${client.user.tag}`));

// ====== Message Handler ======
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // ====== !listme command ======
    if (message.content.startsWith("!listme")) {
        let range = message.content.split(" ")[1];
        let items = [];
        let startIndex = 0;

        if (range && range.toLowerCase() === "all") {
            items = bridgeList;
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

    // ====== Color Commands ======
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = content.split(" ");
        const num = parseInt(numStr, 10);
        if (num > 0 && num <= bridgeList.length) {
            let color = cmd.toLowerCase() === "!red" ? "🔴" : cmd.toLowerCase() === "!yellow" ? "🟡" : "🟢";
            bridgeList[num - 1].color = color;
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    // ====== Remove & Clear ======
    if (content.startsWith("!remove") && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const num = parseInt(content.split(" ")[1]);
        if (!isNaN(num) && num >= 1 && num <= bridgeList.length) {
            bridgeList.splice(num - 1, 1);
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    if (content === "!clear" && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        bridgeList = [];
        await updateBridgeListMessage(message.channel);
        return;
    }

    // ====== Detect Bridges (Block-based) ======
    const blocks = content.split(/\n\s*\n/); // Split by empty lines
    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const bridgeLink = bridgeMatch[0].trim();
        const code = bridgeLink.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        if (bridgeList.some(entry => entry.bridgeLink.toLowerCase() === bridgeLink.toLowerCase())) continue;

        // Use first line with colon for name
        const displayNameLine = block.split("\n").find(line => line.includes(":"));
        const displayName = displayNameLine ? displayNameLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";

        bridgeList.push({
            bridgeLink,
            vercelLink,
            bridge: bridgeLink,
            vercel: vercelLink,
            name: displayName,
            color: ""
        });
    }

    await updateBridgeListMessage(message.channel);
});

client.login(process.env.DISCORD_TOKEN);
