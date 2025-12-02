
from fastapi import Request
from fastapi import APIRouter, Depends, HTTPException, Response, Query, status
from sqlalchemy.orm import Session, joinedload, load_only
from app.database import get_db
from app.models.task import Task
from app.models.aktivitaet_question import TaskCheckAnswer
from app.schemas.aktivitaet_question import TaskCheckAnswerCreate, TaskCheckAnswerRead
from app.models.aktivitaet import Aktivitaet
from app.models.aktivitaet_question import AktivitaetQuestion
from app.schemas.aktivitaet_question import AktivitaetQuestionRead
from app.models.structure import Top, Ebene, Stiege, Bauteil
from app.models.process import ProcessStep, ProcessModel
from app.models.gewerk import Gewerk
from app.models.project import Project
from app.models.user import User 
from app.schemas.task import TaskCreate, TaskRead, TaskUpdate, TimelineTask
from app.schemas.bulk import BulkBody, BulkFilters, BulkUpdate
from typing import List, Dict
from datetime import date, timedelta, datetime
from sqlalchemy import func, select, or_, and_, case, cast, Integer
from app.core.protocol import compute_diff, log_protocol
from pydantic import BaseModel
from typing import Optional


today = date.today()
router = APIRouter()

def _task_location_str_from_top(top) -> str | None:
    """
    Vrati string: 'Bauteil • Stiege • Ebene • Top' ili None ako nema hijerarhije.
    """
    if not top:
        return None
    ebene = top.ebene
    stiege = ebene.stiege if ebene else None
    bauteil = stiege.bauteil if stiege else None

    parts: list[str] = []
    if bauteil and bauteil.name:
        parts.append(bauteil.name)
    if stiege and stiege.name:
        parts.append(stiege.name)
    if ebene and ebene.name:
        parts.append(ebene.name)
    if top.name:
        parts.append(top.name)

    return " • ".join(parts) if parts else None


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


# We'll create a condition for delayed tasks
  # Condition 1: task is not done (end_ist is null) and end_soll < today
  # Condition 2: task is done but end_ist > end_soll
delayed_condition = or_(
    and_(Task.end_ist.is_(None), Task.end_soll < today),
    Task.end_ist > Task.end_soll
)

STATUS_CHOICES = ("Erledigt", "In Bearbeitung", "Offen")

@router.get("/projects/{project_id}/tasks-count")
def tasks_count(project_id: int, db: Session = Depends(get_db)):
    total = db.query(func.count()).select_from(Task).filter(Task.project_id == project_id).scalar() or 0
    return {"total": int(total)}


@router.post("/tasks", response_model=TaskRead, status_code=201)
def create_task(data: TaskCreate, request: Request, db: Session = Depends(get_db)):
    task = Task(**data.dict())
    db.add(task)
    db.commit()
    db.refresh(task)
    log_protocol(db, request, action="task.create", ok=True, status_code=201,
                 details={"task_id": task.id, "payload": data.dict()})
    return task

@router.get("/tasks", response_model=List[TaskRead])
def list_tasks(db: Session = Depends(get_db)):
    return db.query(Task).all()

from fastapi import Response
import time

