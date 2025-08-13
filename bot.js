const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");
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
    ]
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

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    // --- ADMIN COMMANDS ---
    if (message.content.startsWith("!remove")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const parts = message.content.split(" ");
        const num = parseInt(parts[1]);
        if (isNaN(num) || num < 1 || num > bridgeList.length) return;

        bridgeList.splice(num - 1, 1);
        saveBridgeList();

        if (lastListMessage) await lastListMessage.delete();

        const formattedList = bridgeList.map((entry, idx) => `${idx + 1}. ${entry.display}`).join("\n\n");
        lastListMessage = await message.channel.send(`**Bridge List:**\n${formattedList}`);
        return;
    }

    if (message.content === "!clear") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        bridgeList = [];
        saveBridgeList();

        if (lastListMessage) await lastListMessage.delete();
        lastListMessage = await message.channel.send("**Bridge List cleared.**");
        return;
    }

    // --- BRIDGE LINK DETECTION ---
    // Remove strikethrough/combining characters for robust detection
    const cleanContent = message.content.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

    const bridgePattern = /(l\+k:\/\/bridge\?[^\s]+)/gi;
    const matches = cleanContent.match(bridgePattern);

    if (matches) {
        for (const link of matches) {
            const code = link.split("?")[1];
            if (!code) continue;

            const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

            // ----- DUPLICATE CHECK BASED ON BRIDGE CODE ONLY -----
            const isDuplicate = bridgeList.some(entry => entry.bridgeLink.includes(code));
            if (isDuplicate) {
                // Notify the user their bridge is already on the list
                message.reply(`⚠️ This bridge is already on the list: ${link}`);
                continue; // Skip adding duplicate
            }

            // Find a line containing "Type: Name" for display
            let structureLine = cleanContent.split("\n").find(line => line.includes(":"));
            let displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";

            bridgeList.push({
                bridgeLink: link,
                vercelLink,
                display: `${displayName}\n${link}\n${vercelLink}`
            });
        }

        saveBridgeList();

        // Delete previous list message if exists
        if (lastListMessage) {
            try { await lastListMessage.delete(); } 
            catch (err) { console.log("Could not delete previous list message:", err); }
        }

        const formattedList = bridgeList.map((entry, idx) => `${idx + 1}. ${entry.display}`).join("\n\n");
        lastListMessage = await message.channel.send(`**Bridge List:**\n${formattedList}`);

        console.log("Bridge links detected and list updated:", bridgeList);
    }
});

// Login using your bot token from Heroku config vars
client.login(process.env.DISCORD_TOKEN);
