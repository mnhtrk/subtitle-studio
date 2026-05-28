"""silero vad, json построчно stdin/stdout

Команды:
  {"cmd":"detect","audio_path":"...","speech_pad_ms":200,...}
  {"cmd":"quit"}
"""

from __future__ import annotations

import json
import sys
import time
import traceback
from typing import Any


SAMPLE_RATE = 16_000


def emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg: str) -> None:
    emit({"type": "log", "msg": msg})


def load_silero_vad_safe():
    # jit из bytes - на windows кириллица в пути ломает torch
    import io
    import torch
    from importlib import resources

    ref = resources.files("silero_vad.data").joinpath("silero_vad.jit")
    jit_bytes = ref.read_bytes()
    model = torch.jit.load(io.BytesIO(jit_bytes), map_location="cpu")
    model.eval()
    return model


def main() -> None:
    t_import = time.time()
    import torch
    from silero_vad import read_audio, get_speech_timestamps

    log(f"imports ready in {time.time() - t_import:.2f}s")

    torch.set_num_threads(max(1, (torch.get_num_threads() or 4) // 2))

    t0 = time.time()
    log("loading silero-vad model (in-memory, path-safe)")
    model = load_silero_vad_safe()
    log(f"model loaded in {time.time() - t0:.2f}s")

    emit({"type": "ready", "device": "cpu"})

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

        if cmd == "detect":
            path = req.get("audio_path", "")
            if not path:
                emit({"type": "error", "error": "detect: audio_path missing"})
                continue
            try:
                speech_pad_ms = int(req.get("speech_pad_ms", 550))
                min_silence_duration_ms = int(req.get("min_silence_duration_ms", 1200))
                min_speech_duration_ms = int(req.get("min_speech_duration_ms", 200))
                threshold = float(req.get("threshold", 0.22))

                t_load = time.time()
                wav = read_audio(path, sampling_rate=SAMPLE_RATE)
                load_sec = time.time() - t_load
                duration_sec = float(len(wav)) / SAMPLE_RATE
                log(
                    f"audio loaded: {duration_sec:.2f}s "
                    f"({len(wav)} samples) in {load_sec:.2f}s"
                )

                t_vad = time.time()
                segments = get_speech_timestamps(
                    wav,
                    model,
                    sampling_rate=SAMPLE_RATE,
                    return_seconds=True,
                    threshold=threshold,
                    min_speech_duration_ms=min_speech_duration_ms,
                    min_silence_duration_ms=min_silence_duration_ms,
                    speech_pad_ms=speech_pad_ms,
                )
                vad_ms = (time.time() - t_vad) * 1000.0

                total_speech = float(sum(s["end"] - s["start"] for s in segments))
                ratio = (total_speech / max(duration_sec, 1e-6)) * 100.0
                log(
                    f"VAD: {len(segments)} segments, "
                    f"speech {total_speech:.2f}s / {duration_sec:.2f}s "
                    f"({ratio:.1f}%), inf={vad_ms:.0f}ms"
                )

                emit({
                    "type": "result",
                    "segments": [
                        {"start": float(s["start"]), "end": float(s["end"])}
                        for s in segments
                    ],
                    "duration_sec": duration_sec,
                    "total_speech_sec": total_speech,
                    "inference_ms": vad_ms,
                })
            except Exception as exc:
                emit({
                    "type": "error",
                    "error": f"detect failed: {exc}",
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
