# FFmpeg для сборки релиза

Скопируйте сюда из [ffmpeg-release-essentials](https://www.gyan.dev/ffmpeg/builds/):

- `ffmpeg.exe`
- `ffprobe.exe`

Дальше из корня репозитория: **`npm run release:win`** — соберёт venv, модель пола, ffmpeg и установщик.

`*.exe` в git не коммитятся. Для `tauri dev` без этих файлов используется FFmpeg из PATH.
