import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import {
  PlusCircle,
  Save,
  Trash2,
  Workflow,
  ListChecks,
  X,
} from "lucide-react";

type Step = {
  id?: number;
  gewerk_id: number;
  activity: string;
  duration_days: number;
  parallel: boolean;
  order: number;
  /** stabilni ključ za DnD i mape aktivnosti (ne ide u backend) */
  _key: string;
};

type AktivitaetOption = {
  id: number;
  name: string;
  gewerk_id: number;
};


type AktivitaetQuestion = {
  id?: number;
  aktivitaet_id: number;
  sort_order: number;
  label: string;
  field_type: "boolean" | "text" | "image";
  required: boolean;
  _isNew?: boolean;
  _isDeleted?: boolean;
};

type QuestionModalState = {
  aktivitaetId: number;
  aktivitaetName: string;
  stepIndex: number;
  items: AktivitaetQuestion[];
  isLoading: boolean;
  isSaving: boolean;
};

const genKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const ProcessModelEditor = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [modelName, setModelName] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [gewerke, setGewerke] = useState<any[]>([]);
  const [aktivitaetenMap, setAktivitaetenMap] = useState<
    Record<string, AktivitaetOption[]>
  >({});

  const [questionModal, setQuestionModal] = useState<QuestionModalState | null>(
    null
  );

  // DnD refs
  const dragIndexRef = useRef<number | null>(null);
  const overIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const loadGewerke = async () => {
      const res = await api.get("/gewerke");
      setGewerke(res.data);
    };
    loadGewerke();
  }, []);

  useEffect(() => {
    if (!id) return;
    const loadModel = async () => {
      try {
        const res = await api.get(`/process-models/${id}`);
        setModelName(res.data.name);

        // dodaj stabilni _key po koraku (preferiraj postojeći id)
        const loaded: Step[] = (res.data.steps || []).map((s: any, idx: number) => ({
          id: s.id,
          gewerk_id: s.gewerk_id ?? 0,
          activity: s.activity ?? "",
          duration_days: s.duration_days ?? 5,
          parallel: !!s.parallel,
          order: s.order ?? idx,
          _key: s.id ? `id-${s.id}` : genKey(),
        }));

        setSteps(loaded);

        // prefetch aktivnosti po gewerk_id
        for (const st of loaded) {
          if (st.gewerk_id) {
            const resAkt = await api.get(`/gewerke/${st.gewerk_id}/aktivitaeten`);
            setAktivitaetenMap((prev) => ({ ...prev, [st._key]: resAkt.data }));
          }
        }
      } catch (err) {
        console.error("Fehler beim Laden des Modells:", err);
      }
    };
    loadModel();
  }, [id]);

  const fetchAktivitaeten = async (stableKey: string, gewerk_id: number) => {
    if (!gewerk_id) return;
    const res = await api.get(`/gewerke/${gewerk_id}/aktivitaeten`);
    setAktivitaetenMap((prev) => ({ ...prev, [stableKey]: res.data }));
  };

  const handleAddStep = () => {
    const newStep: Step = {
      gewerk_id: 0,
      activity: "",
      duration_days: 5,
      parallel: false,
      order: steps.length,
      _key: genKey(),
    };
    setSteps((prev) => [...prev, newStep]);
  };

  const handleRemoveStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleStepChange = (index: number, field: keyof Step, value: any) => {
    setSteps((prev) => {
      const copy = [...prev];
      const step = { ...copy[index] };

      const newValue =
        field === "duration_days" ? parseInt(value as string, 10) : value;

      (step as any)[field] = newValue;
      copy[index] = step;

      // ako promijenimo gewerk, osvježi aktivnosti i resetiraj activity
      if (field === "gewerk_id") {
        fetchAktivitaeten(step._key, Number(newValue));
        step.activity = "";
      }
      return copy;
    });
  };

  const moveItem = (arr: Step[], from: number, to: number) => {
    const copy = [...arr];
    const [m] = copy.splice(from, 1);
    copy.splice(to, 0, m);
    return copy;
  };

  // DnD handlers
  const onDragStart = (index: number) => (e: React.DragEvent) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index)); // za kompatibilnost
  };

  const onDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault(); // omogućava drop
    overIndexRef.current = index;
  };

  const onDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from =
      dragIndexRef.current ??
      Number(e.dataTransfer.getData("text/plain") || NaN);
    const to = index;

    if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
      setSteps((prev) => moveItem(prev, from as number, to));
    }
    dragIndexRef.current = null;
    overIndexRef.current = null;
  };

  const onDragEnd = () => {
    dragIndexRef.current = null;
    overIndexRef.current = null;
  };

  const handleSubmit = async () => {
    try {
      // preračunaj order po trenutnom poretku
      const payload = {
        name: modelName,
        steps: steps.map((step, i) => {
          const { _key, ...rest } = step;
          return { ...rest, order: i };
        }),
      };

      if (id) {
        await api.put(`/process-models/${id}`, payload);
        alert("Modell aktualisiert.");
      } else {
        await api.post("/process-models", payload);
        alert("Prozessmodell gespeichert!");
      }
      navigate("/prozessmodelle");
    } catch (err) {
      console.error("Fehler beim Speichern:", err);
      alert("Fehler beim Speichern.");
    }
  };

  const getGewerkColor = (gewerk_id: number) => {
    const gewerk = gewerke.find((g) => g.id === gewerk_id);
    return gewerk?.color || "#ffffff";
  };

  const openQuestionModal = async (step: Step, stepIndex: number) => {
    const list = aktivitaetenMap[step._key] || [];
    const selected = list.find(
      (a) => (a.name || "").trim() === (step.activity || "").trim()
    );

    if (!selected) {
      alert("Bitte zuerst eine Aktivität auswählen.");
      return;
    }

    setQuestionModal({
      aktivitaetId: selected.id,
      aktivitaetName: selected.name,
      stepIndex,
      items: [],
      isLoading: true,
      isSaving: false,
    });

    try {
      const res = await api.get<AktivitaetQuestion[]>(
        `/aktivitaeten/${selected.id}/questions`
      );
      setQuestionModal((prev) =>
        prev && prev.aktivitaetId === selected.id
          ? { ...prev, items: res.data, isLoading: false }
          : prev
      );
    } catch (err) {
      console.error("Fehler beim Laden der Fragen:", err);
      setQuestionModal((prev) =>
        prev && prev.aktivitaetId === selected.id
          ? { ...prev, isLoading: false }
          : prev
      );
    }
  };

  const handleAddQuestionRow = () => {
    if (!questionModal) return;
    const visible = questionModal.items.filter((q) => !q._isDeleted);
    const nextSort =
      (visible.length ? Math.max(...visible.map((q) => q.sort_order)) : 0) + 1;

    const newItem: AktivitaetQuestion = {
      id: undefined,
      aktivitaet_id: questionModal.aktivitaetId,
      sort_order: nextSort,
      label: "",
      field_type: "boolean",
      required: false,
      _isNew: true,
    };

    setQuestionModal({
      ...questionModal,
      items: [...questionModal.items, newItem],
    });
  };

  const handleQuestionFieldChange = (
    index: number,
    field: keyof AktivitaetQuestion,
    value: any
  ) => {
    if (!questionModal) return;
    const items = [...questionModal.items];
    items[index] = { ...items[index], [field]: value };
    setQuestionModal({ ...questionModal, items });
  };

  const handleMarkQuestionDeleted = (index: number) => {
    if (!questionModal) return;
    const items = [...questionModal.items];
    const q = items[index];

    if (!q.id) {
      items.splice(index, 1);
    } else {
      items[index] = { ...q, _isDeleted: true };
    }

    setQuestionModal({ ...questionModal, items });
  };

  const handleSaveQuestions = async () => {
    if (!questionModal) return;
    const { aktivitaetId } = questionModal;
    const processModelId = id ? Number(id) : undefined;

    setQuestionModal({ ...questionModal, isSaving: true });

    try {
      for (const q of questionModal.items) {
        // brisanje
        if (q._isDeleted && q.id) {
          await api.delete(`/aktivitaeten/aktivitaet-questions/${q.id}`, {
            params: { process_model_id: processModelId },
          });
          continue;
        }
        

        const payload = {
          sort_order: q.sort_order,
          label: q.label,
          field_type: q.field_type,
          required: q.required,
        };

        // novi
        if (q._isNew) {
          const res = await api.post<AktivitaetQuestion>(
            `/aktivitaeten/${aktivitaetId}/questions`,
            payload,
            {
              params: { process_model_id: processModelId },
            }
          );
          q.id = res.data.id;
          q._isNew = false;
        } else if (q.id) {
          // update
          await api.put<AktivitaetQuestion>(
            `/aktivitaeten/aktivitaet-questions/${q.id}`,
            payload,
            {
              params: { process_model_id: processModelId },
            }
          );
        }
        
      }

      // ponovno učitaj čistu listu
      const fresh = await api.get<AktivitaetQuestion[]>(
        `/aktivitaeten/${aktivitaetId}/questions`
      );

      setQuestionModal(null);
      
    } catch (err) {
      console.error("Fehler beim Speichern der Fragen:", err);
      alert("Fehler beim Speichern der Fragen.");
      setQuestionModal({ ...questionModal, isSaving: false });
    }
  };

  const closeQuestionModal = () => setQuestionModal(null);
  

  return (
    <div className="min-h-screen bg-gray-100">
      <div
        className="w-full"
        style={{
          backgroundImage: "url('/images/Startseite-OfficePark-2_01.png')",
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          height: "400px",
        }}
      >
        <div className="h-full w-full bg-opacity-40 flex items-center justify-center">
          <h1 className="text-white text-5xl md:text-5xl font-bold drop-shadow-[0_0_15px_black] border-black">
            {id ? `Modell ${modelName} bearbeiten` : "Neues Prozessmodell"}
          </h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center">
          <div className="mb-2 flex items-center gap-2 ml-auto">
            <button
              className="px-3 py-2 rounded bg-gray-200 text-gray-900 hover:bg-gray-300"
              onClick={() => navigate("/dashboard")}
            >
              ◀ Zurück zum 📁 Dashboard
            </button>

            <button
              onClick={() => navigate(`/prozessmodelle`)}
              className="px-3 py-2 rounded bg-gray-200 text-gray-900 hover:bg-gray-300"
            >
              ◀ Zurück zum 🧩 Prozessmodelle
            </button>
          </div>
        </div>

        <div className="mb-6">
          <input
            type="text"
            placeholder="Modellname"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            className="w-full p-3 rounded border text-xl font-semibold"
          />
        </div>

        {steps.map((step, index) => (
          <div
            key={step._key}
            className="rounded-lg shadow p-5 mb-4 space-y-4 border border-gray-200 relative"
            style={{ backgroundColor: getGewerkColor(step.gewerk_id) }}
            draggable
            onDragStart={onDragStart(index)}
            onDragOver={onDragOver(index)}
            onDrop={onDrop(index)}
            onDragEnd={onDragEnd}
          >
            {/* Drag handle / redni broj */}
            <div className="absolute -left-3 top-3 select-none">
              <div
                title="Zum Verschieben ziehen"
                className="cursor-grab active:cursor-grabbing bg-white/70 rounded-full px-2 py-1 text-xs font-semibold shadow"
              >
                #{index + 1}
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="w-full">
                <label className="block text-m text-inherit font-bold drop-shadow-[0_0_2px_white]">
                  Gewerk
                </label>
                <select
                  value={step.gewerk_id}
                  onChange={(e) =>
                    handleStepChange(
                      index,
                      "gewerk_id",
                      parseInt(e.target.value)
                    )
                  }
                  className="w-full p-2 border rounded"
                >
                  <option value={0}>-- wählen --</option>
                  {gewerke.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-full">
                <label className="block text-m text-inherit font-bold drop-shadow-[0_0_2px_white]">
                  Aktivität
                </label>
                {(() => {
                  const list = aktivitaetenMap[step._key] || [];
                  const hasMatch = !!list.find(
                    (a) =>
                      (a.name || "").trim() === (step.activity || "").trim()
                  );

                  return (
                    <>
                      <select
                        value={step.activity}
                        onChange={(e) =>
                          handleStepChange(index, "activity", e.target.value)
                        }
                        className="w-full p-2 border rounded"
                      >
                        <option value="">-- wählen --</option>

                        {/* Fallback: ako spremljena aktivnost nema match u opcijama (još), dodaj je privremeno */}
                        {step.activity && !hasMatch && (
                          <option value={step.activity}>{step.activity}</option>
                        )}

                        {list.map((a) => (
                          <option key={a.id} value={(a.name || "").trim()}>
                            {a.name}
                          </option>
                        ))}
                      </select>

                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => openQuestionModal(step, index)}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/80 hover:bg-white shadow-sm"
                        >
                          <ListChecks size={14} />
                          Zusatzfragen
                        </button>
                      </div>
                    </>
                  );
                  
                })()}
              </div>
            </div>

            <div className="flex gap-4 items-center">
              <div>
                <label className="block text-m text-inherit font-bold drop-shadow-[0_0_2px_white]">
                  Dauer (Tage)
                </label>
                <input
                  type="number"
                  value={step.duration_days}
                  onChange={(e) =>
                    handleStepChange(index, "duration_days", e.target.value)
                  }
                  className="w-24 p-2 border rounded"
                />
              </div>

              <div className="flex items-center gap-2 mt-6">
                <input
                  type="checkbox"
                  checked={step.parallel}
                  onChange={(e) =>
                    handleStepChange(index, "parallel", e.target.checked)
                  }
                />
                <label className="block text-m text-white font-bold drop-shadow-[0_0_2px_black]">
                  gleichzeitig?
                </label>
              </div>

              <button
                onClick={() => handleRemoveStep(index)}
                className="ml-auto hover:text-red-400 text-white drop-shadow-[0_0_2px_black]"
              >
                <Trash2 size={22} /> Entfernen
              </button>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={handleAddStep}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800"
          >
            <PlusCircle size={18} /> Schritt hinzufügen
          </button>

          <button
            onClick={handleSubmit}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            <Save size={18} /> {id ? "Aktualisieren" : "Speichern"}
          </button>
        </div>
      </div>
      {questionModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full mx-4">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold text-lg">
                Zusatzfragen für Aktivität "{questionModal.aktivitaetName}"
              </h2>
              <button
                onClick={closeQuestionModal}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-3">
              {questionModal.isLoading ? (
                <p className="text-sm text-gray-500">Lade Fragen...</p>
              ) : (
                <>
                  {questionModal.items.filter((q) => !q._isDeleted).length ===
                    0 && (
                    <p className="text-sm text-gray-500 italic">
                      Noch keine Zusatzfragen definiert.
                    </p>
                  )}

                  {questionModal.items
                    .map((q, qi) => ({ q, qi }))
                    .filter(({ q }) => !q._isDeleted)
                    .map(({ q, qi }) => (
                      <div
                        key={q.id ?? `new-${qi}`}
                        className="grid grid-cols-[3rem,1fr,9rem,6rem,auto] gap-2 items-center text-sm"
                      >
                        <input
                          type="number"
                          className="w-12 p-1 border rounded"
                          value={q.sort_order}
                          onChange={(e) =>
                            handleQuestionFieldChange(
                              qi,
                              "sort_order",
                              Number(e.target.value) || 0
                            )
                          }
                        />
                        <input
                          type="text"
                          className="w-full p-1 border rounded"
                          placeholder="Fragetext"
                          value={q.label}
                          onChange={(e) =>
                            handleQuestionFieldChange(
                              qi,
                              "label",
                              e.target.value
                            )
                          }
                        />
                        <select
                          className="p-1 border rounded"
                          value={q.field_type}
                          onChange={(e) =>
                            handleQuestionFieldChange(
                              qi,
                              "field_type",
                              e.target.value as AktivitaetQuestion["field_type"]
                            )
                          }
                        >
                          <option value="boolean">Ja / Nein</option>
                          <option value="text">Text</option>
                          <option value="image">Bild</option>
                        </select>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={q.required}
                            onChange={(e) =>
                              handleQuestionFieldChange(
                                qi,
                                "required",
                                e.target.checked
                              )
                            }
                          />
                          Pflicht?
                        </label>
                        <button
                          type="button"
                          onClick={() => handleMarkQuestionDeleted(qi)}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}

                  <button
                    type="button"
                    onClick={handleAddQuestionRow}
                    className="mt-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200"
                  >
                    <PlusCircle size={14} />
                    Frage hinzufügen
                  </button>
                </>
              )}
            </div>

            <div className="border-t px-4 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeQuestionModal}
                className="px-3 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSaveQuestions}
                disabled={questionModal.isSaving}
                className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {questionModal.isSaving ? "Speichere..." : "Speichern"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessModelEditor;
