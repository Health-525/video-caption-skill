# video-caption

Extract subtitles from YouTube videos and convert to clean, well-structured Markdown notes.

Supports native subtitles, auto-generated subtitles, and Whisper transcription fallback. Works on Windows, macOS, and Linux.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Options Reference](#options-reference)
- [Output Format](#output-format)
- [Paragraph Splitting](#paragraph-splitting)
- [Subtitle Selection Strategy](#subtitle-selection-strategy)
- [n Challenge / Anti-bot Handling](#n-challenge--anti-bot-handling)
- [Whisper Fallback](#whisper-fallback)
- [youtube_cookies.txt Setup](#youtube_cookiestxt-setup)
- [OpenClaw Skill](#openclaw-skill)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- **Auto metadata** — fetches title, channel, publish date, video URL without manual input
- **Smart subtitle selection** — prefers native subtitles over auto-translated ones across multiple languages
- **Fragmented line merging** — merges subtitle cues within a configurable time window (`--merge-window`)
- **Paragraph splitting** — breaks output at sentence-end punctuation (`。！？!?`) with a max-char fallback
- **CJK-aware text joining** — no extra spaces inserted between Chinese/Japanese/Korean characters
- **Subtitle source labeling** — output header shows whether content came from native subs, auto-subs, or Whisper
- **n challenge auto-retry** — on first failure, automatically retries with EJS/Deno bypass args
- **No-cookie safe retry** — on HTTP 429 without cookies, retries with lighter YouTube clients and fewer extractor requests
- **Whisper fallback** — downloads audio and transcribes locally when no subtitles are available
- **Cross-platform** — works on Windows CMD, macOS, Linux; no `del`/`rm` hardcoded
- **Zero npm dependencies** — uses only Node.js built-ins
- **Agent-friendly** — supports `--stdout` for piping Markdown into agent workflows
- **Environment doctor** — supports `--doctor` to check local dependency readiness

---

## Requirements

| Dependency | Install | Required for |
|-----------|---------|--------------|
| Node.js >= 16 | [nodejs.org](https://nodejs.org) | Running the CLI |
| `yt-dlp` | `pip install yt-dlp` | Downloading subtitles / audio |
| `ffmpeg` + `ffprobe` | Install FFmpeg binaries and add to PATH | Audio extraction for Whisper fallback |
| `youtube_cookies.txt` | Export from browser | Bypassing YouTube rate limits |
| Python 3 + `faster-whisper` | `pip install faster-whisper` | Whisper fallback only |

---

## Installation

### Option A: Run directly (no install)

```bash
node bin/video-caption.js <youtube_url> [options]
```

### Option B: Install globally via npm

```bash
# From the repo root
npm install -g .

# Then use from anywhere
video-caption <youtube_url> [options]
```

### Option C: Use as a library

```js
const { normalizeInput, convert } = require('video-caption');
```

### Option D: OpenClaw skill (Claude agent)

See [OpenClaw Skill](#openclaw-skill) section below.

---

## Quick Start

```bash
# Basic usage — output goes to notes/YYYY-MM-DD-VIDEO_ID.md
video-caption https://www.youtube.com/watch?v=VIDEO_ID

# Agent-friendly usage — print Markdown directly to stdout
video-caption https://www.youtube.com/watch?v=VIDEO_ID --stdout

# With cookies (recommended)
video-caption https://youtu.be/VIDEO_ID --cookies youtube_cookies.txt

# Force Whisper (no subtitles available)
video-caption https://youtu.be/VIDEO_ID --whisper --cookies youtube_cookies.txt

# Preflight environment check
video-caption --doctor

# Custom output path
video-caption https://youtu.be/VIDEO_ID --out "./2024/%(id)s.md"

# Prefer English, shorter paragraphs
video-caption https://youtu.be/VIDEO_ID --lang en --para-max-chars 180
```

---

## Options Reference

```
video-caption <youtube_url> [options]

Subtitle options:
  --lang <langs>           Comma-separated language priority list
                           Default: zh-Hans,zh-Hans-en,en
                           Example: --lang "zh-TW,zh-Hant,zh,en"
  --cookies <file>         Path to Netscape-format cookies file
                           Default: youtube_cookies.txt
  --whisper                Force Whisper transcription even if subtitles exist

Output options:
  --out <template>         Output file path template
                           Default: notes/%Y-%m-%d-%(id)s.md
                           Tokens: %Y-%m-%d (date), %(id)s (video ID), %(title)s (title)
  --stdout                 Print Markdown to stdout instead of writing a file
  --keep-timestamps        Prefix each paragraph with [MM:SS] timestamp

Paragraph options:
  --merge-window <secs>    Merge subtitle cues within N seconds into one segment
                           Default: 4
  --para-max-chars <n>     Force a new paragraph after N characters (fallback)
                           Default: 240
  --no-para-split-punct    Disable splitting at sentence-end punctuation
                           (only --para-max-chars applies)

Whisper options:
  --python <path>          Explicit Python interpreter for Whisper
                           Default: auto-detect (python3 / python)
                           Example: --python /home/user/.venv/bin/python3

General:
  --doctor                 Check local environment and dependency availability
  -h, --help               Show this help message
```

Accepted input forms:
- Full YouTube watch URL
- YouTube Shorts URL
- YouTube embed URL
- Raw 11-character video ID

---

## Output Format

Every generated Markdown file has the same structure:

```markdown
# Video Title

| 字段 | 内容 |
|------|------|
| 频道 | Channel Name |
| 发布日期 | 2025-09-15 |
| 原始链接 | https://www.youtube.com/watch?v=VIDEO_ID |
| 字幕来源 | 原生字幕 |

---

Paragraph one. Full sentences merged together here.

Paragraph two continues here, after the previous sentence boundary.

...
```

**字幕来源** values:

| Value | Meaning |
|-------|---------|
| `原生字幕` | Native human subtitles |
| `自动字幕（机器翻译）` | YouTube auto-generated / auto-translated |
| `Whisper 转写` | Local AI transcription via faster-whisper |

With `--keep-timestamps`:

```markdown
**[02:14]** Paragraph starting at 2 minutes 14 seconds.

**[05:30]** Next paragraph.
```

---

## Paragraph Splitting

Subtitle files are fragmented by nature. The tool merges and re-splits them in two stages:

### Stage 1: Merge (within time window)

Cues within `--merge-window` seconds of each other are joined into one segment. Consecutive duplicate lines (common in auto-subs) are deduplicated first.

```
cue 0.0s: "各位同學"
cue 1.5s: "大家好"         ← within 4s window → merged
cue 3.0s: "我們來上課吧。"  ← within 4s window → merged
cue 8.0s: "歡迎來到..."    ← gap > 4s → new segment
```

### Stage 2: Split into paragraphs

**Rule A (default on):** flush paragraph at sentence-end punctuation: `。！？!?`

**Rule B (always on, fallback):** flush paragraph when accumulated length >= `--para-max-chars` (default 240)

Rule A fires first; Rule B catches long runs without punctuation (e.g. stream-of-consciousness speech, Whisper output).

Disable Rule A with `--no-para-split-punct` if you want only length-based splitting.

---

## Subtitle Selection Strategy

Given `--lang zh-Hans,zh-Hans-en,en` and available subtitles `[zh-Hans, zh-Hans-en, en]`:

1. **First pass:** find any lang code with < 3 dash-separated segments → these are native
   - `zh-Hans` → 2 segments → **native** ✓
   - `en` → 1 segment → **native** ✓
2. **Second pass:** if no native found, accept the first available lang (auto-translated)
   - `zh-Hans-en` → 3 segments → **auto-translated**

This ensures you never accidentally download a machine-translated version when a native subtitle exists.

---

## n Challenge / Anti-bot Handling

YouTube's n challenge is a JavaScript-based anti-bot mechanism that causes yt-dlp to fail with errors like:

```
n challenge solving failed
Only images are available for download
Requested format is not available
```

The tool handles this automatically:

1. **First attempt:** normal yt-dlp call
2. **On n challenge detection:** auto-retry with EJS bypass args:
   ```
   --js-runtimes deno:/path/to/deno
   --remote-components ejs:github
   --extractor-args youtube:player_client=web
   ```

If your machine requires Deno for n challenge solving, configure yt-dlp globally so it is always available:

```bash
# Install Deno (no sudo required)
export DENO_INSTALL="$HOME/.deno"
curl -fsSL https://deno.land/install.sh | sh

# Write to yt-dlp config (picked up automatically by every yt-dlp call)
mkdir -p ~/.config/yt-dlp
echo "--js-runtimes deno:$HOME/.deno/bin/deno" >> ~/.config/yt-dlp/config
```

If the retry also fails, the error message includes actionable steps:

```
yt-dlp failed to solve YouTube's "n challenge" (anti-bot JS).
Fix options (try in order):
  1. pip install -U yt-dlp
  2. yt-dlp --update
  3. Ensure youtube_cookies.txt is fresh (re-export from browser)
  4. Use a different network / VPN exit node
```

---

## No-Cookies Strategy

If `youtube_cookies.txt` is missing, the tool automatically switches to a lower-request retry strategy when YouTube returns HTTP 429:

- uses lighter `player_client` values such as `tv` and `mweb`
- skips some webpage/config/js extraction steps
- retries with EJS bypass if anti-bot JS is detected later

This improves real-world success rate, but fresh cookies are still the most reliable option.

---

## Agent Usage

For agent or automation usage, the recommended command is:

```bash
video-caption "https://www.youtube.com/watch?v=VIDEO_ID" --stdout --cookies youtube_cookies.txt
```

This prints the final Markdown note to stdout so another tool or agent can:

- save it to Obsidian or GitHub
- summarize it further
- convert it into tasks or notes
- chain it into a larger workflow

If you want file output, omit `--stdout`.

---

## Testing

Run the unit test suite:

```bash
npm test
```

The repository also includes a GitHub Actions CI workflow for Node.js on Windows and Linux.

---

## Whisper Fallback

Whisper runs when:
- `--list-subs` returns no results for the requested languages, **or**
- `--whisper` flag is explicitly passed, **or**
- subtitle download fails after retries (for example due to HTTP 429 / rate limit)

### Setup

```bash
pip install faster-whisper
```

### How it works

1. Downloads audio as MP3 via yt-dlp
2. Writes a temporary Python script and runs it with the configured interpreter
3. Collects transcribed text, applies `splitTranscript` paragraph splitting
4. Cleans up audio and temp files

### Specify a custom Python interpreter

If you have multiple Python environments:

```bash
video-caption https://youtu.be/VIDEO_ID \
  --whisper \
  --python /home/user/.venv/bin/python3
```

### Windows warning

`faster-whisper` (via ctranslate2) may crash on Windows with exit code `0xC0000005` (Segfault). This is a known ctranslate2 compatibility issue. Options:

1. Try `pip install ctranslate2==3.24.0`
2. Use WSL2 instead of native Windows Python
3. Use a video that has native subtitles (no Whisper needed)

---

## youtube_cookies.txt Setup

Cookies bypass YouTube's rate limits and bot checks. Without them, you may see `429 Too Many Requests` or `Sign in to confirm you're not a bot`.

1. Install the **Get cookies.txt LOCALLY** extension in Chrome/Edge/Firefox
2. Log in to [youtube.com](https://youtube.com)
3. Click the extension icon → **Export** → choose **Netscape** format
4. Save the file as `youtube_cookies.txt` in your working directory
5. Pass it with `--cookies youtube_cookies.txt`

**Security rules:**
- The file is in `.gitignore` — it will never be committed
- The tool never prints the cookies file path or its contents to stdout
- Re-export if you see bot-verification errors (cookies expire)

---

## OpenClaw Skill

This repo doubles as a Claude/OpenClaw skill.

**Skill location:** `.claude/skills/video-caption/SKILL.md`

When installed as a skill, Claude will:
1. Detect YouTube URL + subtitle/note intent from the conversation
2. Run `node bin/video-caption.js <url> [options]` from the repo root
3. Return the path to the generated Markdown file

**Install for OpenClaw:**

```bash
# Clone into your skills directory
git clone https://github.com/Health-525/video-caption-skill.git
```

Then reference the path in your OpenClaw config.

---

## Security

| Concern | Mitigation |
|---------|-----------|
| Cookies accidentally committed | `youtube_cookies.txt` and `*.cookies.txt` in `.gitignore` |
| Cookies path leaked in logs | Cookies path never printed; only `[warn] cookies file not found` if missing |
| Sensitive stderr output | yt-dlp errors are classified and reworded before display |
| Temp files left on disk | VTT files, MP3s, and Whisper `.py` scripts deleted after use |
| External npm dependencies | None — only Node.js built-ins used |

---

## Troubleshooting

### Quick diagnostics

Run:

```bash
video-caption --doctor
```

This checks:

- `yt-dlp`
- Python
- `faster-whisper`
- `youtube_cookies.txt`

| Error | Cause | Fix |
|-------|-------|-----|
| `Sign in to confirm you're not a bot` | Missing or expired cookies | Re-export `youtube_cookies.txt` |
| `429 Too Many Requests` | Rate limited | Use fresh cookies; `pip install -U yt-dlp` |
| `n challenge solving failed` | yt-dlp JS runtime issue | `pip install -U yt-dlp`; configure Deno (see above) |
| `Only images are available` | n challenge not solved | Same as above |
| `No VTT file downloaded` | No subtitles for chosen language | Try `--lang en` or add `--whisper` |
| `ModuleNotFoundError: faster_whisper` | Whisper not installed | `pip install faster-whisper` |
| `0xC0000005` Segfault (Windows) | ctranslate2 incompatibility | Use WSL2 or `pip install ctranslate2==3.24.0` |
| Output has no paragraph breaks | No sentence-end punctuation detected | Try `--para-max-chars 150` |
| Garbled characters in output | Encoding issue | Ensure terminal and editor use UTF-8 |
| `yt-dlp not found` | Not installed or not in PATH | `pip install yt-dlp` |

---

## License

MIT
