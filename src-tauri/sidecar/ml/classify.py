"""gender sidecar (norwood male/female), json построчно stdin/stdout"""

from __future__ import annotations

import json
import sys
import time
import traceback
from typing import Any

# https://huggingface.co/norwoodsystems/norwood-maleVSfemale (~95M params, wav2vec2-base)
MODEL_NAME = "norwoodsystems/norwood-maleVSfemale"
SAMPLE_RATE = 16_000
MIN_CLIP_SEC = 0.05
CONFIDENCE_THRESHOLD = 0.55


def emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg: str) -> None:
    emit({"type": "log", "msg": msg})


def normalize_label(label: str) -> str:
    lower = label.strip().lower()
    if lower in ("male", "m", "man"):
        return "male"
    if lower in ("female", "f", "woman"):
        return "female"
    return lower


def resolve_gender(scores: dict[str, float]) -> tuple[str, str | None]:
    male = scores.get("male", 0.0)
    female = scores.get("female", 0.0)
    if male >= female:
        label, top = "male", male
    else:
        label, top = "female", female
    if top < CONFIDENCE_THRESHOLD:
        return "unknown", f"top {label}={top:.2f} < {CONFIDENCE_THRESHOLD}"
    return label, None


def predictions_to_scores(preds: list[dict[str, Any]]) -> dict[str, float]:
    scores = {"male": 0.0, "female": 0.0}
    for item in preds:
        key = normalize_label(str(item.get("label", "")))
        if key in scores:
            scores[key] = float(item.get("score", 0.0))
    return scores


def main() -> None:
    t_import = time.time()
    import numpy as np
    import torch
    import librosa
    from transformers import pipeline

    log(f"imports ready in {time.time() - t_import:.2f}s")

    torch.set_num_threads(max(1, (torch.get_num_threads() or 4) // 2))

    t0 = time.time()
    log(f"loading model {MODEL_NAME} (первый раз: скачивание с Hugging Face в кэш)")
    classifier = pipeline(
        "audio-classification",
        model=MODEL_NAME,
        device="cpu",
        top_k=2,
    )
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
                    "model": MODEL_NAME,
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

                i0 = max(0, int(round(start * SAMPLE_RATE)))
                i1 = min(len(audio), int(round(end * SAMPLE_RATE)))
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

                preds = classifier(
                    {"array": clip, "sampling_rate": SAMPLE_RATE},
                    top_k=2,
                )
                duration_ms = (time.time() - t_inf) * 1000.0

                scores = predictions_to_scores(preds)
                rounded = {k: round(v, 4) for k, v in scores.items()}
                gender, reason = resolve_gender(scores)

                result: dict[str, Any] = {
                    "type": "result",
                    "id": seg_id,
                    "gender": gender,
                    "scores": rounded,
                    "duration_ms": round(duration_ms, 2),
                    "clip_start": round(start, 3),
                    "clip_end": round(end, 3),
                    "clip_sec": round(clip_sec, 3),
                }
                if reason:
                    result["reason"] = reason
                emit(result)
            except Exception as exc:
                emit({
                    "type": "error",
                    "error": f"classify failed: {exc}",
                    "trace": traceback.format_exc(),
                })

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
