const { Client, GatewayIntentBits } = require("discord.js");

// Just store your channel ID directly here as a string
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Replace with your actual numeric channel ID

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const linkPattern = /(l\+k:\/\/[^\s]+)/gi;
    const matches = message.content.match(linkPattern);

    if (matches) {
        matches.forEach(link => {
            message.reply(`Here’s your clickable link: ${link}`);
        });
    }
});

client.login(process.env.DISCORD_TOKEN);
