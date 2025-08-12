// bot.js
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const ALLOWED_CHANNEL_ID = 'YOUR_CHANNEL_ID_HERE'; // Change to your #lords-knights-links channel ID

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`✅ Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const lkRegex = /(l\+k:\/\/[^\s]+)/gi;
    const matches = message.content.match(lkRegex);

    if (matches && matches.length > 0) {
        // Create embed with all links in one message
        let description = matches.map(link => `[Click here to open](${link})`).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('Lords & Knights Links')
            .setDescription(description)
            .setColor(0x00AE86)
            .setFooter({ text: `Posted by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() });

        await message.channel.send({ embeds: [embed] });

        try {
            await message.delete();
        } catch (err) {
            console.warn(`⚠️ Could not delete message from ${message.author.tag}. Check bot permissions.`);
        }
    }
});

client.login(process.env.BOT_TOKEN);
