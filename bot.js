const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { google } = require('googleapis');

// ================= CONFIG =================
const ALLOWED_CHANNEL_IDS = [
    "1407022766967881759", // Original server channel
    "1425905524553158826"  // New server channel
];
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Replace with your Vercel URL
const BACKUP_LIMIT = 10; // how many backups to keep

// Multi-server support
const SUPPORT_MULTI_SERVER = process.env.SUPPORT_MULTI_SERVER !== 'false'; // Set to false to disable multi-server support
const GLOBAL_DATA_DIR = path.join(__dirname, "data", "global");
const SERVER_DATA_DIR = path.join(__dirname, "data", "servers");

// Legacy single-server file paths (for backward compatibility)
const LEGACY_DATA_FILE = path.join(__dirname, "data", "bridgeList.json");
const LEGACY_COMMAND_LOG_FILE = path.join(__dirname, "data", "commandLog.json");
const LEGACY_USER_DATA_FILE = path.join(__dirname, "data", "userData.json");

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

// Ensure data folders exist
if (!fs.existsSync(path.join(__dirname, "data"))) fs.mkdirSync(path.join(__dirname, "data"));
if (SUPPORT_MULTI_SERVER) {
    if (!fs.existsSync(GLOBAL_DATA_DIR)) fs.mkdirSync(GLOBAL_DATA_DIR);
    if (!fs.existsSync(SERVER_DATA_DIR)) fs.mkdirSync(SERVER_DATA_DIR);
}

// ----------------- SERVER DATA HELPERS -----------------
function getServerDataDir(guildId) {
    if (!SUPPORT_MULTI_SERVER) {
        return path.join(__dirname, "data");
    }
    const serverDir = path.join(SERVER_DATA_DIR, `server_${guildId}`);
    if (!fs.existsSync(serverDir)) {
        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(path.join(serverDir, "backups"), { recursive: true });
    }
    return serverDir;
}

function getServerDataFiles(guildId) {
    const serverDir = getServerDataDir(guildId);
    return {
        bridgeList: path.join(serverDir, "bridgeList.json"),
        userData: path.join(serverDir, "userData.json"),
        commandLog: path.join(serverDir, "commandLog.json"),
        backupsDir: path.join(serverDir, "backups")
    };
}

// Global data storage (will be replaced with server-specific data)
let bridgeList = [];
let commandLog = {};
let userData = {};
let isSaving = false; // Flag to prevent restore during save operations

// Load server-specific data
function loadServerData(guildId) {
    if (!SUPPORT_MULTI_SERVER) {
        // Legacy single-server mode
        loadLegacyData();
        return;
    }
    
    const files = getServerDataFiles(guildId);
    
    // Load bridge list
    try { 
        if (fs.existsSync(files.bridgeList)) {
            bridgeList = JSON.parse(fs.readFileSync(files.bridgeList, "utf8"));
            console.log(`📁 [Server ${guildId}] Loaded ${bridgeList.length} bridges from local file`);
        } else {
            bridgeList = [];
            console.log(`📁 [Server ${guildId}] No local bridge file found, starting with empty list`);
        }
    } 
    catch (err) { console.log(`Error reading bridge list file for server ${guildId}:`, err); }

    // Load command log
    try { 
        if (fs.existsSync(files.commandLog)) {
            commandLog = JSON.parse(fs.readFileSync(files.commandLog, "utf8"));
        } else {
            commandLog = {};
        }
    } 
    catch (err) { console.error(`❌ Error reading command log file for server ${guildId}:`, err); }

    // Load user data
    try { 
        if (fs.existsSync(files.userData)) {
            userData = JSON.parse(fs.readFileSync(files.userData, "utf8"));
            console.log(`📁 [Server ${guildId}] Loaded ${Object.keys(userData).length} users from local file`);
        } else {
            userData = {};
            console.log(`📁 [Server ${guildId}] No local user data file found, starting with empty data`);
        }
    } 
    catch (err) { console.error(`❌ Error reading user data file for server ${guildId}:`, err); }
    
    // Try to restore from Google Drive if no local data exists
    if (Object.keys(userData).length === 0 && bridgeList.length === 0) {
        console.log(`🔄 [Server ${guildId}] No local data found, attempting Google Drive restore...`);
        restoreFromGoogleDrive(guildId);
    } else {
        console.log(`ℹ️ [Server ${guildId}] Local data exists, skipping Google Drive restore`);
    }
}

