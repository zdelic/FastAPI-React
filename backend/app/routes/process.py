from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.process import ProcessModel, ProcessStep
from app.schemas.process import ProcessModelCreate, ProcessModelRead
from app.core.protocol import log_protocol

router = APIRouter()


def _steps_to_list(model: ProcessModel) -> list[str]:
    """
    Pomoćna: vrati listu aktivnosti (samo imena) – ista logika svuda.
    Ako kasnije želiš i gewerk/duration/paralelno, ovdje to možeš proširiti.
    """
    return [s.activity for s in model.steps]


@router.post("/process-models", response_model=ProcessModelRead, status_code=201)
def create_process_model(
    data: ProcessModelCreate, request: Request, db: Session = Depends(get_db)
):
    model = ProcessModel(name=data.name)
    for step_data in data.steps:
        step = ProcessStep(**step_data.dict())
        model.steps.append(step)

    db.add(model)
    db.commit()
    db.refresh(model)

    # --- protokol u istom formatu kao ostali create/update ---
    new_steps = _steps_to_list(model)
    changes = {
        "name": {
            "old": None,
            "new": model.name,
            "label": "Name",
        },
        "steps": {
            "old": [],
            "new": new_steps,
            "label": "Schritte",
        },
    }

    log_protocol(
        db,
        request,
        action="processmodel.create",
        ok=True,
        status_code=201,
        details={
            "id": model.id,
            "entity": "Prozessmodell",
            "name": model.name,
            "changes": changes,
        },
    )

    return model


@router.get("/process-models", response_model=List[ProcessModelRead])
def list_models(db: Session = Depends(get_db)):
    return db.query(ProcessModel).all()


@router.get("/process-models/{model_id}", response_model=ProcessModelRead)
def get_model(model_id: int, db: Session = Depends(get_db)):
    model = db.query(ProcessModel).filter_by(id=model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.delete("/process-models/{model_id}", status_code=204)
def delete_model(model_id: int, request: Request, db: Session = Depends(get_db)):
    model = db.query(ProcessModel).filter_by(id=model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # spremimo podatke prije brisanja, da se vide u protokolu
    steps_before = _steps_to_list(model)
    name_before = model.name
    model_id_val = model.id

    db.delete(model)
    db.commit()

    changes = {
        "deleted": {
            "old": {
                "id": model_id_val,
                "name": name_before,
                "steps": steps_before,
            },
            "new": None,
            "label": "Prozessmodell gelöscht",
        }
    }

    log_protocol(
        db,
        request,
        action="processmodel.delete",
        ok=True,
        status_code=204,
        details={
            "id": model_id_val,
            "entity": "Prozessmodell",
            "name": name_before,
            "changes": changes,
        },
    )

    return {"message": "Deleted"}


@router.put("/process-models/{model_id}", response_model=ProcessModelRead)
def update_process_model(
    model_id: int, data: ProcessModelCreate, request: Request, db: Session = Depends(get_db)
):
    model = db.query(ProcessModel).filter_by(id=model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # --- stare vrijednosti radi diffa ---
    old_name = model.name
    old_steps = _steps_to_list(model)

    # --- update osnovnih polja ---
    model.name = data.name

    # obriši stare stepove i dodaj nove
    model.steps.clear()
    for step_data in data.steps:
        step = ProcessStep(**step_data.dict())
        model.steps.append(step)

    db.commit()
    db.refresh(model)

    new_steps = _steps_to_list(model)

    # --- promjene za protokol u "changes" formatu ---
    changes: dict[str, dict] = {}

    if old_name != model.name:
        changes["name"] = {
            "old": old_name,
            "new": model.name,
            "label": "Name",
        }

    if old_steps != new_steps:
        changes["steps"] = {
            "old": old_steps,
            "new": new_steps,
            "label": "Schritte",
        }

    log_protocol(
        db,
        request,
        action="processmodel.update",
        ok=True,
        status_code=200,
        details={
            "id": model.id,
            "entity": "Prozessmodell",
            "name": model.name,
            "changes": changes,
        },
    )

    return model
