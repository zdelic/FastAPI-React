import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/axios";

const API_URL = process.env.REACT_APP_API_URL || "";

type QuestionFieldType = "boolean" | "text" | "image";

type TaskCheckAnswer = {
  id: number;
  label: string;
  field_type: QuestionFieldType;
  bool_value: boolean | null;
  text_value: string | null;
  image_path: string | null;
  created_at: string;
};

type TaskRow = {
  id: number;
  task: string;
  beschreibung?: string | null;
  gewerk_name?: string | null;
  bauteil?: string | null;
  stiege?: string | null;
  ebene?: string | null;
  top?: string | null;
  process_model?: string | null;
  start_soll?: string | null;
  end_soll?: string | null;
  start_ist?: string | null;
  end_ist?: string | null;
  status: string;
  sub_name?: string | null;
  check_answers: TaskCheckAnswer[];
};

const ProjectTasksTable: React.FC = () => {
  const { id } = useParams<{ id: string }>(); // projekt id
  const navigate = useNavigate();

  const [projectName, setProjectName] = useState<string>("");
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [filterBauteil, setFilterBauteil] = useState("");
  const [filterStiege, setFilterStiege] = useState("");
  const [filterEbene, setFilterEbene] = useState("");
  const [filterTop, setFilterTop] = useState("");
  const unique = <T,>(arr: T[]): T[] => Array.from(new Set(arr));

  const bauteile = unique(
    rows.map((r) => r.bauteil ?? "").filter((v) => v !== "")
  );

  const stiegen = unique(
    rows.map((r) => r.stiege ?? "").filter((v) => v !== "")
  );

  const ebenen = unique(rows.map((r) => r.ebene ?? "").filter((v) => v !== ""));

  const tops = unique(rows.map((r) => r.top ?? "").filter((v) => v !== ""));
  

  const filteredRows = rows.filter(
    (r) =>
      (!filterBauteil || r.bauteil === filterBauteil) &&
      (!filterStiege || r.stiege === filterStiege) &&
      (!filterEbene || r.ebene === filterEbene) &&
      (!filterTop || r.top === filterTop)
  );
  
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // helper za datum
  const formatDate = (v?: string | null) => {
    if (!v) return "";
    const d = v.includes("T") ? v.split("T")[0] : v;
    const [y, m, d2] = d.split("-");
    return y && m && d2 ? `${d2}.${m}.${y}` : d;
  };

  const toggleExpanded = (taskId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  useEffect(() => {
    if (!id) return;

    let alive = true;
    setLoading(true);

    (async () => {
      try {
        // 1) naziv projekta (opcionalno)
        const proj = await api.get(`/projects/${id}`, {
          meta: { showLoader: false },
        });

        // 2) tasks + check-answers
        // OVDJE pretpostavljam novu backend rutu:
        // GET /projects/{id}/tasks-tabelle
        const res = await api.get(`/projects/${id}/tasks-tabelle`, {
          meta: { showLoader: false },
        });

        if (!alive) return;

        const data: TaskRow[] = Array.isArray(res.data) ? res.data : [];

        // sortiraj po: bauteil > stiege > ebene > top > task
        const coll = new Intl.Collator("de", {
          numeric: true,
          sensitivity: "base",
        });
        const sorted = [...data].sort((a, b) => {
          const b1 = a.bauteil || "";
          const b2 = b.bauteil || "";
          const s1 = a.stiege || "";
          const s2 = b.stiege || "";
          const e1 = a.ebene || "";
          const e2 = b.ebene || "";
          const t1 = a.top || "";
          const t2 = b.top || "";
          const n1 = a.task || "";
          const n2 = b.task || "";

          return (
            coll.compare(b1, b2) ||
            coll.compare(s1, s2) ||
            coll.compare(e1, e2) ||
            coll.compare(t1, t2) ||
            coll.compare(n1, n2)
          );
        });

        setProjectName(proj.data?.name ?? "");
        setRows(sorted);
      } catch (err) {
        console.error("Fehler beim Laden der Aufgabentabelle:", err);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  // grupiranje po strukturi
  let lastGroupKey = "";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-cyan-400">
          📋 Aktivitätenliste: <span className="text-black">{projectName}</span>
        </h2>
        <div className="grid grid-cols-4 gap-3 mt-4">
          <select
            className="border p-2 rounded"
            value={filterBauteil}
            onChange={(e) => setFilterBauteil(e.target.value)}
          >
            <option value="">Bauteil (alle)</option>
            {bauteile.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            className="border p-2 rounded"
            value={filterStiege}
            onChange={(e) => setFilterStiege(e.target.value)}
          >
            <option value="">Stiege (alle)</option>
            {stiegen.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            className="border p-2 rounded"
            value={filterEbene}
            onChange={(e) => setFilterEbene(e.target.value)}
          >
            <option value="">Ebene (alle)</option>
            {ebenen.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>

          <select
            className="border p-2 rounded"
            value={filterTop}
            onChange={(e) => setFilterTop(e.target.value)}
          >
            <option value="">Top (alle)</option>
            {tops.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded bg-gray-200 text-gray-900 hover:bg-gray-300"
            onClick={() => navigate(`/projekt/${id}/timeline`)}
          >
            ◀ Zurück zur Timeline
          </button>
          <button
            className="px-3 py-2 rounded bg-gray-200 text-gray-900 hover:bg-gray-300"
            onClick={() => navigate(`/projekt/${id}`)}
          >
            ◀ Zurück zum Projekt
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center items-center py-10">
          <div className="animate-spin h-10 w-10 rounded-full border-4 border-gray-300 border-t-gray-700" />
        </div>
      )}

      {!loading && (
        <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
          <div className="overflow-x-auto max-h-[75vh]">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">
                    Struktur
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">Top</th>
                  <th className="px-3 py-2 text-left font-semibold">
                    Aktivität
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">Gewerk</th>
                  <th className="px-3 py-2 text-left font-semibold">PM</th>
                  <th className="px-3 py-2 text-left font-semibold">
                    Start Soll
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    Ende Soll
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    Start Ist
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    Ende Ist
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Sub</th>
                  <th className="px-3 py-2 text-left font-semibold">
                    Checkliste
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const groupKey = `${row.bauteil || ""}|${row.stiege || ""}|${
                    row.ebene || ""
                  }`;

                  const showGroupHeader = groupKey !== lastGroupKey;
                  if (showGroupHeader) lastGroupKey = groupKey;

                  const isExpanded = expanded.has(row.id);

                  return (
                    <React.Fragment key={row.id}>
                      {showGroupHeader && (
                        <tr className="bg-slate-50">
                          <td
                            className="px-3 py-2 text-xs font-semibold text-slate-700"
                            colSpan={12}
                          >
                            {[
                              row.bauteil && `Bauteil: ${row.bauteil}`,
                              row.stiege && `Stiege: ${row.stiege}`,
                              row.ebene && `Ebene: ${row.ebene}`,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Ohne Struktur"}
                          </td>
                        </tr>
                      )}

                      <tr className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {[row.bauteil, row.stiege, row.ebene]
                            .filter(Boolean)
                            .join(" / ")}
                        </td>
                        <td className="px-3 py-2">{row.top}</td>
                        <td className="px-3 py-2">{row.task}</td>
                        <td className="px-3 py-2">{row.gewerk_name}</td>
                        <td className="px-3 py-2">{row.process_model}</td>
                        <td className="px-3 py-2">
                          {formatDate(row.start_soll)}
                        </td>
                        <td className="px-3 py-2">
                          {formatDate(row.end_soll)}
                        </td>
                        <td className="px-3 py-2">
                          {formatDate(row.start_ist)}
                        </td>
                        <td className="px-3 py-2">{formatDate(row.end_ist)}</td>
                        <td className="px-3 py-2">{row.status}</td>
                        <td className="px-3 py-2">
                          {row.sub_name || (
                            <span className="text-slate-400">–</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.check_answers && row.check_answers.length > 0 ? (
                            <button
                              className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800 hover:bg-blue-200"
                              onClick={() => toggleExpanded(row.id)}
                            >
                              {isExpanded
                                ? "Antworten ausblenden"
                                : `${row.check_answers.length} Antworten anzeigen`}
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">
                              Keine Antworten
                            </span>
                          )}
                        </td>
                      </tr>

                      {isExpanded && row.check_answers.length > 0 && (
                        <tr className="bg-slate-50">
                          <td className="px-3 py-2 text-xs" colSpan={12}>
                            <div className="space-y-2">
                              {row.check_answers.map((a) => (
                                <div
                                  key={a.id}
                                  className="border border-slate-200 rounded-md p-2 flex flex-col gap-1"
                                >
                                  <div className="flex justify-between items-center gap-2">
                                    <span className="font-medium text-xs">
                                      {a.label}
                                    </span>
                                    <span className="text-[10px] uppercase text-slate-500">
                                      {a.field_type === "boolean"
                                        ? "Antwort"
                                        : a.field_type === "image"
                                        ? "Bild"
                                        : a.field_type}
                                    </span>
                                  </div>

                                  {a.field_type === "boolean" && (
                                    <div className="text-xs">
                                      Antwort:{" "}
                                      <span className="font-semibold">
                                        {a.bool_value === null
                                          ? "–"
                                          : a.bool_value
                                          ? "Ja"
                                          : "Nein"}
                                      </span>
                                    </div>
                                  )}

                                  {a.field_type === "text" && (
                                    <div className="text-xs">
                                      {a.text_value || (
                                        <span className="text-slate-400">
                                          –
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {a.field_type === "image" && (
                                    <div className="text-xs">
                                      {a.image_path ? (
                                        <img
                                          src={`${API_URL}${a.image_path}`}
                                          alt={a.label}
                                          className="max-h-40 rounded border object-contain cursor-pointer"
                                          onClick={() =>
                                            window.open(
                                              `${API_URL}${a.image_path}`,
                                              "_blank"
                                            )
                                          }
                                        />
                                      ) : (
                                        <span className="text-slate-400">
                                          kein Bild
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  <div className="text-[10px] text-slate-400">
                                    {a.created_at &&
                                      `Erfasst am: ${formatDate(a.created_at)}`}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectTasksTable;
