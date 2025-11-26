from pathlib import Path

from fastapi import Request

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List
import os, uuid

from app.database import get_db
from app.models.user import User
from app.schemas.user import (
    UserCreate, UserRead, UserUpdate, ROLES,
    PasswordChange, PasswordReset,
)
from app.routes.auth import get_current_user
from app.deps import require_admin
from app.core.security import verify_password, hash_password
from app.core.protocol import log_protocol

BASE_DIR = Path(__file__).resolve().parents[2]
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = STATIC_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/users", tags=["users"])

# --- Admin-only CRUD --------------------------------------------------------

@router.get("", response_model=List[UserRead], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    return db.execute(select(User)).scalars().all()

@router.post("", response_model=UserRead, status_code=201, dependencies=[Depends(require_admin)])
def create_user(data: UserCreate, request: Request, db: Session = Depends(get_db)):
    if data.role not in ROLES:
        raise HTTPException(status_code=400, detail="Ungültige Rolle")
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=409, detail="Email existiert bereits")

    user = User(
        email=data.email,
        hashed_password=hash_password(data.password),
        role=data.role,
        name=data.name,
        address=data.address,
        phone=data.phone,
        avatar_url=data.avatar_url,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # LOG: svi podaci novog korisnika
    log_protocol(
        db,
        request,
        action="user.create",
        ok=True,
        status_code=201,
        details={
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "address": user.address,
            "phone": user.phone,
            "avatar_url": user.avatar_url,
        },
    )

    return user



@router.patch("/{user_id}", response_model=UserRead, dependencies=[Depends(require_admin)])
def update_user(user_id: int, patch: UserUpdate, request: Request, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User nicht gefunden")

    data = patch.model_dump(exclude_unset=True)
    if "role" in data and data["role"] and data["role"] not in ROLES:
        raise HTTPException(status_code=400, detail="Ungültige Rolle")

    # stari podaci radi diffa
    fields = ["name", "email", "role", "address", "phone", "avatar_url"]
    old_values = {f: getattr(user, f, None) for f in fields}

    # primijeni patch
    for k, v in data.items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)

    # izračunaj promjene
    changes: dict[str, dict[str, object]] = {}
    for k, new_val in data.items():
        old_val = old_values.get(k)
        if old_val != getattr(user, k, None):
            changes[k] = {"old": old_val, "new": getattr(user, k, None)}

    # LOG: diff + trenutni snapshot usera
    log_protocol(
        db,
        request,
        action="user.update",
        ok=True,
        status_code=200,
        details={
            "user_id": user.id,
            "user_name": user.name,
            "changes": changes,
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "address": user.address,
            "phone": user.phone,
            "avatar_url": user.avatar_url,
        },
    )

    return user


@router.delete("/{user_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User nicht gefunden")

    # snapshot prije brisanja
    details = {
        "user_id": user.id,
        "user_name": user.name,
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "address": user.address,
        "phone": user.phone,
        "avatar_url": user.avatar_url,
    }

    db.delete(user)
    db.commit()

    log_protocol(
        db,
        request,
        action="user.delete",
        ok=True,
        status_code=204,
        details=details,
    )

    return  # 204


# --- Avatar (admin ili vlasnik) --------------------------------------------

@router.post("/{user_id}/avatar", response_model=UserRead)
async def upload_avatar(
    user_id: int,
    file: UploadFile = File(...),    
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if current.role != "admin" and current.id != user_id:
        raise HTTPException(status_code=403, detail="Nicht erlaubt")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User nicht gefunden")
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Datei muss ein Bild sein")

    ext = os.path.splitext(file.filename)[1] or ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / fname
    with open(dest, "wb") as f:
        f.write(await file.read())

    user.avatar_url = f"/static/uploads/{fname}"
    db.commit(); db.refresh(user)
    log_protocol(db, request, action="user.avatar.upload", ok=True, status_code=200,
                 details={"user_id": user.id, "avatar_url": user.avatar_url})
    return user

# --- Passwords --------------------------------------------------------------

@router.post("/{user_id}/password", status_code=204)
def change_password(
    user_id: int,
    payload: PasswordChange,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    # vlasnik ili admin
    if current.id != user_id and current.role != "admin":
        raise HTTPException(status_code=403, detail="Nicht erlaubt")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User nicht gefunden")

    # ako nije admin, mora potvrditi staru lozinku
    if current.role != "admin":
        if not verify_password(payload.current_password, user.hashed_password):
            raise HTTPException(status_code=400, detail="Falsches aktuelles Passwort")

    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    log_protocol(db, request, action="user.password.change", ok=True, status_code=204,
                 details={"user_id": user.id})
    return  # 204

@router.post("/{user_id}/password-reset", status_code=204, dependencies=[Depends(require_admin)])
def reset_password(user_id: int, payload: PasswordReset, request: Request, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    log_protocol(db, request, action="user.password.reset", ok=True, status_code=204,
                 details={"user_id": user.id})
    return  # 204
