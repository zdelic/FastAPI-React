import React, { forwardRef } from "react";
import api from "../api/axios";
import ProcessModelDropdown from "./ProcessModelDropdown";
import GenerateTasksButton from "./GenerateTasksButton";
import { useParams } from "react-router-dom";
import CustomDatePicker from "./CustomDatePicker";

type EntityType = "bauteil" | "stiege" | "ebene" | "top";

// ---- helpers for smart name suggestions ----
const parseMaxSuffix = (names: string[], prefix: string, rx: RegExp) => {
  let max = 0;
  for (const n of names) {
    const m = n.trim().match(rx);
    if (m && m[1]) {
      const k = parseInt(m[1], 10);
      if (!Number.isNaN(k)) max = Math.max(max, k);
    }
  }
  return max;
};

const suggestBauteilName = (bauteile: { name: string }[]) => {
  const names = bauteile.map((b) => String(b.name || "")).filter(Boolean);
  const max = parseMaxSuffix(names, "Bauteil", /^Bauteil[-\s]?(\d+)$/i);
  return `Bauteil-${max + 1}`;
};

const suggestStiegeName = (bauteil: any) => {
  const names = (bauteil?.stiegen || [])
    .map((s: any) => String(s.name || ""))
    .filter(Boolean);
  const max = parseMaxSuffix(names, "Stiege", /^Stiege[-\s]?(\d+)$/i);
  return `Stiege${max + 1}`;
};

// EG, pa OG1, OG2… (po svakoj stiege)
const suggestEbeneName = (stiege: any) => {
  const names: string[] = (stiege?.ebenen || [])
    .map((e: any) => String(e.name || ""))
    .filter(Boolean);

  // 1) ako još nema EG – predloži EG
  const hasEG = names.some((n: string) => n.trim().toUpperCase() === "EG");
  if (!hasEG) return "EG";

  // 2) inače predlaži OG brojeve (preskači EG)
  let max = 0;
  for (const n of names) {
    const m = n.trim().match(/^OG[-\s]?(\d+)$/i);
    if (m && m[1]) {
      const k = parseInt(m[1], 10);
      if (!Number.isNaN(k)) max = Math.max(max, k);
    }
  }
  return `OG${max + 1}`;
};

// Top: broji se po STIEGE (ne po Ebeni) – skup svih topova kroz sve Ebene u toj Stiege
const suggestTopName = (stiege: any) => {
  const names = (stiege?.ebenen || [])
    .flatMap((e: any) => e?.tops || [])
    .map((t: any) => String(t.name || ""))
    .filter(Boolean);
  const max = parseMaxSuffix(names, "Top", /^Top[-\s]?(\d+)$/i);
  return `Top${max + 1}`;
};

interface ProjektStrukturProps {
  isAdmin?: boolean;

  newBauteil: string;
  setNewBauteil: React.Dispatch<React.SetStateAction<string>>;
  addBauteil: () => void | Promise<void>;

  bauteile: any[];

  editingNames: Record<string, string>;
  handleNameChange: (type: EntityType, id: number, value: string) => void;
  saveEdit: (type: EntityType, id: number) => void | Promise<void>;
  startEditing: (item: any, type: EntityType) => void;
  deleteItem: (type: EntityType, id: number) => void | Promise<void>;

  newStiegen: Record<number, string>;
  setNewStiegen: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  addStiege: (bauteilId: number) => void | Promise<void>;

  newEbenen: Record<number, string>;
  setNewEbenen: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  addEbene: (stiegeId: number) => void | Promise<void>;

  newTops: Record<number, string>;
  setNewTops: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  addTop: (ebeneId: number) => void | Promise<void>;

  loadStructure: () => void | Promise<void>;
  hasTasks: boolean | null;
  handleSyncTasks: () => void | Promise<void>;
}

const typeToPath: Record<EntityType, string> = {
  bauteil: "bauteile",
  stiege: "stiegen",
  ebene: "ebenen",
  top: "tops",
};

const keyOf = (type: EntityType, id: number) => `${type}:${id}`;
const eff = (
  ownPending: number | null | undefined,
  inheritPending: number | null | undefined,
  persisted: number | null | undefined
) => ownPending ?? inheritPending ?? persisted ?? null;

