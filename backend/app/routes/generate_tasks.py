# app/routes/generate_tasks.py

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import exists, and_
from datetime import date, datetime, timedelta

from app.core.protocol import log_protocol
from app.database import get_db
from app.models.project import Project
from app.models.structure import Top, Ebene, Stiege, Bauteil
from app.models.process import ProcessModel, ProcessStep
from app.models.task import Task
from app.schemas.task import TaskRead

router = APIRouter()


def _to_date(v):
    if v is None: return None
    if isinstance(v, date) and not isinstance(v, datetime): return v
    if isinstance(v, datetime): return v.date()
    if isinstance(v, str):
        s = v[:10]
        try: return date.fromisoformat(s)
        except Exception: return None
    return None

def is_weekend(d: date) -> bool:
    return d.weekday() >= 5  # 5=Sub, 6=Ned

def next_workday(d: date) -> date:
    while is_weekend(d):
        d += timedelta(days=1)
    return d

def add_workdays(start: date, days: int) -> date:
    """Vrati zadnji radni dan intervala dužine 'days'.
       start se računa kao 1. radni dan (inkluzivan)."""
    d = next_workday(start)
    remaining = max(1, days) - 1
    while remaining > 0:
        d += timedelta(days=1)
        if not is_weekend(d):
            remaining -= 1
    return d