// Load legacy single-server data
function loadLegacyData() {
    // Load bridge list
    try { 
        if (fs.existsSync(LEGACY_DATA_FILE)) {
            bridgeList = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, "utf8"));
            console.log(`📁 Loaded ${bridgeList.length} bridges from legacy file`);
        } else {
            bridgeList = [];
            console.log(`📁 No legacy bridge file found, starting with empty list`);
        }
    } 
    catch (err) { console.log("Error reading legacy bridge list file:", err); }

    // Load command log
    try { 
        if (fs.existsSync(LEGACY_COMMAND_LOG_FILE)) {
            commandLog = JSON.parse(fs.readFileSync(LEGACY_COMMAND_LOG_FILE, "utf8"));
        } else {
            commandLog = {};
        }
    } 
    catch (err) { console.error("❌ Error reading legacy command log file:", err); }

    // Load user data
    try { 
        if (fs.existsSync(LEGACY_USER_DATA_FILE)) {
            userData = JSON.parse(fs.readFileSync(LEGACY_USER_DATA_FILE, "utf8"));
            console.log(`📁 Loaded ${Object.keys(userData).length} users from legacy file`);
        } else {
            userData = {};
            console.log(`📁 No legacy user data file found, starting with empty data`);
        }
    } 
    catch (err) { console.error("❌ Error reading legacy user data file:", err); }
    
    // Try to restore from Google Drive if no local data exists
    if (Object.keys(userData).length === 0 && bridgeList.length === 0) {
        console.log(`🔄 No legacy data found, attempting Google Drive restore...`);
        restoreFromGoogleDrive('legacy');
    }
}

let lastListMessages = {}; // Channel ID -> array of messages

// ----------------- SAVE FUNCTIONS -----------------

function saveCommandLog(guildId) {
    try { 
        if (!SUPPORT_MULTI_SERVER) {
            fs.writeFileSync(LEGACY_COMMAND_LOG_FILE, JSON.stringify(commandLog, null, 2), "utf8");
        } else {
            const files = getServerDataFiles(guildId);
            fs.writeFileSync(files.commandLog, JSON.stringify(commandLog, null, 2), "utf8");
        }
    }
    catch (err) { console.error(`❌ Error saving command log file:`, err); }
}

function saveUserData(guildId) {
    try { 
        isSaving = true;
        if (!SUPPORT_MULTI_SERVER) {
            fs.writeFileSync(LEGACY_USER_DATA_FILE, JSON.stringify(userData, null, 2), "utf8");
            backupToGoogleDrive('legacy');
        } else {
            const files = getServerDataFiles(guildId);
            fs.writeFileSync(files.userData, JSON.stringify(userData, null, 2), "utf8");
            backupToGoogleDrive(guildId);
        }
        isSaving = false;
    }
    catch (err) { 
        isSaving = false;
        console.error(`❌ Error saving user data file:`, err); 
    }
}

