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

client.once("ready", () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", (message) => {
    if (message.author.bot) return; // ignore bot messages
    if (message.channel.id !== ALLOWED_CHANNEL_ID) return; // ignore other channels

    const linkPattern = /(l\+k:\/\/[^\s]+)/gi;
    const matches = message.content.match(linkPattern);

    if (matches) {
        matches.forEach(link => {
            // Extract the code after "?"
            const code = link.split("?")[1];
            if (!code) return;

            // Generate clickable Vercel redirect link
            const redirectLink = `${REDIRECT_DOMAIN}/api/bridge?code=${encodeURIComponent(code)}`;

            // Reply in Discord with the clickable link
            message.reply(`Here’s your clickable link: ${redirectLink}`);
        });
    }
});

// Login using your bot token from Heroku config vars
client.login(process.env.DISCORD_TOKEN);
