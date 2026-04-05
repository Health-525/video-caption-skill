'use strict';

const assert = require('assert');
const { splitTranscript, mergeCues, toParagraphs } = require('../lib/convert');
const { normalizeInput, looksLikeVideoId } = require('../lib/input');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

test('normalize raw video id to watch url', () => {
  assert.strictEqual(
    normalizeInput('dQw4w9WgXcQ'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
  assert.strictEqual(looksLikeVideoId('dQw4w9WgXcQ'), true);
});

test('normalize shorts url to watch url', () => {
  assert.strictEqual(
    normalizeInput('https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
});

test('normalize embed url to watch url', () => {
  assert.strictEqual(
    normalizeInput('https://www.youtube.com/embed/dQw4w9WgXcQ?si=demo'),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  );
});

test('split transcript by punctuation and max chars', () => {
  const transcript = '第一句。第二句没有那么短但是也应该被保留！Third sentence without CJK punctuation but still valid?';
  const result = splitTranscript(transcript, { splitPunct: true, paraMaxChars: 20 });
  assert.ok(result.length >= 2);
  assert.ok(result[0].includes('第一句'));
});

test('merge cues within window', () => {
  const merged = mergeCues(
    [
      { start: 0, end: 1, text: '你好' },
      { start: 1.5, end: 2, text: '世界。' },
      { start: 8, end: 9, text: '下一段' },
    ],
    4
  );
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[0].text, '你好世界。');
});

test('paragraph flush works for merged segments', () => {
  const result = toParagraphs(
    [
      { start: 0, end: 1, text: '第一句。' },
      { start: 2, end: 3, text: '第二句。' },
    ],
    { splitPunct: true, paraMaxChars: 240 }
  );
  assert.strictEqual(result.length, 2);
});

if (!process.exitCode) {
  console.log('all tests passed');
}
