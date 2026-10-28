/* global fetch */
// The film's music from ElevenLabs Music, composed section by section on the
// film's own marks (src/timeline.ts). The model lands its changes near the
// marks, not on them: measure the drop after each new take and set
// MUSIC_OFFSET in src/timeline.ts so it falls on the first cut.
// Usage: node --env-file=.env scripts/music.mjs → public/music.mp3
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import process from "node:process";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("ELEVENLABS_API_KEY is missing from video/.env");

const style = [
  "modern tech product launch music",
  "instrumental",
  "electronic, warm and optimistic",
  "122 BPM",
  "clean mix with room for a voiceover",
];
const none = ["vocals", "singing", "choir", "spoken words", "lo-fi hiss"];

// Seconds on the film's clock: the cuts, and the sponsor's climb at 29 s.
const sections = [
  [
    0,
    6,
    "Intro",
    [
      "very sparse and quiet",
      "soft plucked synth arpeggio only",
      "no drums, no bass",
      "a riser swelling in the last two seconds",
    ],
    ["drums", "kick", "bass"],
  ],
  [
    6,
    13.5,
    "Drop",
    [
      "sudden full beat from the very first beat",
      "punchy four-on-the-floor kick",
      "deep bass",
      "bright synth stabs",
      "loud and confident",
    ],
    ["quiet", "ambient"],
  ],
  [
    13.5,
    20.7,
    "Groove",
    ["steady groove", "kick, hi-hats and bass", "warm chords"],
    ["silence"],
  ],
  [
    20.7,
    26,
    "Lift",
    [
      "bigger from the first beat",
      "claps on every backbeat",
      "shimmering lead synth",
    ],
    ["quiet"],
  ],
  [
    26,
    29,
    "Breakdown",
    ["drums and bass stop", "pad only", "riser"],
    ["kick", "drums"],
  ],
  [
    29,
    32,
    "Peak",
    [
      "massive full drop on the first beat",
      "every element at once",
      "euphoric",
    ],
    ["quiet"],
  ],
  [
    32,
    36,
    "Outro",
    [
      "one big impact hit on the first beat then the music stops",
      "a soft pad tail fading out",
    ],
    ["drums after the hit"],
  ],
];

const response = await fetch(
  "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
  {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: "music_v1",
      respect_sections_durations: true,
      composition_plan: {
        positive_global_styles: style,
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
  throw new Error(`${response.status} ${await response.text()}`);
writeFileSync("public/music.mp3", Buffer.from(await response.arrayBuffer()));
process.stdout.write(
  `public/music.mp3 (song ${response.headers.get("song-id") ?? "?"})\n`,
);
