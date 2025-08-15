const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Discord channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Vercel redirect URL
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
    if (fs.existsSync(DATA_FILE)) bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (err) {
    console.error("Error reading bridge list:", err);
}

let lastListMessage = null;

function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
    } catch (err) {
        console.error("Error saving bridge list:", err);
    }
}

function formatBridgeList() {
    const colorPriority = { "🔴": 1, "🟡": 2, "🟢": 3, "": 4 };
    bridgeList.sort((a, b) => colorPriority[a.color] - colorPriority[b.color]);
    return bridgeList
        .map((b, i) => {
            const displayName = `**${i + 1}. ${b.color}${b.name}**`;
            return `${displayName}\n${b.bridge}\n[LNK](${b.vercel})`;
        })
        .join("\n\n");
}

async function updateBridgeListMessage(channel) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });

        // Delete all messages that aren't the last list message
        const toDelete = messages.filter(
            m => m.id !== lastListMessage?.id && !m.author.bot
        );
        if (toDelete.size > 0) await channel.bulkDelete(toDelete, true);
    } catch (err) {
        console.error("Error cleaning messages:", err);
    }

    const formattedList = bridgeList.length === 0
        ? "Bridge list is currently empty."
        : "**Bridge List:**\n\n" + formatBridgeList();

    if (lastListMessage) {
        await lastListMessage.edit(formattedList).catch(async () => {
            lastListMessage = await channel.send(formattedList);
        });
    } else {
        lastListMessage = await channel.send(formattedList);
    }
}

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content;

    // ----------------- COLOR COMMANDS -----------------
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

    // ----------------- ADMIN REMOVE & CLEAR -----------------
    if (content.startsWith("!remove") && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const num = parseInt(content.split(" ")[1]);
        if (!isNaN(num) && num >= 1 && num <= bridgeList.length) {
            bridgeList.splice(num - 1, 1);
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        return;
    }

    if (content === "!clear" && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        bridgeList = [];
        saveBridgeList();
        await updateBridgeListMessage(message.channel);
        return;
    }

    // ----------------- PURGE NON-BOT MESSAGES -----------------
    if (content === "!purgeall" && message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        let fetched;
        do {
            fetched = await message.channel.messages.fetch({ limit: 100 });
            const messagesToDelete = fetched.filter(m => m.author.id !== client.user.id);
            if (messagesToDelete.size > 0) await message.channel.bulkDelete(messagesToDelete, true);
        } while (fetched.size >= 2);
        return;
    }

    // ----------------- DM LIST COMMAND -----------------
    if (/^!listme/i.test(content)) {
        const dmMatch = content.match(/^!listme\s+(\d+)-(\d+)$/i);
        const allMatch = content.match(/^!listme\s+all$/i);
        const userDM = await message.author.createDM();

        if (dmMatch) {
            const start = parseInt(dmMatch[1], 10) - 1;
            const end = parseInt(dmMatch[2], 10);
            const slice = bridgeList.slice(start, end)
                .map(b => `${b.name}\n${b.bridge}`)
                .join("\n\n");
            await userDM.send(slice || "No bridges in that range.");
        } else if (allMatch) {
            const slice = bridgeList.map(b => `${b.name}\n${b.bridge}`).join("\n\n");
            await userDM.send(slice || "No bridges in the list.");
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

        const isDuplicate = bridgeList.some(entry => entry.bridgeLink?.includes(code));
        if (isDuplicate) continue;

        const structureLine = block.split("\n").find(line => line.includes(":"));
        const displayName = structureLine
            ? structureLine.split(":").map(s => s.trim()).join("/")
            : "Unknown Structure";

        bridgeList.push({
            bridgeLink: link,
            vercel: vercelLink,
            bridge: link,
            name: displayName,
            color: ""
        });
    }

    saveBridgeList();
    await updateBridgeListMessage(message.channel);
});

client.login(process.env.DISCORD_TOKEN);