function saveBridgeList(guildId) {
    try {
        isSaving = true;
        if (!SUPPORT_MULTI_SERVER) {
            // Legacy mode
            fs.writeFileSync(LEGACY_DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8");
            
            if(bridgeList.length > 0){
                const backupFile = path.join(__dirname, "data", `bridgeList-${Date.now()}.json`);
                fs.writeFileSync(backupFile, JSON.stringify(bridgeList, null, 2), "utf8");
                console.log(`💾 Created legacy backup: ${backupFile}`);

                const backupFiles = fs.readdirSync(path.join(__dirname, "data"))
                    .filter(f => f.startsWith("bridgeList-"))
                    .sort((a, b) => fs.statSync(path.join(__dirname, "data", a)).mtimeMs -
                                    fs.statSync(path.join(__dirname, "data", b)).mtimeMs);
                console.log(`📁 Found ${backupFiles.length} legacy backup files`);
                while (backupFiles.length > BACKUP_LIMIT) {
                    const fileToDelete = backupFiles.shift();
                    fs.unlinkSync(path.join(__dirname, "data", fileToDelete));
                    console.log(`🗑️ Deleted old legacy backup: ${fileToDelete}`);
                }
            }
            
            backupToGoogleDrive('legacy');
        } else {
            // Multi-server mode
            const files = getServerDataFiles(guildId);
            fs.writeFileSync(files.bridgeList, JSON.stringify(bridgeList, null, 2), "utf8");

            if(bridgeList.length > 0){
                const backupFile = path.join(files.backupsDir, `bridgeList-${Date.now()}.json`);
                fs.writeFileSync(backupFile, JSON.stringify(bridgeList, null, 2), "utf8");
                console.log(`💾 [Server ${guildId}] Created local backup: ${backupFile}`);

                const backupFiles = fs.readdirSync(files.backupsDir)
                    .filter(f => f.startsWith("bridgeList-"))
                    .sort((a, b) => fs.statSync(path.join(files.backupsDir, a)).mtimeMs -
                                    fs.statSync(path.join(files.backupsDir, b)).mtimeMs);
                console.log(`📁 [Server ${guildId}] Found ${backupFiles.length} backup files`);
                while (backupFiles.length > BACKUP_LIMIT) {
                    const fileToDelete = backupFiles.shift();
                    fs.unlinkSync(path.join(files.backupsDir, fileToDelete));
                    console.log(`🗑️ [Server ${guildId}] Deleted old backup: ${fileToDelete}`);
                }
            }
            
            backupToGoogleDrive(guildId);
        }
        isSaving = false;
    } catch (err) { 
        isSaving = false;
        console.log(`Error saving bridge list:`, err); 
    }
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

async function backupToGoogleDrive(guildId) {
    if (!driveAuth || !GOOGLE_DRIVE_FILE_ID) return;
    
    try {
        const sheets = google.sheets({ version: 'v4', auth: driveAuth });
        
        // Load existing multi-server data
        let allServerData = {};
        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: GOOGLE_DRIVE_FILE_ID,
                range: 'A1'
            });
            
            if (response.data.values && response.data.values[0] && response.data.values[0][0]) {
                const existingData = JSON.parse(response.data.values[0][0]);
                if (existingData.servers) {
                    allServerData = existingData.servers;
                }
            }
        } catch (err) {
            console.log("No existing data found, starting fresh");
        }
        
        // Update current server data
        allServerData[guildId] = {
            userData: userData,
            bridgeList: bridgeList,
            lastBackup: Date.now()
        };
        
        // Create combined backup data
        const backupData = {
            servers: allServerData,
            lastGlobalBackup: Date.now()
        };
        
        // Write combined JSON data to cell A1
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_DRIVE_FILE_ID,
            range: 'A1',
            valueInputOption: 'RAW',
            resource: {
                values: [[JSON.stringify(backupData, null, 2)]]
            }
        });
        
        console.log(`✅ [Server ${guildId}] Data backed up to Google Drive`);
    } catch (err) {
        console.error(`❌ Failed to backup server ${guildId} to Google Drive:`, err.message);
    }
}

