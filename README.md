# Document Time Tracker

A lightweight browser extension that tracks active time spent in documents and tabs (Google Docs, Microsoft Word Online, etc.). Data is stored locally in your browser for 60+ days.

## Features

- Real-time tracking of active document time
- Local data storage with 60-day retention
- Popup view for quick stats
- Full-featured analytics dashboard
- Filter by time period (Today, Week, Month, All Time)
- Sort by time, recency, or alphabetically
- Export data as JSON
- Works in both Chrome and Firefox

## Installation

### Chrome

1. Download and extract the extension folder
2. Open `chrome://extensions` in your browser
3. Enable "Developer Mode" (top right)
4. Click "Load unpacked"
5. Select the extension folder

### Firefox

1. Download and extract the extension folder
2. Open `about:debugging` in your browser
3. Click "This Firefox"
4. Click "Load Temporary Add-on"
5. Select the `manifest.json` file from the extension folder

## How It Works

- The extension tracks active time only when your browser tab is visible and focused
- Time is not counted for background tabs or minimized windows
- All data is stored locally in IndexedDB (no cloud sync)
- Documents are identified by their URL or document ID
- Data is automatically cleaned up after 60 days

## Files Structure

```
doc-time-tracker/
├── manifest.json          # Extension configuration
├── background.js          # Background service worker
├── content.js             # Content script for tracking
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.js           # Popup logic
│   └── popup.css          # Popup styles
├── dashboard/
│   ├── index.html         # Dashboard UI
│   ├── app.js             # Dashboard logic
│   └── styles.css         # Dashboard styles
└── db/
    └── indexedDb.js       # IndexedDB management
```

## Troubleshooting

**Extension not tracking time?**
- Make sure the tab is visible and the window is focused
- Check that the extension is enabled in your browser settings

**No data showing in dashboard?**
- Refresh the dashboard (use the Refresh button)
- Make sure you've spent active time in the current time period

**Data not persisting?**
- Check browser settings for IndexedDB storage permissions
- Some privacy modes may not allow data persistence

## Privacy

- All data is stored locally in your browser
- No data is sent to any server
- No user accounts or cloud sync
- Data is only deleted after 60 days or manually via browser storage reset

## License

Open source. Use freely.
