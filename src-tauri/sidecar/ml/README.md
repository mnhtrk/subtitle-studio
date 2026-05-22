# sidecar/ml — единое Python-окружение (Silero VAD + gender)

Один `.venv` для транскрипции и определения пола:

| Скрипт | Модель | Когда вызывается |
|--------|--------|------------------|
| `vad.py` | [Silero VAD](https://github.com/snakers4/silero-vad) | Перед Whisper — находит куски с речью; каждый кусок уходит в API отдельно |
| `classify.py` | Common-Voice-Gender-Detection | После транскрипции — пол по репликам |

## Установка (один раз)

Windows (PowerShell):

```powershell
cd "src-tauri/sidecar/ml"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\pip.exe install -r requirements.txt
```

Linux / macOS:

```bash
cd src-tauri/sidecar/ml
python3 -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt
```

Проверка VAD:

```powershell
.\.venv\Scripts\python.exe vad.py
```

stdin:

```json
{"cmd":"detect","audio_path":"C:/path/to/audio.mp3"}
{"cmd":"quit"}
```

## VAD-параметры (фильмы / YouTube)

| Параметр | Значение | Смысл |
|----------|----------|--------|
| `threshold` | 0.40 | ниже = чувствительнее (крики), выше = меньше музыки в тишине |
| `min_silence_duration_ms` | 900 | пауза короче — не режем фразу |
| `min_speech_duration_ms` | 300 | короткие всплески речи |
| `speech_pad_ms` | 200 | Запас по краям реплики |

## Производительность

- Silero VAD: ~2 MB, инференс &lt;1 мс / 30 мс аудио на CPU
- Первый запуск: импорт torch ~2–5 с, RAM ~300–500 MB
- Gender: отдельный процесс после транскрипции, тот же `.venv`
