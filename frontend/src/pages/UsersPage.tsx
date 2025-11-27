import React, { useEffect, useMemo, useState } from "react";
import {
  getUsers, createUser, updateUserRole, deleteUser,
  uploadAvatar, ROLES, Role, User,
  updateUser, changePassword, resetPassword
} from "../api/users";
import {
  UserPlus, Mail, KeyRound, Shield, Trash2, RefreshCw, Search, Loader2,
  Phone, Pencil, Save, X, Phone as PhoneIcon, MapPin, ImagePlus, Upload, CheckCircle2, XCircle,
  IdCard,
  LockKeyhole,
} from "lucide-react";
import { baseURL } from "../api/axios";

import { useNavigate } from "react-router-dom";

type FormState = {
  email: string;
  password: string;
  role: Role;
  name?: string;
  address?: string;
  phone?: string;
  avatar_url?: string;
};

const roleLabel: Record<Role, string> = {
  admin: "Admin",
  bauleiter: "Bauleiter",
  polier: "Polier",
  sub: "Sub",
};

const roleChipClasses: Record<Role, string> = {
  admin: "bg-indigo-600/10 text-indigo-600 ring-1 ring-inset ring-indigo-600/30",
  bauleiter: "bg-emerald-600/10 text-emerald-600 ring-1 ring-inset ring-emerald-600/30",
  polier: "bg-amber-600/10 text-amber-600 ring-1 ring-inset ring-amber-600/30",
  sub: "bg-sky-600/10 text-sky-600 ring-1 ring-inset ring-sky-600/30",
};

const API_URL = baseURL.replace(/\/$/, "");

const DEFAULT_AVATAR = "/images/default-avatar.png"; 

