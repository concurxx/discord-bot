# Google Drive Setup for Bot Data Persistence

This guide will help you set up Google Drive integration to persist user data through Heroku reboots.

## Step 1: Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Drive API"
   - Click on it and press "Enable"

## Step 2: Create a Service Account

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Give it a name like "discord-bot-drive-access"
4. Click "Create and Continue"
5. Skip the optional steps and click "Done"

## Step 3: Generate Service Account Key

1. Click on the service account you just created
2. Go to the "Keys" tab
3. Click "Add Key" > "Create New Key"
4. Choose "JSON" format and click "Create"
5. A JSON file will be downloaded - keep this safe!

## Step 4: Create Google Drive File

1. Go to [Google Drive](https://drive.google.com)
2. Create a new file (you can upload an empty text file or create a Google Doc)
3. Rename it to something like "discord-bot-userdata"
4. Right-click the file and select "Share"
5. Add the service account email (found in the JSON file as "client_email") with "Editor" permissions
6. Copy the file ID from the URL (the long string after `/d/` and before `/edit`)

## Step 5: Set Up Heroku Environment Variables

1. Go to your Heroku app dashboard
2. Go to "Settings" > "Config Vars"
3. Add these two environment variables:

### GOOGLE_DRIVE_FILE_ID
- **Key:** `GOOGLE_DRIVE_FILE_ID`
- **Value:** The file ID you copied from the Google Drive URL

### GOOGLE_SERVICE_ACCOUNT_KEY
- **Key:** `GOOGLE_SERVICE_ACCOUNT_KEY`
- **Value:** Base64 encoded version of your service account JSON

To get the base64 encoded value:

**On Windows (PowerShell):**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\your\service-account-key.json"))
```

**On Mac/Linux:**
```bash
base64 -i path/to/your/service-account-key.json
```

**Online (if you trust the site):**
You can also use an online base64 encoder, but be cautious with sensitive data.

## Step 6: Deploy and Test

1. Deploy your bot to Heroku with the new environment variables
2. Test the new commands:
   - `!troops 40000` - Should set your troop count
   - `!silver 1 city` - Should set your silver capacity
   - `!mystats` - Should show your current stats
   - `!allstats` - Should show all users' stats

## Verification

- Check your Heroku logs to see if Google Drive initialization was successful
- Look for messages like "✅ Google Drive initialized successfully"
- If you see "⚠️ Google Drive not configured", double-check your environment variables

## Troubleshooting

**"Failed to initialize Google Drive" error:**
- Verify the service account JSON is correctly base64 encoded
- Make sure the Google Drive API is enabled in your Google Cloud project
- Check that the service account has access to the Google Drive file

**"Failed to backup to Google Drive" error:**
- Verify the file ID is correct
- Make sure the service account has "Editor" permissions on the file
- Check that the file exists and hasn't been deleted

## Security Notes

- Never commit the service account JSON file to your repository
- The base64 encoded key in Heroku environment variables is safe
- Only share the Google Drive file with the service account, not with public access
- Regularly rotate your service account keys if needed

## How It Works

- User data is stored locally in `data/userData.json`
- Every time user data is updated, it's automatically backed up to Google Drive
- When the bot starts up, it checks Google Drive for newer data and merges it with local data
- This ensures data persistence even when Heroku restarts your dyno