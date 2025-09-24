const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1407022766967881759"; // Replace with your channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Replace with your Vercel URL
const DATA_FILE = path.join(__dirname, "data", "bridgeList.json");
const COMMAND_LOG_FILE = path.join(__dirname, "data", "commandLog.json");
const BACKUP_LIMIT = 10; // how many backups to keep
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
try { if (fs.existsSync(DATA_FILE)) bridgeList = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } 
catch (err) { console.log("Error reading bridge list file:", err); }

// Load command log
let commandLog = {};
try { if (fs.existsSync(COMMAND_LOG_FILE)) commandLog = JSON.parse(fs.readFileSync(COMMAND_LOG_FILE, "utf8")); } 
catch (err) { console.error("❌ Error reading command log file:", err); }

let lastListMessages = [];

// ----------------- SAVE FUNCTIONS -----------------
function saveBridgeList() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");

        if(bridgeList.length > 0){
            const backupFile = path.join(__dirname, "data", `bridgeList-${Date.now()}.json`);
            fs.writeFileSync(backupFile, JSON.stringify(bridgeList, null, 2), "utf8");

            const files = fs.readdirSync(path.join(__dirname, "data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a, b) => fs.statSync(path.join(__dirname,"data",a)).mtimeMs -
                                fs.statSync(path.join(__dirname,"data",b)).mtimeMs);
            while (files.length > BACKUP_LIMIT) fs.unlinkSync(path.join(__dirname,"data",files.shift()));
        }
    } catch (err) { console.log("Error saving bridge list:", err); }
}

function saveCommandLog() {
    try { fs.writeFileSync(COMMAND_LOG_FILE, JSON.stringify(commandLog, null, 2), "utf8"); }
    catch (err) { console.error("❌ Error saving command log file:", err); }
}

// ----------------- FORMAT & SPLIT -----------------
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

function splitMessage(entries, maxLength = 1900) {
    const chunks = [];
    let current = "";
    for (const entry of entries) {
        const entryWithSpacing = (current ? "\n\n" : "") + entry;
        if ((current + entryWithSpacing).length > maxLength) {
            if (current) chunks.push(current.trim());
            current = entry;
        } else current += entryWithSpacing;
    }
    if (current) chunks.push(current.trim());
    return chunks;
}

// ----------------- CLEAN & UPDATE -----------------
async function cleanChannel(channel) {
    try {
        if (channel.id !== ALLOWED_CHANNEL_ID) return; // safety
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !lastListMessages.some(l => l.id === m.id));
        if (toDelete.size > 0) await channel.bulkDelete(toDelete, true);
    } catch (err) { console.error("❌ Error cleaning channel:", err); }
}

