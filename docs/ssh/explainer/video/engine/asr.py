# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["faster-whisper==1.1.1", "requests", "av<14"]
# ///
"""Line-based ASR helper: reads WAV paths on stdin, prints one JSON {"text": ...} per line.
Runs on the CPU so it never competes with the TTS server for the GPU."""
import json
import sys

from faster_whisper import WhisperModel

model = WhisperModel("small.en", device="cpu", compute_type="int8")
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    path = line.strip()
    if not path:
        continue
    try:
        segs, _ = model.transcribe(path, language="en", beam_size=1)
        print(json.dumps({"text": " ".join(s.text.strip() for s in segs)}), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"text": None, "error": str(e)}), flush=True)