@router.get("/projects/{project_id}/tasks-timeline", response_model=List[TimelineTask])
def project_tasks_timeline(
    project_id: int,
    response: Response,
    db: Session = Depends(get_db),
    gewerk: List[str] = Query(None),
    startDate: str = Query(None),
    endDate: str = Query(None),
    statuses: List[str] = Query(None, alias="status"),
    delayed: bool = Query(None),
    taskName: str = Query(None),
    top: List[str] = Query(None),
    ebene: List[str] = Query(None),
    stiege: List[str] = Query(None),
    bauteil: List[str] = Query(None),
    activity: List[str] = Query(None),
    processModel: List[str] = Query(None)
):
    t0 = time.perf_counter()

    # Osnovni query s joinovima
    q = (
        db.query(Task)
        .filter(Task.project_id == project_id)
        .options(
            joinedload(Task.top)
                .joinedload(Top.ebene)
                .joinedload(Ebene.stiege)
                .joinedload(Stiege.bauteil),
            joinedload(Task.process_step).joinedload(ProcessStep.gewerk),
            joinedload(Task.process_step).joinedload(ProcessStep.model),
            joinedload(Task.sub),
            load_only(
                Task.id, Task.project_id, Task.top_id, Task.process_step_id,
                Task.start_soll, Task.end_soll, Task.start_ist, Task.end_ist,
                Task.beschreibung, Task.sub_id
            ),
        )
    )

    # Primjeni filtere
    if gewerk:
        q = q.join(Task.process_step).join(ProcessStep.gewerk).filter(Gewerk.name.in_(gewerk))
    
    if startDate:
        start_date = datetime.strptime(startDate, "%Y-%m-%d").date()
        q = q.filter(Task.end_soll >= start_date)
    
    if endDate:
        end_date = datetime.strptime(endDate, "%Y-%m-%d").date()
        q = q.filter(Task.start_soll <= end_date)
    
    if statuses:
        status_conditions = []
        if "Erledigt" in statuses:
            status_conditions.append(Task.end_ist.isnot(None))
        if "In Bearbeitung" in statuses:
            status_conditions.append(and_(Task.start_ist.isnot(None), Task.end_ist.is_(None)))
        if "Offen" in statuses:
            status_conditions.append(and_(Task.start_ist.is_(None), Task.end_ist.is_(None)))

        if status_conditions:
            q = q.filter(or_(*status_conditions))
    
    if delayed:
        today = date.today()
        q = q.filter(
            or_(
                and_(Task.end_ist.is_(None), Task.end_soll < today),
                Task.end_ist > Task.end_soll
            )
        )
    
    if taskName:
        q = q.join(Task.process_step).filter(ProcessStep.activity.ilike(f"%{taskName}%"))
    
    if top:
        q = q.join(Task.top).filter(Top.name.in_(top))
    
    if ebene:
        q = q.join(Task.top).join(Top.ebene).filter(Ebene.name.in_(ebene))
    
    if stiege:
        q = q.join(Task.top).join(Top.ebene).join(Ebene.stiege).filter(Stiege.name.in_(stiege))
    
    if bauteil:
        q = q.join(Task.top).join(Top.ebene).join(Ebene.stiege).join(Stiege.bauteil).filter(Bauteil.name.in_(bauteil))
    
    if activity:
        q = q.join(Task.process_step).filter(ProcessStep.activity.in_(activity))
    
    if processModel:
        q = q.join(Task.process_step).join(ProcessStep.model).filter(ProcessModel.name.in_(processModel))
    
    # 🔽🔽🔽 SORT 🔽🔽🔽
    q = (
        q.outerjoin(Task.top)
         .outerjoin(Top.ebene)
         .outerjoin(Ebene.stiege)
         .outerjoin(Stiege.bauteil)
         .order_by(
             Bauteil.name.is_(None),  # prvo oni koji imaju bauteil
             Bauteil.name,            # A, B, C...
             Stiege.name.is_(None),
             Stiege.name,             # Stiege 1, Stiege 2...
             Ebene.name.is_(None),
             Ebene.name,              # Ebene 1, Ebene 2...
             Top.name                 # Top 1, Top 2, Top 10 (po abecedi/stringu)
         )
    )
    # 🔼🔼🔼 End SORT 🔼🔼🔼

    q = q.execution_options(stream_results=True)

    # Ostali dio funkcije ostaje isti
    t_fetch_start = time.perf_counter()
    tasks = q.all()
    t_fetch_ms = (time.perf_counter() - t_fetch_start) * 1000.0

    t_build_start = time.perf_counter()
    result: list[TimelineTask] = []
    for t in tasks:
        top = t.top
        ebene = top.ebene if top else None
        stiege = ebene.stiege if ebene else None
        bauteil = stiege.bauteil if stiege else None

        step = t.process_step
        model = step.model if step else None
        gewerk_obj = step.gewerk if step else None

        wohnung = (top.name if (top and top.name) else (f"Top-{top.id}" if top else None))
        farbe = getattr(gewerk_obj, "color", "#cccccc")
        gewerk_name = getattr(gewerk_obj, "name", "Unbekannt")
        sub_user = t.sub if t.sub_id else None

        result.append(TimelineTask(
            id=t.id,
            task=step.activity if step else None,
            wohnung=wohnung,
            start_soll=t.start_soll,
            end_soll=t.end_soll,
            start_ist=t.start_ist,
            end_ist=t.end_ist,
            farbe=farbe,
            gewerk_name=gewerk_name,
            top=top.name if top else None,
            ebene=ebene.name if ebene else None,
            stiege=stiege.name if stiege else None,
            bauteil=bauteil.name if bauteil else None,
            process_step_id=step.id if step else None,
            process_model=(model.name if model else None),
            beschreibung=t.beschreibung,
            sub_id=sub_user.id if sub_user else None,
            sub_name=sub_user.name if sub_user else None,
            top_id=t.top_id,
            project_id=t.project_id,
        ))
    t_build_ms = (time.perf_counter() - t_build_start) * 1000.0

    response.headers["X-Items"] = str(len(result))
    response.headers["X-FetchMs"] = f"{t_fetch_ms:.1f}"
    response.headers["X-BuildMs"] = f"{t_build_ms:.1f}"

    return result


@router.get("/projects/{project_id}/has-tasks", response_model=bool)
def has_tasks(project_id: int, db: Session = Depends(get_db)):
    count = db.query(Task).filter(Task.project_id == project_id).count()
    return count > 0


def find_process_model(top: Top, db: Session):
    if top.process_model_id:
        return db.query(ProcessModel).filter_by(id=top.process_model_id).first()
    ebene = db.query(Ebene).filter_by(id=top.ebene_id).first()
    if ebene and ebene.process_model_id:
        return db.query(ProcessModel).filter_by(id=ebene.process_model_id).first()
    stiege = db.query(Stiege).filter_by(id=ebene.stiege_id).first() if ebene else None
    if stiege and stiege.process_model_id:
        return db.query(ProcessModel).filter_by(id=stiege.process_model_id).first()
    bauteil = db.query(Bauteil).filter_by(id=stiege.bauteil_id).first() if stiege else None
    if bauteil and bauteil.process_model_id:
        return db.query(ProcessModel).filter_by(id=bauteil.process_model_id).first()
    return None



