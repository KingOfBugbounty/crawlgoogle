# CrawlGoogle

<div align="center">

![CrawlGoogle Logo](icons/icon128.png)

**Chrome Extension to Extract Domains from Google Search Results**

[![Author](https://img.shields.io/badge/Author-ofjaaah-blue)](https://github.com/KingOfBugbounty)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-yellow.svg)](https://developer.chrome.com/docs/extensions/)

</div>

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CrawlGoogle Workflow                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐    ┌──────────────────┐    ┌──────────────────────────┐  │
│   │              │    │                  │    │                          │  │
│   │   GOOGLE     │───▶│  CRAWLGOOGLE     │───▶│     YOUR VPS SERVER      │  │
│   │   SEARCH     │    │  EXTENSION       │    │                          │  │
│   │              │    │                  │    │   python3 server.py      │  │
│   └──────────────┘    └──────────────────┘    └──────────────────────────┘  │
│         │                     │                          │                  │
│         │                     │                          │                  │
│         ▼                     ▼                          ▼                  │
│   ┌──────────────┐    ┌──────────────────┐    ┌──────────────────────────┐  │
│   │ Search for:  │    │ Auto-extracts:   │    │ Saves to file:           │  │
│   │              │    │                  │    │                          │  │
│   │ bug bounty   │    │ • example.com    │    │ domains_collected.txt    │  │
│   │ programs     │    │ • target.org     │    │                          │  │
│   │ vulnerability│    │ • company.io     │    │ Ready for scanning!      │  │
│   │ disclosure   │    │ • ...            │    │                          │  │
│   └──────────────┘    └──────────────────┘    └──────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Features

- **Auto-Extract Mode** - Automatically collects domains while you browse Google
- **Auto-Pagination** - Navigate through multiple Google pages automatically
- **Real-time Sync** - Sends domains to your VPS instantly
- **Full URL or Domain** - Choose to collect full URLs or just domains
- **Duplicate Prevention** - Smart filtering removes duplicates
- **Visual Statistics** - Track collected and sent domains
- **Offline Queue** - Queues domains when VPS is unreachable

---

## Installation

### Step 1: Set Up the Server (VPS)

```bash
# Clone the repository
git clone https://github.com/KingOfBugbounty/crawlgoogle.git
cd crawlgoogle

# Start the server
python3 server.py --port 9876

# Or with HTTPS
python3 server.py --port 9876 --https
```

**Quick VPS Setup:**
```bash
# Run the automated setup script
chmod +x setup_vps.sh
./setup_vps.sh 9876
```

### Step 2: Install the Chrome Extension

**Option A: From ZIP file**
1. Download `crawlgoogle-extension.zip`
2. Extract the ZIP file
3. Open Chrome → `chrome://extensions/`
4. Enable **Developer mode** (toggle in top right)
5. Click **Load unpacked**
6. Select the extracted folder

**Option B: From source**
1. Clone this repository
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the repository folder

### Step 3: Configure the Extension

1. Click the CrawlGoogle icon in Chrome toolbar
2. Enter your **VPS IP address**
3. Enter the **Port** (default: 9876)
4. Click **Save & Start Collecting**

---

## Usage

### Basic Collection

1. Go to [Google](https://www.google.com)
2. Search for anything (e.g., `bug bounty programs`)
3. The extension automatically extracts domains from results
4. Domains are sent to your VPS in real-time

### Auto-Pagination

1. Configure max pages and delay in the extension
2. Click **Start Pagination**
3. The extension will automatically navigate through Google pages
4. Collecting domains from each page

### Collection Modes

| Mode | Description |
|------|-------------|
| **Domain only** | Extracts just the domain (e.g., `example.com`) |
| **Full URL** | Extracts complete URLs (e.g., `https://example.com/page`) |

---

## Server API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ping` | GET | Health check |
| `/domains` | GET | List all collected domains |
| `/domains` | POST | Add new domains |
| `/stats` | GET | Get statistics |
| `/export` | GET | Download domains as file |
| `/clear` | POST | Clear all domains |

### Server Options

```bash
python3 server.py --help

Options:
  -p, --port PORT      Port to listen on (default: 9876)
  -o, --output FILE    Output file path
  -b, --bind ADDR      Address to bind (default: 0.0.0.0)
  --https              Enable HTTPS mode
```

---

## Google Dork Examples

Use these dorks to find bug bounty targets:

```
# Bug bounty programs
"bug bounty" OR "vulnerability disclosure" OR "responsible disclosure"

# Specific program types
site:hackerone.com inurl:programs
site:bugcrowd.com inurl:programs
"submit vulnerability" OR "report security issue"

# Technology-specific
inurl:api site:*.io
filetype:js "api_key"
```

---

## File Structure

```
crawlgoogle/
├── manifest.json           # Extension manifest
├── popup.html              # Extension popup UI
├── popup.js                # Popup logic
├── background.js           # Service worker
├── content.js              # Domain extraction
├── styles.css              # Styling
├── server.py               # VPS server
├── setup_vps.sh            # VPS setup script
├── install_vps.sh          # Dependency installer
├── crawlgoogle-extension.zip  # Ready-to-install extension
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Tips

1. **Use specific dorks** - More targeted searches yield better results
2. **Enable auto-pagination** - Collect from multiple pages automatically
3. **Monitor the popup** - Check statistics for collection progress
4. **Run server in background** - Use `screen` or `tmux` on your VPS

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Extension not connecting | Check VPS IP, port, and firewall |
| No domains extracted | Ensure you're on a Google search page |
| HTTPS errors | Try HTTP mode first, or use `setup_vps.sh` to generate certificates |

---

## Author

**ofjaaah**

---

## Disclaimer

This tool is intended for **authorized security testing only**. Always obtain proper authorization before testing any systems. The author is not responsible for misuse of this tool.

---

## License

MIT License - See [LICENSE](LICENSE) for details.
