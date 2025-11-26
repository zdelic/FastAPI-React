from fastapi import Request
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from app.database import get_db
from app.models.structure import Bauteil, Stiege, Ebene, Top
from app.schemas.structure import BauteilUpdate, StiegeUpdate, EbeneUpdate, TopUpdate, BauteilCreate, StiegeCreate, EbeneCreate, TopCreate
from app.crud import structure as crud
from fastapi.encoders import jsonable_encoder
from app.schemas.structure import Bauteil as BauteilSchema
from app.core.protocol import log_protocol
from app.models.project import Project
from app.models.process import ProcessModel



router = APIRouter()



@router.post("/bauteile")
def add_bauteil(data: BauteilCreate, db: Session = Depends(get_db)):
    return crud.create_bauteil(db, data)

@router.post("/stiegen")
def add_stiege(data: StiegeCreate, db: Session = Depends(get_db)):
    return crud.create_stiege(db, data)

@router.post("/ebenen")
def add_ebene(data: EbeneCreate, db: Session = Depends(get_db)):
    return crud.create_ebene(db, data)

@router.post("/tops")
def add_top(data: TopCreate, db: Session = Depends(get_db)):
    return crud.create_top(db, data)

@router.get("/projects/{project_id}/structure", response_model=list[BauteilSchema])
def get_structure(project_id: int, db: Session = Depends(get_db)):
    bauteile = (
        db.query(Bauteil)
        .options(
            joinedload(Bauteil.stiegen)
            .joinedload(Stiege.ebenen)
            .joinedload(Ebene.tops)
        )
        .filter(Bauteil.project_id == project_id)
        .all()
    )

    mapped = [BauteilSchema.model_validate(b).model_dump(mode="json") for b in bauteile]

    
    return mapped

@router.post("/projects/{project_id}/bauteil")
def add_bauteil_to_project(
    project_id: int,
    data: BauteilCreate,
    db: Session = Depends(get_db),
):
    return crud.create_bauteil_for_project(db, project_id, data)

@router.get("/projects/{project_id}/structure/full")
def get_full_project_structure(
    project_id: int,
    db: Session = Depends(get_db)
):
    return crud.get_full_structure(db, project_id)

# UPDATE


@router.put("/bauteile/{bauteil_id}")
def update_bauteil(
    bauteil_id: int,
    request: Request,
    data: BauteilUpdate,
    db: Session = Depends(get_db),
    propagate: bool = Query(True),
):
    bauteil = (
        db.query(Bauteil)
        .options(
            joinedload(Bauteil.stiegen)
            .joinedload(Stiege.ebenen)
            .joinedload(Ebene.tops)
        )
        .filter(Bauteil.id == bauteil_id)
        .first()
    )
    if not bauteil:
        raise HTTPException(status_code=404, detail="Bauteil nicht gefunden")

    # --- staro stanje za diff ---
    old_start = getattr(bauteil, "start_soll", None)
    old_pm_id = bauteil.process_model_id
    old_name = bauteil.name

    payload = data.model_dump(exclude_unset=True)

    # osnovna polja – update samo ako su poslata
    if "name" in payload:
        bauteil.name = data.name
    if "process_model_id" in payload:
        bauteil.process_model_id = data.process_model_id

    # start_soll
    has_start_field = "start_soll" in payload
    if has_start_field:
        bauteil.start_soll = data.start_soll

    db.commit()
    db.refresh(bauteil)

    # propagiraj PM na djecu SAMO kad je promijenjen
    if propagate and "process_model_id" in payload and data.process_model_id is not None:
        for stiege in bauteil.stiegen:
            stiege.process_model_id = data.process_model_id
            for ebene in stiege.ebenen:
                ebene.process_model_id = data.process_model_id
                for top in ebene.tops:
                    top.process_model_id = data.process_model_id
        db.commit()

    # nazivi starog i novog PM
    old_pm = db.query(ProcessModel).get(old_pm_id) if old_pm_id else None
    new_pm = db.query(ProcessModel).get(bauteil.process_model_id) if bauteil.process_model_id else None

    old_pm_name = getattr(old_pm, "name", None)
    new_pm_name = getattr(new_pm, "name", None)

    # CHANGES
    changes: dict[str, dict[str, object]] = {}

    if has_start_field and old_start != bauteil.start_soll:
        changes["start_soll"] = {
            "old": old_start.isoformat() if old_start else None,
            "new": bauteil.start_soll.isoformat() if bauteil.start_soll else None,
        }

    if old_pm_id != bauteil.process_model_id:
        changes["process_model_name"] = {
            "old": old_pm_name,
            "new": new_pm_name,
        }

    pm_name = new_pm_name

    # putanja: Projekt - Bauteil
    project = db.query(Project).get(bauteil.project_id) if getattr(bauteil, "project_id", None) else None
    project_name = project.name if project else None
    bauteil_name = bauteil.name

    bauteil_path = " - ".join([x for x in [project_name, bauteil_name] if x])

    details: dict[str, object] = {
        "bauteil_path": bauteil_path,
        "process_model_name": pm_name,
    }
    if changes:
        details["changes"] = changes

    log_protocol(
        db,
        request,
        action="structure.bauteil.update",
        ok=True,
        status_code=200,
        details=details,
    )
    return bauteil





