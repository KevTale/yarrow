// The voice of the demo on the landing: its lines chained as the brain voices
// them, with a breath between moments for the screen to move. Run from the
// repo root, then copy what it prints into TRY_FILM:
//   npx tsx scripts/landing-voice.mts
import { readFileSync, writeFileSync } from "node:fs";
import { TRY_FILM } from "../src/core/try-ticket";

const key = readFileSync("video/.env", "utf8")
  .match(/^ELEVENLABS_API_KEY=(.*)$/m)![1]!
  .trim()
  .replace(/^"|"$/g, "");
const VOICE = "ZoiZ8fuDWInAcwPXaVeq";
const BYTES_A_SECOND = 128_000 / 8;
// A silent MPEG frame at 128 kbit/s and 44.1 kHz: 1152 samples.
const FRAME = 417;
const FRAME_SECONDS = 1152 / 44_100;
const BREATH = 0.9;

const silence = (seconds: number) => {
  const frames = Math.round(seconds / FRAME_SECONDS);
  const bytes = new Uint8Array(frames * FRAME);
  for (let i = 0; i < frames; i++)
    bytes.set([0xff, 0xfb, 0x90, 0x00], i * FRAME);
  return bytes;
};

const lines = TRY_FILM.map((step) => step.say);
const parts: Uint8Array[] = [];
let at = 0;
for (const [i, text] of lines.entries()) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_v4",
        previous_text: lines.slice(0, i).join(" ") || undefined,
        next_text: lines[i + 1],
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          use_speaker_boost: true,
        },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  const audio = new Uint8Array(await response.arrayBuffer());
  console.log(TRY_FILM[i]!.moment, "at", at.toFixed(1));
  parts.push(audio);
  at += audio.length / BYTES_A_SECOND;
  if (i + 1 < lines.length) {
    parts.push(silence(BREATH));
    at += BREATH;
  }
}
parts.push(silence(0.6));
console.log("length", (at + 0.6).toFixed(1));
writeFileSync("public/demo-priority.mp3", Buffer.concat(parts));
