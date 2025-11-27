@echo off
cd /d C:\DATA\FastAPI-React\backend

REM START BACKEND U LOG FAJL DA VIDIMO AKO IMA GRESKE
"C:\DATA\FastAPI-React\backend\venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8001 >> backend_log.txt 2>&1
