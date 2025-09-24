// bot.js
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1407022766967881759"; // your bridge list channel
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; 
const DATA_FILE = path.join(__dirname, "data", "bridgeList.json");
const COMMAND_LOG_FILE = path.join(__dirname, "data", "commandLog.json");
const BACKUP_LIMIT = 10;
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
    if (channel.id !== ALLOWED_CHANNEL_ID) return;
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !lastListMessages.some(l => l.id === m.id));

        const batchSize = 50;
        const deleteChunks = [];
        let batch = [];

        for (const msg of toDelete.values()) {
            batch.push(msg);
            if (batch.length >= batchSize) {
                deleteChunks.push(batch);
                batch = [];
            }
        }
        if (batch.length) deleteChunks.push(batch);

        for (const chunk of deleteChunks) {
            await channel.bulkDelete(chunk, true);
            await new Promise(res => setTimeout(res, 500));
        }
    } catch (err) { console.error("❌ Error cleaning channel:", err); }
}

async function updateBridgeListMessage(channel) {
    if (channel.id !== ALLOWED_CHANNEL_ID) return;

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

    await cleanChannel(channel);
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
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

    const now = Date.now();
    const userId = message.author.id;
    if (!commandLog[userId]) commandLog[userId] = [];

    const content = message.content.trim();
    const isAllowedChannel = message.channel.id === ALLOWED_CHANNEL_ID;

    // ----------------- Commands -----------------
    if (content.startsWith("!")) {
        const [cmd, ...args] = content.split(" ");

        if (["red","yellow","green"].includes(cmd.slice(1).toLowerCase())) {
            const num = parseInt(args[0],10);
            if(num>0 && num<=bridgeList.length){
                const color = cmd.toLowerCase()==="red"?"🔴":cmd.toLowerCase()==="yellow"?"🟡":"🟢";
                bridgeList[num-1].color=color;
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            }
        }

        if(cmd==="!remove"){
            const num = parseInt(args[0],10);
            if(!isNaN(num) && num>=1 && num<=bridgeList.length){
                bridgeList.splice(num-1,1);
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            }
        }

        if(cmd==="!clearlist"){
            bridgeList = [];
            saveBridgeList();
            if(isAllowedChannel) await updateBridgeListMessage(message.channel);
        }

        if(cmd==="!backups"){
            const files = fs.readdirSync(path.join(__dirname,"data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(__dirname,"data",b)).mtimeMs - fs.statSync(path.join(__dirname,"data",a)).mtimeMs);
            if(files.length===0){try{await message.author.send("No backups available.");}catch{};return;}
            const list = files.map((f,i)=>{
                const data = JSON.parse(fs.readFileSync(path.join(__dirname,"data",f),"utf8"));
                const timestamp = parseInt(f.match(/bridgeList-(\d+)\.json/)[1],10);
                const date = new Date(timestamp);
                const formatted = `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()} ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}:${date.getSeconds().toString().padStart(2,'0')}`;
                return `[${i+1}] ${formatted} (${data.length} bridges)`;
            });
            const chunks = splitMessage(list);
            for(const chunk of chunks){try{await message.author.send(chunk);}catch{}}
        }

        if(cmd==="!restore"){
            const arg = parseInt(args[0]);
            if(isNaN(arg)||arg<1) return;
            const files = fs.readdirSync(path.join(__dirname,"data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(__dirname,"data",b)).mtimeMs - fs.statSync(path.join(__dirname,"data",a)).mtimeMs);
            if(arg>files.length) return;
            const chosenFile = files[arg-1];
            try {
                const data = JSON.parse(fs.readFileSync(path.join(__dirname,"data",chosenFile),"utf8"));
                bridgeList = data;
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            } catch(err){console.error(err);}
        }

        if(cmd==="!listme"){
            if(bridgeList.length===0){try{await message.author.send("Bridge list is empty");}catch{};return;}
            const entries = bridgeList.map(b=>`${b.color}${b.name}\n${b.bridge}`);
            const chunks = splitMessage(entries);
            for(const chunk of chunks){try{await message.author.send(chunk);}catch{}}
        }

        commandLog[userId].push({command:content,timestamp:now});
        commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
    }

    // ----------------- Coordinate/Report Mirroring -----------------
    if(!isAllowedChannel){
        const coordMatches = [...content.matchAll(/l\+k:\/\/coordinates?\?[\d,&]+/gi)];
        const reportMatches = [...content.matchAll(/l\+k:\/\/report\?[\d,&]+/gi)];

        if(coordMatches.length>0 || reportMatches.length>0){
            const coordLinks = coordMatches.map(m => {
                const code = m[0].split("?")[1];
                return `[Click to view coordinates](${REDIRECT_DOMAIN}/api/coord?code=${encodeURIComponent(code)})`;
            });

            const reportLinks = reportMatches.map(m => {
                const code = m[0].split("?")[1];
                return `[Click to view report](${REDIRECT_DOMAIN}/api/report?code=${encodeURIComponent(code)})`;
            });

            const mirroredLinks = [...coordLinks, ...reportLinks].join("\n");
            const mirroredMessage = `**${message.author.username}:**\n${mirroredLinks}`;

            try { await message.channel.send(mirroredMessage); } catch(err) { console.error(err); }
            try { await message.delete(); } catch(err) { console.error(err); }
            return;
        }
    }

    // ----------------- Add new bridges -----------------
    const blocks = content.split(/\n\s*\n/);
    let bridgesAdded=0;
    for(const block of blocks){
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if(!bridgeMatch) continue;
        const link=bridgeMatch[0];
        const code=link.split("?")[1];
        if(!code) continue;
        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;
        if(bridgeList.some(entry=>entry.bridgeLink?.includes(code))) continue;
        const structureLine=block.split("\n").find(line=>line.includes(":"));
        const displayName = structureLine?structureLine.split(":").map(s=>s.trim()).join("/"):"Unknown Structure";
        bridgeList.push({bridgeLink:link,vercelLink,bridge:link,vercel:vercelLink,name:displayName,color:""});
        bridgesAdded++;
    }
    if(bridgesAdded>0){
        commandLog[userId].push({command:`Added ${bridgesAdded} bridge${bridgesAdded>1?"s":""}`,timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
    }

    saveBridgeList();
    if(isAllowedChannel) await updateBridgeListMessage(message.channel);

    // ----------------- Delete user message in allowed channel -----------------
    if(isAllowedChannel){
        try{await message.delete()}catch{}
    }
});

// ----------------- LOGIN -----------------
client.login(process.env.BOT_TOKEN);
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
    if (channel.id !== ALLOWED_CHANNEL_ID) return;
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !lastListMessages.some(l => l.id === m.id));

        const batchSize = 50;
        const deleteChunks = [];
        let batch = [];

        for (const msg of toDelete.values()) {
            batch.push(msg);
            if (batch.length >= batchSize) {
                deleteChunks.push(batch);
                batch = [];
            }
        }
        if (batch.length) deleteChunks.push(batch);

        for (const chunk of deleteChunks) {
            await channel.bulkDelete(chunk, true);
            await new Promise(res => setTimeout(res, 500));
        }
    } catch (err) { console.error("❌ Error cleaning channel:", err); }
}

async function updateBridgeListMessage(channel) {
    if (channel.id !== ALLOWED_CHANNEL_ID) return;

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

    await cleanChannel(channel);
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
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

    const now = Date.now();
    const userId = message.author.id;
    if (!commandLog[userId]) commandLog[userId] = [];

    const content = message.content.trim();
    const isAllowedChannel = message.channel.id === ALLOWED_CHANNEL_ID;

    // ----------------- Commands -----------------
    if (content.startsWith("!")) {
        const [cmd, ...args] = content.split(" ");

        if (["red","yellow","green"].includes(cmd.slice(1).toLowerCase())) {
            const num = parseInt(args[0],10);
            if(num>0 && num<=bridgeList.length){
                const color = cmd.toLowerCase()==="red"?"🔴":cmd.toLowerCase()==="yellow"?"🟡":"🟢";
                bridgeList[num-1].color=color;
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            }
        }

        if(cmd==="!remove"){
            const num = parseInt(args[0],10);
            if(!isNaN(num) && num>=1 && num<=bridgeList.length){
                bridgeList.splice(num-1,1);
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            }
        }

        if(cmd==="!clearlist"){
            bridgeList = [];
            saveBridgeList();
            if(isAllowedChannel) await updateBridgeListMessage(message.channel);
        }

        if(cmd==="!backups"){
            const files = fs.readdirSync(path.join(__dirname,"data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(__dirname,"data",b)).mtimeMs - fs.statSync(path.join(__dirname,"data",a)).mtimeMs);
            if(files.length===0){try{await message.reply("No backups available.");}catch{};return;}
            const list = files.map((f,i)=>{
                const data = JSON.parse(fs.readFileSync(path.join(__dirname,"data",f),"utf8"));
                const timestamp = parseInt(f.match(/bridgeList-(\d+)\.json/)[1],10);
                const date = new Date(timestamp);
                const formatted = `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()} ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}:${date.getSeconds().toString().padStart(2,'0')}`;
                return `[${i+1}] ${formatted} (${data.length} bridges)`;
            });
            const chunks = splitMessage(list);
            for(const chunk of chunks){try{await message.author.send(chunk);}catch{}}
            try{const reply = await message.reply("✅ Backup list sent via DM!"); setTimeout(async()=>{try{await reply.delete()}catch{}},5000);}catch{}
        }

        if(cmd==="!restore"){
            const arg = parseInt(args[0]);
            if(isNaN(arg)||arg<1) return;
            const files = fs.readdirSync(path.join(__dirname,"data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(__dirname,"data",b)).mtimeMs - fs.statSync(path.join(__dirname,"data",a)).mtimeMs);
            if(arg>files.length) return;
            const chosenFile = files[arg-1];
            try {
                const data = JSON.parse(fs.readFileSync(path.join(__dirname,"data",chosenFile),"utf8"));
                bridgeList = data;
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            } catch(err){console.error(err);}
        }

        if(cmd==="!listme"){
            if(bridgeList.length===0){try{await message.author.send("Bridge list is empty");}catch{};return;}
            const entries = bridgeList.map(b=>`${b.color}${b.name}\n${b.bridge}`);
            const chunks = splitMessage(entries);
            for(const chunk of chunks){try{await message.author.send(chunk);}catch{}}
        }

        commandLog[userId].push({command:content,timestamp:now});
        commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
    }

    // ----------------- Coordinate/Report Mirroring -----------------
    if(!isAllowedChannel){
        const coordMatches = [...content.matchAll(/l\+k:\/\/coordinates?\?[\d,&]+/gi)];
        const reportMatches = [...content.matchAll(/l\+k:\/\/report\?[\d,&]+/gi)];

        if(coordMatches.length>0 || reportMatches.length>0){
            let mirrored="";
            if(coordMatches.length>0){
                mirrored += coordMatches.map(m=>{
                    const code = m[0].split("?")[1];
                    return `[Click to view coordinates](${REDIRECT_DOMAIN}/api/coord?code=${encodeURIComponent(code)})`;
                }).join("\n");
            }
            if(reportMatches.length>0){
                mirrored += reportMatches.map(m=>{
                    const code = m[0].split("?")[1];
                    return `[Click to view report](${REDIRECT_DOMAIN}/api/report?code=${encodeURIComponent(code)})`;
                }).join("\n");
            }
            try{await message.channel.send(`**${message.author.username}:**\n${content}\n\n${mirrored}`);}catch{}
            try{await message.delete()}catch{}
            return;
        }
    }

    // ----------------- Add new bridges -----------------
    const blocks = content.split(/\n\s*\n/);
    let bridgesAdded=0;
    for(const block of blocks){
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if(!bridgeMatch) continue;
        const link=bridgeMatch[0];
        const code=link.split("?")[1];
        if(!code) continue;
        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;
        if(bridgeList.some(entry=>entry.bridgeLink?.includes(code))) continue;
        const structureLine=block.split("\n").find(line=>line.includes(":"));
        const displayName = structureLine?structureLine.split(":").map(s=>s.trim()).join("/"):"Unknown Structure";
        bridgeList.push({bridgeLink:link,vercelLink,bridge:link,vercel:vercelLink,name:displayName,color:""});
        bridgesAdded++;
    }
    if(bridgesAdded>0){
        commandLog[userId].push({command:`Added ${bridgesAdded} bridge${bridgesAdded>1?"s":""}`,timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
    }

    saveBridgeList();
    if(isAllowedChannel) await updateBridgeListMessage(message.channel);

    // ----------------- Delete user message in allowed channel -----------------
    if(isAllowedChannel){
        try{await message.delete()}catch{}
    }
});

// ----------------- LOGIN -----------------
client.login(process.env.BOT_TOKEN);

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
    if (channel.id !== ALLOWED_CHANNEL_ID) return; // only allowed channel
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !lastListMessages.some(l => l.id === m.id));
        if (toDelete.size > 0) await channel.bulkDelete(toDelete, true);
    } catch (err) { console.error("❌ Error cleaning channel:", err); }
}

async function updateBridgeListMessage(channel) {
    if (channel.id !== ALLOWED_CHANNEL_ID) return; // only allowed channel

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

    await cleanChannel(channel);
}

// ----------------- BOT READY -----------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
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

    const now = Date.now();
    const userId = message.author.id;
    if (!commandLog[userId]) commandLog[userId] = [];

    // ----------------- Commands -----------------
    const content = message.content.trim();
    const isAllowedChannel = message.channel.id === ALLOWED_CHANNEL_ID;

    // Commands only process if prefix
    if (content.startsWith("!")) {
        const [cmd, ...args] = content.split(" ");

        if (["red","yellow","green"].includes(cmd.slice(1).toLowerCase())) {
            const num = parseInt(args[0],10);
            if(num>0 && num<=bridgeList.length){
                const color = cmd.toLowerCase()==="red"?"🔴":cmd.toLowerCase()==="yellow"?"🟡":"🟢";
                bridgeList[num-1].color=color;
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            }
        }

        if(cmd==="!remove"){
            const num = parseInt(args[0],10);
            if(!isNaN(num) && num>=1 && num<=bridgeList.length){
                bridgeList.splice(num-1,1);
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            }
        }

        if(cmd==="!clearlist"){
            bridgeList = [];
            saveBridgeList();
            if(isAllowedChannel) await updateBridgeListMessage(message.channel);
        }

        if(cmd==="!backups"){
            const files = fs.readdirSync(path.join(__dirname,"data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(__dirname,"data",b)).mtimeMs - fs.statSync(path.join(__dirname,"data",a)).mtimeMs);
            if(files.length===0){try{await message.reply("No backups available.");}catch{};return;}
            const list = files.map((f,i)=>{
                const data = JSON.parse(fs.readFileSync(path.join(__dirname,"data",f),"utf8"));
                const timestamp = parseInt(f.match(/bridgeList-(\d+)\.json/)[1],10);
                const date = new Date(timestamp);
                const formatted = `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()} ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}:${date.getSeconds().toString().padStart(2,'0')}`;
                return `[${i+1}] ${formatted} (${data.length} bridges)`;
            });
            const chunks = splitMessage(list);
            for(const chunk of chunks){try{await message.author.send(chunk);}catch{}}
            try{const reply = await message.reply("✅ Backup list sent via DM!"); setTimeout(async()=>{try{await reply.delete()}catch{}},5000);}catch{}
        }

        if(cmd==="!restore"){
            const arg = parseInt(args[0]);
            if(isNaN(arg)||arg<1) return;
            const files = fs.readdirSync(path.join(__dirname,"data"))
                .filter(f => f.startsWith("bridgeList-"))
                .sort((a,b) => fs.statSync(path.join(__dirname,"data",b)).mtimeMs - fs.statSync(path.join(__dirname,"data",a)).mtimeMs);
            if(arg>files.length) return;
            const chosenFile = files[arg-1];
            try {
                const data = JSON.parse(fs.readFileSync(path.join(__dirname,"data",chosenFile),"utf8"));
                bridgeList = data;
                saveBridgeList();
                if(isAllowedChannel) await updateBridgeListMessage(message.channel);
            } catch(err){console.error(err);}
        }

        if(cmd==="!listme"){
            if(bridgeList.length===0){try{await message.author.send("Bridge list is empty");}catch{};return;}
            const entries = bridgeList.map(b=>`${b.color}${b.name}\n${b.bridge}`);
            const chunks = splitMessage(entries);
            for(const chunk of chunks){try{await message.author.send(chunk);}catch{}}
        }

        commandLog[userId].push({command:content,timestamp:now});
        commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
    }

    // ----------------- Mirror coordinates/reports -----------------
    if(!isAllowedChannel){
        const coordMatches = [...content.matchAll(/l\+k:\/\/coordinates?\?[\d,&]+/gi)];
        const reportMatches = [...content.matchAll(/l\+k:\/\/report\?[\d,&]+/gi)];

        if(coordMatches.length>0 || reportMatches.length>0){
            let mirrored="";
            if(coordMatches.length>0){
                mirrored += coordMatches.map(m=>{
                    const code = m[0].split("?")[1];
                    return `[Click to view coordinates](${REDIRECT_DOMAIN}/api/coord?code=${encodeURIComponent(code)})`;
                }).join("\n");
            }
            if(reportMatches.length>0){
                mirrored += reportMatches.map(m=>{
                    const code = m[0].split("?")[1];
                    return `[Click to view report](${REDIRECT_DOMAIN}/api/report?code=${encodeURIComponent(code)})`;
                }).join("\n");
            }
            try{await message.channel.send(`**${message.author.username}:**\n${content}\n\n${mirrored}`);}catch{}
            try{await message.delete()}catch{}
            return;
        }
    }

    // ----------------- Add new bridges from any channel -----------------
    const blocks = content.split(/\n\s*\n/);
    let bridgesAdded=0;
    for(const block of blocks){
        const bridgeMatch = block.match(/l\+k:\/\/bridge\?[^\s]+/i);
        if(!bridgeMatch) continue;
        const link=bridgeMatch[0];
        const code=link.split("?")[1];
        if(!code) continue;
        const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;
        if(bridgeList.some(entry=>entry.bridgeLink?.includes(code))) continue;
        const structureLine=block.split("\n").find(line=>line.includes(":"));
        const displayName = structureLine?structureLine.split(":").map(s=>s.trim()).join("/"):"Unknown Structure";
        bridgeList.push({bridgeLink:link,vercelLink,bridge:link,vercel:vercelLink,name:displayName,color:""});
        bridgesAdded++;
    }
    if(bridgesAdded>0){
        commandLog[userId].push({command:`Added ${bridgesAdded} bridge${bridgesAdded>1?"s":""}`,timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
    }

    saveBridgeList();
    if(isAllowedChannel) await updateBridgeListMessage(message.channel);

    // ----------------- Delete user message if in allowed channel -----------------
    if(isAllowedChannel){
        try{await message.delete()}catch{}
    }
});

// ----------------- LOGIN -----------------
client.login(process.env.BOT_TOKEN);
