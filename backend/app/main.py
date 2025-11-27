# app/main.py
from pathlib import Path
import os

from fastapi import FastAPI, Depends
from fastapi.responses import ORJSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from app.database import Base, engine
from app.deps import bind_user
# from app.server_timing import TimingMiddleware  # opcionalno

# --- App (NAPOMENA: kreiraj SAMO JEDNOM) ---
app = FastAPI(default_response_class=ORJSONResponse)

# --- Putanje (konzistentne) ---
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

STATIC_DIR = BASE_DIR.parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# --- Middleware ---
# app.add_middleware(TimingMiddleware)  # opcionalno
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
     allow_origins=["http://localhost:3000", "http://localhost:5173", "http://172.20.1.25:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Static mounts (MONTAJ SAMO JEDNOM) ---
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# --- DB init ---
Base.metadata.create_all(bind=engine)

# --- Routers ---
from app.routes import (
    protocol,
    auth,
    project,
    structure,
    process,
    gewerk,
    aktivitaet,
    task,
    generate_tasks,
    user,
)
from app.routes.task_structure import router as structure_router

# Protokol (bez bindera)
app.include_router(protocol.router, dependencies=[Depends(bind_user)])

# Ostale rute – binder da puni request.state.user
app.include_router(project.router,        dependencies=[Depends(bind_user)])
app.include_router(structure.router,      dependencies=[Depends(bind_user)])
app.include_router(process.router,        dependencies=[Depends(bind_user)])
app.include_router(gewerk.router,         dependencies=[Depends(bind_user)])
app.include_router(aktivitaet.router,     dependencies=[Depends(bind_user)])
app.include_router(task.router,           dependencies=[Depends(bind_user)])
app.include_router(generate_tasks.router, dependencies=[Depends(bind_user)])
app.include_router(user.router,           dependencies=[Depends(bind_user)])

# Auth rute (bez bindera)
app.include_router(auth.router, tags=["auth"])

app.include_router(structure_router, dependencies=[Depends(bind_user)])

# Omogući import UPLOAD_DIR iz drugih modula
__all__ = ["app", "UPLOAD_DIR"]
