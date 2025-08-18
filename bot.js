const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1407022766967881759"; // Replace with your channel ID
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

// Load bridge list
let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.log("Error reading bridge list file:", err);
}

let lastListMessages = []; // stores message objects for editing

// ----------------- SAVE TO JSON -----------------
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.log("Error saving bridge list:", err);
    }
}

// ----------------- FORMAT & SORT LIST -----------------
function formatBridgeList(includeVercel = true) {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    return bridgeList.map((b, i) => {
        const displayName = `${i + 1}. ${b.color}${b.name}`;
        const bridgeLine = b.bridge;
        const vercelLine = includeVercel ? `[LNK](${b.vercel})` : "";
        return vercelLine ? `${displayName}\n${bridgeLine}\n${vercelLine}` : `${displayName}\n${bridgeLine}`;
    });
}

// ----------------- SPLIT INTO CHUNKS -----------------
function splitMessage(content, maxLength = 1900) {
    const chunks = [];
    let current = "";

    for (const line of content) {
        if ((current + "\n\n" + line).length > maxLength) {
            chunks.push(current.trim());
            current = line;
        } else {
            current += (current ? "\n\n" : "") + line;
        }
    }
    if (current) chunks.push(current.trim());

    return chunks;
}

// ----------------- CLEAN CHANNEL -----------------
async function cleanChannel(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !lastListMessages.some(l => l.id === m.id));
        if (toDelete.size > 0) {
            await channel.bulkDelete(toDelete, true);
        }
    } catch (err) {
        console.error("❌ Error cleaning channel:", err);
    }
}

// ----------------- UPDATE LIST MESSAGE -----------------
async function updateBridgeListMessage(channel) {
    if (bridgeList.length === 0) {
        if (lastListMessages.length > 0) {
            try {
                await lastListMessages[0].edit("Bridge list is currently empty.");
                for (let i = 1; i < lastListMessages.length; i++) {
                    try { await lastListMessages[i].delete(); } catch {}
                }
                lastListMessages = [lastListMessages[0]];
            } catch {
                const msg = await channel.send("Bridge list is currently empty.");
                lastListMessages = [msg];
            }
        } else {
            const msg = await channel.send("Bridge list is currently empty.");
            lastListMessages = [msg];
        }
        return;
    }

    const entries = formatBridgeList(true);
    const chunks = splitMessage(entries);

    if (chunks.length === lastListMessages.length) {
        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            try {
                await lastListMessages[i].edit(header + chunks[i]);
            } catch {
                const msg = await channel.send(header + chunks[i]);
                lastListMessages[i] = msg;
            }
        }
    } else {
        for (const msg of lastListMessages) {
            try { await msg.delete(); } catch {}
        }
        lastListMessages = [];
        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            const msg = await channel.send(header + chunks[i]);
            lastListMessages.push(msg);
        }
    }

    await cleanChannel(channel);
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    try {
        const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        if (!channel) {
            console.error("❌ Could not find channel for bridge list");
            return;
        }

        const messages = await channel.messages.fetch({ limit: 100 });
        const listMessages = messages
            .filter(m => m.author.id === client.user.id && m.content.startsWith("**Bridge List"))
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        if (listMessages.size > 0) {
            lastListMessages = Array.from(listMessages.values());
            console.log(`🔄 Re-synced ${lastListMessages.length} list message(s).`);
            await updateBridgeListMessage(channel);
        } else {
            await updateBridgeListMessage(channel);
            console.log("🆕 No existing list found, created new one.");
        }
    } catch (err) {
        console.error("❌ Error during startup sync:", err);
    }
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;

    // DM Commands
    if (message.channel.type === 1) {
        if (content.startsWith("!listme")) {
            if (bridgeList.length === 0) {
                await message.author.send("Bridge list is currently empty.");
                return;
            }
            const entries = formatBridgeList(false);
            const chunks = splitMessage(entries);
            for (let i = 0; i < chunks.length; i++) {
                const header = i === 0
                    ? "**Your Bridge List:**\n\n"
                    : `**Your Bridge List (Part ${i+1}):**\n\n`;
                await message.author.send(header + chunks[i]);
            }
        }
        return;
    }

    // Guild Commands
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    // Color commands
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
        setTimeout(async () => { try { await message.delete(); } catch {} }, 3000);
        return;
    }

    // Remove
    if (content.startsWith("!remove")) {
        const num = parseInt(content.split(" ")[1]);
        if (!isNaN(num) && num >= 1 && num <= bridgeList.length) {
            bridgeList.splice(num - 1, 1);
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        setTimeout(async () => { try { await message.delete(); } catch {} }, 3000);
        return;
    }

    // Clear the entire list
    if (content === "!clearlist") {
        bridgeList = [];
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        setTimeout(async () => { try { await message.delete(); } catch {} }, 3000);
        return;
    }

    // Manual resync
    if (content === "!resync") {
        try {
            const messages = await message.channel.messages.fetch({ limit: 100 });
            const listMessages = messages
                .filter(m => m.author.id === client.user.id && m.content.startsWith("**Bridge List"))
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

            let replyMsg;
            if (listMessages.size > 0) {
                lastListMessages = Array.from(listMessages.values());
                await updateBridgeListMessage(message.channel);
                replyMsg = await message.reply("🔄 Re-synced bridge list messages.");
            } else {
                await updateBridgeListMessage(message.channel);
                replyMsg = await message.reply("🆕 No existing list found, created a new one.");
            }

            setTimeout(async () => {
                try { await message.delete(); } catch {}
                try { await replyMsg.delete(); } catch {}
            }, 3000);

        } catch (err) {
            console.error("❌ Error during manual resync:", err);
            const errorReply = await message.reply("⚠️ Resync failed — check logs.");
            setTimeout(async () => {
                try { await message.delete(); } catch {}
                try { await errorReply.delete(); } catch {}
            }, 5000);
        }
        return;
    }

    // Bridge link detection
    const blocks = content.split(/\n\s*\n/);
    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const link = bridgeMatch[0];
        const code = link.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        if (bridgeList.some(entry => entry.bridgeLink?.includes(code))) continue;

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

    saveBridgeList();
    await updateBridgeListMessage(message.channel);
});

// ----------------- LOGIN -----------------
client.login(process.env.DISCORD_TOKEN);
