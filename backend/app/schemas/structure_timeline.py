# app/schemas/structure_timeline.py
from pydantic import BaseModel
from typing import List, Optional
from datetime import date

class StructActivity(BaseModel):
    activity: str
    start: Optional[date]
    end: Optional[date]
    total_tasks: int
    done_tasks: int
    progress: float
    delayed: bool
    gewerk: Optional[str] = None
    color: Optional[str] = None

class StructSegment(BaseModel):
    level: str            # "ebene" | "stiege" | "bauteil"
    id: int
    name: str
    structure_path: Optional[str] = None
    activities: List[StructActivity]

class StructureTimelineResponse(BaseModel):
    project_id: int
    level: str            # "ebene" | "stiege" | "bauteil"
    segments: List[StructSegment]
