# sidecar/ml — единое Python-окружение (Silero VAD + gender)



Один `.venv` для транскрипции и определения пола:



| Скрипт | Модель | Когда вызывается |

|--------|--------|------------------|

| `vad.py` | [Silero VAD](https://github.com/snakers4/silero-vad) | Перед Whisper — находит куски с речью; каждый кусок уходит в API отдельно |

| `classify.py` | [norwoodsystems/norwood-maleVSfemale](https://huggingface.co/norwoodsystems/norwood-maleVSfemale) | После транскрипции — пол говорящего (female/male/unknown) |



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



### Скачивание модели пола



**Вручную с вкладки Files на Hugging Face скачивать не нужно.** При первой транскрипции (или первом запуске `classify.py`) `transformers` сам подтянет веса в кэш:



- Windows: `%USERPROFILE%\.cache\huggingface\hub\`

- Linux/macOS: `~/.cache/huggingface/hub/`



Размер порядка **~400 MB** (модель ~95M параметров, wav2vec2-base). Заметно легче прежней audeering (~1.2 GB). Нужен интернет один раз на машине разработчика.



Для будущей сборки «для обычных людей» без интернета: либо положить кэш в установщик, либо `HF_HOME` рядом с приложением — пока не настроено.



**Лицензия:** уточните на [карточке модели](https://huggingface.co/norwoodsystems/norwood-maleVSfemale). Это бинарный классификатор **тембра голоса** (male/female), не «пол человека».



Проверка gender sidecar:



```powershell

.\.venv\Scripts\python.exe classify.py

```



stdin (после загрузки модели):



```json

{"cmd":"init","audio_path":"C:/path/to/audio.mp3"}

{"cmd":"classify","id":1,"start":0.0,"end":2.0}

{"cmd":"quit"}

```



## VAD-параметры (фильмы / YouTube)



| Параметр | Значение | Смысл |

|----------|----------|--------|

| `threshold` | 0.25 | ниже = чувствительнее (раньше старт речи); не «весь файл» — только окна с prob ≥ порога |

| `min_silence_duration_ms` | 1200 | пауза короче — не режем фразу (меньше ранних обрывов) |

| `min_speech_duration_ms` | 250 | короткие всплески речи |

| `speech_pad_ms` | 400 | запас по краям реплики в Silero |



После VAD в Rust: склейка кусков с паузой &lt; 450 ms, затем +150 ms до начала и до **+2 s** после конца, но **без пересечения** соседних кусков (зазор 80 ms).



## Модель пола (classify.py)



| Параметр | Значение |

|----------|----------|

| `MODEL_NAME` | `norwoodsystems/norwood-maleVSfemale` |

| `CONFIDENCE_THRESHOLD` | 0.55 (по max female/male) |



В скрытый столбец по-прежнему только **female / male / unknown**. В логах `scores`: `male`, `female`.

**Тайминги:** в классификатор уходит **ровно** `start`/`end` субтитра (одна реплика = один запрос), без расширения клипа. В логе: `[gender] #N clip 198.301-200.401 -> ...`. Расширение раньше подмешивало соседние голоса и давало ложный female/male.

Ограничения: дубляж, похожие тембры; при неверных таймингах Whisper пол тоже будет неверным. Переводчик дополнительно получает правила в `ai.rs` (`speaker_gender_translation_rules`).



## Производительность



- Silero VAD: ~2 MB, инференс &lt;1 мс / 30 мс аудио на CPU

- Первый запуск: импорт torch ~2–5 с

- Gender (norwood): ~95M params, CPU; первый запуск — скачивание весов; инференс быстрее, чем у audeering large


