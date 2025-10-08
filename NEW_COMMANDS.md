# New Bot Commands - User Data Tracking

Your bot now has the ability to track and store user information that persists through Heroku reboots!

## New Commands

### Data Entry Commands
- **`!troops <number>`** - Set/update your troop count
  - Example: `!troops 40000` sets your troops to 40,000
  - Overwrites your previous troop count

- **`!silver <number> city`** - Set/update your silver capacity
  - Example: `!silver 1 city` sets your silver capacity to 1 city
  - Example: `!silver 5 city` sets your silver capacity to 5 cities
  - Overwrites your previous silver capacity

### Data Viewing Commands
- **`!mystats`** - View your current stats (sent via DM when possible)
  - Shows your troops, silver capacity, and last update time

- **`!allstats`** - View all users' stats (sent via DM when possible)
  - Shows everyone's data in a formatted list
  - Sorted by most recently updated

### Help Command
- **`!help`** or **`!commands`** - Shows all available commands
  - Includes both new user data commands and existing bridge commands

## Features

### Data Persistence
- All user data is automatically saved to Google Drive
- Data survives Heroku dyno restarts and reboots
- Local and cloud data are automatically synchronized

### User-Specific Storage
- Each user's data is stored by their Discord user ID
- Username is updated automatically if changed
- Data includes timestamps for tracking when it was last updated

### Automatic Overwrites
- New entries automatically replace old ones for the same user
- Keeps a running log of current status for each user
- No duplicate entries - always shows the latest information

## Data Format

Each user's data includes:
- **Username**: Current Discord username
- **Troops**: Last reported troop count (or "Not set")
- **Silver**: Last reported silver capacity (or "Not set") 
- **Last Updated**: Timestamp of when data was last modified

## Examples

```
User: !troops 45000
Bot: ✅ Updated your troop count to 45,000

User: !silver 2 city  
Bot: ✅ Updated your silver capacity to 2 city

User: !mystats
Bot: ✅ Your stats have been sent via DM!

DM Content:
**YourUsername**
🏰 Troops: 45,000
💰 Silver: 2 city
📅 Last updated: 2 minutes ago
```

## Setup Required

To enable Google Drive persistence, you need to:
1. Set up a Google Cloud project with Drive API access
2. Create a service account and get credentials
3. Create a Google Drive file for data storage
4. Set Heroku environment variables

See `GOOGLE_DRIVE_SETUP.md` for detailed instructions.

## Backward Compatibility

All existing bridge list commands continue to work exactly as before:
- Bridge detection and management
- Color coding (!red, !yellow, !green)
- List management (!remove, !clearlist, !listme)
- Backup system (!backups, !restore)
- Command logging (!viewlog)
- Channel cleanup (!cleanup)

The new user data system is completely separate and doesn't interfere with existing functionality.