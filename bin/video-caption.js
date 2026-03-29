#!/usr/bin/env node
'use strict';

const path = require('path');
const fs   = require('fs');
const { download, listSubs } = require('../lib/download');
const { vttToMd }            = require('../lib/convert');
const { transcribe }         = require('../lib/whisper');

// ─── CLI arg parser (no external deps) ──────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    url:             null,
    lang:            'zh-Hans,zh-Hans-en,en',
    out:             'notes/%Y-%m-%d-%(id)s.md',
    cookies:         'youtube_cookies.txt',
    whisper:         false,
    keepTimestamps:  false,
    mergeWindow:     4,   // seconds
    help:            false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h')            { opts.help = true; }
    else if (a === '--whisper')                  { opts.whisper = true; }
    else if (a === '--keep-timestamps')          { opts.keepTimestamps = true; }
    else if (a === '--lang'    && args[i+1])     { opts.lang = args[++i]; }
    else if (a === '--out'     && args[i+1])     { opts.out  = args[++i]; }
    else if (a === '--cookies' && args[i+1])     { opts.cookies = args[++i]; }
    else if (a === '--merge-window' && args[i+1]){ opts.mergeWindow = parseFloat(args[++i]); }
    else if (!a.startsWith('-'))                 { opts.url = a; }
  }
  return opts;
}

function printHelp() {
  console.log(`
Usage: video-caption <youtube_url> [options]

Options:
  --out <template>       Output path template (default: notes/%Y-%m-%d-%(id)s.md)
  --lang <langs>         Subtitle language priority (default: zh-Hans,zh-Hans-en,en)
  --cookies <file>       Cookies file path (default: youtube_cookies.txt)
  --merge-window <secs>  Merge subtitle lines within N seconds (default: 4)
  --keep-timestamps      Include timestamps in output
  --whisper              Force Whisper transcription even if subtitles exist
  -h, --help             Show this help

Examples:
  video-caption https://www.youtube.com/watch?v=VIDEO_ID
  video-caption https://youtu.be/VIDEO_ID --out ./my-notes/%(id)s.md --lang en
  video-caption https://youtu.be/VIDEO_ID --whisper
`);
}

// ─── Output path resolver ────────────────────────────────────────────────────
function resolveOutPath(template, meta) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  return template
    .replace('%Y-%m-%d', date)
    .replace('%(id)s',   meta.id   || 'unknown')
    .replace('%(title)s', (meta.title || 'untitled').replace(/[/\\:*?"<>|]/g, '-'));
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help || !opts.url) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  // Cookies: check existence, never print content
  const cookiesArg = fs.existsSync(opts.cookies) ? opts.cookies : null;
  if (!cookiesArg) {
    console.warn(`[warn] cookies file not found: ${opts.cookies} (proceeding without, may hit rate limits)`);
  }

  let source = null;    // 'native' | 'auto' | 'whisper'
  let vttFile = null;
  let transcript = null;
  let meta = {};

  // ── Step 1: get video metadata ──
  console.log('[1/4] Fetching video metadata...');
  try {
    meta = await download.getMeta(opts.url, cookiesArg);
    console.log(`      Title  : ${meta.title}`);
    console.log(`      Channel: ${meta.channel}`);
    console.log(`      ID     : ${meta.id}`);
  } catch (e) {
    console.error('[error] Failed to fetch metadata:', e.message);
    process.exit(1);
  }

  if (!opts.whisper) {
    // ── Step 2: check subtitles ──
    console.log('[2/4] Checking available subtitles...');
    const subs = await listSubs(opts.url, cookiesArg);
    const langs = opts.lang.split(',');
    const chosen = langs.find(l => subs.includes(l));

    if (chosen) {
      source = subs.some(s => s.startsWith(chosen) && !s.includes('-')) ? 'native' : 'auto';
      console.log(`      Found: ${chosen} (${source})`);

      // ── Step 3: download subtitle ──
      console.log('[3/4] Downloading subtitle...');
      vttFile = await download.getSub(opts.url, chosen, cookiesArg);
    } else {
      console.log('      No subtitles found, falling back to Whisper...');
    }
  }

  if (!vttFile) {
    // ── Whisper fallback ──
    source = 'whisper';
    console.log('[3/4] Downloading audio for Whisper transcription...');
    const audioFile = await download.getAudio(opts.url, cookiesArg);
    console.log('[3/4] Transcribing with Whisper (this may take a while)...');
    transcript = await transcribe(audioFile);
    // cleanup audio
    fs.unlinkSync(audioFile);
  }

  // ── Step 4: convert to markdown ──
  console.log('[4/4] Converting to Markdown...');
  const md = vttFile
    ? vttToMd(vttFile, meta, { source, keepTimestamps: opts.keepTimestamps, mergeWindow: opts.mergeWindow })
    : transcriptToMd(transcript, meta, { source });

  // cleanup vtt
  if (vttFile && fs.existsSync(vttFile)) fs.unlinkSync(vttFile);

  // ── Write output ──
  const outPath = resolveOutPath(opts.out, meta);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`\n[done] ${outPath}`);
}

function transcriptToMd(transcript, meta, { source }) {
  const header = buildHeader(meta, source);
  return header + transcript;
}

function buildHeader(meta, source) {
  const sourceLabel = { native: '原生字幕', auto: '自动字幕', whisper: 'Whisper 转写' }[source] || source;
  return [
    `# ${meta.title || 'Untitled'}`,
    '',
    `> **来源：** [${meta.channel || ''}](${meta.url})`,
    `> **发布日期：** ${meta.uploadDate || ''}`,
    `> **字幕来源：** ${sourceLabel}`,
    '',
    '---',
    '',
  ].join('\n');
}

main().catch(e => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
