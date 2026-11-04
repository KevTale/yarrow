"""The cloned-voice film's middle: the screen of the screen-share rush, beat by beat, under
Kevin's cloned voice and the agent's real voice.

    python -I scripts/edit-voice.py <rush.mp4>

Reads src/hackathon/voice/edl.json (each beat: a span of the rush, and either a cloned line
the span is fitted to, the agent's own words from Chrome's track, or a set length) and
src/hackathon/voice/takes.json (the cloned lines, from scripts/clone-voice.mjs). Writes
public/rush/voice-screen.mp4, public/rush/voice-mix.wav (both voices at -16 LUFS) and
src/hackathon/voice/cut.json (the beats in output frames). The rush's mic is never used.
"""
import json, subprocess, sys, tempfile
from pathlib import Path

import numpy as np

RUSH = sys.argv[1]
FPS, SR = 30, 48000
edl = json.load(open("src/hackathon/voice/edl.json", encoding="utf-8"))
takes = json.load(open("src/hackathon/voice/takes.json", encoding="utf-8"))
tmp = Path(tempfile.mkdtemp())

def decode(args):
    raw = subprocess.run(["ffmpeg", "-v", "error", *args, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

app = decode(["-i", RUSH, "-map", "0:2"])

# Each beat's length: a cloned line sets it (the span is sped to fit), the agent plays at its own pace.
beats = []
at = 0
for beat in edl["beats"]:
    a, b = beat["src"]
    if "say" in beat:
        seconds = beat.get("at", 0) + takes[beat["say"]]["duration"] + beat.get("tail", 0.25)
    elif "seconds" in beat:
        seconds = beat["seconds"]
    else:
        seconds = b - a
    frames = round(seconds * FPS)
    speed = (b - a) / (frames / FPS)
    beats.append(dict(beat, frames=frames, speed=speed, start=at))
    at += frames
total = at

# Video: each beat encoded alone, then joined.
files = []
for k, beat in enumerate(beats):
    a, b = beat["src"]
    out = tmp / f"v{k:03d}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.4f}", "-t", f"{b - a + 0.3:.4f}", "-i", RUSH,
                    "-vf", f"crop=1920:1080:0:0,setpts=(PTS-STARTPTS)/{beat['speed']:.6f},fps={FPS},tpad=stop_mode=clone:stop_duration=1",
                    "-frames:v", str(beat["frames"]), "-c:v", "libx264", "-crf", "14", "-preset", "veryfast", "-g", "30",
                    "-pix_fmt", "yuv420p", "-an", str(out)], check=True)
    files.append(out)
    print(f"{beat['id']}: {beat['frames'] / FPS:.2f} s at {beat['speed']:.2f}x", flush=True)
listing = tmp / "list.txt"
listing.write_text("".join(f"file '{f.as_posix()}'\n" for f in files))
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
                "public/rush/voice-screen.mp4"], check=True)

# Audio: Kevin's cloned lines on one track, the agent's own words on another.
n = round(total / FPS * SR)
clone = np.zeros(n, dtype=np.float32)
agent = np.zeros(n, dtype=np.float32)
fade = int(0.01 * SR)
for beat in beats:
    s = round(beat["start"] / FPS * SR)
    if "say" in beat:
        line = decode(["-i", f"public/rush/voice/{beat['say']}.mp3"])
        o = s + round(beat.get("at", 0) * SR)
        clone[o:o + len(line)] += line[: n - o]
    elif beat.get("agent"):
        a = round(beat["src"][0] * SR)
        part = app[a:a + round(beat["frames"] / FPS * SR)].copy()
        part[:fade] *= np.linspace(0, 1, fade)
        part[-fade:] *= np.linspace(1, 0, fade)
        agent[s:s + len(part)] += part

def loudnorm(wave, dst):
    src = tmp / (dst.stem + ".f32")
    wave.tofile(src)
    base = ["-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", str(src)]
    probe = subprocess.run(["ffmpeg", "-hide_banner", *base, "-af", "loudnorm=I=-16:TP=-2:LRA=9:print_format=json",
                            "-f", "null", "-"], capture_output=True, text=True).stderr
    m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    subprocess.run(["ffmpeg", "-v", "error", "-y", *base, "-af",
                    f"loudnorm=I=-16:TP=-2:LRA=9:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                    f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true",
                    "-ar", str(SR), "-ac", "1", str(dst)], check=True)

loudnorm(clone, tmp / "clone.wav")
loudnorm(agent, tmp / "agent.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp / "clone.wav"), "-i", str(tmp / "agent.wav"), "-filter_complex",
                "[0][1]amix=inputs=2:normalize=0,alimiter=limit=0.85:level=false", "-ac", "2", "public/rush/voice-mix.wav"],
               check=True)

json.dump({"frames": total, "beats": [{k: v for k, v in b.items() if k in ("id", "start", "frames", "speed", "src", "say", "at", "label", "since")}
                                      for b in beats]},
          open("src/hackathon/voice/cut.json", "w", encoding="utf-8", newline=""), indent=1)
print(f"{len(beats)} beats, {total / FPS:.1f} s")
