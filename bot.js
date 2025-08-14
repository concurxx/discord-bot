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

// Helper to save list to JSON file
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.log("Error saving bridge list:", err);
    }
}

// Helper to format and sort list
function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);
    return bridgeList
        .map((b, i) => `${i + 1}. ${b.color}${b.name}\n${b.bridge}\n${b.vercel}`)
        .join("\n\n");
}

// Helper to update the list message in the channel and pin it
async function updateBridgeListMessage(channel) {
    // Delete previous list message if it exists
    if (lastListMessage) {
        try {
            if (lastListMessage.pinned) await lastListMessage.unpin();
            await lastListMessage.delete();
        } catch {}
    }

    if (bridgeList.length === 0) {
        lastListMessage = await channel.send("Bridge list is currently empty.");
    } else {
        lastListMessage = await channel.send("**Bridge List:**\n\n" + formatBridgeList());
        try {
            await lastListMessage.pin();
        } catch (err) {
            console.log("Failed to pin message:", err);
        }
    }
}

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

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
            await message.channel.send(`Updated bridge #${num} to color ${color}`);
        } else {
            await message.channel.send("Invalid number.");
        }
        return;
    }

    // ----------------- PURGE ALL NON-BOT MESSAGES -----------------
    if (content === "!purgeall") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return message.channel.send("You don't have permission to use this command.");
        }

        let deletedCount = 0;
        let fetched;

        do {
            fetched = await message.channel.messages.fetch({ limit: 100 });
            const messagesToDelete = fetched.filter(m => m.author.id !== client.user.id);

            if (messagesToDelete.size > 0) {
                await message.channel.bulkDelete(messagesToDelete, true);
                deletedCount += messagesToDelete.size;
            }
        } while (fetched.size >= 2);

        message.channel.send(`Deleted ${deletedCount} non-bot messages.`);
        return;
    }

    // ----------------- ADMIN REMOVE & CLEAR COMMANDS -----------------
    if (content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const parts = content.split(" ");
        const num = parseInt(parts[1]);
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
    const cleanContent = message.content.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

    const bridgePattern = /(l\+k:\/\/bridge\?[^\s]+)/gi;
    const matches = cleanContent.match(bridgePattern);

    if (matches) {
        for (const link of matches) {
            const code = link.split("?")[1];
            if (!code) continue;

            const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

            const isDuplicate = bridgeList.some(entry => entry.bridgeLink?.includes(code));
            if (isDuplicate) {
                await message.reply(`⚠️ This bridge is already on the list: ${link}`);
                continue;
            }

            let structureLine = cleanContent.split("\n").find(line => line.includes(":"));
            let displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";

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
    }
});

client.login(process.env.DISCORD_TOKEN);
