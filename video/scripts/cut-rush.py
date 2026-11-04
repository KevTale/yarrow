"""Cut a face-cam rush: drop the silences, tighten the pauses, speed it up, and map the words.

    python -I scripts/cut-rush.py <rush.mp4> <stt.json> public/rush [speed]

The rush is OBS's 3840x1080 side by side (webcam on the right), mic on audio track 1.
stt.json is ElevenLabs speech-to-text of that track (model scribe_v2, word timestamps).

Writes <out>/intro-cam.mp4 (webcam half, cut and sped up, no audio), <out>/intro-voice.wav
(the mic, cut, sped up, cleaned), and <out>/intro.json (cuts and words in output seconds).
"""
import json, subprocess, sys
from pathlib import Path

RUSH = sys.argv[1]
STT = Path(sys.argv[2])
OUT = Path(sys.argv[3])
SPEED = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0  # 1.1 was felt on the face cam
FPS = 30
KEEP_AFTER, KEEP_BEFORE = 0.16, 0.14  # around each tightened pause, before speed
MAX_GAP = 0.42                        # pauses longer than this are tightened
DROP = {"uh,", "uh", "um,", "um"}

words = [w for w in json.load(open(STT))["words"] if w["type"] == "word"]
spoken = [w for w in words if w["text"].lower() not in DROP]

# Keep intervals: from just before the first word to just after the last, minus long pauses.
snap = lambda t: round(t * FPS) / FPS
keeps = []
start = spoken[0]["start"] - 0.10
for a, b in zip(spoken, spoken[1:]):
    if b["start"] - a["end"] > MAX_GAP:
        keeps.append((snap(start), snap(a["end"] + KEEP_AFTER)))
        start = b["start"] - KEEP_BEFORE
keeps.append((snap(start), snap(spoken[-1]["end"] + 0.35)))

def out_time(t: float) -> float:
    acc = 0.0
    for s, e in keeps:
        if t < s:
            return acc / SPEED
        if t <= e:
            return (acc + t - s) / SPEED
        acc += e - s
    return acc / SPEED

total = sum(e - s for s, e in keeps) / SPEED
cuts = [out_time(s) for s, _ in keeps[1:]]

# Captions: what was meant, at the moment it was said.
FIX = {"Yero.": "Yarrow.", "Yero": "Yarrow", "Pharos": "Faros", "twenty-twenty-six,": "2026,",
       "twenty-twenty-four,": "2024,"}
mapped = []
i = 0
while i < len(spoken):
    w = spoken[i]
    text = w["text"]
    if text == "one" and spoken[i + 1]["text"] == "point":
        mapped.append(["1.3", out_time(w["start"]), out_time(spoken[i + 2]["end"])])
        i += 3
        continue
    mapped.append([FIX.get(text, text), out_time(w["start"]), out_time(w["end"])])
    i += 1

OUT.mkdir(parents=True, exist_ok=True)
json.dump({"duration": total, "speed": SPEED, "cuts": cuts, "keeps": keeps,
           "words": [[t, round(s, 3), round(e, 3)] for t, s, e in mapped]},
          open(OUT / "intro.json", "w"), indent=1)

n = len(keeps)
v = "".join(f"[0:v]crop=1920:1080:1920:0,trim={s}:{e},setpts=PTS-STARTPTS[v{k}];" for k, (s, e) in enumerate(keeps))
v += "".join(f"[v{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=0,setpts=PTS/{SPEED},fps={FPS}[v]"
a = "".join(
    f"[0:1]atrim={s}:{e},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st={e - s - 0.012:.3f}:d=0.012[a{k}];"
    for k, (s, e) in enumerate(keeps))
a += "".join(f"[a{k}]" for k in range(n)) + (
    f"concat=n={n}:v=0:a=1,rubberband=tempo={SPEED}:formant=preserved,"
    "highpass=f=80,acompressor=threshold=-24dB:ratio=3:attack=8:release=120:makeup=2[a]")

subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", RUSH, "-filter_complex", v + ";" + a,
                "-map", "[v]", "-c:v", "libx264", "-crf", "15", "-preset", "medium", "-g", "15",
                "-pix_fmt", "yuv420p", "-an", str(OUT / "intro-cam.mp4"),
                "-map", "[a]", "-ar", "48000", "-ac", "1", str(OUT / "intro-raw.wav")], check=True)

# Loudness: two passes to -16 LUFS.
probe = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(OUT / "intro-raw.wav"), "-af",
                        "loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
m = json.loads(probe[probe.rindex("{"):probe.rindex("}") + 1])
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(OUT / "intro-raw.wav"), "-af",
                f"loudnorm=I=-16:TP=-1.5:LRA=9:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true",
                "-ar", "48000", "-ac", "2", str(OUT / "intro-voice.wav")], check=True)
(OUT / "intro-raw.wav").unlink()
print(f"{len(keeps)} pieces, {total:.2f} s (from {words[-1]['end'] - words[1]['start']:.2f} s of speech)")
print("cuts at", [round(c, 2) for c in cuts])
