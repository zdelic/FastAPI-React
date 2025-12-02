import React, { useEffect, useState } from "react";
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  uploadProjectImage,
} from "../api/project";
import { useNavigate, Link, NavLink } from "react-router-dom";
import { absoluteUrl } from "../api/axios";
import {
  PlusCircle,
  FolderKanban,
  AlertCircle,
  CalendarDays,
  Home,
  Users,
  Settings,
  Trash2,
  Save,
} from "lucide-react";

import { useLoading } from "../context/LoadingContext";
import CustomDatePicker from "../components/CustomDatePicker";


type Role = "admin" | "bauleiter" | "polier" | "sub";

function getRoleFromToken(): Role | null {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    const payload = JSON.parse(json) as { role?: Role };
    return (payload.role ?? null) as Role | null;
  } catch {
    return null;
  }
}

function withAbortableTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms = 15000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return run(controller.signal).finally(() => clearTimeout(timer));
}



const Dashboard: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const isAdmin = React.useMemo(() => getRoleFromToken() === "admin", []);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const { show, hide } = useLoading();
  const openEdit = (p: any) => {
    setEditing(p);
    setEditName(p.name ?? "");
    setEditDesc(p.description ?? "");
    setEditStart(p.start_date ?? "");
    setEditFile(null);
    setEditOpen(true);
  };

  const [saving, setSaving] = useState(false);

  const refreshProjectsSilently = async () => {
    try {
      const data = await fetchProjects({ hideLoader: true }); // ⬅️ dodano
      setProjects(data);
    } catch (err) {
      console.error(err);
    }
  };
  

  const loadProjects = async () => {
    try {
      
      const data = await fetchProjects();
      setProjects(data);
    } catch (err) {
      setError("Fehler beim Laden der Projekte.");
      console.error(err);
    } finally {
      
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    return `${day}.${month}.${year}`;
  };

  // 2) CREATE — ostavi timeout, UI se uvijek odblokira u finally
  const handleCreate = async () => {
    if (creating) return;
    if (!name.trim()) {
      setError("Projektname ist erforderlich.");
      return;
    }
    if (description.trim().length < 10) {
      setError("Beschreibung muss mindestens 10 Zeichen lang sein.");
      return;
    }
    setError("");
    setCreating(true);

    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("description", description.trim());
      if (startDate) form.append("start_date", startDate);
      if (file) form.append("image", file);

      const created = await withAbortableTimeout(
        (signal) => createProject(form, { signal, hideLoader: true }),
        15000
      );
      

      // optimistic UI
      setProjects((prev) => [created, ...prev]);
      setName("");
      setDescription("");
      setStartDate("");
      setFile(null);
      setShowForm(false);

      // tihi refresh u pozadini
      void refreshProjectsSilently();
    } catch (e) {
      console.error("createProject error:", e);
      setError(
        e instanceof Error && e.message === "timeout"
          ? "Zeitüberschreitung beim Erstellen. Bitte Liste aktualisieren."
          : "Fehler beim Erstellen des Projekts."
      );
    } finally {
      setCreating(false); // ⬅⬅⬅ UI se SIGURNO odblokira
    }
  };

  // 1) EDIT — sigurno snapshot-aj id i NE ČEKAJ upload
  const handleSaveEdit = async () => {
    if (!editing || saving) return;
    setSaving(true);
    try {
      const projId = editing.id; // ⬅⬅⬅ SNAPSHOT ID PRIJE setEditing(null)

      // 1) tekst + datum
      await withAbortableTimeout(
        (signal) =>
          updateProject(
            projId,
            {
              name: editName.trim(),
              description: editDesc.trim(),
              start_date: editStart ? editStart : undefined,
            },
            { signal, hideLoader: true }
          ),
        15000
      );
      

      // 2) zatvori modal i oslobodi UI ODMAH
      setEditOpen(false);
      setEditing(null);
      setSaving(false);

      // 3) upload slike - fire-and-forget, bez oslanjanja na state 'editing'
      if (editFile) {
        const localFile = editFile;
        setEditFile(null);
        void withAbortableTimeout(
          (signal) =>
            uploadProjectImage(projId, localFile, { signal, hideLoader: true }),
          15000
        )
          .then(() => void refreshProjectsSilently())
          .catch((err) => {
            console.error("Bild-Upload fehlgeschlagen:", err);
            setError("Bild-Upload fehlgeschlagen oder Timeout.");
          });
        
      } else {
        void refreshProjectsSilently();
      }
    } catch (e) {
      console.error("handleSaveEdit error:", e);
      setError(
        e instanceof Error && e.message === "timeout"
          ? "Zeitüberschreitung beim Speichern. Die Daten wurden evtl. bereits gespeichert."
          : "Konnte das Projekt nicht speichern."
      );
      setSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!editing || saving) return;
    if (!window.confirm("Projekt wirklich löschen?")) return;
    setSaving(true);
    try {
      await withAbortableTimeout(
        (signal) => deleteProject(editing.id, { signal, hideLoader: true }), // ⬅️ dodano + vraćen delete poziv
        15000
      );
      setEditOpen(false);
      setEditing(null);
      void refreshProjectsSilently();
    } catch (e) {
      console.error("handleDeleteProject error:", e);
      setError(
        e instanceof Error && e.message === "timeout"
          ? "Zeitüberschreitung beim Löschen. Bitte Ansicht aktualisieren."
          : "Löschen fehlgeschlagen."
      );
    } finally {
      setSaving(false);
    }
  };
  

  useEffect(() => {
    void refreshProjectsSilently();
  }, []);
  

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header image */}
      <div
        className="w-full"
        style={{
          backgroundImage: "url('/images/Startseite-OfficePark-2_01.png')",
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          height: "400px", // ili više, po potrebi
        }}
      >
        <div className="h-full w-full bg-opacity-40 flex items-center justify-center">
          <h1 className="text-white text-3xl md:text-4xl font-bold drop-shadow">
            📁 Projektübersicht
          </h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Error */}
        {error && (
          <div className="flex items-center text-red-600 mb-4 text-sm">
            <AlertCircle className="w-4 h-4 mr-2" />
            {error}
          </div>
        )}

        {/* Toggle Header with "Zu den Prozessmodellen" */}
        {isAdmin && (
          <nav className="mb-4">
            <div className="flex items-center justify-between rounded-2xl border bg-white/80 backdrop-blur px-3 py-2 shadow-sm">
              {/* lijeva strana: linkovi */}
              <div className="flex items-center gap-1">
                <NavLink
                  to="/dashboard"
                  className={({ isActive }) =>
                    [
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
                      isActive
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50",
                    ].join(" ")
                  }
                >
                  <Home size={18} />
                  <span></span>
                </NavLink>

                <NavLink
                  to="/users"
                  className={({ isActive }) =>
                    [
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
                      isActive
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50",
                    ].join(" ")
                  }
                >
                  <span>👥 Users</span>
                </NavLink>

                <NavLink
                  to="/prozessmodelle"
                  className={({ isActive }) =>
                    [
                      "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
                      isActive
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50",
                    ].join(" ")
                  }
                >
                  <span>🧩 Prozessmodelle</span>
                </NavLink>

                {getRoleFromToken() === "admin" && (
                  <NavLink
                    to="/audit"
                    className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition"
                  >
                    📜 Protokoll
                  </NavLink>
                )}
              </div>

              {/* desna strana: akcijsko dugme */}
              <button
                onClick={() => setShowForm(!showForm)}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 active:scale-[0.99]"
              >
                <PlusCircle size={18} />
                Neues Projekt
              </button>
            </div>
          </nav>
        )}

        {/* Animated Form */}
        <div
          className={`transition-all duration-500 overflow-hidden ${
            showForm ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="bg-white rounded-lg shadow-md p-6 space-y-4 mb-8">
            <div className="flex gap-4 flex-col md:flex-row">
              <input
                type="text"
                placeholder="Projektname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border p-2 rounded"
              />
              <div className="w-full">
                <CustomDatePicker
                  label="Startdatum"
                  value={startDate || null}
                  onChange={(v) => setStartDate(v ?? "")}
                  variant="light"
                />
              </div>
            </div>

            <textarea
              placeholder="Beschreibung (min. 10 Zeichen)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border p-2 rounded"
            />
            {/* Upload slike */}
            <div className="mt-2">
              <label className="block text-sm text-gray-600 mb-1">
                Projektbild
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full border p-2 rounded"
              />

              {/* Opcionalno: live preview odabrane slike */}
              {file ? (
                <div className="mt-3 h-40 rounded overflow-hidden border">
                  <div
                    className="h-full bg-cover bg-center"
                    style={{
                      backgroundImage: `url('${URL.createObjectURL(file)}')`,
                    }}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <PlusCircle size={18} /> Projekt erstellen
              </button>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => {
                show(); // prikaže globalni loader
                setTimeout(() => {
                  hide();
                  navigate(`/projekt/${p.id}`);
                });
              }}
              className="relative group rounded-2xl overflow-hidden shadow-xl cursor-pointer transform hover:scale-[1.02] transition duration-300 min-h-[220px]"
            >
              {/* Background image */}
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{
                  backgroundImage: `url('${absoluteUrl(
                    p.image_url || "/images/Startseite-Winarsky_01.png"
                  )}')`,
                }}
              />

              {/* Dark gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent group-hover:via-black/70 transition duration-300"></div>

              {/* Content */}
              <div className="relative z-10 p-6 text-white flex flex-col h-full justify-between">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-2xl font-bold mb-1 drop-shadow-lg">
                      {p.name}
                    </h3>
                    <p className="text-base font-medium text-gray-100 drop-shadow-sm line-clamp-3">
                      {p.description}
                    </p>
                  </div>

                  {isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(p);
                      }}
                      className="shrink-0 inline-flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 p-2 backdrop-blur transition"
                      title="Projekt-Einstellungen"
                    >
                      <Settings size={18} />
                    </button>
                  )}
                </div>

                <div className="flex items-center text-sm text-gray-200 mt-4 font-semibold">
                  <CalendarDays size={22} className="mr-2" />
                  {formatDate(p.start_date) || "Kein Datum"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {editOpen && editing && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl bg-white shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Projekt-Einstellungen</h2>
              <button
                onClick={() => setEditOpen(false)}
                className="text-slate-500 hover:text-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Projektname
                </label>
                <input
                  className="w-full border rounded px-3 py-2"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <CustomDatePicker
                    label="Startdatum"
                    value={editStart || null}
                    onChange={(v) => setEditStart(v ?? "")}
                    variant="light"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Projektbild (neu)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setEditFile(e.target.files?.[0] ?? null)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Beschreibung
                </label>
                <textarea
                  className="w-full border rounded px-3 py-2 min-h-24"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                />
              </div>

              {/* preview */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-gray-500 mb-1">
                    Aktuelles Bild
                  </div>
                  <div className="h-32 rounded border overflow-hidden bg-gray-50">
                    <div
                      className="w-full h-full bg-center bg-cover"
                      style={{
                        backgroundImage: `url('${
                          editing.image_url ||
                          "/images/Startseite-Winarsky_01.png"
                        }')`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">
                    Neues Bild (Vorschau)
                  </div>
                  <div className="h-32 rounded border overflow-hidden bg-gray-50">
                    {editFile ? (
                      <div
                        className="w-full h-full bg-center bg-cover"
                        style={{
                          backgroundImage: `url('${URL.createObjectURL(
                            editFile
                          )}')`,
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                        Keine Auswahl
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleDeleteProject}
                disabled={saving}
                className="inline-flex items-center gap-2 text-red-600 hover:text-white border border-red-600 hover:bg-red-600 rounded-xl px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Trash2 size={18} /> Projekt löschen
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="rounded-xl px-4 py-2 border bg-white hover:bg-slate-50"
                >
                  Abbrechen
                </button>

                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 text-white px-4 py-2 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Save size={18} /> Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
