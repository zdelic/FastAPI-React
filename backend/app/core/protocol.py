# app/core/protocol.py
from typing import Any, Mapping, Optional
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID
from fastapi import Request
from sqlalchemy.orm import Session
from app.models.protocol import ProtocolEntry
from app.models.user import User
from app.models.task import Task
from app.models.project import Project



SENSITIVE = {"password","pass","token","authorization","secret","api_key","refresh_token","pin","otp"}

def _task_location_dict(t) -> dict:
    """Izvuci hijerarhiju Bauteil/Stiege/Ebene/Top iz taska (ako postoji)."""
    loc = {}
    top = getattr(t, "top", None)
    if top:
        ebene = getattr(top, "ebene", None)
        stiege = getattr(ebene, "stiege", None) if ebene else None
        bauteil = getattr(stiege, "bauteil", None) if stiege else None
        loc = {
            "bauteil": getattr(bauteil, "name", None),
            "stiege": getattr(stiege, "name", None),
            "ebene": getattr(ebene, "name", None),
            "top": getattr(top, "name", None),
        }
    return loc

def _norm(v):
    if isinstance(v, datetime):
        # ako želiš full precision: return v.isoformat()
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return v

def compute_diff(model, updates: dict) -> dict:
    """
    Vrati samo promijenjena polja: { field: {old: ..., new: ...}, ... }
    """
    diff = {}
    for k, new in updates.items():
        old = getattr(model, k, None)
        old_n = _norm(old)
        new_n = _norm(new)
        if old_n != new_n:
            diff[k] = {"old": old_n, "new": new_n}
    return diff


def to_jsonable(obj: Any) -> Any:
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, (date, datetime, time)):
        return obj.isoformat()
    if isinstance(obj, (Decimal, UUID)):
        return str(obj)
    if isinstance(obj, Mapping):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(v) for v in obj]
    # fallback za bilo šta drugo (npr. SQLA model)
    # ako je Pydantic v2: .model_dump() prvo, pa kroz to_jsonable
    if hasattr(obj, "model_dump"):
        return to_jsonable(obj.model_dump())
    return str(obj)

def _mask(v: Any) -> Any:
    if isinstance(v, Mapping):
        return {k: ("****" if k and k.lower() in SENSITIVE else _mask(v2)) for k, v2 in v.items()}
    if isinstance(v, list):
        return [_mask(x) for x in v]
    return v

def _prepare_details(details: Any) -> Any:
    # pydantic → dict
    if hasattr(details, "model_dump"):
        details = details.model_dump()
    # maskiranje osetljivih polja
    if isinstance(details, (dict, list)):
        details = _mask(details)
    # konverzija u JSON-friendly
    return to_jsonable(details)

def _extract_user_from_request(request: Request) -> tuple[Optional[str], Optional[str]]:
    u = getattr(getattr(request, "state", None), "user", None)
    if not u:
        return None, None
    # probaj redom: ime, username, email
    name = getattr(u, "name", None) or getattr(u, "username", None) or getattr(u, "email", None)
    uid = getattr(u, "id", None)
    return (str(uid) if uid is not None else None, name)

def log_protocol(
    db: Session,
    request: Request,
    *,
    action: str,
    ok: bool,
    status_code: int,
    details: Any = None,
    user_id: Optional[str | int] = None,
    user_name: Optional[str] = None,
):
    # HTTP metapodaci
    method = getattr(request, "method", None)
    path = getattr(getattr(request, "url", None), "path", None)
    ip = getattr(getattr(request, "client", None), "host", None)
    user_agent = request.headers.get("user-agent") if getattr(request, "headers", None) else None

    # user (prioritet: eksplicitni argumenti -> request.state.user -> None)
    if user_id is None and user_name is None:
        uid2, uname2 = _extract_user_from_request(request)
    else:
        uid2, uname2 = None, None

    uid_final = str(user_id) if user_id is not None else uid2
    uname_final = user_name if user_name is not None else uname2

    # NEW: ako imamo user_id ali još nemamo ime, probaj ga dohvatiti iz baze
    if uid_final and not uname_final:
        try:
            uid_int = int(uid_final)
            u = db.get(User, uid_int) if hasattr(db, "get") else db.query(User).get(uid_int)
            if u:
                uname_final = (
                    getattr(u, "name", None)
                    or getattr(u, "username", None)
                    or getattr(u, "email", None)
                )
        except Exception:
            # nikad ne smije srušiti log
            pass

    det = details
    if isinstance(det, dict):
        # automatski ubaci user_id i user_name u details,
        # ali ne prepisuj ako backend već šalje te ključeve
        if uid_final and "user_id" not in det:
            det.setdefault("user_id", uid_final)
        if uname_final and "user_name" not in det:
            det.setdefault("user_name", uname_final)
        try:
            det = enrich_details(action, det, db)
        except Exception:
            pass
    else:
        # ako nije dict, samo proslijedi dalje
        det = details
    det = _prepare_details(det) if det is not None else None

    entry = ProtocolEntry(
        timestamp=datetime.utcnow(),
        user_id=uid_final,
        user_name=uname_final,   # <- sada će biti punjeno
        action=action,
        ok=ok,
        method=method,
        path=path,
        status_code=status_code,
        ip=ip,
        user_agent=user_agent,
        details=det,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def _task_project_dict(t) -> dict | None:
    """
    Vrati {"project_id": ..., "project_name": ...} ako se može izvući iz taska
    preko t.project ili preko strukture (bauteil.project). Inače None.
    """
    # direktna relacija ako postoji
    proj = getattr(t, "project", None)
    if not proj:
        # pokušaj preko strukture
        top = getattr(t, "top", None)
        if top:
            ebene = getattr(top, "ebene", None)
            stiege = getattr(ebene, "stiege", None) if ebene else None
            bauteil = getattr(stiege, "bauteil", None) if stiege else None
            proj = getattr(bauteil, "project", None) if bauteil else None

    if proj:
        return {
            "project_id": getattr(proj, "id", None),
            "project_name": getattr(proj, "name", None),
        }

    # fallback: barem vrati ID ako postoji atribut
    pid = getattr(t, "project_id", None)
    if pid is not None:
        return {"project_id": pid, "project_name": None}

    return None

def enrich_details(action: str, details: dict, db: Session) -> dict:
    if not isinstance(details, dict):
        return details

    if action.startswith("task."):
        task_id = details.get("task_id") or details.get("id")
        if task_id:
            t = db.get(Task, task_id) if hasattr(db, "get") else db.query(Task).get(task_id)
            if t:
                details.setdefault(
                    "task_name",
                    getattr(getattr(t, "process_step", None), "activity", None)
                    or getattr(t, "name", None) or getattr(t, "title", None)
                )
                details.setdefault("location", _task_location_dict(t))

    # NEW: bulk – ako postoji project_id ili sub_id, dopuni imena
    if action.startswith("task.bulk"):
        pid = details.get("project_id")
        if pid and "project_name" not in details:
            proj = db.get(Project, pid) if hasattr(db, "get") else db.query(Project).get(pid)
            if proj:
                details["project_name"] = getattr(proj, "name", None)

        sid = details.get("sub_id")
        if sid and "sub_name" not in details and SubCompany:
            sub = db.get(SubCompany, sid) if hasattr(db, "get") else db.query(SubCompany).get(sid)
            if sub:
                details["sub_name"] = getattr(sub, "name", None)

    return details


