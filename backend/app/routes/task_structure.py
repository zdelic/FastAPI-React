# app/routes/task_structure.py
from fastapi import APIRouter, Depends, Query, HTTPException, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_
from datetime import datetime, date
from typing import Optional, Dict, Tuple, List
from app.database import get_db
from app.models import Task, Top, Ebene, Stiege, Bauteil, ProcessStep, Gewerk, ProcessModel
from app.schemas.structure_timeline import StructureTimelineResponse, StructSegment, StructActivity

router = APIRouter()

def _eff_start(t: Task):
    return t.start_ist or t.start_soll
def _eff_end(t: Task):
    return t.end_ist or t.end_soll

def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None

@router.get("/projects/{project_id}/structure-timeline", response_model=StructureTimelineResponse)
def structure_timeline(
    project_id: int,
    level: str = Query("ebene"),   
    gewerk: Optional[List[str]] = Query(None),
    status: Optional[List[str]] = Query(None),
    startDate: Optional[str] = Query(None),
    endDate: Optional[str] = Query(None),
    delayed: Optional[bool] = Query(None),
    taskName: Optional[str] = Query(None),
    topIds: Optional[List[int]] = Query(None),
    tops: Optional[List[str]] = Query(None),
    ebenen: Optional[List[str]] = Query(None),
    stiegen: Optional[List[str]] = Query(None),
    bauteile: Optional[List[str]] = Query(None),
    activities: Optional[List[str]] = Query(None),
    processModels: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
):
    if level not in ("ebene", "stiege", "bauteil"):
        level = "ebene"
    start_d = _parse_date(startDate)
    end_d   = _parse_date(endDate)
    # bazni upit
    q = (
        db.query(Task)
        .join(Task.process_step, isouter=True)
        .join(Task.top, isouter=True)
        .join(Top.ebene, isouter=True)
        .join(Ebene.stiege, isouter=True)
        .join(Stiege.bauteil, isouter=True)
        .options(
            joinedload(Task.process_step).joinedload(ProcessStep.gewerk),
            joinedload(Task.top).joinedload(Top.ebene).joinedload(Ebene.stiege).joinedload(Stiege.bauteil),
        )
        .filter(Task.project_id == project_id)
    )

    # *isti* filteri kao u /tasks-timeline (prilagodi prema tvojoj implementaciji)
    if topIds:
        q = q.filter(Task.top_id.in_(topIds))
    if tops:
        q = q.filter(Top.name.in_(tops))
    if gewerk:
        q = q.join(ProcessStep.gewerk).filter(Gewerk.name.in_(gewerk))
    if status:
        conds = []
        if "Erledigt" in status:
            conds.append(Task.end_ist.isnot(None))
        if "In Bearbeitung" in status:
            conds.append(and_(Task.start_ist.isnot(None), Task.end_ist.is_(None)))
        if "Offen" in status:
            conds.append(and_(Task.start_ist.is_(None), Task.end_ist.is_(None)))
        if conds:
            q = q.filter(or_(*conds))
    if start_d:
        q = q.filter(Task.end_soll >= start_d)
    if end_d:
        q = q.filter(Task.start_soll <= end_d)
    if delayed:
        today = date.today()
        q = q.filter(or_(
            and_(Task.end_ist.is_(None), Task.end_soll < today),
            Task.end_ist > Task.end_soll
        ))
    if taskName:
        q = q.filter(ProcessStep.activity.ilike(f"%{taskName}%"))
    if ebenen:
        q = q.filter(Ebene.name.in_(ebenen))
    if stiegen:
        q = q.filter(Stiege.name.in_(stiegen))
    if bauteile:
        q = q.filter(Bauteil.name.in_(bauteile))
    if activities:
        q = q.filter(ProcessStep.activity.in_(activities))
    if processModels:
        q = q.join(ProcessStep.model).filter(ProcessModel.name.in_(processModels))

    tasks: List[Task] = q.all()

    # grupiranje: ključ = (segment_id, segment_name, activity)
    from collections import defaultdict
    groups: Dict[Tuple[int, str, str], List[Task]] = defaultdict(list)
    segment_meta: Dict[Tuple[int, str], Optional[str]] = {} 

    def segment_of(t: Task):
        if level == "ebene":
            return (t.top.ebene.id, t.top.ebene.name) if t.top and t.top.ebene else (None, None)
        if level == "stiege":
            return (t.top.ebene.stiege.id, t.top.ebene.stiege.name) if t.top and t.top.ebene and t.top.ebene.stiege else (None, None)
        # bauteil
        st = t.top.ebene.stiege if (t.top and t.top.ebene) else None
        bt = st.bauteil if st else None
        return (bt.id, bt.name) if bt else (None, None)

    for t in tasks:
        seg_id, seg_name = segment_of(t)
        if not seg_id:
            continue
        act = t.process_step.activity if t.process_step else "(ohne Aktivität)"
        groups[(seg_id, seg_name, act)].append(t)

        # 👇 NOVO: izračunaj "putanju" za dati segment
        seg_key = (seg_id, seg_name)
        if seg_key not in segment_meta:
            top = t.top
            ebene = top.ebene if top else None
            stiege = ebene.stiege if ebene else None
            bauteil = stiege.bauteil if stiege else None

            path: Optional[str] = None

            if level == "ebene":
                # ispod Ebene želimo npr: "Bauteil-1 - Stiege-1"
                bt_name = bauteil.name if bauteil else None
                st_name = stiege.name if stiege else None
                parts = [p for p in (bt_name, st_name) if p]
                path = " - ".join(parts) if parts else None

            elif level == "stiege":
                # ispod Stiege npr: "Bauteil-1"
                bt_name = bauteil.name if bauteil else None
                path = bt_name

            elif level == "bauteil":
                # ako hoćeš, ovdje možeš kasnije dodati projekt, za sad ništa
                path = None

            segment_meta[seg_key] = path

    # složi odgovor
    by_segment: Dict[Tuple[int, str], List[StructActivity]] = defaultdict(list)
    today = date.today()

    for (seg_id, seg_name, act), arr in groups.items():
        # efektivni start/end preko svih taskova u grupi
        starts = [ _eff_start(t) for t in arr if _eff_start(t) ]
        ends   = [ _eff_end(t)   for t in arr if _eff_end(t)   ]
        start = min(starts) if starts else None
        end   = max(ends)   if ends   else None

        total = len(arr)
        done  = sum(1 for t in arr if t.end_ist is not None)
        progress = (done / total) if total else 0.0

        # delayed: ako je barem jedan realni task “u minusu”
        any_delayed = any(
            (t.end_ist and t.end_soll and t.end_ist > t.end_soll) or
            (not t.end_ist and t.end_soll and today > t.end_soll)
            for t in arr
        )

         # ➜ uzmi gewerk + color iz ProcessStep.gewerk (prvi koji postoji u grupi)
        gewerk_names = [
            t.process_step.gewerk.name
            for t in arr
            if t.process_step and t.process_step.gewerk
        ]
        gewerk_colors = [
            t.process_step.gewerk.color
            for t in arr
            if t.process_step and t.process_step.gewerk and t.process_step.gewerk.color
        ]
        gewerk_name = gewerk_names[0] if gewerk_names else None
        gewerk_color = gewerk_colors[0] if gewerk_colors else None

        by_segment[(seg_id, seg_name)].append(StructActivity(
            activity=act, start=start, end=end,
            total_tasks=total, done_tasks=done,
            progress=progress, delayed=any_delayed,
            gewerk=gewerk_name, color=gewerk_color
        ))

    segments: List[StructSegment] = []
    for (seg_id, seg_name), acts in by_segment.items():
        seg_key = (seg_id, seg_name)
        path = segment_meta.get(seg_key)

        segments.append(
            StructSegment(
                level=level,
                id=seg_id,
                name=seg_name,
                structure_path=path,  # 👈 NOVO
                activities=sorted(
                    acts, key=lambda a: (a.start or date.max, a.activity)
                ),
            )
        )

    return StructureTimelineResponse(
        project_id=project_id,
        level=level,
        segments=sorted(segments, key=lambda s: s.name.lower())
    )

