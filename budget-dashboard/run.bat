@echo off
setlocal
cd /d "%~dp0"

if not exist config.json (
  copy config.example.json config.json >nul
  echo Foi criado o config.json. Edita-o com os caminhos dos ficheiros do OneDrive e volta a correr este script.
  notepad config.json
  pause
  exit /b 1
)

if not exist .venv\Scripts\python.exe (
  echo A criar ambiente Python...
  py -3 -m venv .venv || python -m venv .venv || (echo Python nao encontrado. Instala em https://www.python.org/downloads/ & pause & exit /b 1)
  .venv\Scripts\python.exe -m pip install --upgrade pip >nul
)

.venv\Scripts\python.exe -m pip install -q -r requirements.txt || (pause & exit /b 1)

.venv\Scripts\python.exe app.py
pause
