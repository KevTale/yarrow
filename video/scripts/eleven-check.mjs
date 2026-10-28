/* global fetch */
// Prints the ElevenLabs plan and the voices this account can use. Never the key.
import process from "node:process";
const key = process.env.ELEVENLABS_API_KEY;
const get = (path) =>
  fetch(`https://api.elevenlabs.io${path}`, {
    headers: { "xi-api-key": key },
  }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => null),
  }));
const sub = await get("/v1/user/subscription");
process.stdout.write(
  `subscription ${sub.status}: ${JSON.stringify(sub.body && { tier: sub.body.tier, used: sub.body.character_count, limit: sub.body.character_limit, status: sub.body.status })}\n`,
);
const voices = await get("/v2/voices?page_size=100");
process.stdout.write(`voices ${voices.status}\n`);
for (const v of voices.body?.voices ?? [])
  process.stdout.write(
    `${v.voice_id}  ${v.name}  [${v.category}]  ${JSON.stringify(v.labels ?? {})}\n`,
  );
