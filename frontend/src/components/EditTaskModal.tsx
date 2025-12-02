import React, { useEffect, useMemo, useState, useCallback } from "react";
import CustomDatePicker from "../components/CustomDatePicker";


// gore u fajlu
export type EditTaskModalTask = {
  id: string | number;
  title?: string;
  beschreibung?: string;
  status?: string;
  start_soll?: string | null;
  end_soll?: string | null;
  start_ist?: string | null;
  end_ist?: string | null;
  sub_id?: number | null; // ⬅️ NOVO
};

type SubOption = { id: number; label: string };

type Props = {
  task: EditTaskModalTask;
  onSave: (u: EditTaskModalTask) => Promise<void> | void;
  onDelete?: (id: string | number) => Promise<void> | void;
  onClose: () => void;
  subOptions?: SubOption[]; // ⬅️ NOVO (dolazi izvana)
};


const toDateInput = (v?: string | null) => (v ?? "");
const fromDateInput = (v: string) => (v ? v : null);

const EditTaskModal: React.FC<Props> = React.memo(({ task, onSave, onDelete, onClose, subOptions = [] }) => {
    const [title, setTitle] = useState(task.title ?? "");
    const [beschreibung, setBeschreibung] = useState(task.beschreibung ?? "");
    const [status, setStatus] = useState(task.status ?? "offen");
    const [startSoll, setStartSoll] = useState(toDateInput(task.start_soll));
    const [endSoll, setEndSoll] = useState(toDateInput(task.end_soll));
    const [startIst, setStartIst] = useState(toDateInput(task.start_ist));
    const [endIst, setEndIst] = useState(toDateInput(task.end_ist));
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [selectedSub, setSelectedSub] = useState<number | null>(
      task.sub_id ?? null
    );

    // kad se promijeni task (klik na drugi event), resetuj polja
    useEffect(() => {
      setTitle(task.title ?? "");
      setBeschreibung(task.beschreibung ?? "");
      setStatus(task.status ?? "offen");
      setStartSoll(toDateInput(task.start_soll));
      setEndSoll(toDateInput(task.end_soll));
      setStartIst(toDateInput(task.start_ist));
      setEndIst(toDateInput(task.end_ist));
      setSelectedSub(task.sub_id ?? null);
    }, [task]);

    const canSave = useMemo(
      () => !saving && title.trim().length > 0,
      [saving, title]
    );

    const handleSave = useCallback(async () => {
      if (!canSave) return;
      setSaving(true);

      // 1) optimistički zatvori UI odmah
      onClose();

      // 2) pošalji update “u pozadini”
      const updated = {
        id: task.id,
        title: title.trim(),
        beschreibung: beschreibung ?? "",
        status,
        start_soll: fromDateInput(startSoll),
        end_soll: fromDateInput(endSoll),
        start_ist: fromDateInput(startIst),
        end_ist: fromDateInput(endIst),
        sub_id: selectedSub,
      };

      try {
        await Promise.resolve(onSave(updated));
        //window.location.reload();
      } finally {
        setSaving(false);
      }
    }, [
      canSave,
      task.id,
      title,
      beschreibung,
      status,
      startSoll,
      endSoll,
      startIst,
      endIst,
      selectedSub,
      onSave,
      onClose,
    ]);

    const handleDelete = useCallback(async () => {
      if (!onDelete || deleting) return;
      if (!window.confirm("Möchten Sie diese Aufgabe löschen?")) return;
      setDeleting(true);
      onClose(); // zatvori odmah
      try {
        await Promise.resolve(onDelete(task.id));
      } finally {
        setDeleting(false);
      }
    }, [onDelete, deleting, onClose, task.id]);

    return (
      <div
        key={String(task.id)}
        className="fixed inset-0 z-[1000] grid place-items-center bg-black/40"
      >
        <div className="w-full max-w-xl rounded-lg bg-white p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {task.title} #{task.id}
            </h2>
            <button
              onClick={onClose}
              className="rounded px-3 py-1 text-sm hover:bg-gray-100"
            >
              Schließen
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Start (plan)
              <CustomDatePicker
                value={startSoll || null}
                onChange={(v) => setStartSoll(v ?? "")}
                variant="light"
                label=""
              />
            </label>

            <label className="text-sm">
              End (plan)
              <CustomDatePicker
                value={endSoll || null}
                onChange={(v) => setEndSoll(v ?? "")}
                variant="light"
                label=""
              />
            </label>

            <label className="text-sm">
              Start (ist)
              <CustomDatePicker
                value={startIst || null}
                onChange={(v) => setStartIst(v ?? "")}
                variant="light"
                label=""
              />
            </label>

            <label className="text-sm">
              End (ist)
              <CustomDatePicker
                value={endIst || null}
                onChange={(v) => setEndIst(v ?? "")}
                variant="light"
                label=""
              />
            </label>

            <label className="block text-sm mb-3">
              Subunternehmen (Dropdown-Menü)
              <select
                className="mt-1 w-full border rounded px-2 py-1"
                value={selectedSub ?? ""}
                onChange={(e) =>
                  setSelectedSub(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">— auswählen —</option>
                {subOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="col-span-2 text-sm">
              Anmerkungen
              <textarea
                className="mt-1 w-full rounded border px-2 py-1"
                rows={4}
                value={beschreibung}
                onChange={(e) => setBeschreibung(e.target.value)}
              />
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            {onDelete && (
              <button
                disabled={deleting}
                onClick={handleDelete}
                className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-60"
              >
                Löschen
              </button>
            )}
            <button
              disabled={!canSave}
              onClick={handleSave}
              className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    );
  }
);

export default EditTaskModal;

              