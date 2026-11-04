/* global fetch */
// The hackathon film's voices from ElevenLabs (src/hackathon/lines.json):
// one take per line, so the film can place each line on its beat, with the
// time each word starts for the captions. A line already taken is kept
// unless its text changed. eleven_v4 ignores the speed setting, so the take
// is sped up afterwards ("tempo", pitch kept) and its word times with it.
// Usage: node --env-file=.env scripts/hackathon-voice.mjs [id...]
//          → public/hackathon/voice/<id>.mp3 and src/hackathon/voice.json
//        node scripts/hackathon-voice.mjs tempo → the tempo again, no new take
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const script = JSON.parse(readFileSync("src/hackathon/lines.json", "utf8"));
const tempo = script.tempo ?? 1;
const out = "src/hackathon/voice.json";
const raw = "out/hackathon-raw";
const taken = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
mkdirSync("public/hackathon/voice", { recursive: true });
mkdirSync(raw, { recursive: true });

function speedUp(id) {
  const ffmpeg = spawnSync(
    `npx remotion ffmpeg -y -loglevel error -i ${raw}/${id}.mp3 -filter:a atempo=${tempo} -b:a 160k public/hackathon/voice/${id}.mp3`,
    { shell: true, stdio: "inherit" },
  );
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg could not speed up ${id}`);
  const line = taken[id];
  line.duration = Number((line.rawDuration / tempo).toFixed(2));
  line.words = line.rawWords.map(([word, at]) => [word, Number((at / tempo).toFixed(2))]);
}

if (process.argv[2] === "tempo") {
  for (const id of Object.keys(taken)) speedUp(id);
} else {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is missing from video/.env");
  const only = process.argv.slice(2);
  for (const line of script.lines) {
    const again = only.length
      ? only.includes(line.id)
      : taken[line.id]?.text !== line.text || !existsSync(`${raw}/${line.id}.mp3`);
    if (!again) continue;
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${script.voices[line.by]}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: line.text,
          model_id: script.model,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, use_speaker_boost: true },
        }),
      },
    );
    if (!response.ok) throw new Error(`${line.id}: ${response.status} ${await response.text()}`);
    const { audio_base64, alignment } = await response.json();
    writeFileSync(`${raw}/${line.id}.mp3`, Buffer.from(audio_base64, "base64"));
    const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
    // Its words, each with the time its first letter starts; tags left out.
    const words = [];
    let inTag = false;
    let word = null;
    characters.forEach((ch, i) => {
      if (ch === "[") inTag = true;
      if (inTag || /\s/.test(ch)) {
        word = null;
        if (ch === "]") inTag = false;
        return;
      }
      if (!word) words.push((word = [ch, starts[i]]));
      else word[0] += ch;
    });
    taken[line.id] = { text: line.text, by: line.by, rawDuration: ends.at(-1) + 0.15, rawWords: words };
    speedUp(line.id);
    process.stdout.write(`${line.id} ${taken[line.id].duration}s\n`);
  }
}
writeFileSync(out, `${JSON.stringify(taken, null, 2)}\n`);
const total = Object.values(taken).reduce((sum, line) => sum + line.duration, 0);
process.stdout.write(`${Object.keys(taken).length} lines, ${total.toFixed(1)}s of voice\n`);
