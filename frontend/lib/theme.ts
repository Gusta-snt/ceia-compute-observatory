"use client";
import { useEffect, useState } from "react";

// Tema: "system" segue o sistema operacional; "light"/"dark" fixam. A escolha fica no navegador
// e vira <html data-theme="light|dark">, que troca os tokens de globals.css.
export type ThemePref = "system" | "light" | "dark";
const KEY = "theme";

/** Roda no <head>, antes da primeira pintura, para a página não piscar no tema errado. */
export const THEME_BOOT = `(function(){try{var p=localStorage.getItem("${KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;

const read = (): ThemePref => {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
};
const apply = (p: ThemePref) => {
  const dark = p === "dark" || (p === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
};

export function useThemePref() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    setPref(read());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (read() === "system") apply("system"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  function choose(p: ThemePref) {
    try { if (p === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch {}
    setPref(p); apply(p);
  }
  return { pref, choose };
}

/** Tema efetivo atual ("light" | "dark"), acompanhando mudanças em <html data-theme>. */
export function useResolvedTheme() {
  const [mode, setMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setMode(el.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const ob = new MutationObserver(sync);
    ob.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => ob.disconnect();
  }, []);
  return mode;
}
