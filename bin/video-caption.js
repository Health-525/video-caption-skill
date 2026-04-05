#!/usr/bin/env node
'use strict';

const path = require('path');
const fs   = require('fs');
const { download, listSubs } = require('../lib/download');
const { vttToMd, splitTranscript } = require('../lib/convert');
const { transcribe }         = require('../lib/whisper');
const { normalizeInput }     = require('../lib/input');
const { runDoctor }          = require('../lib/doctor');

// ─── CLI arg parser (no external deps) ──────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    url:             null,
    lang:            'zh-Hans,zh-Hans-en,en',
    out:             'notes/%Y-%m-%d-%(id)s.md',
    cookies:         process.env.VIDEO_CAPTION_COOKIES || 'youtube_cookies.txt',
    whisper:         false,
    stdout:          false,
    doctor:          false,
    keepTimestamps:  false,
    mergeWindow:     4,     // seconds
    splitPunct:      true,  // break paragraph at sentence-end punctuation
    paraMaxChars:    240,   // fallback: force new paragraph after N chars
    python:          null,
    help:            false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h')            { opts.help = true; }
    else if (a === '--doctor')                   { opts.doctor = true; }
    else if (a === '--whisper')                  { opts.whisper = true; }
    else if (a === '--stdout')                   { opts.stdout = true; }
    else if (a === '--keep-timestamps')          { opts.keepTimestamps = true; }
    else if (a === '--lang'    && args[i+1])     { opts.lang = args[++i]; }
    else if (a === '--out'     && args[i+1])     { opts.out  = args[++i]; }
    else if (a === '--cookies' && args[i+1])     { opts.cookies = args[++i]; }
    else if (a === '--merge-window'   && args[i+1]) { opts.mergeWindow  = parseFloat(args[++i]); }
    else if (a === '--para-max-chars'  && args[i+1]) { opts.paraMaxChars = parseInt(args[++i], 10); }
    else if (a === '--no-para-split-punct')           { opts.splitPunct   = false; }
    else if (a === '--python'          && args[i+1]) { opts.python       = args[++i]; }
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
  --stdout               Print Markdown to stdout instead of writing a file
  --doctor               Check local environment and dependencies
  --merge-window <secs>  Merge subtitle lines within N seconds (default: 4)
  --para-max-chars <n>   Max chars per paragraph before forced break (default: 240)
  --no-para-split-punct  Disable paragraph split at sentence-end punctuation
  --keep-timestamps      Include timestamps in output
  --whisper              Force Whisper transcription even if subtitles exist
  --python <path>        Python interpreter for Whisper (default: auto-detect)
  -h, --help             Show this help

Examples:
  video-caption https://www.youtube.com/watch?v=VIDEO_ID
  video-caption https://youtu.be/VIDEO_ID --out ./my-notes/%(id)s.md --lang en
  video-caption https://youtu.be/VIDEO_ID --whisper
`);
}

function validateOpts(opts) {
  if (!opts.url && !opts.help && !opts.doctor) {
    throw new Error('missing youtube url or video id');
  }
  if (!Number.isFinite(opts.mergeWindow) || opts.mergeWindow < 0) {
    throw new Error('--merge-window must be a number >= 0');
  }
  if (!Number.isInteger(opts.paraMaxChars) || opts.paraMaxChars <= 0) {
    throw new Error('--para-max-chars must be a positive integer');
  }
}

function cleanupTempArtifact(filePath) {
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
}

function shouldFallbackToWhisper(error) {
  const message = String(error && error.message || '').toLowerCase();
  return (
    message.includes('429') ||
    message.includes('rate-limited') ||
    message.includes('too many requests') ||
    message.includes('page needs to be reloaded') ||
    message.includes('no vtt file downloaded') ||
    message.includes('requested format is not available') ||
    message.includes('only images are available')
  );
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
  validateOpts(opts);

  if (opts.doctor) {
    const exitCode = await runDoctor({ cookiesPath: opts.cookies, python: opts.python });
    process.exit(exitCode);
  }

  if (opts.help || !opts.url) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  opts.url = normalizeInput(opts.url);

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
    // Prefer native subtitles: pick the first lang whose code has < 3 segments,
    // fall back to the first available auto-translated lang.
    // e.g. "zh-Hans" (2 segs) = native; "zh-Hans-en" (3 segs) = auto-translated.
    const chosen =
      langs.find(l => subs.includes(l) && l.split('-').length < 3) ||
      langs.find(l => subs.includes(l));

    if (chosen) {
      source = chosen.split('-').length >= 3 ? 'auto' : 'native';
      console.log(`      Found: ${chosen} (${source})`);

      // ── Step 3: download subtitle ──
      console.log('[3/4] Downloading subtitle...');
      try {
        vttFile = await download.getSub(opts.url, chosen, cookiesArg);
      } catch (error) {
        if (shouldFallbackToWhisper(error)) {
          console.warn(`      [fallback] subtitle download failed: ${error.message}`);
          console.warn('      [fallback] switching to Whisper transcription...');
        } else {
          throw error;
        }
      }
    } else {
      console.log('      No subtitles found, falling back to Whisper...');
    }
  }

  if (!vttFile) {
    // ── Whisper fallback ──
    source = 'whisper';
    console.log('[3/4] Downloading audio for Whisper transcription...');
    const audioFile = await download.getAudio(opts.url, cookiesArg);
    try {
      console.log('[3/4] Transcribing with Whisper (this may take a while)...');
      transcript = await transcribe(audioFile, { python: opts.python });
    } finally {
      cleanupTempArtifact(audioFile);
    }
  }

  // ── Step 4: convert to markdown ──
  console.log('[4/4] Converting to Markdown...');
  const md = vttFile
    ? vttToMd(vttFile, meta, { source, keepTimestamps: opts.keepTimestamps, mergeWindow: opts.mergeWindow, splitPunct: opts.splitPunct, paraMaxChars: opts.paraMaxChars })
    : transcriptToMd(transcript, meta, { source, splitPunct: opts.splitPunct, paraMaxChars: opts.paraMaxChars });

  // cleanup vtt
  cleanupTempArtifact(vttFile);

  if (opts.stdout) {
    process.stdout.write(md);
    return;
  }

  // ── Write output ──
  const outPath = resolveOutPath(opts.out, meta);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`\n[done] ${outPath}`);
}

function transcriptToMd(transcript, meta, { source, splitPunct, paraMaxChars }) {
  const header = buildHeader(meta, source);
  const paras  = splitTranscript(transcript, { splitPunct, paraMaxChars });
  return header + paras.join('\n\n') + '\n';
}

function buildHeader(meta, source) {
  const sourceLabel = { native: '原生字幕', auto: '自动字幕（机器翻译）', whisper: 'Whisper 转写' }[source] || source;
  return [
    `# ${meta.title || 'Untitled'}`,
    '',
    `| 字段 | 内容 |`,
    `|------|------|`,
    `| 频道 | ${meta.channel || '-'} |`,
    `| 发布日期 | ${meta.uploadDate || '-'} |`,
    `| 原始链接 | [${meta.url}](${meta.url}) |`,
    `| 字幕来源 | ${sourceLabel} |`,
    '',
    '---',
    '',
  ].join('\n');
}

main().catch(e => {
  console.error('[fatal]', e.message);
  process.exit(1);
});
