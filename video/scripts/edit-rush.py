"""Cut a screen-share rush by an edit list: talk kept at its own pace (fillers out, pauses tight),
actions sped up, the agent's voice taken from the app track and its bleed muted on the mic.

    python -I scripts/edit-rush.py <rush.mp4> <edl.json> <stt-mic.json> <stt-app.json> <outdir> <cut.json>

The rush is OBS's 3840x1080 side by side: the screen on the left, the webcam on the right,
the mic on audio track 1 and Chrome on track 2. Both stt files are ElevenLabs speech-to-text
(scribe_v2, word timestamps). Writes <outdir>/<name>-screen.mp4, -cam.mp4 (a square on the face),
-mix.wav (each voice at -16 LUFS), and <cut.json>: the segments and pieces in output seconds.
"""
import json, subprocess, sys, tempfile
from pathlib import Path

import numpy as np

RUSH, EDL, STT_MIC, STT_APP, OUT, CUT = sys.argv[1:7]
OUT = Path(OUT)
FPS, SR = 30, 48000
FILLERS = {"uh", "um", "euh", "uhm"}
FACE_X = 3250  # the face's x on the 3840-wide rush

edl = json.load(open(EDL))
name = edl["name"]
norm = lambda t: "".join(ch for ch in t.lower() if ch.isalnum() or ch == "'")
mic = [w for w in json.load(open(STT_MIC))["words"] if w["type"] == "word"]
app = [w for w in json.load(open(STT_APP))["words"] if w["type"] == "word"]

# Kevin's words: mic words the app track did not just say (the speakers bleed into the mic).
def bleed(w):
    return any(norm(a["text"]) == norm(w["text"]) and -0.15 <= w["start"] - a["start"] <= 0.45 for a in app)
kevin = [w for w in mic if not bleed(w)]

# Pieces: talk keeps its words (fillers out, long pauses tightened), actions run at their speed.
snap = lambda t: round(t * FPS) / FPS
pieces = []
for i, seg in enumerate(edl["segments"]):
    a, b = seg["in"], seg["out"]
    if seg["kind"] == "act":
        pieces.append({"seg": i, "in": snap(a), "out": snap(b), "speed": seg["speed"], "audio": False})
        continue
    # Only the voices heard in this segment shape its cuts.
    words = sorted(([] if seg.get("muteMic") else [dict(w, who="k") for w in kevin if a <= w["start"] < b]) +
                   ([] if seg.get("muteApp") else [dict(w, who="a") for w in app if a <= w["start"] < b]),
                   key=lambda w: w["start"])
    filler = lambda w: w["who"] == "k" and norm(w["text"]) in FILLERS
    kept = [w for w in words if not filler(w)]
    cuts = []
    for p, q in zip(kept, kept[1:]):
        between = [w for w in words if p["start"] < w["start"] < q["start"]]
        if any(filler(w) for w in between):
            lo, hi = p["end"] + 0.05, q["start"] - 0.05
        elif q["start"] - p["end"] > 0.42:
            lo, hi = p["end"] + 0.16, q["start"] - 0.14
        else:
            continue
        if hi - lo >= 0.1:
            cuts.append((lo, hi))
    start = a
    for lo, hi in cuts:
        pieces.append({"seg": i, "in": snap(start), "out": snap(lo), "speed": 1, "audio": True})
        start = hi
    pieces.append({"seg": i, "in": snap(start), "out": snap(b), "speed": 1, "audio": True})
for p in pieces:
    seg = edl["segments"][p["seg"]]
    p["frames"] = max(1, round((p["out"] - p["in"]) / p["speed"] * FPS))
    p["muteApp"] = seg.get("muteApp", False)
    p["muteMic"] = seg.get("muteMic", False)

# Output times.
t = 0
for p in pieces:
    p["at"] = t
    t += p["frames"]
total = t
segments = []
for i, seg in enumerate(edl["segments"]):
    own = [p for p in pieces if p["seg"] == i]
    segments.append({k: v for k, v in seg.items() if k not in ("in", "out")} |
                    {"from": own[0]["at"], "to": own[-1]["at"] + own[-1]["frames"], "src": [seg["in"], seg["out"]]})

# ---------- Audio ----------
def track(index):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", RUSH, "-map", f"0:{index}", "-ac", "1", "-ar", str(SR),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

mic_wave, app_wave = track(1), track(2)

