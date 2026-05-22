"""gender sidecar, json построчно stdin/stdout"""

from __future__ import annotations

import json
import sys
import time
import traceback
from typing import Any


MODEL_NAME = "prithivMLmods/Common-Voice-Gender-Detection"
SAMPLE_RATE = 16_000
MIN_CLIP_SEC = 0.30
CONFIDENCE_THRESHOLD = 0.60
ID2LABEL = {0: "female", 1: "male"}


def emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg: str) -> None:
    emit({"type": "log", "msg": msg})


def main() -> None:
    t_import = time.time()
    import numpy as np
    import torch
    import librosa
    from transformers import (
        Wav2Vec2ForSequenceClassification,
        Wav2Vec2FeatureExtractor,
    )

    log(f"imports ready in {time.time() - t_import:.2f}s")

    torch.set_num_threads(max(1, (torch.get_num_threads() or 4) // 2))

    t0 = time.time()
    log(f"loading model {MODEL_NAME}")
    model = Wav2Vec2ForSequenceClassification.from_pretrained(MODEL_NAME)
    processor = Wav2Vec2FeatureExtractor.from_pretrained(MODEL_NAME)
    model.eval()
    log(f"model loaded in {time.time() - t0:.2f}s")

    audio: np.ndarray | None = None
    audio_duration = 0.0

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except Exception as exc:
            emit({"type": "error", "error": f"bad json: {exc}"})
            continue

        cmd = req.get("cmd")

        if cmd == "init":
            path = req.get("audio_path", "")
            if not path:
                emit({"type": "error", "error": "init: audio_path missing"})
                continue
            try:
                t_load = time.time()
                samples, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
                audio = samples.astype(np.float32, copy=False)
                audio_duration = float(len(audio)) / SAMPLE_RATE
                log(
                    f"audio loaded: {audio_duration:.2f}s, "
                    f"{len(audio)} samples in {time.time() - t_load:.2f}s"
                )
                emit({
                    "type": "ready",
                    "duration": audio_duration,
                    "device": "cpu",
                })
            except Exception as exc:
                emit({"type": "error", "error": f"load failed: {exc}"})

        elif cmd == "classify":
            if audio is None:
                emit({"type": "error", "error": "classify before init"})
                continue
            try:
                seg_id = req.get("id")
                start = float(req.get("start", 0.0))
                end = float(req.get("end", 0.0))
                clip_sec = max(0.0, end - start)

                if clip_sec < MIN_CLIP_SEC:
                    emit({
                        "type": "result",
                        "id": seg_id,
                        "gender": "unknown",
                        "scores": {"male": 0.0, "female": 0.0},
                        "duration_ms": 0.0,
                        "reason": f"clip {clip_sec:.2f}s < {MIN_CLIP_SEC}s",
                    })
                    continue

                i0 = max(0, int(start * SAMPLE_RATE))
                i1 = min(len(audio), int(end * SAMPLE_RATE))
                if i1 <= i0:
                    emit({
                        "type": "result",
                        "id": seg_id,
                        "gender": "unknown",
                        "scores": {"male": 0.0, "female": 0.0},
                        "duration_ms": 0.0,
                        "reason": "empty slice",
                    })
                    continue

                clip = audio[i0:i1]
                t_inf = time.time()
                inputs = processor(
                    clip,
                    sampling_rate=SAMPLE_RATE,
                    return_tensors="pt",
                    padding=True,
                )
                with torch.no_grad():
                    logits = model(**inputs).logits
                    probs = torch.softmax(logits, dim=1).squeeze().tolist()
                if not isinstance(probs, list):
                    probs = [probs]
                duration_ms = (time.time() - t_inf) * 1000.0

                scores = {
                    ID2LABEL[i]: round(float(probs[i]), 4)
                    for i in range(len(probs))
                }
                top_idx = max(range(len(probs)), key=lambda i: probs[i])
                top_label = ID2LABEL[top_idx]
                top_prob = float(probs[top_idx])
                gender = top_label if top_prob >= CONFIDENCE_THRESHOLD else "unknown"

                result: dict[str, Any] = {
                    "type": "result",
                    "id": seg_id,
                    "gender": gender,
                    "scores": scores,
                    "duration_ms": round(duration_ms, 2),
                }
                if gender == "unknown" and top_prob < CONFIDENCE_THRESHOLD:
                    result["reason"] = (
                        f"top {top_label}={top_prob:.2f} < threshold {CONFIDENCE_THRESHOLD}"
                    )
                emit(result)
            except Exception as exc:
                emit({"type": "error", "error": f"classify failed: {exc}"})

        elif cmd == "quit":
            log("quit received")
            return

        else:
            emit({"type": "error", "error": f"unknown cmd: {cmd}"})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:
        emit({
            "type": "error",
            "error": str(exc),
            "trace": traceback.format_exc(),
        })
        sys.exit(1)
