const { Client, GatewayIntentBits, Partials } = require('discord.js');
require('dotenv').config();

const TOKEN = process.env.BOT_TOKEN;
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

let bridges = [];
let lastListMessageId = null; // store the ID of the last posted list

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Add bridge from message
    if (message.content.includes("l+k://bridge?")) {
        message.delete().catch(() => {});

        const castleMatch = message.content.match(/Castle:\s(.+?)\n/i);
        const bridgeMatch = message.content.match(/(l\+k:\/\/bridge\?[^\s]+)/i);

        if (castleMatch && bridgeMatch) {
            const name = castleMatch[1].trim();
            const bridgeUrl = bridgeMatch[1].trim();
            const shortVercel = `https://lnk-redirect.vercel.app//api/bridge?${encodeURIComponent(bridgeUrl.split("?")[1])}`;

            bridges.push({
                emoji: '',
                name,
                bridgeUrl,
                vercel: shortVercel
            });

            await updateList(message.channel);
        }
    }

    // Assign colors
    if (message.content.startsWith('!green') || message.content.startsWith('!yellow') || message.content.startsWith('!red')) {
        const parts = message.content.split(' ');
        const cmd = parts[0];
        const index = parseInt(parts[1]) - 1;

        if (!isNaN(index) && bridges[index]) {
            const colorMap = {
                '!green': '🟢',
                '!yellow': '🟡',
                '!red': '🔴'
            };
            bridges[index].emoji = colorMap[cmd];
            await updateList(message.channel);
        }
    }

    // Clear bridge(s)
    if (message.content.startsWith('!clear')) {
        const arg = message.content.split(' ')[1];

        if (arg && arg.toLowerCase() === 'all') {
            bridges = []; // wipe the list
            await updateList(message.channel);
        } else {
            const index = parseInt(arg) - 1;
            if (!isNaN(index) && bridges[index]) {
                bridges.splice(index, 1);
                await updateList(message.channel);
            }
        }
    }

    // PM list
    if (message.content.startsWith('!listme')) {
        let range = message.content.replace('!listme', '').trim();
        let listItems = [];

        if (range.toLowerCase() === 'all') {
            listItems = bridges;
        } else if (range.includes('-')) {
            const [start, end] = range.split('-').map(n => parseInt(n));
            listItems = bridges.slice(start - 1, end);
        } else {
            const index = parseInt(range) - 1;
            if (!isNaN(index) && bridges[index]) {
                listItems = [bridges[index]];
            }
        }

        if (listItems.length > 0) {
            const pmList = listItems.map(b =>
                `${b.emoji}${b.name}\n${b.bridgeUrl}`
            ).join('\n\n');

            try {
                await message.author.send(pmList);
            } catch (err) {
                console.error('❌ Could not DM user:', err);
            }
        }
    }
});

async function updateList(channel) {
    const listMsg = bridges.length > 0
        ? bridges.map((b, i) =>
            `${i + 1}. ${b.emoji}${b.name}\n${b.bridgeUrl}\n[LNK](${b.vercel})`
        ).join('\n\n')
        : '*No bridges available*';

    if (lastListMessageId) {
        try {
            const prevMessage = await channel.messages.fetch(lastListMessageId);
            await prevMessage.edit(listMsg);
            return;
        } catch {
            // If message no longer exists, just send a new one
        }
    }

    const sentMessage = await channel.send(listMsg);
    lastListMessageId = sentMessage.id;
}

client.login(TOKEN);