async function restoreFromGoogleDrive(guildId = 'legacy') {
    if (!driveAuth || !GOOGLE_DRIVE_FILE_ID || isSaving) return false;
    
    try {
        const sheets = google.sheets({ version: 'v4', auth: driveAuth });
        
        console.log(`📥 Reading data from Google Sheet...`);
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_DRIVE_FILE_ID,
            range: 'A1'
        });
        
        if (response.data.values && response.data.values[0] && response.data.values[0][0]) {
            const rawData = response.data.values[0][0];
            console.log(`📄 Raw content: ${rawData.substring(0, 100)}...`);
            
            let cloudData;
            try {
                cloudData = JSON.parse(rawData);
            } catch (parseError) {
                console.log(`⚠️ Content is not valid JSON, starting fresh`);
                return false;
            }
            
            // Check if this is the new multi-server format
            if (cloudData.servers) {
                console.log("📦 Detected multi-server backup format");
                console.log(`📊 Available servers: ${Object.keys(cloudData.servers).length}`);
                
                if (cloudData.servers[guildId]) {
                    const serverData = cloudData.servers[guildId];
                    console.log(`📊 Server ${guildId} data: ${Object.keys(serverData.userData || {}).length} users, ${(serverData.bridgeList || []).length} bridges`);
                    
                    // Restore user data
                    if (serverData.userData) {
                        for (const userId in serverData.userData) {
                            if (!userData[userId] || 
                                (serverData.userData[userId].lastUpdated && 
                                 (!userData[userId].lastUpdated || serverData.userData[userId].lastUpdated > userData[userId].lastUpdated))) {
                                userData[userId] = serverData.userData[userId];
                            }
                        }
                        console.log(`✅ [Server ${guildId}] User data restored from multi-server backup`);
                    }
                    
                    // Restore bridge data
                    if (serverData.bridgeList && Array.isArray(serverData.bridgeList)) {
                        console.log(`🔍 [Server ${guildId}] Local bridge count: ${bridgeList.length}, Cloud bridge count: ${serverData.bridgeList.length}`);
                        // Only restore if local bridge list is empty AND cloud has data, or cloud data is significantly newer
                        if ((bridgeList.length === 0 && serverData.bridgeList.length > 0) || 
                            (serverData.lastBackup && serverData.lastBackup > (Date.now() - 60000) && serverData.bridgeList.length > bridgeList.length)) {
                            bridgeList = serverData.bridgeList;
                            console.log(`✅ [Server ${guildId}] Bridge list restored from multi-server backup (${bridgeList.length} bridges)`);
                            // Save the restored bridge data locally
                            saveBridgeList(guildId);
                        } else {
                            console.log(`ℹ️ [Server ${guildId}] Local bridge data is newer or cloud is empty, keeping local version`);
                        }
                    }
                } else {
                    console.log(`ℹ️ No data found for server ${guildId} in multi-server backup`);
                }
                
            } else if (cloudData.userData && cloudData.bridgeList) {
                // Legacy combined format (single server)
                console.log("📦 Detected legacy combined backup format");
                console.log(`📊 Cloud data: ${Object.keys(cloudData.userData).length} users, ${cloudData.bridgeList.length} bridges`);
                
                // Only restore if we're in legacy mode or this is the first server
                if (!SUPPORT_MULTI_SERVER || guildId === 'legacy') {
                    // Restore user data
                    if (cloudData.userData) {
                        for (const userId in cloudData.userData) {
                            if (!userData[userId] || 
                                (cloudData.userData[userId].lastUpdated && 
                                 (!userData[userId].lastUpdated || cloudData.userData[userId].lastUpdated > userData[userId].lastUpdated))) {
                                userData[userId] = cloudData.userData[userId];
                            }
                        }
                        console.log("✅ User data restored from legacy combined backup");
                    }
                    
                    // Restore bridge data
                    if (cloudData.bridgeList && Array.isArray(cloudData.bridgeList)) {
                        console.log(`🔍 Local bridge count: ${bridgeList.length}, Cloud bridge count: ${cloudData.bridgeList.length}`);
                        // Only restore if local bridge list is empty or cloud data is newer
                        if (bridgeList.length === 0 || 
                            (cloudData.lastBackup && cloudData.lastBackup > (bridgeList[0]?.lastUpdated || 0))) {
                            bridgeList = cloudData.bridgeList;
                            console.log(`✅ Bridge list restored from legacy combined backup (${bridgeList.length} bridges)`);
                            // Save the restored bridge data locally
                            saveBridgeList(guildId);
                        } else {
                            console.log("ℹ️ Local bridge data is newer, keeping local version");
                        }
                    }
                } else {
                    console.log(`ℹ️ Skipping legacy data restore for server ${guildId} in multi-server mode`);
                }
                
            } else {
                // Old user-only format - backward compatibility
                console.log("📦 Detected legacy user-only backup format");
                console.log(`📊 Legacy data: ${Object.keys(cloudData).length} users`);
                
                // Only restore if we're in legacy mode
                if (!SUPPORT_MULTI_SERVER || guildId === 'legacy') {
                    // Merge cloud data with local data, preferring newer timestamps
                    for (const userId in cloudData) {
                        if (!userData[userId] || 
                            (cloudData[userId].lastUpdated && 
                             (!userData[userId].lastUpdated || cloudData[userId].lastUpdated > userData[userId].lastUpdated))) {
                            userData[userId] = cloudData[userId];
                        }
                    }
                    console.log("✅ User data restored from legacy user-only backup");
                } else {
                    console.log(`ℹ️ Skipping legacy user-only data restore for server ${guildId} in multi-server mode`);
                }
            }
            
            return true;
        } else {
            console.log("📝 No data found in sheet, starting fresh");
            return false;
        }
    } catch (err) {
        console.error("❌ Failed to restore from Google Drive:", err.message);
    }
    return false;
}

