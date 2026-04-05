'use strict';

const { vttToMd, parseVtt, mergeCues, toParagraphs, splitTranscript } = require('./convert');
const { download, listSubs } = require('./download');
const { transcribe } = require('./whisper');
const { normalizeInput, looksLikeVideoId } = require('./input');
const { runDoctor } = require('./doctor');

module.exports = {
  convert: { vttToMd, parseVtt, mergeCues, toParagraphs, splitTranscript },
  download,
  listSubs,
  transcribe,
  normalizeInput,
  looksLikeVideoId,
  runDoctor,
};