@router.put("/stiegen/{stiege_id}")
def update_stiege(
    stiege_id: int,
    data: StiegeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    propagate: bool = Query(True),
):
    stiege = (
        db.query(Stiege)
        .options(joinedload(Stiege.ebenen).joinedload(Ebene.tops))
        .filter(Stiege.id == stiege_id)
        .first()
    )
    if not stiege:
        raise HTTPException(status_code=404, detail="Stiege nicht gefunden")

    # --- staro stanje za diff ---
    old_start = getattr(stiege, "start_soll", None)
    old_pm_id = stiege.process_model_id
    old_name = stiege.name

    # samo polja koja je frontend STVARNO poslao
    payload = data.model_dump(exclude_unset=True)

    # osnovna polja – update samo ako su poslata
    if "name" in payload:
        stiege.name = data.name
    if "process_model_id" in payload:
        stiege.process_model_id = data.process_model_id

    # start_soll (može biti i None = brisanje)
    has_start_field = "start_soll" in payload
    if has_start_field:
        stiege.start_soll = data.start_soll

    db.commit()
    db.refresh(stiege)

    # propagiraj process model na Ebenen/Tops SAMO ako je stvarno mijenjan
    if propagate and "process_model_id" in payload and data.process_model_id is not None:
        for ebene in stiege.ebenen:
            ebene.process_model_id = data.process_model_id
            for top in ebene.tops:
                top.process_model_id = data.process_model_id
        db.commit()

    # --- nazivi starog i novog PM-a ---
    old_pm = db.query(ProcessModel).get(old_pm_id) if old_pm_id else None
    new_pm = db.query(ProcessModel).get(stiege.process_model_id) if stiege.process_model_id else None

    old_pm_name = getattr(old_pm, "name", None)
    new_pm_name = getattr(new_pm, "name", None)

    # --- CHANGES (diff box) ---
    changes: dict[str, dict[str, object]] = {}

    # diff start_soll
    if has_start_field and old_start != stiege.start_soll:
        changes["start_soll"] = {
            "old": old_start.isoformat() if old_start else None,
            "new": stiege.start_soll.isoformat() if stiege.start_soll else None,
        }

    # diff procesnog modela po IMENU
    if old_pm_id != stiege.process_model_id:
        changes["process_model_name"] = {
            "old": old_pm_name,
            "new": new_pm_name,
        }

    # ime PM-a za tabelu ispod
    pm_name = new_pm_name

    # složi "putanju": Projekt - Bauteil - Stiege
    bauteil = db.query(Bauteil).get(stiege.bauteil_id) if getattr(stiege, "bauteil_id", None) else None
    project = db.query(Project).get(bauteil.project_id) if bauteil and getattr(bauteil, "project_id", None) else None

    project_name = project.name if project else None
    bauteil_name = bauteil.name if bauteil else None
    stiege_name = stiege.name

    stiege_path = " - ".join(
        [x for x in [project_name, bauteil_name, stiege_name] if x]
    )

    # --- details za log ---
    details: dict[str, object] = {
        "stiege_path": stiege_path,
        "process_model_name": pm_name,
    }
    if changes:
        details["changes"] = changes

    log_protocol(
        db,
        request,
        action="structure.stiege.update",
        ok=True,
        status_code=200,
        details=details,
    )
    return stiege




