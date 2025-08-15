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

// Load bridge list from JSON
let bridgeList = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
} catch (err) {
    console.log("Error reading bridge list file:", err);
}

let lastListMessage = null;

// ----------------- SAVE LIST -----------------
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.log("Error saving bridge list:", err);
    }
}

// ----------------- FORMAT LIST -----------------
function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    const sorted = [...bridgeList].sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

    return sorted
        .map((b, i) => {
            const displayName = `**${i + 1}. ${b.color}${b.name.trim()}**`;
            return `${displayName}\n${b.bridge}\n[LNK](${b.vercel})`;
        })
        .join("\n\n");
}

// ----------------- CLEAN CHANNEL -----------------
async function cleanChannel(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => m.id !== lastListMessage?.id);
        if (toDelete.size > 0) {
            await channel.bulkDelete(toDelete, true);
        }
    } catch (err) {
        console.error("Error cleaning channel:", err);
    }
}

// ----------------- UPDATE LIST MESSAGE -----------------
async function updateBridgeListMessage(channel) {
    if (lastListMessage) {
        try {
            await lastListMessage.delete();
        } catch {}
    }

    if (bridgeList.length === 0) {
        lastListMessage = await channel.send("Bridge list is currently empty.");
    } else {
        const formatted = formatBridgeList();
        // Split into multiple messages if near 1900 chars
        if (formatted.length > 1900) {
            const parts = [];
            let chunk = "";
            for (const line of formatted.split("\n")) {
                if ((chunk + line + "\n").length > 1900) {
                    parts.push(chunk);
                    chunk = "";
                }
                chunk += line + "\n";
            }
            if (chunk) parts.push(chunk);

            lastListMessage = await channel.send("**Bridge List:**\n\n" + parts[0]);
            for (let i = 1; i < parts.length; i++) {
                await channel.send(parts[i]);
            }
        } else {
            lastListMessage = await channel.send("**Bridge List:**\n\n" + formatted);
        }
    }

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

    const content = message.content.trim();

    // ---------- COLOR TAG COMMANDS ----------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd, numStr] = content.split(" ");
        const num = parseInt(numStr, 10);

        const colorMap = { "!red": "🔴", "!yellow": "🟡", "!green": "🟢" };

        // Update color based on current displayed number
        const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
        const sorted = [...bridgeList].sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);

        if (num > 0 && num <= sorted.length) {
            sorted[num - 1].color = colorMap[cmd.toLowerCase()] || "";

            // Apply changes back to main bridgeList
            bridgeList = sorted;
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    // ---------- PURGE NON-BOT MESSAGES ----------
    let fetched;
    do {
        fetched = await message.channel.messages.fetch({ limit: 100 });
        const toDelete = fetched.filter(m => m.author.id !== client.user.id);
        if (toDelete.size > 0) await message.channel.bulkDelete(toDelete, true);
    } while (fetched.size >= 2);

    // ---------- !remove & !clear ----------
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

    // ---------- !listme DM ----------
    if (content.startsWith("!listme")) {
        const args = content.split(" ");
        let toSend = [];
        if (args[1] === "all") {
            toSend = bridgeList.map((b, i) => `${i + 1}. ${b.name}\n${b.bridge}`);
        } else if (args[1]?.includes("-")) {
            const [start, end] = args[1].split("-").map(n => parseInt(n));
            toSend = bridgeList.slice(start - 1, end).map((b, i) => `${start + i}. ${b.name}\n${b.bridge}`);
        }
        if (toSend.length > 0) {
            for (const chunk of toSend.join("\n\n").match(/[\s\S]{1,1900}/g)) {
                await message.author.send(chunk);
            }
        }
        return;
    }

    // ---------- PROCESS BRIDGE LINKS ----------
    const blocks = content.split(/\n\s*\n/);
    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) continue;

        const link = bridgeMatch[0];
        const code = link.split("?")[1];
        if (!code) continue;

        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

        // Skip duplicates
        if (bridgeList.some(entry => entry.bridgeLink === link)) continue;

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
