# app/routes/project.py
from typing import List, Dict, Any  
import os, shutil, uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request, Form
from sqlalchemy.orm import Session
from sqlalchemy import select, func, or_, and_, case, literal

from app.database import get_db
from app.routes.auth import get_current_user
from app.deps import require_admin
from app.core.protocol import log_protocol
from app.main import UPLOAD_DIR

from app.models.project import Project as ProjectModel
from app.models.user import User as UserModel
from app.models.task import Task as TaskModel
from app.models.process import ProcessStep as ProcessStepModel
from app.models.gewerk import Gewerk as GewerkModel

from app.schemas.project import (
    ProjectCreate,
    ProjectUpdate,
    ProjectRead,      
    UserAssign,
)


from app.schemas.user import UserRead
from app.schemas.project_user import ProjectUserAdd, ProjectUsersReplace

# koristi prefix SAMO ovdje (nema dupliranja "projects/projects")
router = APIRouter(prefix="/projects", tags=["projects"])

# koristi ISTI UPLOAD_DIR kao u main.py
from app.main import UPLOAD_DIR


# --- helper: pretvori ORM u dict s fiksnim poljima__________________________
def project_to_dict(p):
    return {
        "id": p.id,
        "Name": p.name,
        "Beschreibung": p.description,
        "Startdatum": p.start_date,
        "Bild_URL": getattr(p, "image_url", None),  # 👈 garantiramo ključ
    }


# --- Projekti ---------------------------------------------------------------

