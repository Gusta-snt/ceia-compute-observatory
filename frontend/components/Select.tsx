"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";

export type SelectOption<T extends string = string> = { value: T; label: string; hint?: string };

/**
 * Select desenhado pelo app (não pelo navegador), no padrão listbox do WAI-ARIA:
 * setas/Home/End navegam, Enter/Espaço escolhem, Esc fecha, letras pulam para a opção.
 * `required` continua valendo na validação nativa do <form> por um input oculto.
 */
export function Select<T extends string = string>({ value, onChange, options, label, placeholder = "Selecione", required, size = "sm", className = "", id }: {
  value: T | ""; onChange: (v: T) => void; options: readonly SelectOption<T>[]; label?: string; placeholder?: string;
  required?: boolean; size?: "sm" | "md"; className?: string; id?: string;
}) {
  const auto = useId();
  const btnId = id ?? `sel-${auto}`;
  const listId = `${btnId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Posição da lista (fixa, num portal): calculada pelo espaço livre em volta do botão.
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", t: 0 });
  const naturalW = useRef<number | null>(null);
  const idx = options.findIndex((o) => o.value === value);
  const current = idx >= 0 ? options[idx] : null;

  function show(at = idx >= 0 ? idx : 0) { setActive(at); setOpen(true); }
  function close(focus = true) { setOpen(false); if (focus) btn.current?.focus(); }
  function pick(i: number) { const o = options[i]; if (o) onChange(o.value); close(); }

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { const t = e.target as Node; if (!root.current?.contains(t) && !list.current?.contains(t)) close(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);

  // Abre para baixo ou para cima conforme o espaço; alinha à esquerda ou à direita do botão para não
  // passar da borda da tela; a altura máxima é o espaço que sobra. Recalcula ao rolar e redimensionar.
  useLayoutEffect(() => {
    if (!open) { setPos(null); naturalW.current = null; return; }
    const M = 8;
    const place = () => {
      const b = btn.current, l = list.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      // Largura das opções numa linha só: medida uma vez por abertura (antes de qualquer quebra).
      if (naturalW.current == null && l) naturalW.current = l.scrollWidth;
      const natural = Math.max(r.width, naturalW.current ?? r.width);
      const w = Math.min(natural, vw - 2 * M);
      const left = r.left + w <= vw - M ? r.left : Math.max(M, r.right - w);
      const below = vh - r.bottom - M, above = r.top - M;
      const down = below >= Math.min(288, l?.scrollHeight ?? 288) || below >= above;
      setPos({ position: "fixed", left, width: w, whiteSpace: natural > w ? "normal" : "nowrap", maxHeight: Math.min(288, (down ? below : above) - 4),
        ...(down ? { top: r.bottom + 4 } : { bottom: vh - r.top + 4 }) });
    };
    place();
    const raf = requestAnimationFrame(place); // de novo com a lista já medida
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKey(e: React.KeyboardEvent) {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(last, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(last); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
    else if (e.key.length === 1) {
      // Digitar pula para a primeira opção que começa com o texto (buffer de 600 ms).
      const now = Date.now();
      typed.current = { text: (now - typed.current.t < 600 ? typed.current.text : "") + e.key.toLowerCase(), t: now };
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  }

  const h = size === "md" ? "min-h-10 px-3" : "min-h-9 coarse:min-h-11 px-2.5";
  return (
    <div ref={root} className={`relative ${size === "md" ? "w-full" : "inline-block"} ${className}`}>
      <button ref={btn} id={btnId} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-label={label} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onClick={() => (open ? close() : show())} onKeyDown={onKey}
        className={`flex w-full items-center justify-between gap-2 rounded border bg-surface text-left text-sm text-ink transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:outline-none focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_rgb(var(--action)/.15)] ${open ? "border-brand shadow-[0_0_0_3px_rgb(var(--action)/.15)]" : "border-line"} ${h}`}>
        <span className={`truncate ${current ? "" : "text-mute"}`}>{current?.label ?? placeholder}</span>
        <CaretDown size={14} aria-hidden className={`shrink-0 text-mute transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {required && (
        // Participa da validação do <form>; ao falhar, o foco vai para o botão.
        <input tabIndex={-1} aria-hidden required value={value} onChange={() => {}} onFocus={() => btn.current?.focus()}
          className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px opacity-0" />
      )}
      {open && createPortal(
        <ul ref={list} id={listId} role="listbox" aria-labelledby={label ? undefined : btnId} aria-label={label}
          style={pos ?? { position: "fixed", visibility: "hidden", whiteSpace: "nowrap" }}
          className="z-50 overflow-auto rounded-md border border-line bg-surface p-1 shadow-[0_12px_32px_-12px_rgb(2_48_72/.35)] anim-fade">
          {options.map((o, i) => {
            const sel = o.value === value;
            return (
              <li key={o.value} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={sel}
                onPointerEnter={() => setActive(i)} onClick={() => pick(i)}
                className={`flex cursor-pointer items-start gap-2 rounded px-2.5 py-2 text-sm ${i === active ? "bg-sunken" : ""} ${sel ? "font-medium text-heading" : "text-ink"}`}>
                <Check size={14} aria-hidden weight="bold" className={`mt-0.5 shrink-0 ${sel ? "text-brand" : "invisible"}`} />
                <span>{o.label}{o.hint && <span className="block font-normal text-label text-mute">{o.hint}</span>}</span>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}