@router.put("/ebenen/{ebene_id}")
def update_ebene(
    ebene_id: int,
    data: EbeneUpdate,
    request: Request,
    db: Session = Depends(get_db),
    propagate: bool = Query(True),
):
    ebene = (
        db.query(Ebene)
        .options(joinedload(Ebene.tops))
        .filter(Ebene.id == ebene_id)
        .first()
    )
    if not ebene:
        raise HTTPException(status_code=404, detail="Ebene nicht gefunden")

    # --- staro stanje za diff ---
    old_start = getattr(ebene, "start_soll", None)
    old_pm_id = ebene.process_model_id
    old_name = ebene.name

    # samo polja koja je frontend STVARNO poslao
    payload = data.model_dump(exclude_unset=True)

    # osnovna polja – update samo ako su poslata
    if "name" in payload:
        ebene.name = data.name
    if "process_model_id" in payload:
        ebene.process_model_id = data.process_model_id

    # start_soll (može biti i None = brisanje)
    has_start_field = "start_soll" in payload
    if has_start_field:
        ebene.start_soll = data.start_soll

    db.commit()
    db.refresh(ebene)

    # propagiraj process model na TOP-ove SAMO ako je stvarno mijenjan
    if propagate and "process_model_id" in payload and data.process_model_id is not None:
        for top in ebene.tops:
            top.process_model_id = data.process_model_id
        db.commit()

    # --- PM nazivi (stari/novi) za diff ---
    old_pm = db.query(ProcessModel).get(old_pm_id) if old_pm_id else None
    new_pm = db.query(ProcessModel).get(ebene.process_model_id) if ebene.process_model_id else None

    old_pm_name = getattr(old_pm, "name", None)
    new_pm_name = getattr(new_pm, "name", None)

    # --- CHANGES blok (crveni diff box) ---
    changes: dict[str, dict[str, object]] = {}

    # diff start_soll
    if has_start_field and old_start != ebene.start_soll:
        changes["start_soll"] = {
            "old": old_start.isoformat() if old_start else None,
            "new": ebene.start_soll.isoformat() if ebene.start_soll else None,
        }

    # diff proces modela po imenu
    if old_pm_id != ebene.process_model_id:
        changes["process_model_name"] = {
            "old": old_pm_name,
            "new": new_pm_name,
        }

    # ime PM-a za tabelu ispod
    pm_name = new_pm_name

    # složi putanju Projekt-Bauteil-Stiege-Ebene
    stiege = db.query(Stiege).get(ebene.stiege_id) if getattr(ebene, "stiege_id", None) else None
    bauteil = db.query(Bauteil).get(stiege.bauteil_id) if stiege and getattr(stiege, "bauteil_id", None) else None
    project = db.query(Project).get(bauteil.project_id) if bauteil and getattr(bauteil, "project_id", None) else None

    project_name = project.name if project else None
    bauteil_name = bauteil.name if bauteil else None
    stiege_name = stiege.name if stiege else None
    ebene_name = ebene.name

    ebene_path = " - ".join(
        [x for x in [project_name, bauteil_name, stiege_name, ebene_name] if x]
    )

    # --- details za log ---
    details: dict[str, object] = {
        "ebene_path": ebene_path,
        "process_model_name": pm_name,
    }
    if changes:
        details["changes"] = changes

    log_protocol(
        db,
        request,
        action="structure.ebene.update",
        ok=True,
        status_code=200,
        details=details,
    )
    return ebene