// ----------------- USER DATA FUNCTIONS -----------------
function updateUserData(userId, username, type, value, guildId) {
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
    
    saveUserData(guildId);
}

function formatUserStats(userId) {
    const user = userData[userId];
    if (!user) return null;
    
    const troops = user.troops !== null ? user.troops.toLocaleString() : "Not set";
    const silver = user.silver !== null ? user.silver : "Not set";
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
        const silver = user.silver !== null ? user.silver : "❌";
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
        // Only clean the allowed channels where bridge list is maintained
        if (!ALLOWED_CHANNEL_IDS.includes(channel.id)) return;
        
        // Only clean if we have valid list messages to preserve
        const channelMessages = lastListMessages[channel.id] || [];
        if (channelMessages.length === 0) return;
        
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
            if (channelMessages.some(l => l.id === m.id)) return false;
            
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
    const channelId = channel.id;
    const channelMessages = lastListMessages[channelId] || [];
    
    if (bridgeList.length === 0) {
        if (channelMessages.length > 0) {
            try {
                await channelMessages[0].edit("Bridge list is currently empty.");
                for (let i = 1; i < channelMessages.length; i++) try { await channelMessages[i].delete(); } catch {}
                lastListMessages[channelId] = [channelMessages[0]];
            } catch { try { const msg = await channel.send("Bridge list is currently empty."); lastListMessages[channelId] = [msg]; } catch(err){ console.error(err); } }
        } else { try { const msg = await channel.send("Bridge list is currently empty."); lastListMessages[channelId] = [msg]; } catch(err){ console.error(err); } }
        return;
    }

    const entries = formatBridgeList(true);
    const chunks = splitMessage(entries);

    if (chunks.length === channelMessages.length) {
        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            try { await channelMessages[i].edit(header + chunks[i]); } 
            catch { try { channelMessages[i] = await channel.send(header + chunks[i]); } catch(err){ console.error(err); } }
        }
        lastListMessages[channelId] = channelMessages;
    } else {
        for (const msg of channelMessages) try { await msg.delete(); } catch {}
        lastListMessages[channelId] = [];
        for (let i = 0; i < chunks.length; i++) {
            const header = i === 0 ? "**Bridge List:**\n\n" : `**Bridge List (Part ${i+1}):**\n\n`;
            try { const msg = await channel.send(header + chunks[i]); lastListMessages[channelId].push(msg); } catch(err){ console.error(err); }
        }
    }

    // Clean channel more frequently when in an allowed channel
    if (ALLOWED_CHANNEL_IDS.includes(channel.id)) {
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
    
    // Note: Google Drive restore will happen when first message is processed per server
    
    // Initialize bridge list messages for all allowed channels
    for (const channelId of ALLOWED_CHANNEL_IDS) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) {
                console.error(`❌ Could not find channel ${channelId}`);
                continue;
            }

            const messages = await channel.messages.fetch({ limit: 100 });
            const listMessages = messages
                .filter(m => m.author.id === client.user.id && m.content.startsWith("**Bridge List"))
                .sort((a,b)=>a.createdTimestamp-b.createdTimestamp);

            if (listMessages.size>0) {
                lastListMessages[channelId] = Array.from(listMessages.values());
                await updateBridgeListMessage(channel);
            } else {
                await updateBridgeListMessage(channel);
            }
            console.log(`✅ Initialized bridge list for channel ${channelId}`);
        } catch (err) { 
            console.error(`❌ Error initializing channel ${channelId}:`, err); 
        }
    }
});