async function updateBridgeListMessage(channel) {
    try {
        if (channel.id !== ALLOWED_CHANNEL_ID) return; // safety

        if (bridgeList.length === 0) {
            if (lastListMessages.length > 0) {
                try {
                    await lastListMessages[0].edit("Bridge list is currently empty.");
                    for (let i = 1; i < lastListMessages.length; i++) try { await lastListMessages[i].delete(); } catch {}
                    lastListMessages = [lastListMessages[0]];
                } catch { 
                    try { const msg = await channel.send("Bridge list is currently empty."); lastListMessages = [msg]; } catch(err){ console.error(err); } 
                }
            } else { 
                try { const msg = await channel.send("Bridge list is currently empty."); lastListMessages = [msg]; } catch(err){ console.error(err); } 
            }
            return;
        }

        const entries = formatBridgeList(true);
        const chunks = splitMessage(entries);

        for (const msg of lastListMessages) try { await msg.delete(); } catch {}
        lastListMessages = [];

        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            try { const msg = await channel.send(header + chunks[i]); lastListMessages.push(msg); } catch(err){ console.error(err); }
        }

        await cleanChannel(channel);
    } catch (err) {
        console.error("❌ Error updating bridge list message:", err);
    }
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    try {
        const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        if (!channel) return console.error("❌ Could not find channel for bridge list");
        await updateBridgeListMessage(channel);
    } catch (err) { console.error("❌ Error during startup sync:", err); }
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const content = message.content;
    const now = Date.now();
    const userId = message.author.id;
    if (!commandLog[userId]) commandLog[userId] = [];

    // ================= COMMANDS (allowed channel only) =================
    if (message.channel.id === ALLOWED_CHANNEL_ID) {
        if (content.startsWith("!red") || content.startsWith("!yellow") || content.startsWith("!green")) {
            const color = content.startsWith("!red") ? "🔴" : content.startsWith("!yellow") ? "🟡" : "🟢";
            const index = parseInt(content.split(" ")[1]) - 1;
            if (index >= 0 && index < bridgeList.length) {
                bridgeList[index].color = color;
                saveBridgeList();
                await updateBridgeListMessage(message.channel);
            }
        }

        if (content.startsWith("!remove")) {
            const index = parseInt(content.split(" ")[1]) - 1;
            if (index >= 0 && index < bridgeList.length) {
                bridgeList.splice(index, 1);
                saveBridgeList();
                await updateBridgeListMessage(message.channel);
            }
        }

        if (content.startsWith("!clearlist")) {
            bridgeList = [];
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }

        if (content.startsWith("!backups")) {
            const files = fs.readdirSync(path.join(__dirname, "data")).filter(f => f.startsWith("bridgeList-"));
            await message.channel.send("Backups:\n" + files.join("\n"));
        }

        if (content.startsWith("!restore")) {
            const filename = content.split(" ")[1];
            const filePath = path.join(__dirname, "data", filename);
            if (fs.existsSync(filePath)) {
                bridgeList = JSON.parse(fs.readFileSync(filePath, "utf8"));
                saveBridgeList();
                await updateBridgeListMessage(message.channel);
            }
        }

        if (content.startsWith("!listme")) {
            const entries = formatBridgeList(false);
            const chunks = splitMessage(entries);
            for (const chunk of chunks) {
                await message.author.send(chunk);
            }
        }

        if (content.startsWith("!viewlog")) {
            const logs = commandLog[userId] || [];
            const lines = logs.map(l => `${new Date(l.timestamp).toLocaleString()}: ${l.command}`);
            await message.author.send(lines.join("\n") || "No commands logged.");
        }

        // -------- Auto bridge capture (allowed channel only) --------
        const blocks = content.split(/\n\s*\n/);
        let bridgesAdded = 0;
        for (const block of blocks) {
            const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
            if (!bridgeMatch) continue;
            const link = bridgeMatch[0];
            const code = link.split("?")[1];
            if (!code) continue;
            const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;
            if (bridgeList.some(entry => entry.bridgeLink?.includes(code))) continue;
            const structureLine = block.split("\n").find(line => line.includes(":"));
            const displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";
            bridgeList.push({ bridgeLink: link, vercelLink, bridge: link, vercel: vercelLink, name: displayName, color: "" });
            bridgesAdded++;
        }
        if (bridgesAdded > 0) {
            commandLog[userId].push({ command: `Added ${bridgesAdded} bridge(s)`, timestamp: now });
            commandLog[userId] = commandLog[userId].filter(e => e.timestamp > now - 24*60*60*1000);
            saveCommandLog();
        }

        saveBridgeList();
        try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
        return;
    }

    // ================= MIRRORING (all other channels) =================
    if (message.channel.id !== ALLOWED_CHANNEL_ID) {
        const coordMatches = [...content.matchAll(/l\+k:\/\/coordinates?\?[\d,&]+/gi)];
        if (coordMatches.length > 0) {
            const coordLinks = coordMatches.map(m => {
                const code = m[0].split("?")[1];
                return `[Click to view coordinates](${REDIRECT_DOMAIN}/api/coord?code=${encodeURIComponent(code)})`;
            }).join("\n");

            const mirrored = `**${message.author.username}:**\n${content}\n\n${coordLinks}`;
            try { await message.channel.send(mirrored); } catch(err){ console.error(err); }
            try { await message.delete(); } catch(err) {}
            return;
        }

        const reportMatches = [...content.matchAll(/l\+k:\/\/report\?[\d,&]+/gi)];
        if (reportMatches.length > 0) {
            const reportLinks = reportMatches.map(m => {
                const code = m[0].split("?")[1];
                return `[Click to view report](${REDIRECT_DOMAIN}/api/report?code=${encodeURIComponent(code)})`;
            }).join("\n");

            const mirrored = `**${message.author.username}:**\n${content}\n\n${reportLinks}`;
            try { await message.channel.send(mirrored); } catch(err){ console.error(err); }
            try { await message.delete(); } catch(err) {}
            return;
        }
    }
});

// ----------------- LOGIN -----------------
client.login(process.env.BOT_TOKEN);
