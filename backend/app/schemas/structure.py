from datetime import date
from pydantic import BaseModel
from typing import Optional


class TopCreate(BaseModel):
    name: str
    ebene_id: int

class EbeneCreate(BaseModel):
    name: str
    stiege_id: int

class StiegeCreate(BaseModel):
    name: str
    bauteil_id: int

class BauteilCreate(BaseModel):
    name: str

class Top(BaseModel):
    id: int
    name: str
    ebene_id: int
    process_model_id: Optional[int] = None
    class Config:
        from_attributes = True

class Ebene(BaseModel):
    id: int
    name: str
    stiege_id: int
    process_model_id: Optional[int] = None
    tops: list[Top] = []
    class Config:
        from_attributes = True

class Stiege(BaseModel):
    id: int
    name: str
    bauteil_id: int
    process_model_id: Optional[int] = None
    ebenen: list[Ebene] = []
    class Config:
        from_attributes = True

class Bauteil(BaseModel):
    id: int
    name: str
    project_id: int
    process_model_id: Optional[int] = None
    stiegen: list[Stiege] = []
    class Config:
        from_attributes = True


class StiegeUpdate(BaseModel):
    name: Optional[str] = None
    process_model_id: Optional[int] = None
    start_soll: date | None = None

class BauteilUpdate(BaseModel):
    name: Optional[str] = None
    process_model_id: Optional[int] = None
    start_soll: date | None = None

class EbeneUpdate(BaseModel):
    name: Optional[str] = None
    process_model_id: Optional[int] = None
    start_soll: date | None = None

class TopUpdate(BaseModel):
    name: Optional[str] = None
    process_model_id: Optional[int] = None
    start_soll: date | None = None
