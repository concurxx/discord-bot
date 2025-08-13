const { Client, GatewayIntentBits } = require("discord.js");

// Discord channel ID where the bot listens
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Replace with your actual numeric channel ID

// Vercel redirect domain (serverless function)
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app/";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// List to store bridge entries
let bridgeList = [];
let lastListMessage = null;

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== 1404945236433830049) return;

    // Admin commands
    if (message.content.startsWith("!remove")) {
        if (!message.member.permissions.has("ADMINISTRATOR")) return;

        const parts = message.content.split(" ");
        const num = parseInt(parts[1]);
        if (isNaN(num) || num < 1 || num > bridgeList.length) return;

        bridgeList.splice(num - 1, 1);
        if (lastListMessage) await lastListMessage.delete();

        const formattedList = bridgeList
            .map((entry, idx) => `${idx + 1}. ${entry.display}`)
            .join("\n");

        lastListMessage = await message.channel.send(`**Bridge List:**\n${formattedList}`);
        return;
    }

    if (message.content === "!clear") {
        if (!message.member.permissions.has("ADMINISTRATOR")) return;

        bridgeList = [];
        if (lastListMessage) await lastListMessage.delete();
        lastListMessage = await message.channel.send("**Bridge List cleared.**");
        return;
    }

    // Detect bridge links in the message
    const bridgePattern = /(l\+k:\/\/bridge\?[^\s]+)/gi;
    const matches = message.content.match(bridgePattern);

    if (matches) {
        // Extract first line for structure name/type
        const firstLine = message.content.split("\n")[0];
        let displayName = firstLine.trim();
        if (!displayName.includes(":")) displayName = "Unknown Structure";
        // Example: "Castle: Fons 21" → "Castle/Fons 21"
        else displayName = firstLine.split(":").map(s => s.trim()).join("/");

        for (const link of matches) {
            const code = link.split("?")[1];
            if (!code) continue;

            // Vercel clickable link
            const vercelLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

            // Add to bridge list
            bridgeList.push({
                bridgeLink: link,
                vercelLink,
                display: `${displayName}\n${link}\n${vercelLink}`
            });
        }

        // Delete previous list message if exists
        if (lastListMessage) {
            try { await lastListMessage.delete(); } 
            catch (err) { console.log("Could not delete previous list message:", err); }
        }

        // Build numbered list
        const formattedList = bridgeList
            .map((entry, idx) => `${idx + 1}. ${entry.display}`)
            .join("\n\n"); // extra newline between entries

        lastListMessage = await message.channel.send(`**Bridge List:**\n${formattedList}`);
    }
});

// Login using your bot token from Heroku config vars
client.login(process.env.DISCORD_TOKEN);