@router.post(
    "",
    response_model=ProjectRead,
    dependencies=[Depends(require_admin)],
    status_code=201,
)
def create_project(
    request: Request,
    name: str = Form(...),
    description: str | None = Form(None),
    start_date: date | None = Form(None),
    image: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    proj = ProjectModel(
        name=name,
        description=description,
        start_date=start_date,
        image_url=None,
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    # ako je stigla slika – snimi je i upiši apsolutni javni URL
    if image and image.filename:
        ext = Path(image.filename).suffix.lower() or ".png"
        if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
            raise HTTPException(400, detail="Ungültiger Bildtyp")

        fname = f"project_{proj.id}_{uuid.uuid4().hex}{ext}"
        dest = Path(UPLOAD_DIR) / fname
        with dest.open("wb") as out:
            shutil.copyfileobj(image.file, out)

        proj.image_url = f"/uploads/{fname}"

        db.commit()
        db.refresh(proj)
    
        log_protocol(
        db,
        request,
        action="project.create",
        ok=True,
        status_code=201,
        details={
            "project_id": proj.id,
            "project_name": proj.name,
            # sve bitne vrijednosti u "changes" – isto kao kod update
            "changes": {
                "name": proj.name,
                "description": proj.description,
                "start_date": str(proj.start_date) if proj.start_date else None,
            },
        },
    )


    return proj


@router.get("", response_model=List[ProjectRead], response_model_exclude_none=False, response_model_exclude_unset=False)
def list_projects(
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    # ✅ Admin vidi SVE projekte
    if current_user.role in ("admin", "Admin", "ADMIN"):
        rows = db.query(ProjectModel).all()
        return [ProjectRead.model_validate(r, from_attributes=True) for r in rows]

    if current_user.role == "sub":
        q_tasks = (
            db.query(ProjectModel)
            .join(TaskModel, TaskModel.project_id == ProjectModel.id)
            .filter(TaskModel.sub_id == current_user.id)
        )
        q_membership = (
            db.query(ProjectModel)
            .join(ProjectModel.users)
            .filter(UserModel.id == current_user.id)
        )
        rows = q_tasks.union(q_membership).distinct().all()
        return [ProjectRead.model_validate(r, from_attributes=True) for r in rows]  # ⬅️

    rows = (
        db.query(ProjectModel)
        .join(ProjectModel.users)
        .filter(UserModel.id == current_user.id)
        .all()
    )
    return [ProjectRead.model_validate(r, from_attributes=True) for r in rows]



@router.get("/{project_id}", response_model=ProjectRead, response_model_exclude_none=False, response_model_exclude_unset=False)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    project = db.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    if current_user.role == "sub":
        is_member = any(u.id == current_user.id for u in project.users)
        has_tasks = (
            db.query(TaskModel)
            .filter(TaskModel.project_id == project_id, TaskModel.sub_id == current_user.id)
            .first()
            is not None
        )
        if not (is_member or has_tasks):
            raise HTTPException(status_code=403, detail="Kein Zugriff auf dieses Projekt")

    return ProjectRead.model_validate(project, from_attributes=True)


@router.put("/{project_id}", response_model=ProjectRead, dependencies=[Depends(require_admin)])
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    db_project = db.get(ProjectModel, project_id)
    if not db_project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    # ažuriraj sve polja koja su poslana
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        db_project.name = data["name"]
    if "description" in data:
        db_project.description = data["description"]
    if "start_date" in data:
        db_project.start_date = data["start_date"]
    if "image_url" in data:
        db_project.image_url = data["image_url"]

    db.commit()
    db.refresh(db_project)

    log_protocol(
        db,
        request,
        action="project.update",
        ok=True,
        status_code=200,
        details={
            "project_id": project_id,
            "project_name": db_project.name,
            "changes": data,
        },
    )

    return db_project


# --- Veze projekat ↔ korisnici ---------------------------------------------

@router.get("/{project_id}/users", response_model=List[UserRead])
def list_project_users(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    project = db.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    if current_user.role == "sub":
        is_member = any(u.id == current_user.id for u in project.users)
        has_tasks = (
            db.query(TaskModel)
            .filter(TaskModel.project_id == project_id, TaskModel.sub_id == current_user.id)
            .first()
            is not None
        )
        if not (is_member or has_tasks):
            raise HTTPException(status_code=403, detail="Kein Zugriff auf dieses Projekt")

    return project.users


@router.post("/{project_id}/users", response_model=UserRead, status_code=201, dependencies=[Depends(require_admin)])
def add_user_to_project(
    project_id: int,
    request: Request,
    payload: ProjectUserAdd,
    db: Session = Depends(get_db),
):
    project = db.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    user = db.get(UserModel, payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")

    if any(u.id == user.id for u in project.users):
        raise HTTPException(status_code=409, detail="Benutzer bereits im Projekt")

    project.users.append(user)
    db.commit()
    db.refresh(project)

    user_name = (
        getattr(user, "username", None)
        or getattr(user, "name", None)
        or getattr(user, "email", None)
        or str(user.id)
    )

    log_protocol(
        db,
        request,
        action="project.user.add",
        ok=True,
        status_code=201,
        details={
            "project_id": project.id,
            "project_name": project.name,
            "user_id": user.id,
            "user_name": user_name,
        },
    )

    return user




@router.delete("/{project_id}/users/{user_id}", status_code=204, dependencies=[Depends(require_admin)])
def remove_user_from_project(
    project_id: int,
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
):
    project = db.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    user = db.get(UserModel, user_id)

    project.users = [u for u in project.users if u.id != user_id]
    db.commit()

    user_name = None
    if user:
        user_name = (
            getattr(user, "username", None)
            or getattr(user, "name", None)
            or getattr(user, "email", None)
            or str(user.id)
        )

    log_protocol(
        db,
        request,
        action="project.user.remove",
        ok=True,
        status_code=204,
        details={
            "project_id": project.id,
            "project_name": project.name,
            "user_id": user_id,
            "user_name": user_name,
        },
    )

    return




@router.put("/{project_id}/users", response_model=List[UserRead], dependencies=[Depends(require_admin)])
def replace_project_users(
    project_id: int,
    payload: ProjectUsersReplace,
    request: Request,
    db: Session = Depends(get_db),
):
    project = db.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    users = db.execute(
        select(UserModel).where(UserModel.id.in_(payload.user_ids))
    ).scalars().all()

    project.users = users
    db.commit()
    db.refresh(project)

    log_protocol(
        db,
        request,
        action="project.users.replace",
        ok=True,
        status_code=200,
        details={
            "project_id": project.id,
            "project_name": project.name,
            "user_ids": [u.id for u in users],
        },
    )

    return project.users




@router.delete("/{project_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_project(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    project = db.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    # ⬅️ Spasi ime prije brisanja
    project_name = project.name

    # obriši sliku ako postoji
    try:
        if project.image_url:
            fname = project.image_url.split("/")[-1]
            fpath = Path(UPLOAD_DIR) / fname
            if fpath.exists():
                fpath.unlink(missing_ok=True)
    except Exception:
        pass

    db.delete(project)
    db.commit()

    # ⬅️ Sad koristi spremljeno ime
    log_protocol(
        db,
        request,
        action="project.delete",
        ok=True,
        status_code=204,
        details={
            "project_id": project_id,
            "project_name": project_name,
        },
    )

    return




@router.post("/{project_id}/image", response_model=ProjectRead, dependencies=[Depends(require_admin)])
async def upload_project_image(
    project_id: int,
    request: Request,
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    proj = db.get(ProjectModel, project_id)
    if not proj:
        raise HTTPException(404, "Projekt nicht gefunden")

    ext = Path(image.filename).suffix.lower() or ".png"
    if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
        raise HTTPException(400, "Ungültiger Bildtyp")

    # (opcionalno) obriši staru sliku
    try:
        if proj.image_url:
            old = Path(UPLOAD_DIR) / proj.image_url.split("/")[-1]
            if old.exists():
                old.unlink(missing_ok=True)
    except Exception:
        pass

    fname = f"project_{proj.id}_{uuid.uuid4().hex}{ext}"
    dest = Path(UPLOAD_DIR) / fname
    with dest.open("wb") as out:
        shutil.copyfileobj(image.file, out)

    proj.image_url = f"/uploads/{fname}"
    db.commit()
    db.refresh(proj)
    return proj