// ----------------- MESSAGE HANDLER -----------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content;
    const now = Date.now();
    const userId = message.author.id;
    const guildId = message.guild?.id || 'dm';
    
    // Load server-specific data
    if (SUPPORT_MULTI_SERVER && message.guild) {
        loadServerData(guildId);
    } else if (!SUPPORT_MULTI_SERVER) {
        // Load legacy data once at startup
        if (!global.legacyDataLoaded) {
            loadLegacyData();
            global.legacyDataLoaded = true;
        }
    }
    
    if (!commandLog[userId]) commandLog[userId] = [];
    
    console.log(`📨 [Server ${guildId}] Processing message: "${content}" from ${message.author.username}`);

    // ----------------- COMMANDS -----------------
    if (!ALLOWED_CHANNEL_IDS.includes(message.channel.id) && /^!(red|yellow|green|remove|clearlist|listclear|backups|restore|listme|viewlog|cleanup|backup)/i.test(content)) {
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
            updateUserData(userId, message.author.username, 'troops', troopCount, guildId);
            
            commandLog[userId].push({command: content, timestamp: now});
            commandLog[userId] = commandLog[userId].filter(e => e.timestamp > now - 24 * 60 * 60 * 1000);
            saveCommandLog(guildId);
            
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
        const silverText = content.substring(8).trim(); // Get everything after "!silver "
        
        if (silverText.length > 0) {
            updateUserData(userId, message.author.username, 'silver', silverText, guildId);
            
            commandLog[userId].push({command: content, timestamp: now});
            commandLog[userId] = commandLog[userId].filter(e => e.timestamp > now - 24 * 60 * 60 * 1000);
            saveCommandLog(guildId);
            
            try {
                const reply = await message.reply(`✅ Updated your silver info to: **${silverText}**`);
                setTimeout(async() => {try{await reply.delete()}catch{}}, 5000);
            } catch(err) { console.error(err); }
            
            setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
            return;
        } else {
            try {
                const reply = await message.reply(`❌ Please provide silver information. Use: \`!silver <your silver info>\` (e.g., \`!silver 1 castle 2 forts 3 cities\`)`);
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
        saveCommandLog(guildId);
        
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
        saveCommandLog(guildId);
        
        setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
        return;
    }

    // -------- HELP COMMAND --------
    if(content.toLowerCase() === "!help" || content.toLowerCase() === "!commands"){
        const helpText = `**Available Commands:**\n\n` +
            `**User Data Commands:**\n` +
            `• \`!troops <number>\` - Set your troop count\n` +
            `• \`!silver <your silver info>\` - Set your silver information\n` +
            `• \`!mystats\` - View your current stats\n` +
            `• \`!allstats\` - View all users' stats\n\n` +
            `**Bridge List Commands:** *(Allowed channel only)*\n` +
            `• \`!red <number>\`, \`!yellow <number>\`, \`!green <number>\` - Color bridges\n` +
            `• \`!remove <number>\` - Remove a bridge\n` +
            `• \`!clearlist\` - Clear all bridges\n` +
            `• \`!listme\` - Get bridge list via DM\n` +
            `• \`!backups\`, \`!restore <number>\` - Manage local backups\n` +
            `• \`!backup\` - Backup to Google Drive\n` +
            `• \`!mode\` - Show current bot mode\n` +
            `• \`!viewlog\` - View command history\n` +
            `• \`!cleanup\` - Clean duplicate messages\n\n` +
            `**Examples:**\n` +
            `• \`!troops 40000\` - Sets your troops to 40,000\n` +
            `• \`!silver 1 castle 2 forts 3 cities\` - Sets your silver info`;
        
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
            saveBridgeList(guildId);
            try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
        }
        commandLog[userId].push({command:content,timestamp:now});
        commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog(guildId);
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- REMOVE --------
    if(content.startsWith("!remove")){
        const num = parseInt(content.split(" ")[1]);
        if(!isNaN(num) && num>=1 && num<=bridgeList.length){
            bridgeList.splice(num-1,1);
            saveBridgeList(guildId);
            try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
            commandLog[userId].push({command:content,timestamp:now});
            commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
            saveCommandLog(guildId);
        }
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- CLEARLIST --------
    if(content === "!clearlist" || content === "!listclear"){
        const count = bridgeList.length;
        bridgeList = [];
        saveBridgeList(guildId);
        try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
        commandLog[userId].push({command:`!clearlist (cleared ${count} bridge${count!==1?"s":""})`, timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog(guildId);
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- BACKUPS --------
    if(content.startsWith("!backups")){
        let backupFiles = [];
        let backupDir = "";
        
        if (SUPPORT_MULTI_SERVER) {
            const files = getServerDataFiles(guildId);
            backupDir = files.backupsDir;
            backupFiles = fs.readdirSync(files.backupsDir)
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(files.backupsDir,b)).mtimeMs - fs.statSync(path.join(files.backupsDir,a)).mtimeMs);
        } else {
            backupDir = path.join(__dirname, "data");
            backupFiles = fs.readdirSync(path.join(__dirname, "data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(__dirname, "data", b)).mtimeMs - fs.statSync(path.join(__dirname, "data", a)).mtimeMs);
        }
        
        if(backupFiles.length===0){
            try { await message.reply("No backups available."); } catch(err) { console.error(err); }
            return;
        }
        const list = backupFiles.map((f,i)=>{
            const data = JSON.parse(fs.readFileSync(path.join(backupDir,f),"utf8"));
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
        
        let backupFiles = [];
        let backupDir = "";
        
        if (SUPPORT_MULTI_SERVER) {
            const files = getServerDataFiles(guildId);
            backupDir = files.backupsDir;
            backupFiles = fs.readdirSync(files.backupsDir)
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(files.backupsDir,b)).mtimeMs - fs.statSync(path.join(files.backupsDir,a)).mtimeMs);
        } else {
            backupDir = path.join(__dirname, "data");
            backupFiles = fs.readdirSync(path.join(__dirname, "data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(__dirname, "data", b)).mtimeMs - fs.statSync(path.join(__dirname, "data", a)).mtimeMs);
        }
        
        if(arg>backupFiles.length) return;
        const chosenFile = backupFiles[arg-1];
        if(!chosenFile) return;
        try {
            const data = JSON.parse(fs.readFileSync(path.join(backupDir,chosenFile),"utf8"));
            bridgeList = data;
            saveBridgeList(guildId);
        } catch(err){ console.error(err); return; }
        try { await updateBridgeListMessage(message.channel); } catch(err){ console.error(err); }
        commandLog[userId].push({command:`!restore ${arg} (restored ${bridgeList.length} bridges)`, timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog(guildId);
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
        saveCommandLog(guildId);
        try { const reply = await message.reply("✅ Channel cleanup completed!"); setTimeout(async()=>{try{await reply.delete()}catch{}},5000); } catch{}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- BACKUP --------
    if(content.toLowerCase() === "!backup"){
        console.log(`💾 Manual backup requested by ${message.author.tag}`);
        await backupToGoogleDrive(guildId);
        commandLog[userId].push({command:"!backup", timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog(guildId);
        try { const reply = await message.reply("✅ Data backed up to Google Drive!"); setTimeout(async()=>{try{await reply.delete()}catch{}},5000); } catch{}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- MODE --------
    if(content.toLowerCase() === "!mode"){
        const mode = SUPPORT_MULTI_SERVER ? "Multi-Server" : "Single-Server (Legacy)";
        const serverInfo = SUPPORT_MULTI_SERVER ? `\nCurrent Server: ${guildId}` : "";
        try { 
            const reply = await message.reply(`🤖 **Bot Mode:** ${mode}${serverInfo}\n\n**Data Storage:** ${SUPPORT_MULTI_SERVER ? 'Server-specific folders' : 'Single shared folder'}\n**Google Drive:** ${SUPPORT_MULTI_SERVER ? 'Multi-server backup' : 'Single backup'}`);
            setTimeout(async() => {try{await reply.delete()}catch{}}, 10000);
        } catch(err) { console.error(err); }
        setTimeout(async() => {try{await message.delete()}catch{}}, 3000);
        return;
    }

    // ----------------- MIRROR MESSAGES -----------------
    if (!ALLOWED_CHANNEL_IDS.includes(message.channel.id)) {
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
    // Only process bridge detection in allowed channels
    if (ALLOWED_CHANNEL_IDS.includes(message.channel.id)) {
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
            saveCommandLog(guildId);
            saveBridgeList(guildId);

            // <-- DELETE USER MESSAGE IF IN ALLOWED CHANNEL -->
            console.log(`🔍 Bridge added. Channel ID: ${message.channel.id}, Allowed IDs: ${ALLOWED_CHANNEL_IDS.join(', ')}, Match: ${ALLOWED_CHANNEL_IDS.includes(message.channel.id)}`);
            if (ALLOWED_CHANNEL_IDS.includes(message.channel.id)) {
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
    }
});

// ----------------- LOGIN -----------------
client.login(process.env.BOT_TOKEN);