@router.post("/projects/{project_id}/sync-tasks", response_model=list[TaskRead])
async def sync_tasks(project_id: int, request: Request, db: Session = Depends(get_db)):
    project = db.query(Project).filter_by(id=project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projekt nicht gefunden")

    # 1) pročitaj body
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    start_map = (payload or {}).get("start_map") or {}
    start_map_top: dict[str, str] = (start_map or {}).get("top") or {}
    filters = (payload or {}).get("filters") or {}
    purge_top_ids = (payload or {}).get("purge_top_ids") or []
    top_ids = filters.get("topIds") or []

    # 2) svi topovi u projektu (suženo po filterima)
    tops_q = (
        db.query(Top)
        .join(Ebene)
        .join(Stiege)
        .join(Bauteil)
        .filter(Bauteil.project_id == project_id)
    )
    if top_ids:
        try:
            top_ids = [int(x) for x in top_ids]
        except Exception:
            pass
        tops_q = tops_q.filter(Top.id.in_(top_ids))
    tops = tops_q.all()

    # ograniči purge na već filtrirane TOP-ove (sigurnosna brana)
    allowed_top_ids = {t.id for t in tops}
    safe_purge_ids = [
        tid for tid in purge_top_ids
        if tid in allowed_top_ids and str(tid) not in start_map_top
    ]

    # PURGE: obriši sve taskove za topove bez datuma (ili kojima je datum obrisan)
    if safe_purge_ids:
        db.query(Task).filter(
            Task.project_id == project_id,
            Task.top_id.in_(safe_purge_ids)
        ).delete(synchronize_session=False)

    created_tasks: list[Task] = []
    updated_task_ids: list[int] = []
    all_changes: list[dict] = []

    # 3) za svaki TOP regeneriraj/generiraj taskove iz process modela
    for top in tops:
        model = find_process_model(top, db)
        if not model:
            continue

        # hijerarhija radi loga
        ebene = db.query(Ebene).get(top.ebene_id) if getattr(top, "ebene_id", None) else None
        stiege = ebene.stiege if ebene else None
        bauteil = stiege.bauteil if stiege else None

        existing_tasks = db.query(Task).filter_by(top_id=top.id).all()
        existing_task_map = {t.process_step_id: t for t in existing_tasks}

        # ******** NOVO – fallback za nove TOP-ove ********
        base_str = start_map_top.get(str(top.id))

        # ako mapa NEMA datum za ovaj top
        if not base_str:
            if existing_tasks:
                # ima već taskove → ne diramo (nema razloga mijenjati bez datuma)
                continue
            # nema taskova → pokušaj koristiti start_date projekta
            if project.start_date:
                base_date = project.start_date
            else:
                # ni projekt nema start → preskoči ovaj top
                continue
        else:
            try:
                base_date = date.fromisoformat(base_str[:10])
            except Exception:
                # loš format → ako ima taskove, preskoči; ako nema, opet probaj projekt
                if existing_tasks:
                    continue
                if project.start_date:
                    base_date = project.start_date
                else:
                    continue
        # ******** kraj NOVOG dijela ********

        current_date = next_workday(base_date)

        steps = sorted(
            model.steps,
            key=lambda s: (s.order if s.order is not None else s.id),
        )

        for step in steps:
            duration = step.duration_days or 1
            start_soll = next_workday(current_date)
            end_soll = add_workdays(start_soll, duration)

            location = {
                "project": project.name,
                "bauteil": bauteil.name if bauteil else None,
                "stiege": stiege.name if stiege else None,
                "ebene": ebene.name if ebene else None,
                "top": top.name,
            }

            task = existing_task_map.get(step.id)
            change_entry: dict | None = None

            if not task:
                # 👉 NOVI TASK ZA OVAJ KORAK
                task = Task(
                    project_id=project_id,
                    top_id=top.id,
                    process_step_id=step.id,
                    start_soll=start_soll,
                    end_soll=end_soll,
                )
                db.add(task)
                created_tasks.append(task)

                change_entry = {
                    "task_id": None,
                    "task_name": step.activity,
                    "location": location,
                    "start_soll": {"old": None, "new": str(start_soll)},
                    "end_soll": {"old": None, "new": str(end_soll)},
                }
            else:
                # 👉 postojeći task – update samo ako još nije krenuo
                if task.start_ist is None:
                    start_changed = task.start_soll != start_soll
                    end_changed = task.end_soll != end_soll

                    if start_changed or end_changed:
                        change_entry = {
                            "task_id": task.id,
                            "task_name": task.process_step.activity if task.process_step else None,
                            "location": location,
                            "start_soll": {
                                "old": str(task.start_soll) if task.start_soll else None,
                                "new": str(start_soll),
                            } if start_changed else None,
                            "end_soll": {
                                "old": str(task.end_soll) if task.end_soll else None,
                                "new": str(end_soll),
                            } if end_changed else None,
                        }

                        task.start_soll = start_soll
                        task.end_soll = end_soll
                        updated_task_ids.append(task.id)
                        db.add(task)

            if change_entry:
                all_changes.append(change_entry)

            if not getattr(step, "parallel", False):
                current_date = end_soll + timedelta(days=1)


    # 4) commit jednom i log + response IZVAN petlje
    db.commit()

    # refresh za nove taskove radi response_model-a
    for t in created_tasks:
        db.refresh(t)

    details = {
        "project_id": project_id,
        "project_name": project.name,
        "purged_top_ids": safe_purge_ids,
        "created_ids": [t.id for t in created_tasks],
        "updated_ids": updated_task_ids,
        "changes": all_changes,
    }

    log_protocol(
        db,
        request,
        action="task.sync",
        ok=True,
        status_code=200,
        details=details,
    )

    # frontend ionako poslije učitava timeline, pa je dovoljno vratiti nove taskove
    return created_tasks







@router.get("/projects/{project_id}/task-stats")
def project_task_stats(project_id: int, db: Session = Depends(get_db)):
    # Učitaj sve taskove po projektu direktno
    tasks = db.query(Task).filter(Task.project_id == project_id).all()

    # Ukupan broj taskova
    total = len(tasks)
    done = sum(1 for t in tasks if t.status == "done")
    in_progress = sum(1 for t in tasks if t.status == "in_progress")
    offen = sum(1 for t in tasks if t.status == "offen")
    percent_done = round((done / total) * 100, 1) if total else 0

    # Grupisanje po gewerk (ako postoji)
    gewerk_stats = {}
    for task in tasks:
        if not task.process_step or not task.process_step.gewerk:
            continue  # preskoči ako fali veza

        name = task.process_step.gewerk.name

        if name not in gewerk_stats:
            gewerk_stats[name] = {"done": 0, "in_progress": 0, "offen": 0}

        if task.status in gewerk_stats[name]:
            gewerk_stats[name][task.status] += 1

    return {
        "total": total,
        "done": done,
        "in_progress": in_progress,
        "offen": offen,
        "percent_done": percent_done,
        "by_gewerk": [
            {"gewerk": name, **counts} for name, counts in gewerk_stats.items()
        ]
    }



@router.get("/projects/{project_id}/progress-curve")
def get_progress_curve(project_id: int, db: Session = Depends(get_db)):
    tasks = db.query(Task).filter(Task.project_id == project_id).all()

    data = {}

    for task in tasks:
        # Soll = planirano
        soll = task.start_soll or task.end_soll
        if soll:
            week = soll.isocalendar()[1]
            year = soll.isocalendar()[0]
            key = f"{year}-KW{week}"
            data.setdefault(key, {"soll": 0, "ist": 0})
            data[key]["soll"] += 1

        # Ist = stvarno završeno
        ist = task.end_ist or task.start_ist
        if ist:
            week = ist.isocalendar()[1]
            year = ist.isocalendar()[0]
            key = f"{year}-KW{week}"
            data.setdefault(key, {"soll": 0, "ist": 0})
            data[key]["ist"] += 1

    sorted_keys = sorted(data.keys())

    return {
        "labels": sorted_keys,
        "soll": [data[k]["soll"] for k in sorted_keys],
        "ist": [data[k]["ist"] for k in sorted_keys],
    }

@router.put("/tasks/{task_id}", response_model=TaskRead)
def update_task(
    task_id: int,
    request: Request,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
):
    # 1) nađi task
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task nicht gefunden")

    # 2) pripremi diff na osnovu STARIH vrijednosti
    updates = task_data.dict(exclude_unset=True)
    diff = compute_diff(task, updates)

    # 3) primijeni promjene
    for attr, value in updates.items():
        setattr(task, attr, value)

    db.commit()
    db.refresh(task)

    # 4) složi malo “ljepše” detalje za protokol

    # projekt (za kolonu "Projekt")
    project = getattr(task, "project", None)
    project_id = task.project_id
    project_name = project.name if project else None

    # naziv taska (aktivnost)
    task_name = None
    try:
        if task.process_step and task.process_step.activity:
            task_name = task.process_step.activity
    except Exception:
        task_name = None

    # hijerarhija: bauteil / stiege / ebene / top
    top = getattr(task, "top", None)
    ebene = top.ebene if top else None
    stiege = ebene.stiege if ebene else None
    bauteil = stiege.bauteil if stiege else None
    sub_user = task.sub if task.sub_id else None
    sub_name = sub_user.name if sub_user else None

    location = {
        "bauteil": bauteil.name if bauteil else None,
        "stiege": stiege.name if stiege else None,
        "ebene": ebene.name if ebene else None,
        "top": top.name if top else None,
    }

    # 5) log u istom “dizajnu” kao ostalo
    log_protocol(
        db,
        request,
        action="task.update",
        ok=True,
        status_code=200,
        details={
            "project_id": project_id,
            "project_name": project_name,
            "task_id": task.id,
            "task_name": task_name,
            "location": location,
            "changes": diff,
            "sub_id": task.sub_id,
            "sub_name": sub_name,

        },
    )

    return task


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task nicht gefunden")

    # --- pripremi podatke ZA LOG prije brisanja ---

    # projekt
    project_id = task.project_id
    project = db.query(Project).filter_by(id=project_id).first()
    project_name = project.name if project else None

    # naziv aktivnosti
    step = task.process_step
    task_name = step.activity if step else None

    # hijerarhija (bauteil / stiege / ebene / top)
    top = task.top
    ebene = top.ebene if top else None
    stiege = ebene.stiege if ebene else None
    bauteil = stiege.bauteil if stiege else None

    location = {
        "bauteil": bauteil.name if bauteil else None,
        "stiege": stiege.name if stiege else None,
        "ebene": ebene.name if ebene else None,
        "top": top.name if top else None,
    }

    # --- obriši task ---
    db.delete(task)
    db.commit()

    # --- log u istom dizajnu kao task.update ---
    log_protocol(
        db,
        request,
        action="task.delete",
        ok=True,
        status_code=200,
        details={
            "project_id": project_id,
            "project_name": project_name,
            "task_id": task_id,
            "task_name": task_name,
            "location": location,
        },
    )

    return {"ok": True}


@router.get("/subs")
def list_subs(db: Session = Depends(get_db)):
    subs = db.query(User).filter(User.role == "sub").order_by(User.name).all()
    return [{"id": u.id, "name": u.name, "email": u.email} for u in subs]




@router.patch("/projects/{project_id}/tasks/bulk")
def bulk_update_tasks(
    project_id: int,
    request: Request,
    body: BulkBody,
    db: Session = Depends(get_db),
):
    # Bazni query za sve taskove u projektu + eager load za strukturu
    q = (
        db.query(Task)
        .filter(Task.project_id == project_id)
        .options(
            joinedload(Task.top)
            .joinedload(Top.ebene)
            .joinedload(Ebene.stiege)
            .joinedload(Stiege.bauteil),
            joinedload(Task.process_step),
        )
    )

    # Po ID-jevima
    if body.ids:
        q = q.filter(Task.id.in_(body.ids))

    # Po filterima (isto kao u /tasks-timeline) + topIds
    f = body.filters
    if f:
        if getattr(f, "topIds", None):
            q = q.filter(Task.top_id.in_(f.topIds))
        if f.gewerk:
            q = q.join(Task.process_step).join(ProcessStep.gewerk).filter(
                Gewerk.name.in_(f.gewerk)
            )
        if f.status:
            conds = []
            if "Erledigt" in f.status:
                conds.append(Task.end_ist.isnot(None))
            if "In Bearbeitung" in f.status:
                conds.append(
                    and_(Task.start_ist.isnot(None), Task.end_ist.is_(None))
                )
            if "Offen" in f.status:
                conds.append(
                    and_(Task.start_ist.is_(None), Task.end_ist.is_(None))
                )
            if conds:
                q = q.filter(or_(*conds))
        if f.startDate:
            q = q.filter(Task.end_soll >= f.startDate)
        if f.endDate:
            q = q.filter(Task.start_soll <= f.endDate)
        if f.delayed:
            today = date.today()
            q = q.filter(
                or_(
                    and_(Task.end_ist.is_(None), Task.end_soll < today),
                    Task.end_ist > Task.end_soll,
                )
            )
        if f.taskName:
            q = q.join(Task.process_step).filter(
                ProcessStep.activity.ilike(f"%{f.taskName}%")
            )
        if f.tops:
            q = q.join(Task.top).filter(Top.name.in_(f.tops))
        if f.ebenen:
            q = (
                q.join(Task.top)
                .join(Top.ebene)
                .filter(Ebene.name.in_(f.ebenen))
            )
        if f.stiegen:
            q = (
                q.join(Task.top)
                .join(Top.ebene)
                .join(Ebene.stiege)
                .filter(Stiege.name.in_(f.stiegen))
            )
        if f.bauteile:
            q = (
                q.join(Task.top)
                .join(Top.ebene)
                .join(Ebene.stiege)
                .join(Stiege.bauteil)
                .filter(Bauteil.name.in_(f.bauteile))
            )
        if f.activities:
            q = q.join(Task.process_step).filter(
                ProcessStep.activity.in_(f.activities)
            )
        if f.processModels:
            q = (
                q.join(Task.process_step)
                .join(ProcessStep.model)
                .filter(ProcessModel.name.in_(f.processModels))
            )

    # Ako nema update dijela – nema posla
    if not body.update:
        return {"betroffen": 0}

    u = body.update
    updated_ids: list[int] = []

    # flag da li je ovo baš „Fertig“-tipka (copy start/end_soll + status=done)
    is_mark_done = (
        isinstance(getattr(u, "start_ist", None), str)
        and u.start_ist == "__COPY__start_soll"
        and isinstance(getattr(u, "end_ist", None), str)
        and u.end_ist == "__COPY__end_soll"
        and getattr(u, "status", None) == "done"
        and getattr(u, "sub_id", None) is None
    )

    # 1) Samo sub_id → ➕ Sub button
    if (
        u.sub_id is not None
        and all(getattr(u, k, None) is None for k in ("start_ist", "end_ist", "status"))
    ):
        sub_user = db.query(User).get(u.sub_id)
        if not sub_user:
            raise HTTPException(
                status_code=404, detail="Subunternehmen (User) nicht gefunden"
            )
        if (getattr(sub_user, "role", None) or "").lower() != "sub":
            raise HTTPException(
                status_code=400,
                detail="Angegebener Benutzer ist kein Subunternehmen",
            )

        tasks = q.all()
        if not tasks:
            return {"betroffen": 0}

        ids = [t.id for t in tasks]
        db.query(Task).filter(Task.id.in_(ids)).update(
            {"sub_id": u.sub_id}, synchronize_session=False
        )
        db.commit()

        # lijepa lista taskova sa strukturom
        log_tasks = []
        for t in tasks:
            loc_str = _task_location_str_from_top(t.top)
            name = t.process_step.activity if t.process_step else None
            log_tasks.append(
                {
                    "id": t.id,
                    "name": name,
                    "location": loc_str,
                }
            )

        log_protocol(
            db,
            request,
            action="task.bulk.assign_sub",
            ok=True,
            status_code=200,
            details={
                "project_id": project_id,
                "sub_id": u.sub_id,
                "sub_name": getattr(sub_user, "name", None)
                or getattr(sub_user, "email", None)
                or f"Sub #{sub_user.id}",
                "count": len(log_tasks),
                "tasks": log_tasks,
            },
        )

        return {"betroffen": len(ids)}

    # 2) Ostali slučajevi (uklj. „Fertig“-tipka)
    tasks = q.all()
    log_tasks: list[dict] = []

    for t in tasks:
        changed = False

        # start_ist
        if getattr(u, "start_ist", None) is not None:
            if isinstance(u.start_ist, str) and u.start_ist == "__COPY__start_soll":
                if t.start_soll:
                    t.start_ist = t.start_soll
                    changed = True
            else:
                d = _to_date(u.start_ist)
                if d:
                    t.start_ist = d
                    changed = True

        # end_ist
        if getattr(u, "end_ist", None) is not None:
            if isinstance(u.end_ist, str) and u.end_ist == "__COPY__end_soll":
                if t.end_soll:
                    t.end_ist = t.end_soll
                    changed = True
            else:
                d = _to_date(u.end_ist)
                if d:
                    t.end_ist = d
                    changed = True

        # status
        if getattr(u, "status", None) is not None:
            t.status = u.status
            changed = True

        # sub_id (kombinovano sa gore navedenim)
        if getattr(u, "sub_id", None) is not None:
            t.sub_id = u.sub_id
            changed = True

        if changed:
            updated_ids.append(t.id)
            db.add(t)

            loc_str = _task_location_str_from_top(t.top)
            name = t.process_step.activity if t.process_step else None
            log_tasks.append(
                {
                    "id": t.id,
                    "name": name,
                    "location": loc_str,
                }
            )

    db.commit()

    # log u protokol
    if updated_ids:
        log_protocol(
            db,
            request,
            action="task.bulk.mark_done" if is_mark_done else "task.bulk.update",
            ok=True,
            status_code=200,
            details={
                "project_id": project_id,
                "count": len(updated_ids),
                "tasks": log_tasks,
            },
        )

    return {"betroffen": len(updated_ids)}





# ===== Zeitsprung / skip-window ============================================

class SkipWindowFilters(BaseModel):
    topIds: Optional[list[int]] = None 
    top: Optional[list[str]] = None
    ebene: Optional[list[str]] = None
    stiege: Optional[list[str]] = None
    bauteil: Optional[list[str]] = None
    gewerk: Optional[list[str]] = None
    activity: Optional[list[str]] = None
    processModel: Optional[list[str]] = None

class SkipWindowRequest(BaseModel):
    start: date
    end: date
    skip_weekends: bool = True
    filters: Optional[SkipWindowFilters] = None

def _ranges_overlap(a_start: date | None, a_end: date | None,
                    b_start: date, b_end: date) -> bool:
    if a_start is None or a_end is None:
        return False
    return a_start <= b_end and b_start <= a_end

def _count_weekend_days(start: date, end: date) -> int:
    if end < start:
        return 0
    days = (end - start).days + 1
    wend = 0
    for i in range(days):
        d = start + timedelta(days=i)
        if d.weekday() >= 5:  # 5=Sat, 6=Sun
            wend += 1
    return wend

def _overlaps(a_start: date | None, a_end: date | None, b_start: date, b_end: date) -> bool:
    if not a_start or not a_end:
        return False
    # intervali inkluzivni po danima
    return not (a_end < b_start or a_start > b_end)

def _next_monday(d: date) -> tuple[date, int]:
    """
    Ako d padne na vikend, vraća prvi ponedjeljak i koliko je dana pomaknuto.
    Inače vraća (d, 0).
    """
    if d.weekday() < 5:
        return d, 0
    # subota=5 -> +2, nedjelja=6 -> +1
    add = 7 - d.weekday()
    return d + timedelta(days=add), add

@router.post("/projects/{project_id}/schedule/skip-window")
def schedule_skip_window(
    project_id: int,
    payload: SkipWindowRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # 0) validacije
    if payload.end < payload.start:
        raise HTTPException(status_code=400, detail="Ende vor Start")

    # 1) TAČAN broj dana prozora (inkluzivno) — bez oduzimanja vikenda
    shift_days = (payload.end - payload.start).days + 1
    if shift_days <= 0:
        return {"moved": 0, "days_shifted": 0}

    # helper: ako padne na vikend, pomjeri na ponedjeljak i vrati koliko je pomaknuto
    def _bump_if_weekend(d: date) -> tuple[date, int]:
        wd = d.weekday()  # 0=Mon ... 5=Sat 6=Sun
        if wd < 5:
            return d, 0
        add = 7 - wd  # Sat->2, Sun->1
        return d + timedelta(days=add), add

    # 2) bazni query + eager load za strukturu
    q = (
        db.query(Task)
        .filter(Task.project_id == project_id)
        .options(
            joinedload(Task.top)
            .joinedload(Top.ebene)
            .joinedload(Ebene.stiege)
            .joinedload(Stiege.bauteil),
            joinedload(Task.process_step),
        )
    )

    # 3) filteri (uklj. topIds)
    f = payload.filters
    if f:
        if getattr(f, "topIds", None):
            q = q.filter(Task.top_id.in_(f.topIds))
        if getattr(f, "top", None):
            q = q.join(Task.top).filter(Top.name.in_(f.top))
        if getattr(f, "ebene", None):
            q = q.join(Task.top).join(Top.ebene).filter(Ebene.name.in_(f.ebene))
        if getattr(f, "stiege", None):
            q = (
                q.join(Task.top)
                .join(Top.ebene)
                .join(Ebene.stiege)
                .filter(Stiege.name.in_(f.stiege))
            )
        if getattr(f, "bauteil", None):
            q = (
                q.join(Task.top)
                .join(Top.ebene)
                .join(Ebene.stiege)
                .join(Stiege.bauteil)
                .filter(Bauteil.name.in_(f.bauteil))
            )
        if getattr(f, "gewerk", None):
            q = (
                q.join(Task.process_step)
                .join(ProcessStep.gewerk)
                .filter(Gewerk.name.in_(f.gewerk))
            )
        if getattr(f, "activity", None):
            q = q.join(Task.process_step).filter(
                ProcessStep.activity.in_(f.activity)
            )
        if getattr(f, "processModel", None):
            q = (
                q.join(Task.process_step)
                .join(ProcessStep.model)
                .filter(ProcessModel.name.in_(f.processModel))
            )

    moved = 0
    log_tasks: list[dict] = []

    for t in q.all():
        s = t.start_soll
        e = t.end_soll
        if not s and not e:
            continue

        # pomjeramo samo one koji PREKLAPAJU prozor
        if _ranges_overlap(s, e, payload.start, payload.end):
            ns = s + timedelta(days=shift_days) if s else None
            ne = e + timedelta(days=shift_days) if e else None

            # vikendi po želji
            if payload.skip_weekends:
                if ns:
                    ns, _ = _bump_if_weekend(ns)
                if ne:
                    ne, _ = _bump_if_weekend(ne)

            t.start_soll = ns
            t.end_soll = ne
            moved += 1

            loc_str = _task_location_str_from_top(t.top)
            name = t.process_step.activity if t.process_step else None
            log_tasks.append(
                {
                    "id": t.id,
                    "name": name,
                    "location": loc_str,
                }
            )

    db.commit()

    project = db.query(Project).get(project_id)
    project_name = project.name if project else None

    # log u protokol
    if moved:
        log_protocol(
            db,
            request,
            action="task.schedule.skip_window",
            ok=True,
            status_code=200,
            details={
                "project_id": project_id,
                "project_name": project_name,
                "start": str(payload.start),
                "end": str(payload.end),
                "skip_weekends": payload.skip_weekends,
                "moved": moved,
                "days_shifted": shift_days,
                "filters": payload.filters.dict() if payload.filters else None,
                "tasks": log_tasks,

            },
        )

    return {"moved": moved, "days_shifted": shift_days}




@router.get("/projects/{project_id}/stats")
def project_stats(
    project_id: int,
    until: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    response: Response = None,
):
    if response is not None:
        response.headers["X-Stats-Impl"] = "task.py-v2"  # 👈 marker
    q = (
        db.query(Task)
        .join(Task.process_step, isouter=True)
        .join(ProcessStep.gewerk, isouter=True)
        .options(
            joinedload(Task.process_step).joinedload(ProcessStep.gewerk),
            load_only(
                Task.id, Task.project_id, Task.start_soll, Task.end_soll,
                Task.start_ist, Task.end_ist
            ),
        )
        .filter(Task.project_id == project_id)
    )
    tasks: list[Task] = q.all()

    DEFAULT_G = "Allgemein"

    # ⚠️ fallback na "Allgemein" umjesto "" (prazno)
    def gname_of(t: Task) -> str:
        try:
            name = (t.process_step.gewerk.name or "").strip()
        except Exception:
            name = ""
        return name or DEFAULT_G

    # skup SVIH gewerka u projektu – uvijek formiraj listu lijevo
    all_gewerke: set[str] = set()
    for t in tasks:
        all_gewerke.add(gname_of(t))  # ⚠️ već normalizirano

    total = done = in_prog = offen = 0
    by_gewerk: dict[str, dict] = {}

    for t in tasks:
        s_soll, e_soll = t.start_soll, t.end_soll
        s_ist,  e_ist  = t.start_ist,  t.end_ist

        if until:
            # preskoči čisto buduće taskove bez IST-a
            if (not s_ist) and (not e_ist) and (s_soll and s_soll > until):
                continue

            if e_ist and e_ist <= until:
                cls = "done"
            elif s_ist and s_ist <= until and (not e_ist or e_ist > until):
                cls = "in_progress"
            else:
                if (s_soll is None) or (s_soll and s_soll <= until):
                    cls = "offen"
                else:
                    continue
        else:
            if e_ist:
                cls = "done"
            elif s_ist and not e_ist:
                cls = "in_progress"
            else:
                cls = "offen"

        total += 1
        if cls == "done":
            done += 1
        elif cls == "in_progress":
            in_prog += 1
        else:
            offen += 1

        gname = gname_of(t)  # ⚠️ uvijek normalizirano ime
        if gname not in by_gewerk:
            by_gewerk[gname] = {"gewerk": gname, "done": 0, "in_progress": 0, "offen": 0}
        by_gewerk[gname][cls] += 1

    # ⚠️ osiguraj 0/0/0 zapise i za gewerke bez taskova u “until” rezu
    for gname in sorted(all_gewerke):
        by_gewerk.setdefault(gname, {"gewerk": gname, "done": 0, "in_progress": 0, "offen": 0})

    percent_done = round((done / total) * 100, 2) if total else 0.0

    # (po želji sortiraj po imenu)
    by_gewerk_list = sorted(by_gewerk.values(), key=lambda r: r["gewerk"].lower())

    return {
        "total": total,
        "done": done,
        "in_progress": in_prog,
        "offen": offen,
        "percent_done": percent_done,
        "by_gewerk": by_gewerk_list,  # ⚠️ nikad prazni string kao ime
    }


@router.post(
    "/tasks/{task_id}/check-answers",
    response_model=List[TaskCheckAnswerRead],
    status_code=status.HTTP_201_CREATED,
)
def save_task_check_answers(
    task_id: int,
    data: List[TaskCheckAnswerCreate],
    db: Session = Depends(get_db),
):
    """
    Spremi odgovore na dodatna pitanja za jedan task.
    (Koristit će se kada u UI označiš task kao završen.)
    """
    task = db.query(Task).get(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task nicht gefunden",
        )

    created: list[TaskCheckAnswer] = []

    for item in data:
        ans = TaskCheckAnswer(
            task_id=task_id,
            aktivitaet_question_id=item.aktivitaet_question_id,
            label=item.label,
            field_type=item.field_type,
            bool_value=item.bool_value,
            text_value=item.text_value,
            image_path=item.image_path,
        )
        db.add(ans)
        created.append(ans)

    db.commit()

    for ans in created:
        db.refresh(ans)

    return created



@router.get(
    "/tasks/{task_id}/questions",
    response_model=list[AktivitaetQuestionRead],
)
def get_questions_for_task(
    task_id: int,
    db: Session = Depends(get_db),
):
    """
    Vrati sva Zusatzfragen za dati task prema process_step → gewerk_id i activity.
    """
    task = db.query(Task).get(task_id)
    if not task:
        raise HTTPException(404, "Task nicht gefunden")

    step = task.process_step
    if not step:
        return []

    gewerk_id = step.gewerk_id          # 🔥 pravilno!
    activity_name = step.activity       # 🔥 pravilno!

    if not gewerk_id or not activity_name:
        return []

    aktivitaet = (
        db.query(Aktivitaet)
        .filter(
            Aktivitaet.gewerk_id == gewerk_id,
            Aktivitaet.name == activity_name,
        )
        .first()
    )
    if not aktivitaet:
        return []

    qs = (
        db.query(AktivitaetQuestion)
        .filter(AktivitaetQuestion.aktivitaet_id == aktivitaet.id)
        .order_by(AktivitaetQuestion.sort_order, AktivitaetQuestion.id)
        .all()
    )

    return qs




@router.get("/projects/{project_id}/tasks-tabelle")
def project_tasks_table(
    project_id: int,
    db: Session = Depends(get_db),
):
    """
    Vrati listu taskova za projekat + sve check-answers po tasku,
    za frontend komponentu ProjectTasksTable.
    """

    # 1) Učitaj sve taskove za projekat sa strukturom, gewerkom i sub-om
    tasks: List[Task] = (
        db.query(Task)
        .filter(Task.project_id == project_id)
        .options(
            joinedload(Task.top)
                .joinedload(Top.ebene)
                .joinedload(Ebene.stiege)
                .joinedload(Stiege.bauteil),
            joinedload(Task.process_step).joinedload(ProcessStep.gewerk),
            # ⬆️ namjerno NEMA ProcessStep.model u joinedload-u
            joinedload(Task.sub),
        )
        .all()
    )

    # 2) Učitaj sve odgovore (TaskCheckAnswer) za ove taskove
    task_ids = [t.id for t in tasks] or [-1]

    answers = (
        db.query(TaskCheckAnswer)
        .filter(TaskCheckAnswer.task_id.in_(task_ids))
        .all()
    )

    # grupiši odgovore po task_id
    answers_by_task: Dict[int, List[TaskCheckAnswer]] = {}
    for a in answers:
        answers_by_task.setdefault(a.task_id, []).append(a)

    # 3) Složi JSON kao što frontend očekuje (TaskRow + check_answers)
    rows = []
    for t in tasks:
        top = t.top
        ebene = top.ebene if top else None
        stiege = ebene.stiege if ebene else None
        bauteil = stiege.bauteil if stiege else None

        step = t.process_step
        # ⬇️ ovdje normalno pristupamo modelu, bez joinedload-a
        model = step.model if step else None
        gewerk = step.gewerk if step else None
        sub_user = t.sub if t.sub_id else None

        row = {
            "id": t.id,
            "task": step.activity if step else None,
            "beschreibung": t.beschreibung,
            "gewerk_name": gewerk.name if gewerk else None,
            "bauteil": bauteil.name if bauteil else None,
            "stiege": stiege.name if stiege else None,
            "ebene": ebene.name if ebene else None,
            "top": top.name if top else None,
            "process_model": model.name if model else None,
            "start_soll": t.start_soll,
            "end_soll": t.end_soll,
            "start_ist": t.start_ist,
            "end_ist": t.end_ist,
            "status": t.status,  # "offen" / "in_progress" / "done"
            "sub_name": sub_user.name if sub_user else None,
            "check_answers": [],
        }

        # dodaj check_answers
        ca_list = answers_by_task.get(t.id, [])
        for a in ca_list:
            row["check_answers"].append(
                {
                    "id": a.id,
                    "label": a.label,
                    "field_type": a.field_type,  # "boolean" | "text" | "image"
                    "bool_value": a.bool_value,
                    "text_value": a.text_value,
                    "image_path": a.image_path,
                    "created_at": a.created_at.isoformat() if a.created_at else None,
                }
            )

        rows.append(row)

    return rows

