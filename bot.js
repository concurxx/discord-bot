const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Replace with your channel ID
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

// Load bridge list from JSON file
let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.log("Error reading bridge list file:", err);
}

let lastListMessage = null;

function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.log("Error saving bridge list:", err);
    }
}

// Format list for channel display
function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);
    return bridgeList
        .map((b, i) => `${i + 1}. ${b.color}${b.name}\n${b.bridge}\n[**LNK**](${b.vercel})`)
        .join("\n\n");
}

// Update the list message (and delete old one)
async function updateBridgeListMessage(channel) {
    if (lastListMessage) {
        try { await lastListMessage.delete(); } catch {}
    }
    if (bridgeList.length === 0) {
        lastListMessage = await channel.send("Bridge list is currently empty.");
    } else {
        lastListMessage = await channel.send("**Bridge List:**\n\n" + formatBridgeList());
    }
}

// Send long messages in chunks (for DM list)
async function sendInChunks(user, text) {
    const chunks = text.match(/[\s\S]{1,1900}(?=\n|$)/g) || [];
    for (const chunk of chunks) {
        await user.send(chunk);
    }
}

// DM helper for !listme
async function sendListToUser(user, start, end, channel) {
    if (bridgeList.length === 0) {
        await user.send("The bridge list is currently empty.").catch(async () => {
            const warn = await channel.send(`${user}, I couldn't DM you. Please enable DMs from server members.`);
            setTimeout(() => warn.delete().catch(() => {}), 5000);
        });
        return;
    }
    start = Math.max(1, start);
    end = Math.min(bridgeList.length, end);
    const requestedItems = bridgeList.slice(start - 1, end);
    if (requestedItems.length === 0) {
        await user.send("Invalid range. Please check the list length.").catch(async () => {
            const warn = await channel.send(`${user}, I couldn't DM you. Please enable DMs from server members.`);
            setTimeout(() => warn.delete().catch(() => {}), 5000);
        });
        return;
    }
    const listText = requestedItems
        .map((b, i) => {
            const displayNumber = start + i;
            return `${displayNumber}. ${b.color}${b.name}\n${b.bridge}`;
        })
        .join("\n\n");

    try {
        await sendInChunks(user, `Here’s your requested bridge list (${start}-${end}):\n\n${listText}`);
    } catch {
        const warn = await channel.send(`${user}, I couldn't DM you. Please enable DMs from server members.`);
        setTimeout(() => warn.delete().catch(() => {}), 5000);
    }
}

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content;

    // ================== !listme command ==================
    if (/^!listme\s+(all|\d+-\d+)$/i.test(content)) {
        if (/all/i.test(content)) {
            await sendListToUser(message.author, 1, bridgeList.length, message.channel);
        } else {
            const [, range] = content.split(" ");
            const [start, end] = range.split("-").map(n => parseInt(n, 10));
            await sendListToUser(message.author, start, end, message.channel);
        }
        await message.delete().catch(() => {});
        return;
    }

    // ================== Color tag commands ==================
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
        await message.delete().catch(() => {});
        return;
    }

    // ================== Admin remove & clear ==================
    if (content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const parts = content.split(" ");
        const num = parseInt(parts[1]);
        if (!isNaN(num) && num >= 1 && num <= bridgeList.length) {
            bridgeList.splice(num - 1, 1);
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        await message.delete().catch(() => {});
        return;
    }

    if (content === "!clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        bridgeList = [];
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        await message.delete().catch(() => {});
        return;
    }

    // ================== Bridge link detection ==================
    const blocks = content.split(/\n\s*\n/);
    let updated = false;
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
        updated = true;
    }
    if (updated) {
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
    }

    // ================== Always delete non-bot messages ==================
    await message.delete().catch(() => {});
});

client.login(process.env.DISCORD_TOKEN);