const ProjektStruktur: React.FC<ProjektStrukturProps> = ({
  isAdmin = false,

  newBauteil,
  setNewBauteil,
  addBauteil,

  bauteile,

  editingNames,
  handleNameChange,
  saveEdit,
  startEditing,
  deleteItem,

  newStiegen,
  setNewStiegen,
  addStiege,

  newEbenen,
  setNewEbenen,
  addEbene,

  newTops,
  setNewTops,
  addTop,

  loadStructure,
  hasTasks,
  handleSyncTasks,
}) => {
  const canEdit = !!isAdmin;

  const [flash, setFlash] = React.useState<null | {
    type: "success" | "error";
    text: string;
  }>(null);

  const [syncing, setSyncing] = React.useState(false);

  const showFlash = React.useCallback(
    (text: string, type: "success" | "error" = "success") => {
      setFlash({ type, text });
      setTimeout(() => setFlash(null), 3500);
    },
    []
  );

  const { id: projectId } = useParams<{ id: string }>();
  const [projectStart, setProjectStart] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const res = await api.get(`/projects/${projectId}`);
        // normalizuj na 'YYYY-MM-DD'
        const d = res.data?.start_date
          ? String(res.data.start_date).slice(0, 10)
          : null;
        setProjectStart(d);
      } catch {
        setProjectStart(null);
      }
    })();
  }, [projectId]);

  // Pending promjene PM-a (preview dok ne klikneš Sync)
  const [pendingPM, setPendingPM] = React.useState<
    Record<string, number | null>
  >({});

  // isto kao pendingPM, ali za start_soll (string ISO 'YYYY-MM-DD' | null)
  const [pendingStart, setPendingStart] = React.useState<
    Record<string, string | null>
  >({});

  const effStr = (
    ownPending: string | null | undefined,
    inheritPending: string | null | undefined,
    persisted: string | null | undefined
  ) => ownPending ?? inheritPending ?? persisted ?? null;

  const collectionOf = (type: EntityType) =>
    type === "bauteil"
      ? "bauteile"
      : type === "stiege"
      ? "stiegen"
      : type === "ebene"
      ? "ebenen"
      : "tops";

  // commit u DB (analogno commitPM)
  const commitStart = async (
    type: EntityType,
    id: number,
    startSoll: string | null
  ) => {
    const coll = collectionOf(type);

    // ako API zahtijeva i 'name' u PUT-u, dohvatimo ga (kao što radiš za PM)
    let name: string | undefined = undefined;
    try {
      const res = await api.get(`/${coll}/${id}`);
      name = res.data?.name ?? undefined;
    } catch {
      /* ok */
    }

    const payload: Record<string, any> = name ? { name } : {};
    payload.start_soll = startSoll;

    await api.put(`/${coll}/${id}`, payload);
  };

  // propagate na podstrukturu (analogno handleSelectPM)
  const handleSelectStart = (
    type: EntityType,
    id: number,
    startSoll: string | null
  ) => {
    setPendingStart((prev) => {
      const next = { ...prev, [keyOf(type, id)]: startSoll };

      const propagate = (item: any, t: EntityType) => {
        if (t === "bauteil") {
          item.stiegen?.forEach((s: any) => propagate(s, "stiege"));
        } else if (t === "stiege") {
          item.ebenen?.forEach((e: any) => propagate(e, "ebene"));
        } else if (t === "ebene") {
          item.tops?.forEach((tp: any) => propagate(tp, "top"));
        }
        next[keyOf(t, item.id)] = startSoll;
      };

      const root = bauteile.find((b) => {
        if (type === "bauteil") return b.id === id;
        if (type === "stiege") return b.stiegen?.some((s: any) => s.id === id);
        if (type === "ebene")
          return b.stiegen?.some((s: any) =>
            s.ebenen?.some((e: any) => e.id === id)
          );
        if (type === "top")
          return b.stiegen?.some((s: any) =>
            s.ebenen?.some((e: any) => e.tops?.some((t: any) => t.id === id))
          );
        return false;
      });

      if (root) {
        if (type === "bauteil") {
          propagate(root, "bauteil");
        } else if (type === "stiege") {
          const st = root.stiegen.find((s: any) => s.id === id);
          if (st) propagate(st, "stiege");
        } else if (type === "ebene") {
          const st = root.stiegen.find((s: any) =>
            s.ebenen?.some((e: any) => e.id === id)
          );
          const eb = st?.ebenen?.find((e: any) => e.id === id);
          if (eb) propagate(eb, "ebene");
        }
      }

      return next;
    });
  };

  // kad se promijeni PM na nekom nivou, propagiraj u sve podređene
  const handleSelectPM = (
    type: EntityType,
    id: number,
    pmId: number | null
  ) => {
    setPendingPM((prev) => {
      const next = { ...prev, [keyOf(type, id)]: pmId };

      // automatsko nasljeđivanje – primijeni na podređene
      const propagate = (item: any, t: EntityType) => {
        if (t === "bauteil") {
          item.stiegen?.forEach((s: any) => propagate(s, "stiege"));
        } else if (t === "stiege") {
          item.ebenen?.forEach((e: any) => propagate(e, "ebene"));
        } else if (t === "ebene") {
          item.tops?.forEach((tp: any) => propagate(tp, "top"));
        }

        next[keyOf(t, item.id)] = pmId;
      };

      // pronađi u strukturi glavni objekt
      const root = bauteile.find((b) => {
        if (type === "bauteil") return b.id === id;
        if (type === "stiege") return b.stiegen?.some((s: any) => s.id === id);
        if (type === "ebene")
          return b.stiegen?.some((s: any) =>
            s.ebenen?.some((e: any) => e.id === id)
          );
        if (type === "top")
          return b.stiegen?.some((s: any) =>
            s.ebenen?.some((e: any) => e.tops?.some((t: any) => t.id === id))
          );
        return false;
      });

      if (root) {
        if (type === "bauteil") propagate(root, "bauteil");
        else if (type === "stiege") {
          const st = root.stiegen.find((s: any) => s.id === id);
          if (st) propagate(st, "stiege");
        } else if (type === "ebene") {
          const st = root.stiegen.find((s: any) =>
            s.ebenen?.some((e: any) => e.id === id)
          );
          const eb = st?.ebenen?.find((e: any) => e.id === id);
          if (eb) propagate(eb, "ebene");
        }
      }

      return next;
    });
  };

  // iz trenutno prikazane strukture izvuci sve vidljive TOP-ove
  const visibleTopIds = React.useMemo(
    () =>
      (bauteile ?? [])
        .flatMap((b) => b.stiegen ?? [])
        .flatMap((s) => s.ebenen ?? [])
        .flatMap((e) => e.tops ?? [])
        .map((t) => t.id),
    [bauteile]
  );

  // helper: prikupi SVE topId iz cijele strukture (i nevidljive)
  const collectAllTopIds = (bauteile: any[]) => {
    const ids: number[] = [];
    for (const b of bauteile) {
      for (const s of b.stiegen || []) {
        for (const e of s.ebenen || []) {
          for (const t of e.tops || []) ids.push(Number(t.id));
        }
      }
    }
    return ids;
  };

  // Vrati set TOP ID-jeva kojima je datum eksplicitno obrisan (pendingStart[key] === null)
  // Uvažava i brisanje na roditelju (propagira niže).
  const getClearedTopIds = (
    bauteile: any[],
    pendingStart: Record<string, string | null>
  ) => {
    const cleared = new Set<number>();

    const isClearedHere = (type: EntityType, id: number) =>
      Object.prototype.hasOwnProperty.call(pendingStart, `${type}:${id}`) &&
      pendingStart[`${type}:${id}`] === null;

    const walkBauteil = (b: any, parentCleared: boolean) => {
      const here = isClearedHere("bauteil", b.id);
      const clearedFlag = parentCleared || here;
      for (const s of b.stiegen || []) walkStiege(s, clearedFlag);
    };

    const walkStiege = (s: any, parentCleared: boolean) => {
      const here = isClearedHere("stiege", s.id);
      const clearedFlag = parentCleared || here;
      for (const e of s.ebenen || []) walkEbene(e, clearedFlag);
    };

    const walkEbene = (e: any, parentCleared: boolean) => {
      const here = isClearedHere("ebene", e.id);
      const clearedFlag = parentCleared || here;
      for (const t of e.tops || []) walkTop(t, clearedFlag);
    };

    const walkTop = (t: any, parentCleared: boolean) => {
      const here = isClearedHere("top", t.id);
      const clearedFlag = parentCleared || here;
      if (clearedFlag) cleared.add(Number(t.id));
    };

    for (const b of bauteile || []) walkBauteil(b, false);
    return cleared;
  };

  const applyPendingThenSync = React.useCallback(async () => {
    // potvrda (DE)
    const ok = window.confirm(
      "Achtung!\n\n" +
        "Es werden NUR die aktuell gefilterten/angezeigten Einheiten synchronisiert. " +
        "Die Aufgaben werden gemäß dem zugewiesenen Prozessmodell und den Startdaten neu aufgebaut. " +
        "Bereits begonnene Aufgaben (mit Start Ist) werden NICHT verändert und bleiben im Timeline.\n\n" +
        "Übersprungene Termine mit der Funktion „Zeitsprung“ werden storniert..\n\n" +
        "Möchten Sie fortfahren?"
    );

    if (!ok) return;

    setSyncing(true);
    try {
      // 0) project_id (uzimamo ga iz strukture)
      const pid = bauteile?.[0]?.project_id;
      if (!pid) return;

      if (Object.keys(pendingPM).length) {
        setPendingPM({});
      }

      // 2) složi start_map po TOP-ovima – SAMO oni s eksplicitnim (ili naslijeđenim) datumom
      const topStartMap = buildStartMapForTops();
      // sinkroniziramo samo trenutno vidljive (scope!)
      const topIdsToSync = visibleTopIds;

      // 1) Topovi eksplicitno "očišćeni" u ovoj sesiji (na njima ili na roditelju)
      const clearedNow = getClearedTopIds(bauteile, pendingStart);

      // 2) Purgeaj SAMO one koji su:
      //    - vidljivi (scope),
      //    - imali taskove ranije,
      //    - NEMAJU efektivan datum sada (nisu u start_map),
      //    - i eksplicitno su obrisani u ovoj sesiji (ili im je roditelj obrisan)
      const purgeTopIds = topIdsToSync.filter((id) => {
        const hadTasksBefore = !!derivedStartByTop[id];
        const hasDateNow = Object.prototype.hasOwnProperty.call(
          topStartMap,
          String(id)
        );
        const wasClearedNow = clearedNow.has(id);
        return hadTasksBefore && !hasDateNow && wasClearedNow;
      });

      // Ako baš NEMA nijednog TOP-a vidljivog, nema smisla zvati backend
      if (topIdsToSync.length === 0) {
        showFlash("Keine sichtbaren Einheiten zum Synchronisieren.", "error");
        setSyncing(false);
        return;
      }

      // (Opcionalno) Ako je mapa prazna, samo pokaži benignu poruku, ali nastavi.
      // Backend će preskočiti sve jer nema datuma za ugraditi (neće dirati TOP-ove bez datuma).
      if (Object.keys(topStartMap).length === 0) {
        console.debug(
          "[SYNC] start_map ist leer – ich synchronisiere nur PM-Änderungen, kein Datum.."
        );
      }

      await api.post(
        `/projects/${pid}/sync-tasks`,
        {
          start_map: { top: topStartMap }, // generiraj/aktualiziraj SAMO ove
          filters: { topIds: visibleTopIds }, // ograniči na trenutno vidljive
          purge_top_ids: purgeTopIds, // OBRIŠI taskove za ove (bez datuma)
        },
        { meta: { showLoader: true } }
      );

      // 4) refetch
      await loadStructure();

      // ✅ flash poruka
      showFlash("Aufgaben wurden erfolgreich synchronisiert.");
    } catch (e) {
      showFlash(
        "Synchronisierung fehlgeschlagen. Bitte erneut versuchen.",
        "error"
      );
    } finally {
      setSyncing(false);
    }
  }, [
    bauteile,
    pendingPM,
    pendingStart,
    projectStart,
    loadStructure,
    visibleTopIds,
  ]);

  const showGenerate = canEdit && hasTasks === false;
  const showSync = canEdit && hasTasks === true;

  const commitPM = async (
    type: EntityType,
    id: number,
    pmId: number | null
  ) => {
    const coll = collectionOf(type);

    // ako backend traži i 'name' za PUT
    let name: string | undefined = undefined;
    try {
      const res = await api.get(`/${coll}/${id}`);
      name = res.data?.name ?? undefined;
    } catch {
      /* ok */
    }

    await api.put(
      `/${coll}/${id}`,
      name ? { name, process_model_id: pmId } : { process_model_id: pmId }
    );
  };

  // vrati mapu: { [topId]: 'YYYY-MM-DD' }
  // helper: pretvori bilo što u 'YYYY-MM-DD' ili null
  const toYMD = (v: any): string | null => {
    if (v == null) return null;
    // ako je string sa samo razmakom ili prazan -> null
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return null;
      // pokušaj uzeti prvih 10 kad je ISO string
      // inače pokušaj Date parse
      const iso = s.length >= 10 ? s.slice(0, 10) : s;
      // gruba validacija YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
      const d = new Date(s);
      if (isNaN(d as any)) return null;
      return d.toISOString().slice(0, 10);
    }
    // dayjs ili Date ili objekt sa toISOString
    if (typeof v?.toISOString === "function") {
      try {
        return v.toISOString().slice(0, 10);
      } catch {
        return null;
      }
    }
    // broj? (timestamp)
    if (typeof v === "number") {
      const d = new Date(v);
      if (isNaN(d as any)) return null;
      return d.toISOString().slice(0, 10);
    }
    return null;
  };

  // helper: pending ima prednost, ali "" i nevažeće -> ignoriraj
  const pickExplicit = (pending: any, persisted: any): string | null => {
    const p = toYMD(pending);
    if (p) return p;
    const q = toYMD(persisted);
    return q || null;
  };

  // Vrati mapu: { [topId]: 'YYYY-MM-DD' } – SAMO jedinice koje imaju efektivni (naslijeđeni) datum
  const buildStartMapForTops = React.useCallback(() => {
    const out: Record<string, string> = {};

    for (const b of bauteile) {
      const bStart =
        pickExplicit(pendingStart[`bauteil:${b.id}`], b.start_soll) ??
        projectStart; // 👈 fallback

      for (const s of b.stiegen || []) {
        const sOwn = pickExplicit(pendingStart[`stiege:${s.id}`], s.start_soll);
        const sStart = sOwn ?? bStart;

        for (const e of s.ebenen || []) {
          const eOwn = pickExplicit(
            pendingStart[`ebene:${e.id}`],
            e.start_soll
          );
          const eStart = eOwn ?? sStart;

          for (const t of e.tops || []) {
            const tOwn = pickExplicit(
              pendingStart[`top:${t.id}`],
              t.start_soll
            );
            const tStart = tOwn ?? eStart ?? projectStart ?? null;

            if (tStart) {
              out[String(t.id)] = tStart;
            }
          }
        }
      }
    }
    return out;
  }, [bauteile, pendingStart, projectStart]);
  

  // 🆕 vrijednosti izvedene iz taskova (po TOP-u)
  const [derivedStartByTop, setDerivedStartByTop] = React.useState<
    Record<number, string>
  >({});
  // Usporedba ISO 'YYYY-MM-DD' stringova – vrati minimum
  const minDate = (
    a: string | null | undefined,
    b: string | null | undefined
  ) => {
    if (!a) return b ?? null;
    if (!b) return a ?? null;
    return a < b ? a : b;
  };

  // Min derived po potomcima
  const derivedMinForEbene = (e: any) => {
    let m: string | null = null;
    for (const t of e?.tops || []) {
      const s = derivedStartByTop[Number(t.id)];
      if (s) m = minDate(m, s);
    }
    return m;
  };
  const derivedMinForStiege = (s: any) => {
    let m: string | null = null;
    for (const e of s?.ebenen || []) m = minDate(m, derivedMinForEbene(e));
    return m;
  };
  const derivedMinForBauteil = (b: any) => {
    let m: string | null = null;
    for (const s of b?.stiegen || []) m = minDate(m, derivedMinForStiege(s));
    return m;
  };

  // DISPLAY vrijednost (bez nasljeđivanja s roditelja!)
  // prioritet: pending -> eksplicitni persisted -> derived -> null
  const displayStartTop = (t: any) => {
    const k = `top:${t.id}`;
    if (Object.prototype.hasOwnProperty.call(pendingStart, k))
      return pendingStart[k];
    return t.start_soll ?? derivedStartByTop[Number(t.id)] ?? null;
  };
  const displayStartEbene = (e: any) => {
    const k = `ebene:${e.id}`;
    if (Object.prototype.hasOwnProperty.call(pendingStart, k))
      return pendingStart[k];
    return e.start_soll ?? derivedMinForEbene(e) ?? null;
  };
  const displayStartStiege = (s: any) => {
    const k = `stiege:${s.id}`;
    if (Object.prototype.hasOwnProperty.call(pendingStart, k))
      return pendingStart[k];
    return s.start_soll ?? derivedMinForStiege(s) ?? null;
  };
  const displayStartBauteil = (b: any) => {
    const k = `bauteil:${b.id}`;
    if (Object.prototype.hasOwnProperty.call(pendingStart, k))
      return pendingStart[k];
    return b.start_soll ?? derivedMinForBauteil(b) ?? null;
  };

  const [derivedPmNameByTop, setDerivedPmNameByTop] = React.useState<
    Record<number, string>
  >({});

  // Kad imamo bar jedan bauteil, znamo project_id → povuci taskove i složi mape
  React.useEffect(() => {
    const pid = bauteile?.[0]?.project_id;
    if (!pid) {
      setDerivedStartByTop({});
      setDerivedPmNameByTop({});
      return;
    }

    let alive = true;
    (async () => {
      try {
        // koristi postojeću rutu (istu kao na Timelineu)
        const r = await api.get(`/projects/${pid}/tasks-timeline`, {
          meta: { showLoader: false },
        });
        if (!alive) return;

        const byTopStart: Record<number, string> = {};
        const byTopModel: Record<number, string> = {};

        const arr = Array.isArray(r.data) ? r.data : [];
        for (const t of arr) {
          const topId = Number(t.top_id);
          if (!topId) continue;

          // min start_soll po TOP-u
          const s = (t.start_soll || "").slice(0, 10);
          if (s) {
            const prev = byTopStart[topId];
            if (!prev || s < prev) byTopStart[topId] = s;
          }

          // naziv process modela (prvi koji nađemo je dovoljan)
          if (t.process_model && !byTopModel[topId]) {
            byTopModel[topId] = String(t.process_model);
          }
        }

        setDerivedStartByTop(byTopStart);
        setDerivedPmNameByTop(byTopModel);
      } catch (e) {
        setDerivedStartByTop({});
        setDerivedPmNameByTop({});
      }
    })();

    return () => {
      alive = false;
    };
  }, [bauteile]);

  // jednostavna funkcija koja briše vrijednost date inputa
  const clearDateInput = (ref: React.RefObject<HTMLInputElement>) => {
    if (ref.current) {
      ref.current.value = "";
      ref.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  // helper – vrati baš eksplicitni datum za UI (pending > persisted), bez nasljeđivanja
  const ownStart = (
    type: "bauteil" | "stiege" | "ebene" | "top",
    id: number,
    persisted?: any
  ) => {
    const k = `${type}:${id}`;
    if (Object.prototype.hasOwnProperty.call(pendingStart, k)) {
      // korisnik je dirao – null znači "obrisano" → prikaži prazno
      return pendingStart[k];
    }
    // inače prikaži ono što je STVARNO upisano u DB za taj objekt
    return persisted?.start_soll ?? null;
  };

  // Naturalno sortiranje po nazivu: Top1, Top2, Top10 / EG, OG1, OG2, OG10...
  const naturalByName = (a: any, b: any) =>
    String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "de", {
      numeric: true,
      sensitivity: "base",
    });

  return (
    <div className="col-span-1 overflow-y-auto max-h-[80vh] pr-2">
      <div className="space-y-8">
        {/* Neues Bauteil */}
        {canEdit && (
          <div className="mb-4 flex items-center gap-2">
            {/* Neues Bauteil */}
            {canEdit && (
              <div className="mb-4 flex items-center gap-2">
                <input
                  type="text"
                  value={newBauteil}
                  onFocus={() => {
                    if (!newBauteil)
                      setNewBauteil(suggestBauteilName(bauteile));
                  }}
                  onChange={(e) => setNewBauteil(e.target.value)}
                  placeholder="Neuer Bauteil"
                  className="bg-gray-800 text-white border border-cyan-500 rounded px-3 py-1 text-sm"
                />
                <button
                  onClick={() => {
                    if (!newBauteil) {
                      setNewBauteil(suggestBauteilName(bauteile));
                      return;
                    }
                    addBauteil();
                  }}
                  className="text-cyan-400 hover:text-cyan-200"
                >
                  + Bauteil
                </button>
              </div>
            )}
          </div>
        )}

        {[...bauteile].sort(naturalByName).map((b) => {
          const bPersisted: number | null =
            b.process_model?.id ?? b.process_model_id ?? null;
          const bPending = pendingPM[keyOf("bauteil", b.id)];
          const bEff = eff(bPending, null, bPersisted);
          const bStartPersisted: string | null = b.start_soll ?? null;
          const bStartPending = pendingStart[keyOf("bauteil", b.id)];
          const bStartKey = keyOf("bauteil", b.id);
          const bStartEff = Object.prototype.hasOwnProperty.call(
            pendingStart,
            bStartKey
          )
            ? pendingStart[bStartKey]
            : bStartPersisted ?? projectStart ?? null;

          return (
            <div
              key={b.id}
              className="bg-gradient-to-r from-blue-950 via-slate-900 to-gray-900 text-white rounded-2xl p-6 shadow-xl backdrop-blur-md border border-blue-800/30 transition hover:scale-[1.01]"
            >
              {/* Bauteil Header */}
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-xl font-bold text-cyan-300">
                    🏗
                    {canEdit &&
                    editingNames[`bauteil-${b.id}`] !== undefined ? (
                      <>
                        <input
                          value={editingNames[`bauteil-${b.id}`]}
                          onChange={(e) =>
                            handleNameChange("bauteil", b.id, e.target.value)
                          }
                          className="bg-gray-800 text-white border border-cyan-500 rounded px-3 py-1 text-sm focus:outline-none"
                        />
                        <button onClick={() => saveEdit("bauteil", b.id)}>
                          💾
                        </button>
                      </>
                    ) : (
                      <>
                        <span>{b.name}</span>
                        {canEdit && (
                          <button onClick={() => startEditing(b, "bauteil")}>
                            ✏️
                          </button>
                        )}
                      </>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => deleteItem("bauteil", b.id)}
                        className="text-red-400 hover:text-red-600 text-xl"
                      >
                        🗑
                      </button>
                    )}
                  </div>

                  <div className="text-sm text-slate-300 flex items-center justify-between">
                    <ProcessModelDropdown
                      label="Prozessmodell"
                      widthClass="w-[220px]"
                      key={`pm-bauteil-${b.id}-${bEff}`}
                      itemId={b.id}
                      type="bauteil"
                      selectedId={bEff}
                      selectedName={undefined}
                      disabled={!canEdit}
                      deferCommit={true} // ne commitaj odmah, nego kad user klikne Sync
                      onSelect={async (newId) => {
                        handleSelectPM("bauteil", b.id, newId); // instant UI
                        await commitPM("bauteil", b.id, newId); // DB
                        await loadStructure(); // svježi podaci
                      }}
                    />
                    <label className="block text-xs ml-5"></label>
                    <CustomDatePicker
                      label="Start (Soll)"
                      value={displayStartBauteil(b)}
                      disabled={!canEdit}
                      onKeyDown={async (
                        e: React.KeyboardEvent<HTMLInputElement>
                      ) => {
                        // ← tipizirano
                        if (e.key === "Delete" || e.key === "Backspace") {
                          handleSelectStart("bauteil", b.id, null);
                          await commitStart("bauteil", b.id, null);
                          await loadStructure();
                        }
                      }}
                      onChange={async (v) => {
                        handleSelectStart("bauteil", b.id, v);
                        await commitStart("bauteil", b.id, v);
                        await loadStructure();
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Neue Stiege */}
              {canEdit && (
                <div className="mt-4 flex items-center gap-2">
                  <input
                    type="text"
                    value={newStiegen[b.id] || ""}
                    onFocus={() => {
                      if (!newStiegen[b.id]) {
                        const suggestion = suggestStiegeName(b);
                        setNewStiegen((prev) => ({
                          ...prev,
                          [b.id]: suggestion,
                        }));
                      }
                    }}
                    onChange={(e) =>
                      setNewStiegen((prev) => ({
                        ...prev,
                        [b.id]: e.target.value,
                      }))
                    }
                    placeholder="Neue Stiege"
                    className="bg-gray-800 text-white border border-cyan-500 rounded px-3 py-1 text-sm"
                  />
                  <button
                    onClick={() => {
                      if (!newStiegen[b.id]) {
                        const suggestion = suggestStiegeName(b);
                        setNewStiegen((prev) => ({
                          ...prev,
                          [b.id]: suggestion,
                        }));
                        return;
                      }
                      addStiege(b.id);
                    }}
                    className="text-cyan-400 hover:text-cyan-200"
                  >
                    + Stiege
                  </button>
                </div>
              )}

              {/* Stiegen */}
              <div className="mt-4 space-y-4 ml-4 border-l border-cyan-700 pl-4">
                {[...(b.stiegen ?? [])].sort(naturalByName).map((s: any) => {
                  const sPersisted: number | null =
                    s.process_model?.id ?? s.process_model_id ?? null;
                  const sPending = pendingPM[keyOf("stiege", s.id)];
                  const sEff = eff(sPending, bPending ?? null, sPersisted);
                  const sStartPersisted: string | null = s.start_soll ?? null;
                  const sStartPending = pendingStart[keyOf("stiege", s.id)];
                  const sKey = keyOf("stiege", s.id);
                  const sStartEff = Object.prototype.hasOwnProperty.call(
                    pendingStart,
                    sKey
                  )
                    ? pendingStart[sKey]
                    : Object.prototype.hasOwnProperty.call(
                        pendingStart,
                        bStartKey
                      )
                    ? pendingStart[bStartKey]
                    : sStartPersisted ?? projectStart ?? null;

                  return (
                    <div key={s.id}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-semibold text-purple-300">
                          🪜
                          {canEdit &&
                          editingNames[`stiege-${s.id}`] !== undefined ? (
                            <>
                              <input
                                value={editingNames[`stiege-${s.id}`]}
                                onChange={(e) =>
                                  handleNameChange(
                                    "stiege",
                                    s.id,
                                    e.target.value
                                  )
                                }
                                className="bg-gray-800 text-white border border-purple-400 rounded px-3 py-1 text-sm"
                              />
                              <button onClick={() => saveEdit("stiege", s.id)}>
                                💾
                              </button>
                            </>
                          ) : (
                            <>
                              <span>{s.name}</span>
                              <ProcessModelDropdown
                                label="Prozessmodell"
                                widthClass="w-[220px]"
                                key={`pm-stiege-${s.id}-${sEff}`}
                                itemId={s.id}
                                type="stiege"
                                selectedId={sEff}
                                selectedName={undefined}
                                disabled={!canEdit}
                                deferCommit={true}
                                onSelect={async (newId) => {
                                  handleSelectPM("stiege", s.id, newId);
                                  await commitPM("stiege", s.id, newId);
                                  await loadStructure();
                                }}
                              />

                              {canEdit && (
                                <button
                                  onClick={() => startEditing(s, "stiege")}
                                >
                                  ✏️
                                </button>
                              )}
                            </>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => deleteItem("stiege", s.id)}
                              className="text-red-400"
                            >
                              🗑
                            </button>
                          )}
                          <div>
                            <CustomDatePicker
                              label="Start (Soll)"
                              value={displayStartStiege(s)}
                              disabled={!canEdit}
                              onChange={async (v) => {
                                handleSelectStart("stiege", s.id, v);
                                await commitStart("stiege", s.id, v);
                                await loadStructure();
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Neue Ebene */}
                      {canEdit && (
                        <div className="mt-2 flex items-center gap-2 ml-4">
                          <input
                            type="text"
                            value={newEbenen[s.id] || ""}
                            onFocus={() => {
                              if (!newEbenen[s.id]) {
                                const suggestion = suggestEbeneName(s);
                                setNewEbenen((prev) => ({
                                  ...prev,
                                  [s.id]: suggestion,
                                }));
                              }
                            }}
                            onChange={(e) =>
                              setNewEbenen((prev) => ({
                                ...prev,
                                [s.id]: e.target.value,
                              }))
                            }
                            placeholder="Neue Ebene"
                            className="bg-gray-800 text-white border border-indigo-400 rounded px-3 py-1 text-sm"
                          />
                          <button
                            onClick={() => {
                              if (!newEbenen[s.id]) {
                                const suggestion = suggestEbeneName(s);
                                setNewEbenen((prev) => ({
                                  ...prev,
                                  [s.id]: suggestion,
                                }));
                                return;
                              }
                              addEbene(s.id);
                            }}
                            className="text-indigo-400 hover:text-indigo-300"
                          >
                            + Ebene
                          </button>
                        </div>
                      )}

                      {/* Ebenen */}
                      <div className="mt-2 ml-4 space-y-3 border-l border-indigo-500 pl-4">
                        {[...(s.ebenen ?? [])]
                          .sort(naturalByName)
                          .map((e: any) => {
                            const ePersisted: number | null =
                              e.process_model?.id ?? e.process_model_id ?? null;
                            const ePending = pendingPM[keyOf("ebene", e.id)];
                            const eEff = eff(
                              ePending,
                              sPending ?? bPending ?? null,
                              ePersisted
                            );
                            const eStartPersisted: string | null =
                              e.start_soll ?? null;
                            const eStartPending =
                              pendingStart[keyOf("ebene", e.id)];
                            const eKey = keyOf("ebene", e.id);
                            const eStartEff =
                              Object.prototype.hasOwnProperty.call(
                                pendingStart,
                                eKey
                              )
                                ? pendingStart[eKey]
                                : Object.prototype.hasOwnProperty.call(
                                    pendingStart,
                                    sKey
                                  )
                                ? pendingStart[sKey]
                                : Object.prototype.hasOwnProperty.call(
                                    pendingStart,
                                    bStartKey
                                  )
                                ? pendingStart[bStartKey]
                                : eStartPersisted ?? projectStart ?? null;

                            return (
                              <div key={e.id}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 text-emerald-300">
                                    🏢
                                    {canEdit &&
                                    editingNames[`ebene-${e.id}`] !==
                                      undefined ? (
                                      <>
                                        <input
                                          value={editingNames[`ebene-${e.id}`]}
                                          onChange={(ev) =>
                                            handleNameChange(
                                              "ebene",
                                              e.id,
                                              ev.target.value
                                            )
                                          }
                                          className="bg-gray-800 text-white border border-emerald-500 rounded px-3 py-1 text-sm"
                                        />
                                        <button
                                          onClick={() =>
                                            saveEdit("ebene", e.id)
                                          }
                                        >
                                          💾
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <span>{e.name}</span>
                                        <ProcessModelDropdown
                                          label="Prozessmodell"
                                          widthClass="w-[220px]"
                                          key={`pm-ebene-${e.id}-${eEff}`}
                                          itemId={e.id}
                                          type="ebene"
                                          selectedId={eEff}
                                          selectedName={undefined}
                                          disabled={!canEdit}
                                          deferCommit={true}
                                          onSelect={async (newId) => {
                                            handleSelectPM(
                                              "ebene",
                                              e.id,
                                              newId
                                            );
                                            await commitPM(
                                              "ebene",
                                              e.id,
                                              newId
                                            );
                                            await loadStructure();
                                          }}
                                        />

                                        {canEdit && (
                                          <button
                                            onClick={() =>
                                              startEditing(e, "ebene")
                                            }
                                          >
                                            ✏️
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {canEdit && (
                                      <button
                                        onClick={() =>
                                          deleteItem("ebene", e.id)
                                        }
                                        className="text-red-400"
                                      >
                                        🗑
                                      </button>
                                    )}
                                    <div>
                                      <CustomDatePicker
                                        label="Start (Soll)"
                                        value={displayStartEbene(e)}
                                        disabled={!canEdit}
                                        onChange={async (v) => {
                                          handleSelectStart("ebene", e.id, v);
                                          await commitStart("ebene", e.id, v);
                                          await loadStructure();
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Neue Tops */}
                                {canEdit && (
                                  <div className="mt-2 flex items-center gap-2 ml-4">
                                    <input
                                      type="text"
                                      value={newTops[e.id] || ""}
                                      onFocus={() => {
                                        if (!newTops[e.id]) {
                                          // stiege objekt je “s”; trebamo ga da saberemo sve tops po Ebenama u toj stiege
                                          const suggestion = suggestTopName(s);
                                          setNewTops((prev) => ({
                                            ...prev,
                                            [e.id]: suggestion,
                                          }));
                                        }
                                      }}
                                      onChange={(ev) =>
                                        setNewTops((prev) => ({
                                          ...prev,
                                          [e.id]: ev.target.value,
                                        }))
                                      }
                                      placeholder="Neuer Top"
                                      className="bg-gray-800 text-white border border-pink-400 rounded px-3 py-1 text-sm"
                                    />
                                    <button
                                      onClick={() => {
                                        if (!newTops[e.id]) {
                                          const suggestion = suggestTopName(s);
                                          setNewTops((prev) => ({
                                            ...prev,
                                            [e.id]: suggestion,
                                          }));
                                          return;
                                        }
                                        addTop(e.id);
                                      }}
                                      className="text-pink-300 hover:text-pink-200"
                                    >
                                      + Top
                                    </button>
                                  </div>
                                )}

                                {/* Tops */}
                                <div className="mt-2 ml-4 space-y-2 border-l border-pink-500 pl-4">
                                  {[...(e.tops ?? [])]
                                    .sort(naturalByName)
                                    .map((t: any) => {
                                      const tPersisted: number | null =
                                        t.process_model?.id ??
                                        t.process_model_id ??
                                        null;
                                      const tPending =
                                        pendingPM[keyOf("top", t.id)];
                                      const tEff = eff(
                                        tPending,
                                        ePending ??
                                          sPending ??
                                          bPending ??
                                          null,
                                        tPersisted
                                      );
                                      const tStartPersisted: string | null =
                                        t.start_soll ?? null;
                                      const tStartPending =
                                        pendingStart[keyOf("top", t.id)];
                                      const tStartDerived =
                                        derivedStartByTop[t.id] ?? null; // 🆕 iz taskova

                                      const tKey = keyOf("top", t.id);
                                      const tStartEff =
                                        Object.prototype.hasOwnProperty.call(
                                          pendingStart,
                                          tKey
                                        )
                                          ? pendingStart[tKey]
                                          : Object.prototype.hasOwnProperty.call(
                                              pendingStart,
                                              eKey
                                            )
                                          ? pendingStart[eKey]
                                          : Object.prototype.hasOwnProperty.call(
                                              pendingStart,
                                              sKey
                                            )
                                          ? pendingStart[sKey]
                                          : Object.prototype.hasOwnProperty.call(
                                              pendingStart,
                                              bStartKey
                                            )
                                          ? pendingStart[bStartKey]
                                          : tStartPersisted ??
                                            tStartDerived ??
                                            projectStart ??
                                            null;

                                      const topPmNameDerived =
                                        derivedPmNameByTop[t.id];

                                      return (
                                        <div
                                          key={t.id}
                                          className="flex items-center justify-between"
                                        >
                                          <div className="flex items-center gap-2 text-pink-200">
                                            🚪
                                            {canEdit &&
                                            editingNames[`top-${t.id}`] !==
                                              undefined ? (
                                              <>
                                                <input
                                                  value={
                                                    editingNames[`top-${t.id}`]
                                                  }
                                                  onChange={(ev) =>
                                                    handleNameChange(
                                                      "top",
                                                      t.id,
                                                      ev.target.value
                                                    )
                                                  }
                                                  className="bg-gray-800 text-white border border-pink-300 rounded px-3 py-1 text-sm"
                                                />
                                                <button
                                                  onClick={() =>
                                                    saveEdit("top", t.id)
                                                  }
                                                >
                                                  💾
                                                </button>
                                              </>
                                            ) : (
                                              <>
                                                <span>{t.name}</span>
                                                <ProcessModelDropdown
                                                  label="Prozessmodell"
                                                  widthClass="w-[220px]"
                                                  key={`pm-top-${t.id}-${
                                                    tEff ?? "nil"
                                                  }-${
                                                    topPmNameDerived ?? "nil"
                                                  }`} // forsira svježi prikaz
                                                  itemId={t.id}
                                                  type="top"
                                                  selectedId={tEff}
                                                  selectedName={
                                                    tEff
                                                      ? undefined
                                                      : topPmNameDerived
                                                  } // 🆕 ako ID ne znamo, prikaži naziv
                                                  disabled={!canEdit}
                                                  deferCommit={true} // (može ostati kako već imaš)
                                                  onSelect={async (newId) => {
                                                    handleSelectPM(
                                                      "top",
                                                      t.id,
                                                      newId
                                                    );
                                                    await commitPM(
                                                      "top",
                                                      t.id,
                                                      newId
                                                    ); // tvoja postojeća fn
                                                    await loadStructure();
                                                  }}
                                                />

                                                {canEdit && (
                                                  <button
                                                    onClick={() =>
                                                      startEditing(t, "top")
                                                    }
                                                  >
                                                    ✏️
                                                  </button>
                                                )}
                                              </>
                                            )}
                                            {canEdit && (
                                              <button
                                                onClick={() =>
                                                  deleteItem("top", t.id)
                                                }
                                                className="text-red-400"
                                              >
                                                🗑
                                              </button>
                                            )}
                                            <div>
                                              <CustomDatePicker
                                                label="Start (Soll)"
                                                value={displayStartTop(t)}
                                                disabled={!canEdit}
                                                onChange={async (v) => {
                                                  handleSelectStart(
                                                    "top",
                                                    t.id,
                                                    v
                                                  );
                                                  await commitStart(
                                                    "top",
                                                    t.id,
                                                    v
                                                  );
                                                  await loadStructure();
                                                }}
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task Kontrole */}
      <div className="mt-8 flex flex-wrap gap-4">
        {showGenerate && (
          <div>
            <GenerateTasksButton startMapTop={buildStartMapForTops()} />
          </div>
        )}

        {showSync && (
          <button
            onClick={applyPendingThenSync}
            disabled={syncing}
            className={`bg-gradient-to-r from-yellow-500 to-amber-400 text-black font-semibold px-6 py-2 rounded-xl shadow transition
            ${
              syncing
                ? "opacity-60 cursor-not-allowed"
                : "hover:shadow-lg hover:scale-105 active:scale-100"
            }`}
            title={
              syncing ? "Synchronisierung läuft…" : "Aufgaben synchronisieren"
            }
          >
            {syncing ? "⏳ Synchronisierung…" : "🔄 Aufgaben synchronisieren"}
          </button>
        )}
      </div>
      {flash && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded shadow-lg
      ${
        flash.type === "success"
          ? "bg-emerald-600 text-white"
          : "bg-red-600 text-white"
      }`}
          role="status"
        >
          {flash.text}
        </div>
      )}
    </div>
  );
};

export default React.memo(ProjektStruktur);
