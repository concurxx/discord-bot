const { Client, GatewayIntentBits, Partials } = require("discord.js");
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;
let bridgeList = [];

// Utility: Send updated list in channel
function sendBridgeList(channel) {
    if (bridgeList.length === 0) {
        channel.send("No bridges in the list.");
        return;
    }

    const listText = bridgeList
        .map(b => `${b.color}Castle/${b.name}\n${b.bridge}\n${b.vercel}`)
        .join("\n\n");

    channel.send(listText);
}

// Utility: Send private list without vercel links
function sendPrivateList(user, start, end) {
    if (bridgeList.length === 0) {
        user.send("No bridges in the list.");
        return;
    }

    let selected;
    if (start === "all") {
        selected = bridgeList;
    } else {
        const s = Math.max(1, parseInt(start));
        const e = Math.min(bridgeList.length, parseInt(end));
        selected = bridgeList.slice(s - 1, e);
    }

    const listText = selected
        .map(b => `${b.color}Castle/${b.name}\n${b.bridge}`)
        .join("\n\n");

    user.send(listText);
}

// Listen for messages
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // Cleanup all non-bot messages in the channel
    if (message.guild) {
        const fetched = await message.channel.messages.fetch({ limit: 50 });
        const toDelete = fetched.filter(m => !m.author.bot);
        if (toDelete.size > 0) {
            message.channel.bulkDelete(toDelete, true);
        }
    }

    const content = message.content.trim();

    // Detect bridge info
    const castleRegex = /Castle:\s*(.+)/g;
    const bridgeRegex = /l\+k:\/\/bridge\?([\d]+)&([\w\d]+)&([\d]+)/g;

    let castleMatches = [...content.matchAll(castleRegex)];
    let bridgeMatches = [...content.matchAll(bridgeRegex)];

    if (castleMatches.length > 0 && bridgeMatches.length > 0) {
        for (let i = 0; i < Math.min(castleMatches.length, bridgeMatches.length); i++) {
            const name = castleMatches[i][1].trim();
            const bridgeRaw = `l+k://bridge?${bridgeMatches[i][1]}&${bridgeMatches[i][2]}&${bridgeMatches[i][3]}`;
            const vercel = `https://lnk-redirect.vercel.app//api/bridge?code=${bridgeMatches[i][1]}%26${bridgeMatches[i][2]}%26${bridgeMatches[i][3]}`;

            bridgeList.push({ color: "🟢", name, bridge: bridgeRaw, vercel });
        }

        sendBridgeList(message.channel);
        return;
    }

    // Sorting commands
    if (content.startsWith("!red")) {
        const num = parseInt(content.split(" ")[1]);
        if (!isNaN(num) && bridgeList[num - 1]) {
            bridgeList[num - 1].color = "🔴";
            sendBridgeList(message.channel);
        }
    }

    if (content.startsWith("!yellow")) {
        const num = parseInt(content.split(" ")[1]);
        if (!isNaN(num) && bridgeList[num - 1]) {
            bridgeList[num - 1].color = "🟡";
            sendBridgeList(message.channel);
        }
    }

    if (content.startsWith("!green")) {
        const num = parseInt(content.split(" ")[1]);
        if (!isNaN(num) && bridgeList[num - 1]) {
            bridgeList[num - 1].color = "🟢";
            sendBridgeList(message.channel);
        }
    }

    // Listme command (PM only, no vercel links)
    if (content.startsWith("!listme")) {
        const args = content.split(" ").slice(1);

        if (args[0] && args[0].toLowerCase() === "all") {
            sendPrivateList(message.author, "all");
        } else if (args.length === 2) {
            sendPrivateList(message.author, args[0], args[1]);
        } else {
            message.author.send("Usage: !listme all  OR  !listme <start> <end>");
        }
    }
});

client.login(TOKEN);
