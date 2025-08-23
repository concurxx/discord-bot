const { Client, GatewayIntentBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================
const ALLOWED_CHANNEL_ID = "1407022766967881759"; // Replace with your channel ID
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/"; // Replace with your Vercel URL
const DATA_FILE = path.join(__dirname, "data", "bridgeList.json");
const COMMAND_LOG_FILE = path.join(__dirname, "data", "commandLog.json");
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
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(bridgeList, null, 2), "utf8"); }
    catch (err) { console.log("Error saving bridge list:", err); }
}

function saveCommandLog() {
    try { fs.writeFileSync(COMMAND_LOG_FILE, JSON.stringify(commandLog, null, 2), "utf8"); }
    catch (err) { console.error("❌ Error saving command log:", err); }
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
        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(m => !lastListMessages.some(l => l.id === m.id));
        if (toDelete.size > 0) await channel.bulkDelete(toDelete, true);
    } catch (err) { console.error("❌ Error cleaning channel:", err); }
}

async function updateBridgeListMessage(channel) {
    if (bridgeList.length === 0) {
        if (lastListMessages.length > 0) {
            try {
                await lastListMessages[0].edit("Bridge list is currently empty.");
                for (let i = 1; i < lastListMessages.length; i++) try { await lastListMessages[i].delete(); } catch {}
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
            try { await lastListMessages[i].edit(header + chunks[i]); } 
            catch { lastListMessages[i] = await channel.send(header + chunks[i]); }
        }
    } else {
        for (const msg of lastListMessages) try { await msg.delete(); } catch {}
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

    // ✅ Only operate in the allowed channel
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const content = message.content;
    const now = Date.now();
    const userId = message.author.id;
    if (!commandLog[userId]) commandLog[userId] = [];

    // -------- COLOR COMMANDS --------
    if (/^!(red|yellow|green) \d+$/i.test(content)) {
        const [cmd,numStr] = content.split(" ");
        const num = parseInt(numStr,10);
        if(num>0 && num<=bridgeList.length){
            let color = cmd.toLowerCase()==="!red"?"🔴":cmd.toLowerCase()==="!yellow"?"🟡":"🟢";
            bridgeList[num-1].color=color;
            saveBridgeList();
            await updateBridgeListMessage(message.channel);
        }
        commandLog[userId].push({command:content,timestamp:now});
        commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- REMOVE COMMAND --------
    if(content.startsWith("!remove")){
        const num = parseInt(content.split(" ")[1]);
        if(!isNaN(num) && num>=1 && num<=bridgeList.length){
            bridgeList.splice(num-1,1);
            saveBridgeList();
            await updateBridgeListMessage(message.channel);

            commandLog[userId].push({command:content,timestamp:now});
            commandLog[userId] = commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
            saveCommandLog();
        }
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- CLEARLIST COMMAND --------
    if(content === "!clearlist"){
        const count = bridgeList.length;
        bridgeList = [];
        saveBridgeList();
        await updateBridgeListMessage(message.channel);

        commandLog[userId].push({command:`!clearlist (cleared ${count} bridge${count!==1?"s":""})`, timestamp:now});
        commandLog[userId]=commandLog[userId].filter(e=>e.timestamp>now-24*60*60*1000);
        saveCommandLog();

        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- !listme --------
    if(content.startsWith("!listme")){
        if(bridgeList.length===0){try{await message.author.send("Bridge list is empty");}catch{await message.channel.send(`${message.author}, I can't DM you.`)};return;}
        const args = content.split(" ").slice(1);
        let start=0,end=bridgeList.length;
        if(args.length>0 && args[0].toLowerCase()!=="all"){
            const match=args[0].match(/^(\d+)-(\d+)$/);
            if(match){start=Math.max(0,parseInt(match[1],10)-1);end=Math.min(bridgeList.length,parseInt(match[2],10));}
        }
        const entries = bridgeList.slice(start,end).map((b,i)=>`${i+1}. ${b.color}${b.name}\n${b.bridge}`);
        const chunks = splitMessage(entries);
        try{for(let i=0;i<chunks.length;i++){await message.author.send((i===0?"**Your Bridge List:**\n\n":`**Your Bridge List (Part ${i+1}):**\n\n`)+chunks[i]);}
            const reply=await message.reply("✅ Bridge list sent via DM!");setTimeout(async()=>{try{await reply.delete()}catch{}},5000);
        }catch{await message.channel.send(`${message.author}, I can't DM you.`);}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- !viewlog --------
    if(content.startsWith("!viewlog")){
        let allLogs=[];
        for(const uid in commandLog){
            const user = await client.users.fetch(uid).catch(()=>null);
            const username = user?user.tag:uid;
            commandLog[uid].forEach(entry=>allLogs.push(`${username} → <t:${Math.floor(entry.timestamp/1000)}:T> → ${entry.command}`));
        }
        allLogs.sort((a,b)=>parseInt(a.match(/<t:(\d+):T>/)[1])-parseInt(b.match(/<t:(\d+):T>/)[1]));
        if(allLogs.length===0){try{await message.author.send("No commands logged in the last 24 hours");}catch{await message.channel.send(`${message.author}, I can't DM you.`)};return;}
        const chunks = splitMessage(allLogs,1900);
        try{for(let i=0;i<chunks.length;i++){await message.author.send((i===0?"**Command Log (last 24h):**\n\n":`**Command Log (Part ${i+1}):**\n\n`)+chunks[i]);}
            const reply=await message.reply("✅ Command log sent via DM!");setTimeout(async()=>{try{await reply.delete()}catch{}},5000);
        }catch{await message.channel.send(`${message.author}, I can't DM you.`);}
        setTimeout(async()=>{try{await message.delete()}catch{}},3000);
        return;
    }

    // -------- Bridge detection --------
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
    await updateBridgeListMessage(message.channel);
});

// ----------------- LOGIN -----------------
client.login(process.env.DISCORD_TOKEN);