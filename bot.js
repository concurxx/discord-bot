const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { google } = require('googleapis');

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1407022766967881759"; // Replace with your channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Replace with your Vercel URL
const DATA_FILE = path.join(__dirname, "data", "bridgeList.json");
const COMMAND_LOG_FILE = path.join(__dirname, "data", "commandLog.json");
const USER_DATA_FILE = path.join(__dirname, "data", "userData.json");
const BACKUP_LIMIT = 10; // how many backups to keep

// Google Drive Config
const GOOGLE_DRIVE_FILE_ID = process.env.GOOGLE_DRIVE_FILE_ID; // File ID for userData backup
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY; // Base64 encoded service account JSON
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

// Load user data
let userData = {};
try { if (fs.existsSync(USER_DATA_FILE)) userData = JSON.parse(fs.readFileSync(USER_DATA_FILE, "utf8")); } 
catch (err) { console.error("❌ Error reading user data file:", err); }

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

function saveUserData() {
    try { 
        fs.writeFileSync(USER_DATA_FILE, JSON.stringify(userData, null, 2), "utf8");
        // Also backup to Google Drive
        backupToGoogleDrive();
    }
    catch (err) { console.error("❌ Error saving user data file:", err); }
}

// ----------------- GOOGLE DRIVE FUNCTIONS -----------------
let driveAuth = null;

async function initializeGoogleDrive() {
    if (!GOOGLE_SERVICE_ACCOUNT_KEY || !GOOGLE_DRIVE_FILE_ID) {
        console.log("⚠️ Google Drive not configured - user data will only persist locally");
        return false;
    }
    
    try {
        console.log(`🔍 Decoding service account key...`);
        const credentials = JSON.parse(Buffer.from(GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString());
        console.log(`📧 Service account email: ${credentials.client_email}`);
        console.log(`🆔 Project ID: ${credentials.project_id}`);
        console.log(`📁 File ID to access: ${GOOGLE_DRIVE_FILE_ID}`);
        
        driveAuth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']
        });
        
        console.log(`🔐 Authentication created, testing file access...`);
        
        // Test the connection
        const drive = google.drive({ version: 'v3', auth: driveAuth });
        console.log(`🔍 Attempting to access file...`);
        const fileInfo = await drive.files.get({ fileId: GOOGLE_DRIVE_FILE_ID });
        console.log(`📁 File found: ${fileInfo.data.name}`);
        
        console.log("✅ Google Drive initialized successfully");
        return true;
    } catch (err) {
        console.error("❌ Failed to initialize Google Drive:");
        console.error(`   Error type: ${err.constructor.name}`);
        console.error(`   Error message: ${err.message}`);
        console.error(`   Error code: ${err.code}`);
        if (err.response) {
            console.error(`   HTTP status: ${err.response.status}`);
            console.error(`   Response data:`, err.response.data);
        }
        return false;
    }
}

async function backupToGoogleDrive() {
    if (!driveAuth || !GOOGLE_DRIVE_FILE_ID) return;
    
    try {
        const drive = google.drive({ version: 'v3', auth: driveAuth });
        const media = {
            mimeType: 'application/json',
            body: JSON.stringify(userData, null, 2)
        };
        
        await drive.files.update({
            fileId: GOOGLE_DRIVE_FILE_ID,
            media: media
        });
        
        console.log("✅ User data backed up to Google Drive");
    } catch (err) {
        console.error("❌ Failed to backup to Google Drive:", err.message);
    }
}

