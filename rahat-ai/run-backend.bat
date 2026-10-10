@echo off
cd /d "%~dp0services\api"
call .venv\Scripts\activate
uvicorn main:app --reload --port 8030
