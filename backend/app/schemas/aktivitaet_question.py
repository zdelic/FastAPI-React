# app/schemas/aktivitaet_question.py

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


QuestionFieldType = Literal["boolean", "text", "image"]


class AktivitaetQuestionBase(BaseModel):
    sort_order: int = 0
    label: str
    field_type: QuestionFieldType
    required: bool = False


class AktivitaetQuestionCreate(AktivitaetQuestionBase):
    pass


class AktivitaetQuestionUpdate(AktivitaetQuestionBase):
    pass


class AktivitaetQuestionRead(AktivitaetQuestionBase):
    id: int
    aktivitaet_id: int

    class Config:
        orm_mode = True


class TaskCheckAnswerBase(BaseModel):
    aktivitaet_question_id: Optional[int] = None
    label: str
    field_type: QuestionFieldType
    bool_value: Optional[bool] = None
    text_value: Optional[str] = None
    image_path: Optional[str] = None


class TaskCheckAnswerCreate(TaskCheckAnswerBase):
    pass


class TaskCheckAnswerRead(TaskCheckAnswerBase):
    id: int
    task_id: int
    created_at: datetime

    class Config:
        orm_mode = True
