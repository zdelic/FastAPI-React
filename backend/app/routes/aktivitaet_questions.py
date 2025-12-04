from typing import List

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.aktivitaet import Aktivitaet
from app.models.aktivitaet_question import AktivitaetQuestion
from app.models.process import ProcessModel  # 👈 bitno
from app.schemas.aktivitaet_question import (
    AktivitaetQuestionCreate,
    AktivitaetQuestionRead,
    AktivitaetQuestionUpdate,
)
from app.core.protocol import compute_diff, log_protocol



router = APIRouter(prefix="/aktivitaeten", tags=["Aktivitäten"])


def get_aktivitaet_or_404(aktivitaet_id: int, db: Session) -> Aktivitaet:
    aktivitaet = db.query(Aktivitaet).get(aktivitaet_id)
    if not aktivitaet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aktivität nicht gefunden",
        )
    return aktivitaet


def get_process_model_name(db: Session, process_model_id: int | None) -> str | None:
    """
    Dohvati ime Prozessmodella po ID-u.
    Ne pogađamo više preko activity naziva, nego dobijamo ID iz frontenda.
    """
    if not process_model_id:
        return None
    pm = db.query(ProcessModel).get(process_model_id)
    return pm.name if pm else None



# --- ROUTES -------------------------------------------------------------


@router.get(
    "/{aktivitaet_id}/questions",
    response_model=List[AktivitaetQuestionRead],
)
def list_questions_for_aktivitaet(
    aktivitaet_id: int,
    db: Session = Depends(get_db),
):
    get_aktivitaet_or_404(aktivitaet_id, db)
    questions = (
        db.query(AktivitaetQuestion)
        .filter(AktivitaetQuestion.aktivitaet_id == aktivitaet_id)
        .order_by(AktivitaetQuestion.sort_order.asc(), AktivitaetQuestion.id.asc())
        .all()
    )
    return questions


@router.post(
    "/{aktivitaet_id}/questions",
    response_model=AktivitaetQuestionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_question_for_aktivitaet(
    aktivitaet_id: int,
    data: AktivitaetQuestionCreate,
    request: Request,
    process_model_id: int | None = None,
    db: Session = Depends(get_db),
):

    aktivitaet = get_aktivitaet_or_404(aktivitaet_id, db)

    obj = AktivitaetQuestion(
        aktivitaet_id=aktivitaet_id,
        sort_order=data.sort_order,
        label=data.label,
        field_type=data.field_type,
        required=data.required,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    process_model_name = get_process_model_name(db, process_model_id)

    # 📝 PROTOKOL – KO, za koji proces, koji aktivitet, koje pitanje
    log_protocol(
        db,
        request,
        action="aktivitaet_question.create",
        ok=True,
        status_code=status.HTTP_201_CREATED,
        details={
            "entity": "AktivitaetQuestion",
            "id": obj.id,
            "aktivitaet_id": obj.aktivitaet_id,
            "aktivitaet_name": aktivitaet.name,
            "process_model_id": process_model_id,
            "process_model_name": process_model_name,
            "sort_order": obj.sort_order,
            "label": obj.label,
            "field_type": obj.field_type,
            "required": obj.required,
        },
    )

    return obj



@router.put(
    "/aktivitaet-questions/{question_id}",
    response_model=AktivitaetQuestionRead,
)
def update_question(
    question_id: int,
    data: AktivitaetQuestionUpdate,
    request: Request,
    process_model_id: int | None = None,
    db: Session = Depends(get_db),
):

    obj = db.query(AktivitaetQuestion).get(question_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Frage nicht gefunden",
        )

    aktivitaet = db.query(Aktivitaet).get(obj.aktivitaet_id)
    aktivitaet_name = getattr(aktivitaet, "name", None)
    process_model_name = get_process_model_name(db, process_model_id)

    # diff na osnovu novog payload-a
    changes = compute_diff(
        obj,
        {
            "sort_order": data.sort_order,
            "label": data.label,
            "field_type": data.field_type,
            "required": data.required,
        },
    )

    # ako stvarno nema promjene -> nema loga
    if not changes:
        # ipak primijeni (za slučaj da je nešto force-sync), ali bez protokola
        obj.sort_order = data.sort_order
        obj.label = data.label
        obj.field_type = data.field_type
        obj.required = data.required

        db.commit()
        db.refresh(obj)
        return obj

    # ima promjena -> upiši pa logiraj
    obj.sort_order = data.sort_order
    obj.label = data.label
    obj.field_type = data.field_type
    obj.required = data.required

    db.commit()
    db.refresh(obj)

    log_protocol(
        db,
        request,
        action="aktivitaet_question.update",
        ok=True,
        status_code=status.HTTP_200_OK,
        details={
            "entity": "AktivitaetQuestion",
            "id": obj.id,
            "aktivitaet_id": obj.aktivitaet_id,
            "aktivitaet_name": aktivitaet_name,
            "process_model_id": process_model_id,
            "process_model_name": process_model_name,
            "changes": changes,
        },
    )

    return obj



@router.delete(
    "/aktivitaet-questions/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_question(
    question_id: int,
    request: Request,
    process_model_id: int | None = None,
    db: Session = Depends(get_db),
):

    obj = db.query(AktivitaetQuestion).get(question_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Frage nicht gefunden",
        )

    aktivitaet = db.query(Aktivitaet).get(obj.aktivitaet_id)
    aktivitaet_name = getattr(aktivitaet, "name", None)
    process_model_name = get_process_model_name(db, process_model_id)

    # snapshot prije brisanja – ovo hoćeš da vidiš u protokolu
    details = {
        "entity": "AktivitaetQuestion",
        "id": obj.id,
        "aktivitaet_id": obj.aktivitaet_id,
        "aktivitaet_name": aktivitaet_name,
        "process_model_id": process_model_id,
        "process_model_name": process_model_name,
        "sort_order": obj.sort_order,
        "label": obj.label,
        "field_type": obj.field_type,
        "required": obj.required,
    }

    db.delete(obj)
    db.commit()

    log_protocol(
        db,
        request,
        action="aktivitaet_question.delete",
        ok=True,
        status_code=status.HTTP_204_NO_CONTENT,
        details=details,
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)