# The mic is muted wherever the agent speaks and Kevin does not.
gain = np.ones(len(mic_wave), dtype=np.float32)
spans = []
for w in app:
    s, e = w["start"] - 0.05, w["end"] + 0.35
    if spans and s - spans[-1][1] < 0.6:
        spans[-1][1] = e
    else:
        spans.append([s, e])
for s, e in spans:
    gain[int(max(0, s) * SR):int(e * SR)] = 0
for w in kevin:
    gain[int(max(0, w["start"] - 0.1) * SR):int((w["end"] + 0.12) * SR)] = 1
ramp = int(0.012 * SR)
c = np.cumsum(np.concatenate([[0], gain]))
gain = ((c[ramp:] - c[:-ramp]) / ramp).astype(np.float32)
gain = np.concatenate([gain, np.ones(len(mic_wave) - len(gain), dtype=np.float32)])
mic_wave = mic_wave * gain

def cut(wave, mute_key):
    parts = []
    fade = int(0.008 * SR)
    for p in pieces:
        n = round(p["frames"] / FPS * SR)
        if not p["audio"] or p[mute_key]:
            parts.append(np.zeros(n, dtype=np.float32))
            continue
        s = int(p["in"] * SR)
        part = wave[s:s + n].copy()
        part = np.pad(part, (0, n - len(part)))
        part[:fade] *= np.linspace(0, 1, fade)
        part[-fade:] *= np.linspace(1, 0, fade)
        parts.append(part)
    return np.concatenate(parts)

OUT.mkdir(parents=True, exist_ok=True)
tmp = Path(tempfile.mkdtemp())
def loudnorm(src, dst, pre=""):
    chain = (pre + "," if pre else "")
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", str(src), "-af",
                            chain + "loudnorm=I=-16:TP=-2:LRA=9:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True).stderr
    m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", str(src), "-af",
                    chain + f"loudnorm=I=-16:TP=-2:LRA=9:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                    f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true",
                    "-ar", str(SR), "-ac", "1", str(dst)], check=True)

cut(mic_wave, "muteMic").tofile(tmp / "mic.f32")
cut(app_wave, "muteApp").tofile(tmp / "app.f32")
loudnorm(tmp / "mic.f32", tmp / "mic.wav", "highpass=f=80,acompressor=threshold=-24dB:ratio=3:attack=8:release=120:makeup=2")
loudnorm(tmp / "app.f32", tmp / "app.wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp / "mic.wav"), "-i", str(tmp / "app.wav"), "-filter_complex",
                "[0][1]amix=inputs=2:normalize=0,alimiter=limit=0.85:level=false", "-ac", "2", str(OUT / f"{name}-mix.wav")],
               check=True)

# ---------- Video: each piece encoded alone, then joined ----------
lists = {"screen": [], "cam": []}
for k, p in enumerate(pieces):
    speed = p["speed"]
    sp = f"setpts=(PTS-STARTPTS)/{speed},fps={FPS}"
    s_out, c_out = tmp / f"s{k:03d}.mp4", tmp / f"c{k:03d}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{p['in']:.4f}", "-t", f"{p['out'] - p['in'] + 0.2:.4f}", "-i", RUSH,
                    "-filter_complex",
                    f"[0:v]split[a][b];[a]crop=1920:1080:0:0,{sp}[s];[b]crop=1080:1080:{FACE_X - 540}:0,scale=540:540,{sp}[c]",
                    "-map", "[s]", "-frames:v", str(p["frames"]), "-c:v", "libx264", "-crf", "14", "-preset", "veryfast",
                    "-g", "30", "-pix_fmt", "yuv420p", "-an", str(s_out),
                    "-map", "[c]", "-frames:v", str(p["frames"]), "-c:v", "libx264", "-crf", "16", "-preset", "veryfast",
                    "-g", "30", "-pix_fmt", "yuv420p", "-an", str(c_out)], check=True)
    lists["screen"].append(s_out)
    lists["cam"].append(c_out)
    print(f"piece {k + 1}/{len(pieces)}", flush=True)
for kind, files in lists.items():
    listing = tmp / f"{kind}.txt"
    listing.write_text("".join(f"file '{f.as_posix()}'\n" for f in files))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
                    str(OUT / f"{name}-{kind}.mp4")], check=True)

json.dump({"frames": total, "segments": segments,
           "pieces": [{k: p[k] for k in ("seg", "in", "out", "speed", "at", "frames")} for p in pieces]},
          open(CUT, "w"), indent=1)
print(f"{len(pieces)} pieces, {total / FPS:.1f} s")