@router.post("/projects/{project_id}/generate-tasks", response_model=list[TaskRead])
async def generate_tasks(project_id: int, request: Request, db: Session = Depends(get_db)):
    """
    Generiše taskove za sve TOP-ove u projektu na osnovu najbližeg *process modela* (Top→Ebene→Stiege→Bauteil).

    Body (opciono):
    {
      "start_map": {
        "top": { "123": "2025-11-04", "124": "2025-11-10", ... }
      }
    }

    Ako `start_map.top[<topId>]` nedostaje, koristi se `project.start_date`, pa današnji datum.
    Za svaki task se postavlja: start_ist = start_soll.
    """
    debug = request.query_params.get("debug") in {"1", "true", "yes"}

    project: Project | None = db.query(Project).filter_by(id=project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    # Svi TOP-ovi u projektu (preko hijerarhije)
    tops: list[Top] = (
        db.query(Top)
        .join(Ebene).join(Stiege).join(Bauteil)
        .filter(Bauteil.project_id == project_id)
        .all()
    )
    if not tops:
        raise HTTPException(status_code=404, detail="No TOPs found in project.")

    # --- Body: mapa početnih datuma po TOP-u (opciono) ----------------------
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    start_map = (payload or {}).get("start_map") or {}
    start_map_top: dict[str, str] = (start_map or {}).get("top") or {}

    created_tasks: list[Task] = []
    skipped_no_model: list[int] = []
    skipped_duplicates: list[tuple[int, int]] = []
    traces: list[dict] = []

    for top in tops:
        # Hijerarhija (za trace i pronalazak modela)
        ebene: Ebene | None = db.query(Ebene).filter_by(id=top.ebene_id).first()
        stiege: Stiege | None = db.query(Stiege).filter_by(id=ebene.stiege_id).first() if ebene else None
        bauteil: Bauteil | None = db.query(Bauteil).filter_by(id=stiege.bauteil_id).first() if stiege else None

        # Pronađi najbliži process model uzlazno
        model: ProcessModel | None = None
        model_source: str | None = None
        if getattr(top, "process_model_id", None):
            model = db.query(ProcessModel).filter_by(id=top.process_model_id).first()
            model_source = "top"
        elif ebene and getattr(ebene, "process_model_id", None):
            model = db.query(ProcessModel).filter_by(id=ebene.process_model_id).first()
            model_source = "ebene"
        elif stiege and getattr(stiege, "process_model_id", None):
            model = db.query(ProcessModel).filter_by(id=stiege.process_model_id).first()
            model_source = "stiege"
        elif bauteil and getattr(bauteil, "process_model_id", None):
            model = db.query(ProcessModel).filter_by(id=bauteil.process_model_id).first()
            model_source = "bauteil"

        trace = {
            "top": {"id": top.id, "name": getattr(top, "name", f"Top#{top.id}")},
            "ebene": {"id": ebene.id, "name": getattr(ebene, "name", f"Ebene#{ebene.id}")} if ebene else None,
            "stiege": {"id": stiege.id, "name": getattr(stiege, "name", f"Stiege#{stiege.id}")} if stiege else None,
            "bauteil": {"id": bauteil.id, "name": getattr(bauteil, "name", f"Bauteil#{bauteil.id}")} if bauteil else None,
            "model": {"id": model.id, "name": getattr(model, "name", f"Model#{model.id}")} if model else None,
            "model_source": model_source,
            "steps_considered": [],
            "steps_skipped_duplicate": [],
            "tasks_created": [],
            "reason": None,
        }

        if not model:
            skipped_no_model.append(top.id)
            trace["reason"] = "no_process_model_found"
            traces.append(trace)
            continue

        # Sortiraj i deduplikuj korake
        steps_sorted: list[ProcessStep] = sorted(
            model.steps,
            key=lambda s: (s.order if getattr(s, "order", None) is not None else 10**9, s.id),
        )
        seen_step_ids: set[int] = set()
        unique_steps: list[ProcessStep] = []
        for step in steps_sorted:
            sid = int(step.id)
            trace["steps_considered"].append({
                "id": sid,
                "name": getattr(step, "name", f"Step#{sid}"),
                "order": getattr(step, "order", None),
                "parallel": getattr(step, "parallel", False),
                "duration_days": getattr(step, "duration_days", None),
            })
            if sid in seen_step_ids:
                continue
            seen_step_ids.add(sid)
            unique_steps.append(step)

        # Početni datum za ovaj TOP:
        # 1) mapa iz frontenda  2) project.start_date  3) today
        # Početni datum – samo ako je iz mape; inače preskoči TOP
        base_str = start_map_top.get(str(top.id))
        if not base_str:
            continue  # bez datuma -> ne generiraj ništa za ovaj TOP

        base_date = _to_date(base_str)
        if not base_date:
            continue
        current_date = next_workday(base_date)      


        # Kreiraj taskove po redu
        for step in unique_steps:
            # Preskoči duplikate (ako task već postoji)
            already = db.query(
                exists().where(
                    and_(
                        Task.project_id == project.id,
                        Task.top_id == top.id,
                        Task.process_step_id == step.id,
                    )
                )
            ).scalar()

            duration = getattr(step, "duration_days", None) or 1
            start_soll = next_workday(current_date)             # ⬅️
            end_soll   = add_workdays(start_soll, duration)     # ⬅️


            if already:
                skipped_duplicates.append((top.id, step.id))
                trace["steps_skipped_duplicate"].append({"id": int(step.id)})
                if not getattr(step, "parallel", False):
                    current_date = end_soll + timedelta(days=1)
                continue

            task = Task(
                top_id=top.id,
                process_step_id=step.id,
                start_soll=start_soll,
                end_soll=end_soll,  # traženo ponašanje
                project_id=project.id,
                status="offen",
            )
            db.add(task)
            db.flush()

            trace["tasks_created"].append({
                "task_id": task.id,
                "step_id": int(step.id),
                "start_soll": str(start_soll),
                "end_soll": str(end_soll),
                "parallel": bool(getattr(step, "parallel", False)),
            })
            created_tasks.append(task)

            if not getattr(step, "parallel", False):
                current_date = end_soll + timedelta(days=1)

        traces.append(trace)

    db.commit()

    details = {
        "project_id": project_id,
        "Projektname": project.name,
        "anzahl_aktivitäten": len(created_tasks),
        "übersprungen_kein_Modell": skipped_no_model[:200],
        "übersprungen_duplikate": skipped_duplicates[:200],
        "project_name": project.name, 
    }
    if debug:
        details["trace"] = traces[:200]

    # Zapiši u protokol (ne ruši endpoint ako logging ne uspije)
    try:
        log_protocol(db, request, action="task.generate", ok=True, status_code=200, details=details)
        db.commit()
    except Exception:
        db.rollback()

    # (opciono) ispiši debug u stdout
    if debug:
        import json, sys
        print("[task.generate.debug]", json.dumps(details, ensure_ascii=False, default=str)[:20000], file=sys.stdout)

    return created_tasks
