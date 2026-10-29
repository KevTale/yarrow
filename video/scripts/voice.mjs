/* global fetch */
// The voiceover from ElevenLabs (src/voice-lines.json): the whole script in
// one take, so the delivery holds from line to line, with each line's span
// read from the character timestamps. The film plays each span on its beat.
// Usage: node --env-file=.env scripts/voice.mjs
//          → public/voice/take.mp3 and src/voice-take.json
//        node scripts/voice.mjs cuts → places the cuts again, no new take
//        node --env-file=.env scripts/voice.mjs samples <voiceId>...
//          → out/voices/<voiceId>.mp3, to compare voices
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const key = process.env.ELEVENLABS_API_KEY;
const script = JSON.parse(readFileSync("src/voice-lines.json", "utf8"));
// A blank line between lines: a real pause, so each cut lands in silence.
const text = script.lines.map((line) => line.text).join("\n\n");

async function take(voice) {
  if (!key) throw new Error("ELEVENLABS_API_KEY is missing from video/.env");
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: script.model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

if (process.argv[2] === "samples") {
  mkdirSync("out/voices", { recursive: true });
  for (const voice of process.argv.slice(3)) {
    const { audio_base64 } = await take(voice);
    writeFileSync(
      `out/voices/${voice}.mp3`,
      Buffer.from(audio_base64, "base64"),
    );
    process.stdout.write(`out/voices/${voice}.mp3\n`);
  }
} else if (process.argv[2] === "cuts") {
  writeSpans(cut(JSON.parse(readFileSync("src/voice-take.json", "utf8"))));
} else {
  const result = await take(script.voice);
  mkdirSync("public/voice", { recursive: true });
  writeFileSync(
    "public/voice/take.mp3",
    Buffer.from(result.audio_base64, "base64"),
  );
  const {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  } = result.alignment;
  if (characters.join("") !== text)
    throw new Error("The alignment does not match the text sent");
  // Each line's rough span: its first spoken character to its last, tags
  // left out. The timestamps run late at a pause, so cut() places the cuts.
  let offset = 0;
  const spans = {};
  for (const line of script.lines) {
    const begin = text.indexOf(line.text, offset);
    const end = begin + line.text.length;
    offset = end;
    const spoken = [];
    let inTag = false;
    for (let i = begin; i < end; i++) {
      if (text[i] === "[") inTag = true;
      else if (text[i] === "]") inTag = false;
      else if (!inTag && /\S/.test(text[i])) spoken.push(i);
    }
    spans[line.id] = { start: starts[spoken[0]], end: ends[spoken.at(-1)] };
  }
  writeSpans(cut(spans));
}

function writeSpans(spans) {
  writeFileSync("src/voice-take.json", `${JSON.stringify(spans, null, 2)}\n`);
  process.stdout.write(`src/voice-take.json\n${JSON.stringify(spans)}\n`);
}

/**
 * Where each line really starts and stops in the take: the longest silence
 * near each rough boundary (10 ms windows under -45 dB). A line plays from
 * just before its first sound to a short tail into the silence, so no cut
 * ever catches the next word.
 */
function cut(rough) {
  const wav = "out/voice.wav";
  mkdirSync("out", { recursive: true });
  const ffmpeg = spawnSync(
    `npx remotion ffmpeg -y -loglevel error -i public/voice/take.mp3 -ac 1 -ar 16000 -c:a pcm_s16le ${wav}`,
    { shell: true, stdio: "inherit" },
  );
  if (ffmpeg.status !== 0) throw new Error("ffmpeg could not decode the take");
  const data = readFileSync(wav);
  const pcm = data.indexOf("data") + 8;
  const quiet = [];
  for (let at = pcm; at + 320 <= data.length; at += 320) {
    let sum = 0;
    for (let k = 0; k < 160; k++)
      sum += (data.readInt16LE(at + 2 * k) / 32768) ** 2;
    quiet.push(10 * Math.log10(sum / 160 + 1e-12) < -45);
  }
  const ids = Object.keys(rough);
  const seconds = (i) => Number((i / 100).toFixed(2));
  const spans = {};
  const first = quiet.indexOf(false);
  const last = quiet.lastIndexOf(false);
  spans[ids[0]] = { start: seconds(Math.max(0, first - 5)) };
  for (let n = 0; n < ids.length - 1; n++) {
    const from = Math.max(0, Math.floor((rough[ids[n]].end - 0.8) * 100));
    const to = Math.ceil((rough[ids[n + 1]].start + 0.3) * 100);
    let best = { at: from, length: 0 };
    for (let i = from, run = 0; i <= to; i++) {
      run = quiet[i] ? run + 1 : 0;
      if (run > best.length) best = { at: i - run + 1, length: run };
    }
    if (best.length < 15)
      throw new Error(`No pause between ${ids[n]} and ${ids[n + 1]}`);
    const tail = Math.min(15, Math.floor(best.length / 2));
    spans[ids[n]].end = seconds(best.at + tail);
    spans[ids[n + 1]] = { start: seconds(best.at + best.length - 5) };
  }
  spans[ids.at(-1)].end = seconds(Math.min(quiet.length, last + 20));
  return spans;
}
