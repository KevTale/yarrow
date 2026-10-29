// The film's music, arranged bar by bar from a short loop (ref/clip.wav, a
// royalty-free 16 s clip at 99.8 BPM): two bars of intro, four of groove,
// then its ending. Bars are cut on the measured grid and joined with 5 ms
// crossfades, so the groove lands on the film's first cut (src/timeline.ts)
// and the ending plays on the end card.
// Usage: node scripts/arrange.mjs → public/music.wav
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

/** The clip's grid, measured: one bar, and where its first downbeat is. */
const BAR = 2.4055;
const DOWNBEAT = 0.085;
/** Its parts, in bars: 0–1 intro, 2–5 groove, 6 the ending (it fades). */
const ENDING_SECONDS = 1.6;

/** The film's marks this arrangement answers (seconds). */
const GROOVE_AT = 7;
const LENGTH = 38;

const groove = [2, 3, 4, 5];
const plan = [
  0,
  0,
  1, // the intro, its last bar ending on the cut
  ...groove,
  ...groove,
  ...groove.slice(0, 3), // eleven bars of groove, to the end card
  6, // the clip's own ending
];
const introBars = plan.indexOf(2);

const wav = readFileSync("ref/clip.wav");
let at = 12;
let format;
let data;
while (at < wav.length) {
  const id = wav.toString("ascii", at, at + 4);
  const size = wav.readUInt32LE(at + 4);
  if (id === "fmt ")
    format = {
      channels: wav.readUInt16LE(at + 10),
      rate: wav.readUInt32LE(at + 12),
      bits: wav.readUInt16LE(at + 22),
    };
  if (id === "data") data = wav.subarray(at + 8, at + 8 + size);
  at += 8 + size + (size % 2);
}
if (!format || !data || format.bits !== 16)
  throw new Error("ref/clip.wav must be a 16-bit PCM wav");
const { channels, rate } = format;
const frames = data.length / 2 / channels;
const sample = (frame, channel) =>
  frame < frames ? data.readInt16LE((frame * channels + channel) * 2) : 0;

const out = new Float32Array(Math.round(LENGTH * rate) * channels);
const fade = Math.round(0.005 * rate);
// The first bar starts before the film does, so the groove lands on its mark.
let cursor = Math.round((GROOVE_AT - introBars * BAR) * rate);
for (const bar of plan) {
  const from = Math.round((DOWNBEAT + bar * BAR) * rate);
  const length = Math.round((bar === 6 ? ENDING_SECONDS : BAR) * rate);
  for (let i = -fade; i < length + fade; i++) {
    const target = cursor + i;
    if (target < 0 || target * channels >= out.length) continue;
    // Each bar fades in over the last one's tail and out over the next one's head.
    const gain =
      i < 0 ? (i + fade) / fade : i >= length ? 1 - (i - length) / fade : 1;
    for (let c = 0; c < channels; c++)
      out[target * channels + c] += (gain * sample(from + i, c)) / 32768;
  }
  cursor += length;
}

const pcm = Buffer.alloc(out.length * 2);
out.forEach((v, i) =>
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2),
);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * channels * 2, 28);
header.writeUInt16LE(channels * 2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
writeFileSync("public/music.wav", Buffer.concat([header, pcm]));
process.stdout.write(
  `public/music.wav: ${plan.length} bars, groove at ${GROOVE_AT} s, ending at ${(GROOVE_AT + 11 * BAR).toFixed(2)} s\n`,
);