async function restoreFromGoogleDrive() {
    if (!driveAuth || !GOOGLE_DRIVE_FILE_ID) return false;
    
    try {
        const drive = google.drive({ version: 'v3', auth: driveAuth });
        
        // Export the Google Sheet as plain text
        console.log(`📥 Downloading file content...`);
        const response = await drive.files.export({
            fileId: GOOGLE_DRIVE_FILE_ID,
            mimeType: 'text/plain'
        });
        
        console.log(`📄 Raw content: ${response.data}`);
        
        if (response.data && response.data.trim()) {
            let cloudData;
            try {
                // Try to parse as JSON
                cloudData = JSON.parse(response.data.trim());
            } catch (parseError) {
                console.log(`⚠️ Content is not valid JSON, starting fresh: ${response.data}`);
                return false;
            }
            
            // Merge cloud data with local data, preferring newer timestamps
            for (const userId in cloudData) {
                if (!userData[userId] || 
                    (cloudData[userId].lastUpdated && 
                     (!userData[userId].lastUpdated || cloudData[userId].lastUpdated > userData[userId].lastUpdated))) {
                    userData[userId] = cloudData[userId];
                }
            }
            
            console.log("✅ User data restored from Google Drive");
            return true;
        }
    } catch (err) {
        console.error("❌ Failed to restore from Google Drive:", err.message);
    }
    return false;
}

// ----------------- USER DATA FUNCTIONS -----------------
function updateUserData(userId, username, type, value) {
    if (!userData[userId]) {
        userData[userId] = {
            username: username,
            troops: null,
            silver: null,
            lastUpdated: Date.now()
        };
    }
    
    userData[userId].username = username; // Update username in case it changed
    userData[userId][type] = value;
    userData[userId].lastUpdated = Date.now();
    
    saveUserData();
}

function formatUserStats(userId) {
    const user = userData[userId];
    if (!user) return null;
    
    const troops = user.troops !== null ? user.troops.toLocaleString() : "Not set";
    const silver = user.silver !== null ? `${user.silver} city` : "Not set";
    const lastUpdated = user.lastUpdated ? `<t:${Math.floor(user.lastUpdated / 1000)}:R>` : "Unknown";
    
    return `**${user.username}**\n🏰 Troops: ${troops}\n💰 Silver: ${silver}\n📅 Last updated: ${lastUpdated}`;
}

function formatAllStats() {
    const users = Object.entries(userData)
        .filter(([_, user]) => user.troops !== null || user.silver !== null)
        .sort((a, b) => (b[1].lastUpdated || 0) - (a[1].lastUpdated || 0));
    
    if (users.length === 0) return "No user data available.";
    
    return users.map(([userId, user]) => {
        const troops = user.troops !== null ? user.troops.toLocaleString() : "❌";
        const silver = user.silver !== null ? `${user.silver} city` : "❌";
        const lastUpdated = user.lastUpdated ? `<t:${Math.floor(user.lastUpdated / 1000)}:R>` : "❓";
        
        return `**${user.username}** | 🏰 ${troops} | 💰 ${silver} | ${lastUpdated}`;
    }).join("\n");
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
        // Only clean the allowed channel where bridge list is maintained
        if (channel.id !== ALLOWED_CHANNEL_ID) return;
        
        // Only clean if we have valid list messages to preserve
        if (lastListMessages.length === 0) return;
        
        console.log(`🧹 Starting channel cleanup in allowed channel`);
        
        // Fetch recent messages (limit to 50 to be safer)
        const messages = await channel.messages.fetch({ limit: 50 });
        console.log(`📨 Fetched ${messages.size} messages for cleanup check`);
        
        // Delete bot messages that are NOT in lastListMessages and are NEWER than 5 minutes (safety window)
        // Also include old duplicate bridge list messages that are older than 5 minutes but newer than 1 hour
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        
        const toDelete = messages.filter(m => {
            if (m.author.id !== client.user.id) return false;
            if (lastListMessages.some(l => l.id === m.id)) return false;
            
            const isRecentDuplicate = m.createdTimestamp > fiveMinutesAgo;
            const isOldDuplicate = m.createdTimestamp < fiveMinutesAgo && m.createdTimestamp > oneHourAgo;
            const isBridgeListMessage = m.content.startsWith("**Bridge List") || m.content === "Bridge list is currently empty.";
            
            return (isRecentDuplicate || isOldDuplicate) && isBridgeListMessage;
        });
        
        console.log(`🗑️ Found ${toDelete.size} messages to delete`);
        
        // Safety check: don't delete more than 15 messages at once
        if (toDelete.size > 15) {
            console.log(`⚠️ Attempted to delete ${toDelete.size} messages, limiting to 15 for safety`);
            const limitedDelete = toDelete.first(15);
            await channel.bulkDelete(limitedDelete, true);
            console.log(`✅ Deleted 15 duplicate bridge list messages`);
        } else if (toDelete.size > 0) {
            console.log(`🧹 Cleaning ${toDelete.size} duplicate bridge list messages`);
            await channel.bulkDelete(toDelete, true);
            console.log(`✅ Successfully cleaned ${toDelete.size} messages`);
        } else {
            console.log(`✨ No duplicate messages found - channel is clean`);
        }
    } catch (err) { console.error("❌ Error cleaning channel:", err); }
}