export default function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<FormState>({
    email: "", password: "", role: "bauleiter", name: "", address: "", phone: "", avatar_url: ""
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
    const [editSaving, setEditSaving] = useState(false);
    const [editData, setEditData] = useState({
    name: "",
    email: "",
    address: "",
    phone: "",
    role: "bauleiter" as Role,
  });
    const [pwdEditing, setPwdEditing] = useState<User | null>(null);
    const [pwdData, setPwdData] = useState({ current: "", next: "", confirm: "" });
    const [pwdSaving, setPwdSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const emailValid = useMemo(() => /\S+@\S+\.\S+/.test(form.email), [form.email]);
  const passwordValid = form.password.length >= 6;
  const canSubmit = emailValid && passwordValid && ROLES.includes(form.role);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.name || "").toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q) ||
      (u.address || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q)
    );
  }, [users, query]);

  function openEdit(u: User) {
    setEditing(u);
    setEditData({
        name: u.name || "",
        email: u.email || "",
        address: u.address || "",
        phone: u.phone || "",
        role: u.role,
    });
    }
    function closeEdit() {
    setEditing(null);
    }

  function getAvatarSrc(u: User) {
    // Ako backend već vratio nešto apsolutno ili data: — koristi
    if (u.avatar_url) {
        if (/^https?:\/\//i.test(u.avatar_url) || u.avatar_url.startsWith("data:")) {
        return u.avatar_url;
        }
        // Inače prefiksaj API baznim URL-om (npr. http://127.0.0.1:8000)
        return `${API_URL}${u.avatar_url}`;
    }
    // Fallback
    return DEFAULT_AVATAR;
    }

  function onPickAvatar(file?: File | null) {
    if (!file) {
      setAvatarFile(null);
      setAvatarPreview(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Ungültige Datei. Bitte ein Bild wählen (JPEG/PNG/WebP).");
      return;
    }
    setError(null);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getUsers();
      setUsers(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Fehler beim Laden der Benutzer.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createUser({
        email: form.email,
        password: form.password,
        role: form.role,
        name: form.name || undefined,
        address: form.address || undefined,
        phone: form.phone || undefined,
        avatar_url: form.avatar_url || undefined,
      });

      let finalUser = created;
      if (avatarFile) {
        finalUser = await uploadAvatar(created.id, avatarFile);
      }

      setUsers((u) => [finalUser, ...u]);

      setForm({ email: "", password: "", role: "bauleiter", name: "", address: "", phone: "", avatar_url: "" });
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(null);
      setAvatarPreview(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Benutzer konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }

  async function onChangeRole(id: number, role: Role) {
    setError(null);
    try {
      const updated = await updateUserRole(id, role);
      setUsers((arr) => arr.map(u => (u.id === id ? updated : u)));
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Rolle konnte nicht geändert werden.");
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm("Benutzer löschen?")) return;
    setError(null);
    try {
      await deleteUser(id);
      setUsers((arr) => arr.filter(u => u.id !== id));
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Benutzer konnte nicht gelöscht werden.");
    }
  }

  async function onUploadRowAvatar(id: number, file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Ungültige Datei. Bitte ein Bild wählen (JPEG/PNG/WebP).");
      return;
    }
    try {
      const updated = await uploadAvatar(id, file);
      setUsers((arr) => arr.map(u => (u.id === id ? updated : u)));
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Avatar-Upload fehlgeschlagen.");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* HERO */}
      <div
        className="relative h-[260px] w-full bg-cover bg-center"
        style={{ backgroundImage: "url('/images/Startseite-OfficePark-2_01.png')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/70" />
        <div className="relative z-10 mx-auto flex h-full max-w-6xl items-end px-6 pb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow">👥 Benutzer</h1>
            <p className="mb-10 text-slate-200">Benutzer, Rollen und Zugriffe verwalten</p>
          </div>
                    
          <div className="ml-auto mb-8">
            <button
              className="px-3 py-2 rounded bg-gray-200 text-gray-900 hover:bg-gray-300"
              onClick={() => navigate("/dashboard")}
            >
              ◀ Zurück zum 📁 Dashboard
            </button>            
          </div>
        
        </div>
      </div>

      {/* CONTAINER */}
      <div className="-mt-10 w-full px-6 pb-16">
        {/* Top panel: Formular + Suche */}
        <div className="rounded-2xl border bg-white/70 backdrop-blur shadow-sm ring-1 ring-black/5 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Formular (mit optional Adresse/Telefon + Avatar-Upload) */}
            <form onSubmit={onCreate} className="grid w-full grid-cols-1 gap-3 md:grid-cols-7">
              {/* E-Mail */}
              <div className="relative md:col-span-2">
                <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                <input
                  type="email"
                  placeholder="E-Mail-Adresse"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

             {/* Passwort */}
            <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />

            {/*
                Dinamičke klase:
                - zeleno kad je dovoljno dugo
                - crveno kad je nešto upisano ali < 6
                - default kad je prazno
            */}
            {(() => {
                const touched = form.password.length > 0;
                const base = "w-full rounded-xl border bg-white/60 pl-10 pr-10 py-2.5 outline-none focus:ring-2";
                const ok   = "border-emerald-500 focus:ring-emerald-500";
                const bad  = "border-rose-500 focus:ring-rose-500";
                const def  = "border-slate-300 focus:ring-blue-500";
                const cls  = `${base} ${passwordValid ? ok : touched ? bad : def}`;
                return (
                <input
                    type="password"
                    placeholder="Passwort (min. 6 Zeichen)"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className={cls}
                    aria-invalid={touched && !passwordValid}
                    aria-describedby="pwd-hint"
                />
                );
            })()}

            {/* desna ikona */}
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                {form.password.length > 0 && (
                passwordValid
                    ? <CheckCircle2 size={18} className="text-emerald-600" />
                    : <XCircle size={18} className="text-rose-600" />
                )}
            </span>

            {/* hint ispod inputa */}
            <div id="pwd-hint" className="mt-1 text-xs">
                {form.password.length > 0 && !passwordValid && (
                <span className="text-rose-600">
                    Mindestens 6 Zeichen – noch {6 - form.password.length}.
                </span>
                )}
                {passwordValid && (
                <span className="text-emerald-600">Gut! Mindestlänge erreicht ✔</span>
                )}
            </div>
            </div>


              {/* Rolle */}
              <div className="relative">
                <Shield className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                  className="w-full appearance-none rounded-xl border border-slate-300 bg-white/60 pl-10 pr-9 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROLES.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">▾</span>
              </div>
              {/* Name/Firma (optional) – direktno poslije Passwort */}
                <div className="relative md:col-span-2">
                <IdCard className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                <input
                    type="text"
                    placeholder="Name/Firma (optional)"
                    value={form.name || ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                />
                </div>

              {/* Adresse (optional) */}
              <div className="relative md:col-span-2">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                <input
                  type="text"
                  placeholder="Adresse (optional)"
                  value={form.address || ""}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Telefon (optional) */}
              <div className="relative">
                <PhoneIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                <input
                  type="tel"
                  placeholder="Telefon (optional)"
                  value={form.phone || ""}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Avatar upload (optional) */}
              <label className="group relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/60 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => onPickAvatar(e.target.files?.[0] || null)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <ImagePlus size={18} />
                {avatarFile ? "Avatar ausgewählt" : "Avatar hinzufügen (optional)"}
              </label>

              {/* Vorschau */}
              {avatarPreview && (
                <div className="col-span-full flex items-center gap-3 rounded-xl border border-slate-200 bg-white/50 p-2">
                  <img src={avatarPreview} alt="Vorschau" className="h-12 w-12 rounded-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onPickAvatar(null)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    Entfernen
                  </button>
                </div>
              )}

              {/* Aktionen */}
              <div className="col-span-full flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={!canSubmit || saving}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white shadow hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  title={canSubmit ? "Benutzer hinzufügen" : "Gültige E-Mail und Passwort eingeben"}
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                  Hinzufügen
                </button>

                <button
                  type="button"
                  onClick={load}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/70 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.99]"
                  title="Liste aktualisieren"
                >
                  <RefreshCw size={18} />
                  Aktualisieren
                </button>

              </div>
            </form>

            {/* Suche */}
            <div className="relative w-full md:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                placeholder="Suchen nach E-Mail, Rolle, Adresse…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Fehlerleiste */}
          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Tabelle */}
        <div className="mt-6 overflow-x-auto overflow-y-hidden rounded-2xl border bg-white/80 backdrop-blur shadow-sm ring-1 ring-black/5">
          <div className="flex flex-nowrap items-center justify-between border-b px-4 py-3">
            <div className="text-sm text-slate-500">
              {loading ? "Laden…" : `${filtered.length} Benutzer`}
            </div>
          </div>

          <div className="relative">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                <Loader2 className="animate-spin text-slate-600" size={24} />
              </div>
            )}

            <table className="w-full min-w-[900px] border-separate border-spacing-0 whitespace-nowrap">
              <thead>
                <tr className="text-left text-sm text-slate-500">
                  <th className="sticky top-0 z-[1] bg-white/80 px-4 py-3 font-medium">Benutzer/ E-Mail</th>
                  <th className="sticky top-0 z-[1] bg-white/80 px-4 py-3 font-medium">Kontakt</th>
                  <th className="sticky top-0 z-[1] bg-white/80 px-4 py-3 font-medium">Rolle</th>
                  <th className="sticky top-0 z-[1] bg-white/80 px-4 py-3 font-medium">Avatar</th>
                  <th className="sticky top-0 z-[1] bg-white/80 px-4 py-3 font-medium">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                    {filtered.map((u, idx) => {
                        const base = getAvatarSrc(u);
                        const imgSrc = `${base}?v=${encodeURIComponent(u.avatar_url ?? "")}`; // cache-buster

                        return (
                        <tr
                            key={u.id}
                            className={[
                            "transition",
                            idx % 2 ? "bg-slate-50/60" : "bg-white",
                            "hover:bg-blue-50/60",
                            ].join(" ")}
                        >
                            {/* Benutzer */}
                            <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                                <img
                                key={imgSrc} // forsira remount kad se src promijeni
                                src={imgSrc}
                                alt={u.email}
                                className="h-10 w-10 rounded-full object-cover ring-1 ring-black/5"
                                onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).src = DEFAULT_AVATAR;
                                }}
                                />
                                <div>
                                <div className="font-medium text-slate-900">{u.name}</div>
                                {u.email && (
                                  <a
                                    href={`mailto:${u.email.trim()}`}
                                    className="text-sm text-slate-700 hover:underline hover:text-blue-600 break-all"
                                    title={`E-Mail senden an ${u.email}`}
                                    onClick={(e) => e.stopPropagation()} 
                                  >
                                    {u.email}
                                  </a>
                                )}
                                </div>
                            </div>
                            </td>
                           

                            {/* Kontakt */}
                            <td className="px-4 py-3">
                            {/* Telefon: ikona + tel: link */}
                            <div className="flex items-center gap-2 text-sm text-slate-700">
                                <PhoneIcon size={16} className="shrink-0 text-slate-500" />
                                {u.phone ? (
                                <a
                                    href={`tel:${u.phone.replace(/[^0-9+]/g, "")}`} // dozvoli + i cifre
                                    className="hover:underline"
                                >
                                    {u.phone}
                                </a>
                                ) : (
                                <span className="text-slate-400">—</span>
                                )}
                            </div>

                            {/* Adresa: ikona + tekst ispod */}
                            <div className="mt-1 flex items-start gap-2 text-xs text-slate-500">
                                <MapPin size={14} className="mt-[2px] shrink-0" />
                                {u.address ? (
                                    <a
                                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(u.address)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:underline"
                                    >
                                        {u.address}
                                    </a>
                                    ) : "—"}

                            </div>
                            </td>


                            {/* Rolle */}
                            <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                                <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleChipClasses[u.role]}`}
                                >
                                {roleLabel[u.role]}
                                </span>
                                <select
                                value={u.role}
                                onChange={(e) => onChangeRole(u.id, e.target.value as Role)}
                                className="rounded-lg border border-slate-300 bg-white/70 px-2 py-1 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                {ROLES.map((r) => (
                                    <option key={r} value={r}>
                                    {roleLabel[r]}
                                    </option>
                                ))}
                                </select>
                            </div>
                            </td>

                            {/* Avatar ändern (pro Zeile) */}
                            <td className="px-4 py-3">
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white/70 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                                <Upload size={16} />
                                Avatar ändern
                                <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) =>
                                    onUploadRowAvatar(u.id, e.target.files?.[0] || null)
                                }
                                />
                            </label>
                            </td>

                            {/* Aktionen */}
                            <td className="px-4 py-3">
                            <button
                                onClick={() => onDelete(u.id)}
                                className="inline-flex items-center gap-2 rounded-lg border border-red-300/60 bg-red-600/90 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-600 active:scale-[0.99]"
                                title="Benutzer löschen"
                            >
                                <Trash2 size={16} />
                                Löschen
                            </button>
                            <button
                                onClick={() => openEdit(u)}
                                className="mr-2 ml-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/80 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                                title="Benutzer bearbeiten"
                                >
                                <Pencil size={16} />
                                Bearbeiten
                            </button>
                            <button
                                onClick={() => { setPwdEditing(u); setPwdData({ current: "", next: "", confirm: "" }); }}
                                className="mr-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/80 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                                title="Passwort ändern"
                                >
                                <KeyRound size={16} />
                                Passwort
                            </button>

                            </td>
                        </tr>
                        );
                    })}
                    {filtered.length === 0 && !loading && (
                        <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                            Keine Benutzer vorhanden.
                        </td>
                        </tr>
                    )}
                    </tbody>

            </table>
            {editing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    {/* backdrop */}
                    <div className="absolute inset-0 bg-black/40" onClick={closeEdit} />
                    {/* dialog */}
                    <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-white/95 p-5 shadow-xl">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Benutzer bearbeiten</h3>
                        <button onClick={closeEdit} className="rounded-full p-1 hover:bg-slate-100">
                        <X size={18} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        {/* Name/Firma */}
                        <div className="relative">
                        <IdCard className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                        <input
                            type="text"
                            placeholder="Name/Firma"
                            value={editData.name}
                            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                            className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        </div>

                        {/* E-Mail */}
                        <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                        <input
                            type="email"
                            placeholder="E-Mail-Adresse"
                            value={editData.email}
                            onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                            className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        </div>

                        {/* Adresse */}
                        <div className="relative">
                        <MapPin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                        <input
                            type="text"
                            placeholder="Adresse"
                            value={editData.address}
                            onChange={(e) => setEditData({ ...editData, address: e.target.value })}
                            className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        </div>

                        {/* Telefon */}
                        <div className="relative">
                        <PhoneIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                        <input
                            type="tel"
                            placeholder="Telefon"
                            value={editData.phone}
                            onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                            className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        </div>
                    </div>

                    {/* Fehler */}
                    {error && (
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                        {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="mt-4 flex justify-end gap-2">
                        <button
                        onClick={closeEdit}
                        className="rounded-xl border border-slate-300 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                        Abbrechen
                        </button>
                        <button
                        onClick={async () => {
                            if (!editing) return;
                            try {
                            setEditSaving(true);
                            setError(null);

                            // pošalji samo izmijenjena polja (diff)
                            const patch: any = {};
                            if (editData.name !== (editing.name || "")) patch.name = editData.name || null;
                            if (editData.email !== (editing.email || "")) patch.email = editData.email || null;
                            if (editData.address !== (editing.address || "")) patch.address = editData.address || null;
                            if (editData.phone !== (editing.phone || "")) patch.phone = editData.phone || null;

                            const updated = await updateUser(editing.id, patch);
                            setUsers((arr) => arr.map(u => (u.id === editing.id ? updated : u)));
                            closeEdit();
                            } catch (e: any) {
                            setError(e?.response?.data?.detail ?? "Änderungen konnten nicht gespeichert werden.");
                            } finally {
                            setEditSaving(false);
                            }
                        }}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
                        disabled={editSaving}
                        >
                        {editSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        Speichern
                        </button>
                    </div>
                    </div>
                </div>
                )}

                {pwdEditing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setPwdEditing(null)} />
                    <div className="relative z-10 w-full max-w-md rounded-2xl border bg-white/95 p-5 shadow-xl">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Passwort ändern — {pwdEditing.email}</h3>
                        <button onClick={() => setPwdEditing(null)} className="rounded-full p-1 hover:bg-slate-100">
                        <X size={18} />
                        </button>
                    </div>

                    <div className="space-y-3">
                        {/* Ako želiš samo admin reset, ovaj blok sakrij */}
                        {/* <div className="relative">
                        <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                        <input
                            type="password"
                            placeholder="Aktuelles Passwort"
                            value={pwdData.current}
                            onChange={(e) => setPwdData({ ...pwdData, current: e.target.value })}
                            className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        </div> */}

                        <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                        <input
                            type="password"
                            placeholder="Neues Passwort (min. 6 Zeichen)"
                            value={pwdData.next}
                            onChange={(e) => setPwdData({ ...pwdData, next: e.target.value })}
                            className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        </div>

                        <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={18} />
                        <input
                            type="password"
                            placeholder="Neues Passwort bestätigen"
                            value={pwdData.confirm}
                            onChange={(e) => setPwdData({ ...pwdData, confirm: e.target.value })}
                            className="w-full rounded-xl border border-slate-300 bg-white/60 pl-10 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        </div>

                        {/* Hint */}
                        <div className="text-xs text-slate-500">
                        {pwdData.next && pwdData.next.length < 6 && (
                            <span className="text-rose-600">Mindestens 6 Zeichen – noch {6 - pwdData.next.length}.</span>
                        )}
                        {pwdData.next && pwdData.confirm && pwdData.next !== pwdData.confirm && (
                            <span className="text-rose-600 ml-2">Passwörter stimmen nicht überein.</span>
                        )}
                        </div>
                    </div>

                    <div className="mt-4 flex justify-end gap-2">
                        <button
                        onClick={() => setPwdEditing(null)}
                        className="rounded-xl border border-slate-300 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                        Abbrechen
                        </button>
                        <button
                        disabled={
                            pwdSaving ||
                            pwdData.next.length < 6 ||
                            pwdData.next !== pwdData.confirm
                        }
                        onClick={async () => {
                            if (!pwdEditing) return;
                            setPwdSaving(true);
                            try {
                            // ADMIN RESET (bez starog passworda):
                            await resetPassword(pwdEditing.id, pwdData.next);

                            // SELF-SERVICE (traži staru lozinku):
                            // await changePassword(pwdEditing.id, pwdData.current, pwdData.next);

                            setPwdEditing(null);
                            } catch (e: any) {
                            alert(e?.response?.data?.detail ?? "Passwort konnte nicht geändert werden.");
                            } finally {
                            setPwdSaving(false);
                            }
                        }}
                        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-60"
                        >
                        {pwdSaving ? <span className="animate-spin">⏳</span> : <Save size={16} />}
                        Speichern
                        </button>
                    </div>
                    </div>
                </div>
                )}


          </div>
        </div>
      </div>
    </div>
  );
}
