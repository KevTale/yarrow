/* global fetch */
// The film's music from ElevenLabs Music, composed section by section on the
// film's own marks (src/timeline.ts). The model lands its changes near the
// marks, not on them: measure where the groove starts in each new take and
// set MUSIC_OFFSET in src/timeline.ts so it falls on the first cut.
// Usage: node --env-file=.env scripts/music.mjs <style>... → out/music-<style>.mp3
//        then copy the chosen one to public/music.mp3
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is missing from video/.env");

/** Rhythm first, like a product ad: a groove, not a build and a drop. */
const styles = {
  indie: [
    "upbeat indie pop instrumental in the style of an Apple product ad",
    "tight dry live drums, handclaps and finger snaps",
    "bouncy picked bass guitar",
    "staccato piano chords",
    "playful, confident, catchy",
    "118 BPM",
    "crisp modern mix with room for a voiceover",
  ],
  electro: [
    "rhythmic minimal electronic instrumental in the style of an Apple product ad",
    "punchy percussive groove: kick, snappy claps, stomps, shakers",
    "plucked synth bass",
    "short quirky synth hooks",
    "playful, confident, modern",
    "122 BPM",
    "crisp modern mix with room for a voiceover",
  ],
};
const none = [
  "vocals",
  "singing",
  "choir",
  "spoken words",
  "EDM drop",
  "risers",
  "cinematic",
  "epic",
  "corporate",
  "lo-fi hiss",
];

// Seconds on the film's clock: the cuts, and the sponsor's climb at 28 s.
const sections = [
  [
    0,
    6,
    "Intro",
    [
      "finger snaps and a muted staccato riff only",
      "no kick, no bass",
      "a one-beat drum fill at the very end",
    ],
    ["kick", "bass", "riser"],
  ],
  [
    6,
    13.5,
    "Groove",
    [
      "the full groove starts on the very first beat",
      "kick, claps on the backbeat, bass",
      "tight and punchy",
    ],
    ["quiet", "fade in"],
  ],
  [
    13.5,
    20.7,
    "Groove two",
    ["same groove", "adds a bright catchy hook"],
    ["silence"],
  ],
  [
    20.7,
    26,
    "Lift",
    [
      "bigger from the first beat",
      "stomps and extra percussion",
      "the hook doubled",
    ],
    ["quiet"],
  ],
  [
    26,
    32,
    "Strip",
    ["drums and bass only, the hook out", "still driving"],
    ["silence", "riser"],
  ],
  [
    32,
    37,
    "Button",
    [
      "one final staccato hit with the whole band on the first beat, then the music stops",
      "a short natural tail",
    ],
    ["drums after the hit"],
  ],
];

const take = async (style) => {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "music_v1",
        respect_sections_durations: true,
        composition_plan: {
          positive_global_styles: styles[style],
          negative_global_styles: none,
          sections: sections.map(([from, to, name, local, avoid]) => ({
            section_name: name,
            duration_ms: Math.round((to - from) * 1000),
            positive_local_styles: local,
            negative_local_styles: avoid,
            lines: [],
          })),
        },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`${style}: ${response.status} ${await response.text()}`);
  writeFileSync(
    `out/music-${style}.mp3`,
    Buffer.from(await response.arrayBuffer()),
  );
  process.stdout.write(`out/music-${style}.mp3\n`);
};

const chosen = process.argv.slice(2);
if (!chosen.length || chosen.some((style) => !styles[style]))
  throw new Error(`Pick styles among: ${Object.keys(styles).join(", ")}`);
mkdirSync("out", { recursive: true });
await Promise.all(chosen.map(take));
