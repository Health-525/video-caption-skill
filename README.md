# video-caption

Extract subtitles from YouTube videos and convert to clean Markdown notes.

## Features

- Auto-fetches video title, channel, publish date
- Merges fragmented subtitle lines into readable paragraphs
- Detects sentence boundaries (CJK + Latin) to form paragraphs
- Labels subtitle source: native / auto-generated / Whisper
- Whisper fallback when no native subtitles exist
- Cross-platform: Windows, macOS, Linux

## Quick Start

```bash
# Install (or run directly with node)
npm install -g .

# Run
video-caption https://www.youtube.com/watch?v=VIDEO_ID
```

Output: `notes/YYYY-MM-DD-VIDEO_ID.md`

## Requirements

- Node.js >= 16
- `yt-dlp` — `pip install yt-dlp`
- `youtube_cookies.txt` (Netscape format) — export from browser to bypass rate limits

## Options

```
video-caption <url> [options]

  --out <template>       Output path (default: notes/%Y-%m-%d-%(id)s.md)
  --lang <langs>         Subtitle languages (default: zh-Hans,zh-Hans-en,en)
  --cookies <file>       Cookies file (default: youtube_cookies.txt)
  --merge-window <secs>  Merge window in seconds (default: 4)
  --keep-timestamps      Add [MM:SS] prefix to each paragraph
  --whisper              Force Whisper transcription
  -h, --help             Show help
```

## OpenClaw Skill

This repo is also an OpenClaw skill. See `.claude/skills/video-caption/SKILL.md`.

## Security

- `youtube_cookies.txt` is in `.gitignore` — never committed
- Cookies path is never printed to stdout
- No external npm dependencies

## License

MIT
