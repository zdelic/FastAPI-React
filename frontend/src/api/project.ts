import api from "./axios";
import type { AxiosRequestConfig } from "axios";
import type { User } from "./users"; // koristi isti tip kao ProjectUsersCard

// ============ Projekti ============
export type ProjectDTO = {
  id: number;
  name: string;
  description?: string | null;
  start_date?: string | null;
  image_url?: string | null;
};

export async function fetchProjects(cfg: AxiosRequestConfig = {}) {
  const { data } = await api.get<ProjectDTO[]>("/projects", cfg);
  return data;
}

// POST /projects  (multipart: name, description, start_date?, image?)
export async function createProject(
  form: FormData,
  cfg: AxiosRequestConfig = {}
) {
  const { data } = await api.post<ProjectDTO>("/projects", form, {
    headers: { "Content-Type": "multipart/form-data" },
    ...cfg,
  });
  return data;
}

// PUT /projects/{id}  (JSON partial)
export async function updateProject(
  id: number,
  payload: Partial<Pick<ProjectDTO, "name" | "description" | "start_date">>,
  cfg: AxiosRequestConfig = {}
) {
  const { data } = await api.put<ProjectDTO>(`/projects/${id}`, payload, cfg);
  return data;
}

// DELETE /projects/{id}
export async function deleteProject(id: number, cfg: AxiosRequestConfig = {}) {
  await api.delete(`/projects/${id}`, cfg);
}

// POST /projects/{id}/image  (multipart file upload)
export async function uploadProjectImage(
  id: number,
  file: File,
  cfg: AxiosRequestConfig = {}
) {
  const form = new FormData();
  form.append("image", file);
  const { data } = await api.post<ProjectDTO>(`/projects/${id}/image`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    ...cfg,
  });
  return data;
}

// ============ Korisnici projekta (za ProjectUsersCard) ============
// Pretpostavljeni backend endpoints (prilagodi ako su drugačiji):
// GET    /projects/{id}/users
// POST   /projects/{id}/users           body: { user_id }
// DELETE /projects/{id}/users/{user_id}

export async function getProjectUsers(
  projectId: number,
  cfg: AxiosRequestConfig = {}
): Promise<User[]> {
  const { data } = await api.get<User[]>(`/projects/${projectId}/users`, cfg);
  return data;
}

export async function addUserToProject(
  projectId: number,
  userId: number,
  cfg: AxiosRequestConfig = {}
): Promise<User> {
  // Neki backend-i vraćaju 204 bez tijela; da bismo imali User za UI,
  // nakon POST-a dohvatimo listu i vratimo upravo dodanog korisnika.
  const res = await api.post(
    `/projects/${projectId}/users`,
    { user_id: userId },
    cfg
  );
  if (res.data && typeof res.data === "object") {
    // ako backend ipak vrati korisnika, iskoristi ga
    return res.data as User;
  }
  const list = await getProjectUsers(projectId, cfg);
  const added = list.find((u) => u.id === userId);
  if (!added) {
    // fallback – minimalni objekt, da ne padne UI (prilagodi po potrebi)
    return { id: userId, name: "Unbekannt", email: "", role: "sub" } as User;
  }
  return added;
}

export async function removeUserFromProject(
  projectId: number,
  userId: number,
  cfg: AxiosRequestConfig = {}
): Promise<void> {
  await api.delete(`/projects/${projectId}/users/${userId}`, cfg);
}

// ============ Struktura projekta (za ProjektDetail) ============
// GET /projects/{id}/structure
export async function fetchStructure(
  projectId: number,
  cfg: AxiosRequestConfig = {}
) {
  const { data } = await api.get(`/projects/${projectId}/structure`, cfg);
  return data;
}

// (po želji) re-export User tipa ako ti treba drugdje
export type { User } from "./users";

export async function getProjectName(projectId: number): Promise<string> {
  const { data } = await api.get(`/projects/${projectId}`);
  return data.name;
}
