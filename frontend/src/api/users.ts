// src/api/users.ts
import api from "./axios";

/** Dozvoljene role */
export const ROLES = ["admin", "bauleiter", "polier", "sub"] as const;
export type Role = typeof ROLES[number];

/** Modeli */
export type User = {
  id: number;
  email: string;
  role: Role;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
};

export type UserCreate = {
  email: string;
  password: string;
  role: Role;
  name?: string;
  address?: string;
  phone?: string;
  avatar_url?: string; // ako želiš ponekad slati već gotov URL
};

export type UserUpdate = Partial<{
  email: string;
  role: Role;
  name: string;
  address: string;
  phone: string;
  avatar_url: string;
}>;

/** API pozivi */
export async function getUsers(): Promise<User[]> {
  const { data } = await api.get("/users");
  return data;
}

export async function createUser(u: UserCreate): Promise<User> {
  const { data } = await api.post("/users", u);
  return data;
}

/**
 * PROMJENA ROLE — koristi postojeći endpoint PATCH /users/{id}
 * (umjesto /users/{id}/role koji ne postoji kod tebe i davao je 404)
 */
export async function updateUserRole(id: number, role: Role): Promise<User> {
  const { data } = await api.patch(`/users/${id}`, { role });
  return data;
}

export async function updateUser(id: number, patch: UserUpdate): Promise<User> {
  const { data } = await api.patch(`/users/${id}`, patch);
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}

/** Upload avatara (multipart/form-data, field name: "file") */
export async function uploadAvatar(id: number, file: File): Promise<User> {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await api.post(`/users/${id}/avatar`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/** Promjena lozinke uz unos stare (self-service) */
export async function changePassword(
  id: number,
  current_password: string,
  new_password: string
): Promise<void> {
  await api.post(`/users/${id}/password`, { current_password, new_password });
}

/** Admin reset lozinke (bez stare) */
export async function resetPassword(
  id: number,
  new_password: string
): Promise<void> {
  await api.post(`/users/${id}/password-reset`, { new_password });
}
