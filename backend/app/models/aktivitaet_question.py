# models/aktivitaet_question.py

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base  # isto kao u ostalim modelima


class AktivitaetQuestion(Base):
    __tablename__ = "aktivitaet_questions"

    id = Column(Integer, primary_key=True, index=True)
    aktivitaet_id = Column(Integer, ForeignKey("aktivitaeten.id"), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    label = Column(String, nullable=False)
    field_type = Column(String(10), nullable=False)   # 'boolean' | 'text' | 'image'
    required = Column(Boolean, nullable=False, default=False)

    # veza na Aktivitaet model
    aktivitaet = relationship("Aktivitaet", back_populates="questions")


class TaskCheckAnswer(Base):
    __tablename__ = "task_check_answers"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    aktivitaet_question_id = Column(Integer, ForeignKey("aktivitaet_questions.id"), nullable=True)

    label = Column(String, nullable=False)
    field_type = Column(String(10), nullable=False)   # 'boolean' | 'text' | 'image'

    bool_value = Column(Boolean, nullable=True)
    text_value = Column(String, nullable=True)
    image_path = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