async function updateBridgeListMessage(channel) {
    if (bridgeList.length === 0) {
        if (lastListMessages.length > 0) {
            try {
                await lastListMessages[0].edit("Bridge list is currently empty.");
                for (let i = 1; i < lastListMessages.length; i++) try { await lastListMessages[i].delete(); } catch {}
                lastListMessages = [lastListMessages[0]];
            } catch { try { const msg = await channel.send("Bridge list is currently empty."); lastListMessages = [msg]; } catch(err){ console.error(err); } }
        } else { try { const msg = await channel.send("Bridge list is currently empty."); lastListMessages = [msg]; } catch(err){ console.error(err); } }
        return;
    }

    const entries = formatBridgeList(true);
    const chunks = splitMessage(entries);

    if (chunks.length === lastListMessages.length) {
        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            try { await lastListMessages[i].edit(header + chunks[i]); } 
            catch { try { lastListMessages[i] = await channel.send(header + chunks[i]); } catch(err){ console.error(err); } }
        }
    } else {
        for (const msg of lastListMessages) try { await msg.delete(); } catch {}
        lastListMessages = [];
        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            try { const msg = await channel.send(header + chunks[i]); lastListMessages.push(msg); } catch(err){ console.error(err); }
        }
    }

    // Clean channel more frequently when in the allowed channel
    if (channel.id === ALLOWED_CHANNEL_ID) {
        if (Math.random() < 0.3) { // 30% chance to clean in allowed channel
            await cleanChannel(channel);
        }
    }
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    
    // Initialize Google Drive
    await initializeGoogleDrive();
    
    // Try to restore user data from Google Drive
    await restoreFromGoogleDrive();
    
    try {
        const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        if (!channel) return console.error("❌ Could not find channel for bridge list");

        const messages = await channel.messages.fetch({ limit: 100 });
        const listMessages = messages
            .filter(m => m.author.id === client.user.id && m.content.startsWith("**Bridge List"))
            .sort((a,b)=>a.createdTimestamp-b.createdTimestamp);

        if (listMessages.size>0) {
            lastListMessages = Array.from(listMessages.values());
            await updateBridgeListMessage(channel);
        } else await updateBridgeListMessage(channel);
    } catch (err) { console.error("❌ Error during startup sync:", err); }
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;
    const now = Date.now();
    const userId = message.author.id;
    if (!commandLog[userId]) commandLog[userId] = [];
    
    console.log(`📨 Processing message: "${content}" from ${message.author.username}`);

    // ----------------- COMMANDS -----------------
    if (message.channel.id !== ALLOWED_CHANNEL_ID && /^!(red|yellow|green|remove|clearlist|listclear|backups|restore|listme|viewlog|cleanup)/i.test(content)) {
        try { await message.reply("⚠️ This command can only be used in the allowed channel."); } catch{}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- TROOPS COMMAND --------
    if (content.toLowerCase().startsWith('!troops ')) {
        console.log(`✅ Troops command matched!`);
        const parts = content.split(' ');
        if (parts.length === 2 && /^\d+$/.test(parts[1])) {
            const troopCount = parseInt(parts[1], 10);
            updateUserData(userId, message.author.username, 'troops', troopCount);
            
            commandLog[userId].push({command: content, timestamp: now});
            commandLog[userId] = commandLog[userId].filter(e => e.timestamp > now - 24 * 60 * 60 * 1000);
            saveCommandLog();
            
            try {
                const reply = await message.reply(`✅ Updated your troop count to **${troopCount.toLocaleString()}**`);
                setTimeout(async() => {try{await reply.delete()}catch{}}, 5000);
            } catch(err) { console.error(err); }
            
            setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
            return;
        } else {
            try {
                const reply = await message.reply(`❌ Invalid format. Use: \`!troops <number>\` (e.g., \`!troops 40000\`)`);
                setTimeout(async() => {try{await reply.delete()}catch{}}, 8000);
            } catch(err) { console.error(err); }
            setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
            return;
        }
    }

    // -------- SILVER COMMAND --------
    if (content.toLowerCase().startsWith('!silver ')) {
        console.log(`✅ Silver command matched!`);
        const parts = content.toLowerCase().split(' ');
        if (parts.length === 3 && /^\d+$/.test(parts[1]) && parts[2] === 'city') {
            const silverCapacity = parseInt(parts[1], 10);
            updateUserData(userId, message.author.username, 'silver', silverCapacity);
            
            commandLog[userId].push({command: content, timestamp: now});
            commandLog[userId] = commandLog[userId].filter(e => e.timestamp > now - 24 * 60 * 60 * 1000);
            saveCommandLog();
            
            try {
                const reply = await message.reply(`✅ Updated your silver capacity to **${silverCapacity} city**`);
                setTimeout(async() => {try{await reply.delete()}catch{}}, 5000);
            } catch(err) { console.error(err); }
            
            setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
            return;
        } else {
            try {
                const reply = await message.reply(`❌ Invalid format. Use: \`!silver <number> city\` (e.g., \`!silver 1 city\`)`);
                setTimeout(async() => {try{await reply.delete()}catch{}}, 8000);
            } catch(err) { console.error(err); }
            setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
            return;
        }
    }

    // -------- MYSTATS COMMAND --------
    if (content.toLowerCase() === "!mystats") {
        const stats = formatUserStats(userId);
        
        if (!stats) {
            try {
                const reply = await message.reply("⚠️ You haven't set any stats yet. Use `!troops <number>` or `!silver <number> city` to get started!");
                setTimeout(async() => {try{await reply.delete()}catch{}}, 8000);
            } catch(err) { console.error(err); }
        } else {
            try {
                await message.author.send(`**Your Stats:**\n\n${stats}`);
                const reply = await message.reply("✅ Your stats have been sent via DM!");
                setTimeout(async() => {try{await reply.delete()}catch{}}, 5000);
            } catch {
                try {
                    const reply = await message.reply(`**Your Stats:**\n\n${stats}`);
                    setTimeout(async() => {try{await reply.delete()}catch{}}, 10000);
                } catch(err) { console.error(err); }
            }
        }
        
        commandLog[userId].push({command: "!mystats", timestamp: now});
        commandLog[userId] = commandLog[userId].filter(e => e.timestamp > now - 24 * 60 * 60 * 1000);
        saveCommandLog();
        
        setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
        return;
    }

    // -------- ALLSTATS COMMAND --------
    if (content.toLowerCase() === "!allstats") {
        const allStats = formatAllStats();
        const chunks = splitMessage([allStats], 1900);
        
        try {
            for (let i = 0; i < chunks.length; i++) {
                const header = i === 0 ? "**All User Stats:**\n\n" : `**All User Stats (Part ${i+1}):**\n\n`;
                await message.author.send(header + chunks[i]);
            }
            const reply = await message.reply("✅ All stats have been sent via DM!");
            setTimeout(async() => {try{await reply.delete()}catch{}}, 5000);
        } catch {
            try {
                for (let i = 0; i < chunks.length; i++) {
                    const header = i === 0 ? "**All User Stats:**\n\n" : `**All User Stats (Part ${i+1}):**\n\n`;
                    const reply = await message.channel.send(header + chunks[i]);
                    setTimeout(async() => {try{await reply.delete()}catch{}}, 15000);
                }
            } catch(err) { console.error(err); }
        }
        
        commandLog[userId].push({command: "!allstats", timestamp: now});
        commandLog[userId] = commandLog[userId].filter(e => e.timestamp > now - 24 * 60 * 60 * 1000);
        saveCommandLog();
        
        setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
        return;
    }

    // -------- HELP COMMAND --------
    if(content.toLowerCase() === "!help" || content.toLowerCase() === "!commands"){
        const helpText = `**Available Commands:**\n\n` +
            `**User Data Commands:**\n` +
            `• \`!troops <number>\` - Set your troop count\n` +
            `• \`!silver <number> city\` - Set your silver capacity\n` +
            `• \`!mystats\` - View your current stats\n` +
            `• \`!allstats\` - View all users' stats\n\n` +
            `**Bridge List Commands:** *(Allowed channel only)*\n` +
            `• \`!red <number>\`, \`!yellow <number>\`, \`!green <number>\` - Color bridges\n` +
            `• \`!remove <number>\` - Remove a bridge\n` +
            `• \`!clearlist\` - Clear all bridges\n` +
            `• \`!listme\` - Get bridge list via DM\n` +
            `• \`!backups\`, \`!restore <number>\` - Manage backups\n` +
            `• \`!viewlog\` - View command history\n` +
            `• \`!cleanup\` - Clean duplicate messages\n\n` +
            `**Examples:**\n` +
            `• \`!troops 40000\` - Sets your troops to 40,000\n` +
            `• \`!silver 1 city\` - Sets your silver capacity to 1 city`;
        
        try {
            await message.author.send(helpText);
            const reply = await message.reply("✅ Help sent via DM!");
            setTimeout(async() => {try{await reply.delete()}catch{}}, 5000);
        } catch {
            try {
                const reply = await message.channel.send(helpText);
                setTimeout(async() => {try{await reply.delete()}catch{}}, 20000);
            } catch(err) { console.error(err); }
        }
        
        setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
        return;
    }

    // -------- COLOR COMMANDS --------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd,numStr] = content.split(" ");
        const num = parseInt(numStr,10);
        if(num>0 && num<=bridgeList.length){
            let color = cmd.toLowerCase()==="!red"?"🔴":cmd.toLowerCase()==="!yellow"?"🟡":"🟢";
            bridgeList[num-1].color=color;
            saveBridgeList();
            try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
        }
        commandLog[userId].push({command:content,timestamp:now});
        commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- REMOVE --------
    if(content.startsWith("!remove")){
        const num = parseInt(content.split(" ")[1]);
        if(!isNaN(num) && num>=1 && num<=bridgeList.length){
            bridgeList.splice(num-1,1);
            saveBridgeList();
            try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
            commandLog[userId].push({command:content,timestamp:now});
            commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
            saveCommandLog();
        }
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- CLEARLIST --------
    if(content === "!clearlist" || content === "!listclear"){
        const count = bridgeList.length;
        bridgeList = [];
        saveBridgeList();
        try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
        commandLog[userId].push({command:`!clearlist (cleared ${count} bridge${count!==1?"s":""})`, timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- BACKUPS --------
    if(content.startsWith("!backups")){
        const files = fs.readdirSync(path.join(__dirname,"data"))
            .filter(f => f.startsWith("bridgeList-"))
            .sort((a,b) => fs.statSync(path.join(__dirname,"data",b)).mtimeMs - fs.statSync(path.join(__dirname,"data",a)).mtimeMs);
        if(files.length===0){
            try { await message.reply("No backups available."); } catch(err) { console.error(err); }
            return;
        }
        const list = files.map((f,i)=>{
            const data = JSON.parse(fs.readFileSync(path.join(__dirname,"data",f),"utf8"));
            const timestamp = parseInt(f.match(/bridgeList-(\d+)\.json/)[1],10);
            const date = new Date(timestamp);
            const formatted = `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()} ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}:${date.getSeconds().toString().padStart(2,'0')}`;
            return `[${i+1}] ${formatted} (${data.length} bridges)`;
        });
        const chunks = splitMessage(list);
        for (const chunk of chunks) { try { await message.author.send(chunk); } catch(err){ console.error(err); } }
        try { const reply = await message.reply("✅ Backup list sent via DM!"); setTimeout(async()=>{try{await reply.delete()}catch{}},5000); } catch{}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- RESTORE --------
    if(content.startsWith("!restore")){
        const arg = parseInt(content.split(" ")[1]);
        if(isNaN(arg) || arg<1) return;
        const files = fs.readdirSync(path.join(__dirname,"data"))
            .filter(f => f.startsWith("bridgeList-"))
            .sort((a,b) => fs.statSync(path.join(__dirname,"data",b)).mtimeMs - fs.statSync(path.join(__dirname,"data",a)).mtimeMs);
        if(arg>files.length) return;
        const chosenFile = files[arg-1];
        if(!chosenFile) return;
        try {
            const data = JSON.parse(fs.readFileSync(path.join(__dirname,"data",chosenFile),"utf8"));
            bridgeList = data;
            saveBridgeList();
        } catch(err){ console.error(err); return; }
        try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
        commandLog[userId].push({command:`!restore ${arg} (restored ${bridgeList.length} bridges)`, timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
        try { await message.reply(`✅ Bridge list restored from backup [${arg}] (${bridgeList.length} bridges)`); } catch(err){ console.error(err); }
        return;
    }

    // -------- LISTME --------
    if(content.startsWith("!listme")){
        if(bridgeList.length===0){try{await message.author.send("Bridge list is empty");}catch{try{await message.channel.send(`${message.author}, I can't DM you.`)}catch{}};return;}
        const args = content.split(" ").slice(1);
        let start=0,end=bridgeList.length;
        if(args.length>0 && args[0].toLowerCase()!=="all"){
            const match=args[0].match(/^(\d+)-(\d+)$/);
            if(match){start=Math.max(0,parseInt(match[1],10)-1);end=Math.min(bridgeList.length,parseInt(match[2],10));}
        }
        const entries = bridgeList.slice(start,end).map((b,i)=>`${i+1}. ${b.color}${b.name}\n${b.bridge}`);
        const chunks = splitMessage(entries);
        try{for(let i=0;i<chunks.length;i++){await message.author.send((i===0?"**Your Bridge List:**\n\n":`**Your Bridge List (Part ${i+1}):**\n\n`)+chunks[i]);}
            try{const reply=await message.reply("✅ Bridge list sent via DM!");setTimeout(async()=>{try{await reply.delete()}catch{}},5000);}catch{}
        }catch{try{await message.channel.send(`${message.author}, I can't DM you.`)}catch{}}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- VIEWLOG --------
    if(content.startsWith("!viewlog")){
        let allLogs=[];
        for(const uid in commandLog){
            const user = await client.users.fetch(uid).catch(()=>null);
            const username = user?user.tag:uid;
            commandLog[uid].forEach(entry=>allLogs.push(`${username} → <t:${Math.floor(entry.timestamp/1000)}:T> → ${entry.command}`));
        }
        allLogs.sort((a,b)=>parseInt(a.match(/<t:(\d+):T>/)[1])-parseInt(b.match(/<t:(\d+):T>/)[1]));
        if(allLogs.length===0){try{await message.author.send("No commands logged in the last 24 hours");}catch{try{await message.channel.send(`${message.author}, I can't DM you.`)}catch{}};return;}
        const chunks = splitMessage(allLogs,1900);
        try{for(let i=0;i<chunks.length;i++){await message.author.send((i===0?"**Command Log (last 24h):**\n\n":`**Command Log (Part ${i+1}):**\n\n`)+chunks[i]);}
            try{const reply=await message.reply("✅ Command log sent via DM!");setTimeout(async()=>{try{await reply.delete()}catch{}},5000);}catch{}
        }catch{try{await message.channel.send(`${message.author}, I can't DM you.`)}catch{}}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- CLEANUP --------
    if(content.startsWith("!cleanup")){
        console.log(`🧹 Manual cleanup requested by ${message.author.tag}`);
        await cleanChannel(message.channel);
        commandLog[userId].push({command:"!cleanup", timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
        try { const reply = await message.reply("✅ Channel cleanup completed!"); setTimeout(async()=>{try{await reply.delete()}catch{}},5000); } catch{}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // ----------------- MIRROR MESSAGES -----------------
    if (message.channel.id !== ALLOWED_CHANNEL_ID) {
        const mirrorTypes = [
            {regex:/l\+k:\/\/coordinates?\?[\d,&]+/gi, api:"coord", label:"coordinates"},
            {regex:/l\+k:\/\/report\?[\d,&]+/gi, api:"report", label:"report"},
            {regex:/l\+k:\/\/player\?[\d,&]+/gi, api:"player", label:"player"}
        ];

        for(const type of mirrorTypes){
            const matches = [...content.matchAll(type.regex)];
            if(matches.length>0){
                const links = matches.map(m=>{
                    const code = m[0].split("?")[1];
                    return `[Click to view ${type.label}](${REDIRECT_DOMAIN}/api/${type.api}?code=${encodeURIComponent(code)})`;
                }).join("\n");

                const mirrored = `**${message.author.username}:**\n${content}\n\n${links}`;
                try { await message.channel.send(mirrored); } catch(err){ console.error(`❌ Error sending mirrored ${type.label} message:`, err); }
                try { await message.delete(); } catch(err){ console.error(`❌ Error deleting user message:`, err); }
                return;
            }
        }
    }

    // ----------------- BRIDGE DETECTION -----------------
    console.log(`🔍 Checking message for bridge links: "${content.substring(0, 100)}..."`);
    const blocks = content.split(/\n\s*\n/);
    console.log(`📝 Split into ${blocks.length} blocks`);
    let bridgesAdded = 0;
    for (const block of blocks) {
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if (!bridgeMatch) {
            console.log(`❌ No bridge match in block: "${block.substring(0, 50)}..."`);
            continue;
        }
        console.log(`✅ Found bridge link: ${bridgeMatch[0]}`);
        const link = bridgeMatch[0];
        const code = link.split("?")[1];
        if (!code) {
            console.log(`❌ No code found in link: ${link}`);
            continue;
        }
        console.log(`🔑 Extracted code: ${code}`);
        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;
        if (bridgeList.some(entry => entry.bridgeLink?.includes(code))) {
            console.log(`⚠️ Bridge already exists with code: ${code}`);
            continue;
        }
        const structureLine = block.split("\n").find(line => line.includes(":"));
        const displayName = structureLine ? structureLine.split(":").map(s => s.trim()).join("/") : "Unknown Structure";
        console.log(`➕ Adding bridge: ${displayName} - ${link}`);
        bridgeList.push({ bridgeLink: link, vercelLink, bridge: link, vercel: vercelLink, name: displayName, color: "" });
        bridgesAdded++;
    }

    if (bridgesAdded > 0) {
        commandLog[userId].push({ command: `Added ${bridgesAdded} bridge${bridgesAdded > 1 ? "s" : ""}`, timestamp: now });
        commandLog[userId] = commandLog[userId].filter(e => e.timestamp > now - 24 * 60 * 60 * 1000);
        saveCommandLog();
        saveBridgeList();

        // <-- DELETE USER MESSAGE IF IN ALLOWED CHANNEL -->
        console.log(`🔍 Bridge added. Channel ID: ${message.channel.id}, Allowed ID: ${ALLOWED_CHANNEL_ID}, Match: ${message.channel.id === ALLOWED_CHANNEL_ID}`);
        if (message.channel.id === ALLOWED_CHANNEL_ID) {
            console.log(`🗑️ Attempting to delete user message with bridge link`);
            try { 
                await message.delete(); 
                console.log(`✅ Successfully deleted user bridge message`);
            } catch (err) { 
                console.error("❌ Error deleting user bridge message:", err); 
            }
        } else {
            console.log(`ℹ️ Not deleting message - not in allowed channel`);
        }
        
        // Only update bridge list if bridges were actually added
        try { await updateBridgeListMessage(message.channel); } catch (err) { console.error(err); }
    }
});

// ----------------- LOGIN -----------------
client.login(process.env.BOT_TOKEN);