@router.put("/tops/{top_id}")
def update_top(
    top_id: int,
    data: TopUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    obj = db.query(Top).get(top_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Top nicht gefunden")

    # --- staro stanje za diff ---
    old_start = getattr(obj, "start_soll", None)
    old_pm_id = obj.process_model_id
    old_name = obj.name

    # ime STAROG process modela (za diff)
    old_pm = db.query(ProcessModel).get(old_pm_id) if old_pm_id else None
    pm_old_name = old_pm.name if old_pm else None

    # samo polja koja su POSLATA iz frontenda
    payload = data.model_dump(exclude_unset=True)

    # osnovna polja
    if "name" in payload:
        obj.name = data.name
    if "process_model_id" in payload:
        obj.process_model_id = data.process_model_id

    # start_soll (može biti i None → brisanje)
    had_start_field = "start_soll" in payload
    if had_start_field:
        obj.start_soll = data.start_soll

    db.commit()
    db.refresh(obj)

    # --- changes za Start (Soll) + Prozessmodell ---
    changes: dict[str, dict[str, object]] = {}

    # promjena datuma
    if had_start_field and old_start != obj.start_soll:
        changes["start_soll"] = {
            "old": old_start.isoformat() if old_start else None,
            "new": obj.start_soll.isoformat() if obj.start_soll else None,
        }

    # ime NOVOG process modela
    pm_name = None
    if obj.process_model_id:
        pm = db.query(ProcessModel).get(obj.process_model_id)
        if pm:
            pm_name = pm.name

    # promjena process modela → diff u crvenom boxu
    if old_pm_id != obj.process_model_id:
        changes["process_model"] = {
            "old": pm_old_name,
            "new": pm_name,
        }

    # da li se išta promijenilo (datum, model ili ime)
    any_change = bool(changes) or (old_name != obj.name)

    # složi putanju Projekt - Bauteil - Stiege - Top
    ebene = db.query(Ebene).get(obj.ebene_id) if getattr(obj, "ebene_id", None) else None
    stiege = db.query(Stiege).get(ebene.stiege_id) if ebene and getattr(ebene, "stiege_id", None) else None
    bauteil = db.query(Bauteil).get(stiege.bauteil_id) if stiege and getattr(stiege, "bauteil_id", None) else None
    project = db.query(Project).get(bauteil.project_id) if bauteil and getattr(bauteil, "project_id", None) else None

    project_name = project.name if project else None
    bauteil_name = bauteil.name if bauteil else None
    stiege_name = stiege.name if stiege else None
    top_name = obj.name

    top_path = " - ".join([x for x in [project_name, bauteil_name, stiege_name, top_name] if x])

    # --- details koje šaljemo u protokol ---
    if not any_change:
        details = {}
    else:
        details = {
            "top_path": top_path,
            "process_model_name": pm_name,
        }
        if changes:
            details["changes"] = changes

    log_protocol(
        db,
        request,
        action="structure.top.update",
        ok=True,
        status_code=200,
        details=details,
    )
    return obj




@router.delete("/bauteile/{bauteil_id}", status_code=204)
def delete_bauteil(bauteil_id: int, request: Request, db: Session = Depends(get_db)):
    obj = db.query(Bauteil).get(bauteil_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Bauteil nicht gefunden")
    db.delete(obj)
    db.commit()
    log_protocol(db, request, action="structure.bauteil.delete", ok=True, status_code=204, details={"bauteil_id": bauteil_id})
    return {"message": "Gelöscht"}

@router.delete("/stiegen/{stiege_id}", status_code=204)
def delete_stiege(stiege_id: int, request: Request, db: Session = Depends(get_db)):
    obj = db.query(Stiege).get(stiege_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Stiege nicht gefunden")
    db.delete(obj)
    db.commit()
    log_protocol(db, request, action="structure.stiege.delete", ok=True, status_code=204, details={"stiege_id": stiege_id})
    return {"message": "Gelöscht"}

@router.delete("/ebenen/{ebene_id}", status_code=204)
def delete_ebene(ebene_id: int, request: Request, db: Session = Depends(get_db)):
    obj = db.query(Ebene).get(ebene_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Ebene nicht gefunden")
    db.delete(obj)
    db.commit()
    log_protocol(db, request, action="structure.ebene.delete", ok=True, status_code=204, details={"ebene_id": ebene_id})
    return {"message": "Gelöscht"}

@router.delete("/tops/{top_id}")
def delete_top(top_id: int, request: Request, db: Session = Depends(get_db)):
    obj = db.query(Top).get(top_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Top nicht gefunden")
    db.delete(obj)
    db.commit()
    log_protocol(db, request, action="structure.top.delete", ok=True, status_code=204, details={"top_id": top_id})
    return {"message": "Gelöscht"}

@router.get("/tops/{top_id}")
def get_top(top_id: int, db: Session = Depends(get_db)):
    top = db.query(Top).get(top_id)
    if not top:
        raise HTTPException(status_code=404, detail="Top nicht gefunden")
    return top

@router.get("/ebenen/{ebene_id}")
def get_ebene(ebene_id: int, db: Session = Depends(get_db)):
    ebene = db.query(Ebene).get(ebene_id)
    if not ebene:
        raise HTTPException(status_code=404, detail="Ebene nicht gefunden")
    return ebene

@router.get("/stiegen/{stiege_id}")
def get_stiege(stiege_id: int, db: Session = Depends(get_db)):
    stiege = db.query(Stiege).get(stiege_id)
    if not stiege:
        raise HTTPException(status_code=404, detail="Stiege nicht gefunden")
    return stiege

@router.get("/bauteile/{bauteil_id}")
def get_bauteil(bauteil_id: int, db: Session = Depends(get_db)):
    bauteil = db.query(Bauteil).get(bauteil_id)
    if not bauteil:
        raise HTTPException(status_code=404, detail="Bauteil nicht gefunden")
    return bauteil
