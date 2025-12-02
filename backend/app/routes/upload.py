from fastapi import APIRouter, UploadFile, File
from fastapi import HTTPException, status
import os
from uuid import uuid4

router = APIRouter(prefix="/upload", tags=["Upload"])

UPLOAD_DIR = "static/uploads/task_checks"

os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/task-check-image")
async def upload_task_check_image(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nur Bilddateien sind erlaubt.",
        )

    ext = os.path.splitext(file.filename)[1] or ".jpg"
    fname = f"taskcheck_{uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, fname)

    with open(path, "wb") as f:
        f.write(await file.read())

    # put koji će front koristiti
    url_path = f"/static/uploads/task_checks/{fname}"
    return {"path": url_path}
