# Lords & Knights Clickable Link Bot

A simple Discord bot that takes `l+k://` links from Lords & Knights and reposts them as clickable embeds in a specific channel.

## Features
- Only responds in one allowed channel
- Combines multiple links into a single embed
- Deletes the original unclickable message
- Works with castle, bridge, coordinates, and other L&K links

---

## Deploy to Heroku

Click the button below to deploy this bot to Heroku:

[![Deploy](https://www.heroku.com/deploy?template=https://github.com/concurxx/discord-bot)](https://www.heroku.com/deploy?template=https://github.com/concurxx/discord-bot)

When prompted on Heroku:
- **BOT_TOKEN** → Your bot token from the Discord Developer Portal
- **ALLOWED_CHANNEL_ID** → The channel ID for `1404945236433830049`

---

## Local Development

1. Clone this repo or unzip the files into a folder.
2. Create `.env`:
    ```
    BOT_TOKEN=MTQwNDkwNjM4NDU2NjM4NjczOA.GICMjg.ctFHKawXUlrEFANAMSqtZq0aRpHiFJ4wUmp1XA
    ALLOWED_CHANNEL_ID=1404945236433830049
    ```
3. Install dependencies:
    ```bash
    npm install
    ```
4. Start the bot:
    ```bash
    node bot.js
    ```

---

## Permissions Needed
When inviting your bot to Discord, make sure it has:
- Read Messages/View Channels
- Send Messages
- Embed Links
- Manage Messages (for deleting the original link)



