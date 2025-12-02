# app/routes/aktivitaet_questions.py

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.aktivitaet import Aktivitaet
from app.models.aktivitaet_question import AktivitaetQuestion
from app.schemas.aktivitaet_question import (
    AktivitaetQuestionCreate,
    AktivitaetQuestionRead,
    AktivitaetQuestionUpdate,
)

# ako želiš da samo admin može uređivati:
# from app.dependencies import require_admin

router = APIRouter(
    prefix="/aktivitaeten",
    tags=["Aktivitaet Fragen"],
)


def get_aktivitaet_or_404(aktivitaet_id: int, db: Session) -> Aktivitaet:
    obj = db.query(Aktivitaet).get(aktivitaet_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aktivität nicht gefunden",
        )
    return obj


@router.get("/{aktivitaet_id}/questions", response_model=List[AktivitaetQuestionRead])
def list_questions_for_aktivitaet(
    aktivitaet_id: int,
    db: Session = Depends(get_db),
):
    """
    Vrati sva pitanja za jedan Aktivität, sortirano po sort_order.
    """
    # samo provjera da aktivitaet postoji
    get_aktivitaet_or_404(aktivitaet_id, db)

    qs = (
        db.query(AktivitaetQuestion)
        .filter(AktivitaetQuestion.aktivitaet_id == aktivitaet_id)
        .order_by(AktivitaetQuestion.sort_order, AktivitaetQuestion.id)
        .all()
    )
    return qs


@router.post(
    "/{aktivitaet_id}/questions",
    response_model=AktivitaetQuestionRead,
    status_code=status.HTTP_201_CREATED,
    # dependencies=[Depends(require_admin)],  # ako želiš
)
def create_question_for_aktivitaet(
    aktivitaet_id: int,
    data: AktivitaetQuestionCreate,
    db: Session = Depends(get_db),
):
    """
    Kreiraj jedno pitanje za dati Aktivität.
    """
    get_aktivitaet_or_404(aktivitaet_id, db)

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
    return obj


@router.put(
    "/aktivitaet-questions/{question_id}",
    response_model=AktivitaetQuestionRead,
    # dependencies=[Depends(require_admin)],
)
def update_question(
    question_id: int,
    data: AktivitaetQuestionUpdate,
    db: Session = Depends(get_db),
):
    """
    Update jednog pitanja.
    """
    obj = db.query(AktivitaetQuestion).get(question_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Frage nicht gefunden",
        )

    obj.sort_order = data.sort_order
    obj.label = data.label
    obj.field_type = data.field_type
    obj.required = data.required

    db.commit()
    db.refresh(obj)
    return obj


@router.delete(
    "/aktivitaet-questions/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    # dependencies=[Depends(require_admin)],
)
def delete_question(
    question_id: int,
    db: Session = Depends(get_db),
):
    """
    Obriši jedno pitanje.
    """
    obj = db.query(AktivitaetQuestion).get(question_id)
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Frage nicht gefunden",
        )

    db.delete(obj)
    db.commit()
    return
