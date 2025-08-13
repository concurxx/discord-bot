const { Client, GatewayIntentBits } = require("discord.js");

// Put your channel ID as a string
const ALLOWED_CHANNEL_ID = "1404945236433830049"; // Replace with your actual numeric channel ID

// Your redirect domain from Vercel
const REDIRECT_DOMAIN = "https://lnk-redirect.vercel.app";

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
            // Extract the code after the "?"
const code = link.split("?")[1];
const redirectLink = `${REDIRECT_DOMAIN}/bridge?code=${encodeURIComponent(code)}`;
message.reply(`Here’s your clickable link: ${redirectLink}`);


            // Reply with the clickable link
            message.reply(`Here’s your clickable link: ${redirectLink}`);
        });
    }
});

client.login(process.env.DISCORD_TOKEN);

