/* global fetch */
// The cloned-voice film's lines (src/hackathon/voice/lines.json), read by the
// ElevenLabs instant clone of Kevin's voice (src/hackathon/voice/clone.json),
// one take per line with the time each word starts. A line already taken is
// kept unless its text changed. The takes go to public/rush/voice/ (kept out
// of git: a synthetic copy of a real voice), their timings to
// src/hackathon/voice/takes.json.
// Usage: node --env-file=.env scripts/clone-voice.mjs [id...]
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const script = JSON.parse(readFileSync("src/hackathon/voice/lines.json", "utf8"));
const { voice } = JSON.parse(readFileSync("src/hackathon/voice/clone.json", "utf8"));
const out = "src/hackathon/voice/takes.json";
const dir = "public/rush/voice";
const taken = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
mkdirSync(dir, { recursive: true });

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is missing from video/.env");
const only = process.argv.slice(2);
let characters = 0;
for (const line of script.lines) {
  const again = only.length ? only.includes(line.id) : taken[line.id]?.text !== line.text || !existsSync(`${dir}/${line.id}.mp3`);
  if (!again) continue;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_192`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: line.text, model_id: script.model, voice_settings: script.settings }),
  });
  if (!response.ok) throw new Error(`${line.id}: ${response.status} ${await response.text()}`);
  const { audio_base64, alignment } = await response.json();
  writeFileSync(`${dir}/${line.id}.mp3`, Buffer.from(audio_base64, "base64"));
  const { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words = [];
  let word = null;
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      word = null;
      return;
    }
    if (!word) words.push((word = [ch, starts[i], ends[i]]));
    else {
      word[0] += ch;
      word[2] = ends[i];
    }
  });
  taken[line.id] = { text: line.text, duration: Number((ends.at(-1) + 0.1).toFixed(3)), words };
  characters += line.text.length;
  process.stdout.write(`${line.id} ${taken[line.id].duration}s\n`);
}
writeFileSync(out, `${JSON.stringify(taken, null, 1)}\n`);
process.stdout.write(`${characters} characters\n`);
