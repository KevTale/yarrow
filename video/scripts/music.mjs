// A calm placeholder bed, synthesized: a warm pad, a soft bass and a
// plucked arpeggio with an echo. No samples, no license to track.
// Usage: node scripts/music.mjs public/music.wav [seconds]
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import process from "node:process";

const out = process.argv[2] ?? "public/music.wav";
const seconds = Number(process.argv[3] ?? 32);
const rate = 44100;
const n = Math.floor(seconds * rate);
const left = new Float32Array(n);
const right = new Float32Array(n);

const bpm = 96;
const beat = 60 / bpm;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Fmaj7, Cmaj7/E, Am7, G6: two bars each.
const chords = [
  [53, 57, 60, 64],
  [52, 55, 59, 64],
  [57, 60, 64, 67],
  [55, 59, 62, 64],
];
const bass = [41, 40, 45, 43];
const chordLength = 8 * beat;

// The pad: detuned sines per note, each chord swelling in and out.
for (let k = 0; k * chordLength < seconds; k++) {
  const chord = chords[k % chords.length];
  const start = k * chordLength;
  const end = Math.min(seconds, start + chordLength + 1.2);
  for (const note of chord) {
    for (const [detune, pan] of [
      [-0.06, 0.3],
      [0.06, 0.7],
    ]) {
      const f = hz(note + detune);
      for (let i = Math.floor(start * rate); i < end * rate && i < n; i++) {
        const t = i / rate - start;
        const env = Math.min(1, t / 1.6) * Math.min(1, (end - i / rate) / 1.4);
        const v =
          0.022 *
          env *
          (Math.sin(2 * Math.PI * f * t) +
            0.18 * Math.sin(4 * Math.PI * f * t));
        left[i] += v * (1 - pan);
        right[i] += v * pan;
      }
    }
  }
  // The bass: the root, an octave down, soft.
  const f = hz(bass[k % bass.length]);
  for (let i = Math.floor(start * rate); i < end * rate && i < n; i++) {
    const t = i / rate - start;
    const env = Math.min(1, t / 0.4) * Math.min(1, (end - i / rate) / 1.4);
    const v = 0.05 * env * Math.sin(2 * Math.PI * f * t);
    left[i] += v;
    right[i] += v;
  }
}

// The arpeggio: eighth notes up and down the chord, an octave up, from 3 s.
const pluck = new Float32Array(n);
const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
for (let step = 0; step * (beat / 2) < seconds; step++) {
  const at = step * (beat / 2);
  if (at < 3 || at > seconds - 2.5) continue;
  const chord = chords[Math.floor(at / chordLength) % chords.length];
  const f = hz(chord[pattern[step % pattern.length]] + 12);
  const accent = step % 4 === 0 ? 1 : 0.7;
  for (let i = Math.floor(at * rate); i < (at + 1.2) * rate && i < n; i++) {
    const t = i / rate - at;
    const env = Math.exp(-t * 5.5) * Math.min(1, t / 0.004);
    pluck[i] +=
      0.05 *
      accent *
      env *
      (Math.sin(2 * Math.PI * f * t) +
        0.25 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t * 9));
  }
}
// A dotted-eighth echo, panned wide.
const delay = Math.floor(beat * 0.75 * rate);
const echo = new Float32Array(n);
for (let i = 0; i < n; i++)
  echo[i] = pluck[i] + (i >= delay ? echo[i - delay] * 0.38 : 0);
for (let i = 0; i < n; i++) {
  const wet = echo[i] - pluck[i];
  left[i] += pluck[i] * 0.8 + wet * 0.55;
  right[i] +=
    pluck[i] * 0.8 + (i >= 600 ? (echo[i - 600] - pluck[i - 600]) * 0.55 : 0);
}

// Fade in and out, then 16-bit stereo PCM.
const fadeIn = 1.0;
const fadeOut = 2.8;
const data = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  const t = i / rate;
  const g =
    2.5 * Math.min(1, t / fadeIn) * Math.min(1, (seconds - t) / fadeOut);
  data.writeInt16LE(
    Math.round(Math.max(-1, Math.min(1, left[i] * g)) * 32767),
    i * 4,
  );
  data.writeInt16LE(
    Math.round(Math.max(-1, Math.min(1, right[i] * g)) * 32767),
    i * 4 + 2,
  );
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(out, Buffer.concat([header, data]));
process.stdout.write(`wrote ${out}: ${seconds}s\n`);
