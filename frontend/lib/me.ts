"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

export type Me = { id: number; username: string; name: string | null; role: "admin" | "usuario"; active: boolean; last_login: string | null };

// Usuário logado, compartilhado entre o menu e as páginas. refreshMe() após login; clearMe() no logout.
let current: Me | null = null;
let pending: Promise<Me | null> | null = null;
const subs = new Set<(m: Me | null) => void>();
const emit = () => subs.forEach((fn) => fn(current));

export function refreshMe(): Promise<Me | null> {
  pending = api<Me>("/auth/me").then((m) => m, () => null).then((m) => { current = m; pending = null; emit(); return m; });
  return pending;
}
export function clearMe() { current = null; emit(); }

export function useMe(): { me: Me | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(current);
  const [loading, setLoading] = useState(!current);
  useEffect(() => {
    const fn = (m: Me | null) => { setMe(m); setLoading(false); };
    subs.add(fn);
    if (current) fn(current);
    else if (location.pathname.startsWith("/login")) setLoading(false);
    else (pending ?? refreshMe()).then(fn);
    return () => { subs.delete(fn); };
  }, []);
  return { me, loading };
}

export const ROLE_LABEL: Record<string, string> = { admin: "Administrador", usuario: "Usuário" };
