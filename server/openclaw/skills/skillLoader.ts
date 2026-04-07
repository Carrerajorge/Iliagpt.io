import type { OpenClawConfig } from '../config';
import type { Skill } from '../types';
import { skillRegistry } from './skillRegistry';
import { loadSkillsFromFilesystem } from './filesystemSkillLoader';
import { Logger } from '../../lib/logger';

function getBuiltinSkills(): Skill[] {
  return [
    {
      id: 'coding-agent',
      name: 'Coding Agent',
      description: 'Full programming assistant with shell, filesystem, and git capabilities',
      prompt: `You are an expert software engineer. You have access to shell execution (openclaw_exec), file reading (openclaw_read), file writing (openclaw_write), and file editing (openclaw_edit) tools.

When coding:
- Read existing files before modifying them
- Use git for version control when appropriate
- Run tests after making changes
- Handle errors gracefully
- Follow the project's existing code style`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_edit', 'openclaw_list'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'github',
      name: 'GitHub Operations',
      description: 'Create issues, pull requests, review code, manage repos via gh CLI',
      prompt: `You can interact with GitHub using the gh CLI tool via openclaw_exec.

Common operations:
- gh issue create --title "..." --body "..."
- gh pr create --title "..." --body "..."
- gh pr list / gh issue list
- gh repo clone owner/repo
- gh api repos/{owner}/{repo}/issues
- gh pr review --approve
- gh run list / gh run view`,
      tools: ['openclaw_exec', 'openclaw_read'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'data-analysis',
      name: 'Data Analysis',
      description: 'Analyze CSV/JSON data, generate charts and reports',
      prompt: `You are a data analyst. Use Python (via openclaw_exec) to analyze data files.

Approach:
- Read data with pandas
- Perform analysis (describe, groupby, pivot)
- Generate visualizations with matplotlib/seaborn
- Save outputs to workspace
- Use jq for JSON processing
- Generate statistical summaries`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'web-scraper',
      name: 'Web Scraper',
      description: 'Scrape and extract content from websites',
      prompt: `You can scrape web content using curl or Python (requests/beautifulsoup).

Approach:
- Use curl for simple fetches
- Use Python with requests + BeautifulSoup for complex scraping
- Respect robots.txt
- Handle rate limiting
- Extract structured data (tables, lists, links)
- Save results as JSON/CSV`,
      tools: ['openclaw_exec', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'devops',
      name: 'DevOps Assistant',
      description: 'Docker, deployment, CI/CD, infrastructure management',
      prompt: `You are a DevOps engineer. You can manage containers, deployments, and infrastructure.

Tools available:
- docker / docker-compose for containerization
- git for version control
- curl for API calls
- Shell commands for system management

Always be careful with destructive operations.`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_list'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'weather',
      name: 'Weather',
      description: 'Get current weather and forecasts for any location',
      prompt: `Provide weather information using free APIs.

Methods:
- curl "wttr.in/{city}?format=j1" for JSON weather data
- curl "wttr.in/{city}" for formatted weather
- curl "api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true" for Open-Meteo

Always provide temperature, conditions, humidity, and wind speed.`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'summarize',
      name: 'Summarize',
      description: 'Summarize or extract text/transcripts from URLs, podcasts, and local files',
      prompt: `You are a content summarizer. Extract and condense information from various sources.

Approach:
- Use curl to fetch web pages
- Parse HTML to extract main content
- Use youtube-dl or yt-dlp for video transcripts
- Generate concise, structured summaries with key points
- Support bullet-point, paragraph, and executive summary formats
- Handle multiple languages`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'blogwatcher',
      name: 'Blog Watcher',
      description: 'Monitor blogs and RSS/Atom feeds for updates',
      prompt: `Monitor RSS/Atom feeds and blog sources for new content.

Approach:
- Parse RSS/Atom XML feeds with curl + Python/Node
- Track publication dates
- Extract titles, summaries, and links
- Filter by keywords or topics
- Generate digest reports of latest posts`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'gifgrep',
      name: 'GIF Search',
      description: 'Search GIF providers, download results, and extract stills',
      prompt: `Search and download GIFs from the web.

Approach:
- Use Tenor/Giphy public APIs for GIF search
- Download and save GIF files
- Extract frames using ffmpeg
- Generate contact sheets/sprite sheets
- Support keyword and category search`,
      tools: ['openclaw_exec', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'video-frames',
      name: 'Video Frames',
      description: 'Extract frames or short clips from videos using ffmpeg',
      prompt: `Process video files using ffmpeg.

Operations:
- ffmpeg -i input.mp4 -vf "fps=1" frame_%04d.png (extract frames)
- ffmpeg -i input.mp4 -ss 00:01:00 -t 10 clip.mp4 (extract clips)
- ffmpeg -i input.mp4 -vf "scale=640:-1" resized.mp4 (resize)
- ffmpeg -i input.mp4 -vf "select=eq(pict_type\\,I)" -vsync vfr keyframes_%04d.png (keyframes)
- Generate thumbnails, GIFs, and contact sheets`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'nano-pdf',
      name: 'PDF Tools',
      description: 'Edit PDFs with natural-language instructions',
      prompt: `Work with PDF files using command-line tools.

Operations:
- Extract text: pdftotext, python with PyPDF2/pdfplumber
- Split pages: pdftk or qpdf
- Merge documents: pdftk cat
- Fill form fields
- Convert to/from other formats
- OCR with tesseract for scanned PDFs`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'session-logs',
      name: 'Session Logs',
      description: 'Search and analyze session logs using jq',
      prompt: `Analyze session and application logs.

Approach:
- Use jq for JSON log parsing
- grep/awk/sed for text log analysis
- Filter by timestamp, level, or content
- Generate summaries and statistics
- Export filtered results
- Track error patterns`,
      tools: ['openclaw_exec', 'openclaw_read'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'model-usage',
      name: 'Model Usage',
      description: 'Summarize per-model usage, costs, and token metrics',
      prompt: `Track and report AI model usage metrics.

Capabilities:
- Query local usage databases/logs
- Calculate token consumption per model
- Estimate costs based on pricing
- Compare model performance/cost ratios
- Generate usage reports and dashboards
- Track quota limits and remaining allowances`,
      tools: ['openclaw_exec', 'openclaw_read'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'healthcheck',
      name: 'Health Check',
      description: 'Host security hardening and system health audits',
      prompt: `Perform system health and security audits.

Checks:
- System resource usage (CPU, memory, disk)
- Open ports and services (ss -tlnp)
- File permissions audit
- Process monitoring (ps aux)
- Network connectivity tests
- Log analysis for errors/warnings
- Environment variable review
- Dependency vulnerability scanning`,
      tools: ['openclaw_exec', 'openclaw_read'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'skill-creator',
      name: 'Skill Creator',
      description: 'Create, edit, improve, or audit AgentSkills',
      prompt: `Help create and manage OpenClaw skills.

Workflow:
- Design skill manifest (name, description, tools, prompt)
- Write SKILL.md documentation
- Package skill files
- Validate skill structure
- Test skill execution
- Publish to ClawHub registry`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_edit'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'clawhub',
      name: 'ClawHub',
      description: 'Search, install, update, and publish agent skills from clawhub.com',
      prompt: `Manage the ClawHub skill registry.

Operations:
- Search available skills by keyword or category
- Install skills from the registry
- Update existing skills to latest versions
- Publish new skills
- Manage skill dependencies
- Review skill ratings and usage stats`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'oracle',
      name: 'Oracle',
      description: 'Expert Q&A, deep analysis, and guided recommendations',
      prompt: `You are an expert oracle providing deep analysis and reasoning.

Capabilities:
- Break down complex problems step by step
- Provide multiple perspectives on issues
- Generate decision matrices for comparisons
- Research topics using web search and file analysis
- Bundle context from multiple sources
- Deliver structured, actionable recommendations`,
      tools: ['openclaw_exec', 'openclaw_read'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'openai-whisper',
      name: 'Whisper (Local)',
      description: 'Local speech-to-text with Whisper CLI (no API key needed)',
      prompt: `Transcribe audio using the Whisper CLI (local, offline).

Usage:
- whisper audio.mp3 --model base --language auto
- whisper audio.wav --model small --output_format vtt
- Supported formats: mp3, wav, m4a, flac, ogg
- Output formats: txt, vtt, srt, json
- Language detection is automatic
- Models: tiny, base, small, medium (larger = more accurate but slower)`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'sherpa-onnx-tts',
      name: 'Local TTS',
      description: 'Local text-to-speech via sherpa-onnx (offline, no cloud)',
      prompt: `Generate speech from text using local ONNX models.

Approach:
- Use sherpa-onnx for offline TTS
- Support multiple voices and languages
- Adjust speed, pitch, and volume
- Output to WAV/MP3 format
- Process batch text files
- No internet or API key required`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'songsee',
      name: 'Audio Visualization',
      description: 'Generate spectrograms and audio feature visualizations',
      prompt: `Analyze and visualize audio files.

Tools:
- ffmpeg for audio processing and spectrogram generation
- sox for audio analysis
- Python with librosa for feature extraction
- Generate waveforms, spectrograms, chromagrams
- Extract tempo, pitch, and frequency features
- Create visual panels of audio characteristics`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'tmux',
      name: 'Tmux',
      description: 'Remote-control tmux sessions for interactive CLIs',
      prompt: `Manage tmux terminal multiplexer sessions.

Commands:
- tmux new-session -d -s name (create session)
- tmux send-keys -t name "command" Enter (send keystrokes)
- tmux capture-pane -t name -p (read output)
- tmux list-sessions (list active sessions)
- tmux kill-session -t name (terminate)
- Useful for running persistent background processes`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'mcporter',
      name: 'MCP Porter',
      description: 'List, configure, auth, and call MCP servers/tools',
      prompt: `Manage Model Context Protocol (MCP) servers and tools.

Operations:
- List available MCP servers and tools
- Configure server connections (HTTP/stdio)
- Authenticate with MCP providers
- Call MCP tools with structured inputs
- Generate CLI scaffolding for new servers
- Edit server configurations`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'gh-issues',
      name: 'GitHub Issues Agent',
      description: 'Fetch GitHub issues, implement fixes, and open PRs',
      prompt: `Automated GitHub issue management and resolution.

Workflow:
- gh issue list --label bug (list issues)
- Analyze issue descriptions and reproduce problems
- Implement fixes with coding-agent capabilities
- Create feature branches and commit changes
- Open pull requests with detailed descriptions
- Monitor PR review comments and address feedback`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_edit'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'gemini',
      name: 'Gemini',
      description: 'Gemini CLI for one-shot Q&A, summaries, and generation',
      prompt: `Use Google Gemini for AI-powered tasks.

Capabilities:
- One-shot question answering
- Document summarization
- Code generation and review
- Multimodal analysis (text + images)
- Translation and language tasks
- Structured data extraction`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'discord',
      name: 'Discord',
      description: 'Discord operations via the message tool',
      prompt: `Interact with Discord for messaging and moderation.

Capabilities:
- Send messages to channels
- Read channel history
- Manage webhooks for notifications
- Format messages with embeds
- React to messages
- Channel management operations`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'slack',
      name: 'Slack',
      description: 'Slack automation for channels, threads, and messages',
      prompt: `Automate Slack workspace operations.

Capabilities:
- Send messages to channels and threads
- React to and pin messages
- Upload files and share content
- Search message history
- Manage channel topics and purposes
- Create formatted blocks and attachments`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'notion',
      name: 'Notion',
      description: 'Notion API for creating and managing pages, databases, and blocks',
      prompt: `Manage Notion workspace content via the API.

Operations:
- Create and update pages
- Query and filter databases
- Add and modify blocks (text, code, lists, etc.)
- Search across the workspace
- Manage page properties
- Link between pages and databases`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'trello',
      name: 'Trello',
      description: 'Manage Trello boards, lists, and cards via REST API',
      prompt: `Automate Trello board management.

Operations:
- Create and move cards between lists
- Add comments, labels, and due dates
- Manage board members
- Create checklists and attachments
- Search cards across boards
- Generate board reports and statistics`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'gog',
      name: 'Google Workspace',
      description: 'Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs',
      prompt: `Manage Google Workspace services.

Services:
- Gmail: read, send, search, label emails
- Calendar: create events, check availability
- Drive: list, upload, download, share files
- Sheets: read/write spreadsheet data
- Docs: create and edit documents
- Contacts: search and manage contacts`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'goplaces',
      name: 'Google Places',
      description: 'Query Google Places API for place search, details, and reviews',
      prompt: `Search and retrieve place information.

Capabilities:
- Text search for businesses and points of interest
- Get detailed place information (address, hours, rating)
- Read user reviews
- Geocode addresses to coordinates
- Find nearby places by category
- Resolve place IDs to full details`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'himalaya',
      name: 'Himalaya Email',
      description: 'CLI email management via IMAP/SMTP',
      prompt: `Manage emails from the terminal via IMAP/SMTP.

Commands:
- himalaya list (list inbox messages)
- himalaya read {id} (read a message)
- himalaya write (compose new email)
- himalaya reply {id} (reply to message)
- himalaya search "query" (search emails)
- himalaya move {id} {folder} (organize)
- himalaya delete {id} (remove)`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'spotify-player',
      name: 'Spotify Player',
      description: 'Terminal Spotify playback and search',
      prompt: `Control Spotify playback from the terminal.

Features:
- Search tracks, albums, artists, playlists
- Play/pause/skip/previous controls
- Volume adjustment
- Queue management
- Browse recommendations
- Manage playlists
- View currently playing track info`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'obsidian',
      name: 'Obsidian',
      description: 'Work with Obsidian vaults (plain Markdown notes)',
      prompt: `Manage Obsidian vault files (Markdown-based notes).

Operations:
- Create and edit notes (plain .md files)
- Search notes by content or frontmatter
- Manage tags and links between notes
- Navigate the knowledge graph
- Process templates and daily notes
- Export notes to other formats`,
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_edit'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'openai-whisper-api',
      name: 'Whisper API',
      description: 'Transcribe audio via OpenAI Audio Transcriptions API',
      prompt: `Transcribe audio using the OpenAI Whisper API (cloud).

Usage:
- High-accuracy transcription
- Supports 50+ languages
- Translation to English
- Timestamps and word-level alignment
- Multiple output formats (text, SRT, VTT, JSON)
- Handles audio up to 25MB`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'voice-call',
      name: 'Voice Call',
      description: 'Start voice calls via the OpenClaw voice-call plugin',
      prompt: `Initiate and manage voice calls.

Capabilities:
- Start outbound calls
- Interactive voice menus (DTMF)
- Call recording
- Audio playback during calls
- Call transfer and conference
- Status monitoring`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'wacli',
      name: 'WhatsApp CLI',
      description: 'Send WhatsApp messages and search/sync history via wacli',
      prompt: `Automate WhatsApp messaging.

Operations:
- Send text messages to contacts
- Search message history
- Sync chat data
- Export conversations
- Group management
- Media file handling`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: '1password',
      name: '1Password',
      description: 'Set up and use 1Password CLI (op) for secret management',
      prompt: `Manage secrets and credentials with 1Password CLI.

Operations:
- op item list (list vault items)
- op item get {name} (retrieve credentials)
- op item create (add new items)
- op vault list (manage vaults)
- Inject secrets into environment variables
- Generate secure passwords`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'apple-notes',
      name: 'Apple Notes',
      description: 'Manage Apple Notes via memo CLI on macOS',
      prompt: `Manage Apple Notes from the terminal (macOS only).

Operations:
- Create new notes with rich text
- Search notes by content
- Edit existing notes
- Move notes between folders
- Delete notes
- Export notes to various formats`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'apple-reminders',
      name: 'Apple Reminders',
      description: 'Manage Apple Reminders via remindctl CLI',
      prompt: `Manage Apple Reminders from the terminal (macOS only).

Commands:
- List reminders by list or date
- Add new reminders with due dates
- Edit existing reminders
- Mark reminders as complete
- Delete reminders
- Organize by lists and priorities`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'bear-notes',
      name: 'Bear Notes',
      description: 'Create, search, and manage Bear notes via grizzly CLI',
      prompt: `Work with Bear notes application.

Operations:
- Create notes with Markdown formatting
- Search notes by content or tags
- Manage nested tags
- Link between notes
- Export notes
- Archive and trash management`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'blucli',
      name: 'BluOS CLI',
      description: 'BluOS CLI for discovery, playback, grouping, and volume',
      prompt: `Control BluOS audio devices.

Operations:
- Discover BluOS devices on the network
- Control playback (play, pause, skip)
- Adjust volume and EQ
- Group/ungroup players
- Manage play queues
- Browse music services`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'bluebubbles',
      name: 'BlueBubbles',
      description: 'Send and manage iMessages via BlueBubbles server',
      prompt: `Manage iMessages through BlueBubbles.

Capabilities:
- Send and receive iMessages
- Search message history
- Manage group chats
- Handle attachments
- Read receipts and typing indicators
- Scheduled messages`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'camsnap',
      name: 'Camera Capture',
      description: 'Capture frames or clips from RTSP/ONVIF cameras',
      prompt: `Capture and process camera streams.

Operations:
- ffmpeg -i rtsp://... -vframes 1 snapshot.jpg (capture frame)
- ffmpeg -i rtsp://... -t 10 clip.mp4 (record clip)
- Discover ONVIF cameras on network
- Motion detection via frame comparison
- Time-lapse creation
- Multi-camera monitoring`,
      tools: ['openclaw_exec', 'openclaw_write'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'eightctl',
      name: 'Eight Sleep',
      description: 'Control Eight Sleep pods (status, temperature, alarms)',
      prompt: `Manage Eight Sleep smart mattress.

Controls:
- View sleep metrics and status
- Adjust bed temperature
- Configure alarm schedules
- Set heating/cooling zones
- Review sleep analytics
- Manage user profiles`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'imsg',
      name: 'iMessage',
      description: 'iMessage/SMS CLI for listing chats, history, and sending',
      prompt: `Manage iMessage and SMS (macOS only).

Operations:
- List recent conversations
- Read chat history by contact
- Send new messages
- Search message content
- Export conversation data
- Handle multimedia messages`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'openhue',
      name: 'Philips Hue',
      description: 'Control Philips Hue lights and scenes via OpenHue CLI',
      prompt: `Control Philips Hue lighting system.

Commands:
- List lights and rooms
- Turn lights on/off
- Set brightness, color, and temperature
- Activate and create scenes
- Group lights by room/zone
- Schedule lighting changes`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'ordercli',
      name: 'Order CLI',
      description: 'Check past orders and active order status (Foodora)',
      prompt: `Track delivery orders.

Features:
- View order history
- Check active order status
- Track delivery in real-time
- View order receipts
- Manage delivery preferences
- Rate past orders`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'peekaboo',
      name: 'Peekaboo',
      description: 'Capture and automate macOS UI with Peekaboo CLI',
      prompt: `Automate macOS UI interactions.

Capabilities:
- Capture screenshots of specific windows/regions
- List running applications and windows
- Extract UI element trees
- Click, type, and interact with UI elements
- Automate repetitive UI tasks
- Record and replay interactions`,
      tools: ['openclaw_exec', 'openclaw_write'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'sag',
      name: 'ElevenLabs TTS',
      description: 'ElevenLabs text-to-speech with high-quality voice synthesis',
      prompt: `Generate speech with ElevenLabs API.

Features:
- High-quality voice synthesis
- Multiple voice options
- Voice cloning capabilities
- Adjust stability and clarity
- Multiple output formats
- Streaming audio generation`,
      tools: ['openclaw_exec', 'openclaw_write'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'sonoscli',
      name: 'Sonos',
      description: 'Control Sonos speakers (discover/status/play/volume/group)',
      prompt: `Manage Sonos speaker system.

Controls:
- Discover speakers on network
- Play/pause/skip tracks
- Adjust volume per speaker
- Group speakers together
- Browse music libraries
- Manage play queues and favorites`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'things-mac',
      name: 'Things 3',
      description: 'Manage Things 3 via things CLI on macOS',
      prompt: `Manage Things 3 tasks (macOS only).

Operations:
- Add new todos and projects
- Update task details and due dates
- List tasks by area, project, or tag
- Search tasks by content
- Complete and archive tasks
- Organize with tags and areas`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'xurl',
      name: 'X (Twitter)',
      description: 'Make authenticated requests to the X (Twitter) API',
      prompt: `Interact with X (Twitter) API.

Operations:
- Post tweets and threads
- Search tweets by keyword or hashtag
- Reply to and quote tweets
- Follow/unfollow users
- Read user timelines
- Manage bookmarks and lists`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'needs_setup',
    },
    {
      id: 'node-connect',
      name: 'Node Connect',
      description: 'Diagnose OpenClaw node connection and pairing failures',
      prompt: `Troubleshoot OpenClaw companion app connections.

Diagnostics:
- Verify network connectivity
- Check QR code/setup code validity
- Test WebSocket connections
- Validate SSL certificates
- Review firewall rules
- Debug pairing protocol issues`,
      tools: ['openclaw_exec'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'web_search',
      name: 'Web & Academic Search',
      description: 'Search the web, scientific papers, and academic sources with source-aware routing',
      prompt: `Use web_search for research and retrieval.

Guidelines:
- For scientific papers or literature reviews, prefer academic searches
- Capture title, authors, year, abstract/summary, DOI, and source URL when available
- Use browse_url to inspect promising result pages, PDFs, or landing pages
- Distinguish preprints from peer-reviewed sources when possible
- Return citations and links in the final answer`,
      tools: ['web_search', 'browse_url'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'browse_url',
      name: 'Headless Browser',
      description: 'Open URLs, inspect rendered pages, and capture screenshots when needed',
      prompt: `Use browse_url to inspect a specific webpage.

Guidelines:
- Prefer direct URLs from search results or user input
- Extract the page title, main content, and key evidence
- Capture screenshots when a visual check is helpful
- Reuse sessions only when the workflow requires multiple steps on the same site`,
      tools: ['browse_url'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'generate_document',
      name: 'Office Document Generator',
      description: 'Generate Word, Excel, PowerPoint, CSV, and PDF artifacts from structured instructions',
      prompt: `Use generate_document to create downloadable artifacts.

Mapping:
- Word or DOCX requests -> type=word
- Excel or XLSX requests -> type=excel
- PowerPoint or slide deck requests -> type=ppt
- PDF requests -> type=pdf
- CSV requests -> type=csv

Guidelines:
- Preserve headings, tables, and equations when possible
- Keep filenames clean and descriptive
- Confirm what artifact was produced and its intended use`,
      tools: ['generate_document'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'analyze_spreadsheet',
      name: 'Spreadsheet Analyzer',
      description: 'Analyze uploaded Excel or CSV files and produce summaries or data insights',
      prompt: `Use analyze_spreadsheet for uploaded tabular files.

Guidelines:
- Expect an uploadId when the file comes from chat attachments
- Choose an analysis mode that matches the user request (summary, full, text_only, extract_tasks, custom)
- Focus on trends, anomalies, totals, and actionable findings
- Mention when the user needs to upload the file first`,
      tools: ['analyze_spreadsheet'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'memory_search',
      name: 'Semantic Memory',
      description: 'Search prior context, facts, and long-term memory using RAG',
      prompt: `Use OpenClaw memory tools to recover relevant prior context.

Guidelines:
- Use openclaw_rag_search when the user asks to remember, recall, continue, or reuse previous context
- Use openclaw_rag_context to build a compact memory block for the current message
- Surface uncertainty if memory evidence is weak`,
      tools: ['openclaw_rag_search', 'openclaw_rag_context'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'spawn_subagent',
      name: 'Nested Subagents',
      description: 'Delegate multi-step work to OpenClaw subagents and monitor their progress',
      prompt: `Use OpenClaw subagents when the task is large, parallelizable, or needs background execution.

Guidelines:
- Spawn focused subagents with clear objectives
- Poll status only when the result is needed
- Keep parent and child objectives explicit to avoid duplicated work`,
      tools: ['openclaw_spawn_subagent', 'openclaw_subagent_status', 'openclaw_subagent_list'],
      source: 'builtin',
      status: 'ready',
    },
    {
      id: 'math_render',
      name: 'Math Renderer (KaTeX)',
      description: 'Render and structure mathematical solutions using LaTeX/KaTeX, with optional export',
      prompt: `Use LaTeX/KaTeX formatting for mathematics.

Guidelines:
- Inline math uses $...$
- Display math uses $$...$$
- Prefer valid KaTeX syntax such as \\frac, \\sqrt, \\sum, aligned systems, and matrices
- Show step-by-step derivations when solving exercises
- If the user wants a downloadable file, use generate_document and preserve LaTeX in the output
- For math or science references, combine with web_search when needed`,
      tools: ['generate_document', 'web_search'],
      source: 'builtin',
      status: 'ready',
    },
  ];
}

export async function initSkills(config: OpenClawConfig): Promise<void> {
  skillRegistry.clear();

  const builtins = config.skills.includeBuiltins ? getBuiltinSkills() : [];
  skillRegistry.registerMany(builtins);

  const filesystem = await loadSkillsFromFilesystem(config);
  skillRegistry.registerMany(filesystem.skills);

  Logger.info(
    `[OpenClaw:Skills] ${skillRegistry.list().length} skills registered ` +
      `(builtin=${builtins.length}, filesystem=${filesystem.skills.length}, files=${filesystem.loadedFiles.length})`,
  );

  if (filesystem.skippedFiles.length > 0) {
    const sample = filesystem.skippedFiles.slice(0, 5);
    Logger.warn(
      `[OpenClaw:Skills] Skipped ${filesystem.skippedFiles.length} invalid skill files: ` +
        sample.map(s => `${s.filePath} (${s.reason})`).join('; '),
    );
  }
}
