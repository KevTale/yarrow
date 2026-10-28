/* global fetch */
// The voiceover from ElevenLabs (src/voice-lines.json): the whole script in
// one take, so the delivery holds from line to line, with each line's span
// read from the character timestamps. The film plays each span on its beat.
// Usage: node --env-file=.env scripts/voice.mjs
//          → public/voice/take.mp3 and src/voice-take.json
//        node --env-file=.env scripts/voice.mjs samples <voiceId>...
//          → out/voices/<voiceId>.mp3, to compare voices
import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is missing from video/.env");
const script = JSON.parse(readFileSync("src/voice-lines.json", "utf8"));
const text = script.lines.map((line) => line.text).join(" ");

async function take(voice) {
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
  // Each line's span: its first spoken character to its last, tags left out.
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
    spans[line.id] = {
      start: Number(starts[spoken[0]].toFixed(3)),
      end: Number(ends[spoken.at(-1)].toFixed(3)),
    };
  }
  writeFileSync("src/voice-take.json", `${JSON.stringify(spans, null, 2)}\n`);
  process.stdout.write(
    `public/voice/take.mp3\n${JSON.stringify(spans, null, 2)}\n`,
  );
}
