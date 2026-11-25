"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChartBar as BarChart3, Bell, UserCircle as CircleUser, Folders as FolderKanban, SquaresFour as LayoutDashboard, SignOut as LogOut, List as Menu, Monitor, Moon, GearSix as Settings, Sun, Users, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { clearMe, useMe } from "@/lib/me";
import { useThemePref, type ThemePref } from "@/lib/theme";

const GROUPS = [
  { label: "Monitorar", items: [
    { href: "/", label: "Visão geral", icon: LayoutDashboard },
    { href: "/analysis", label: "Análise e capacidade", icon: BarChart3 },
    { href: "/alerts", label: "Alertas", icon: Bell, badge: true },
  ] },
  { label: "Organizar", items: [{ href: "/projects", label: "Projetos", icon: FolderKanban }] },
  { label: "Administrar", adminOnly: true, items: [
    { href: "/admin", label: "Administração", icon: Settings },
    { href: "/users", label: "Usuários", icon: Users },
  ] },
];

const THEME: Record<ThemePref, { label: string; icon: any }> = {
  system: { label: "Sistema", icon: Monitor }, light: { label: "Claro", icon: Sun }, dark: { label: "Escuro", icon: Moon },
};
const THEME_NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const iconBtn = "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-blue-100 transition-colors hover:bg-white/10 hover:text-white md:min-h-9 md:min-w-9";

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [brand, setBrand] = useState<any>({ name: "CEIA Compute Observatory", ceia_logo: "/brand/ceia.png", ufg_logo: "/brand/ufg.png" });
  const [open, setOpen] = useState(false);
  const { me, loading } = useMe();
  const { pref, choose } = useThemePref();
  const isLogin = path.startsWith("/login");
  const bare = isLogin || path.startsWith("/kiosk");
  const alerts = useApi<any>(bare || !me ? null : "/alerts?status=open", 60000);
  const openAlerts: number = alerts.data?.items?.length ?? 0;
  useEffect(() => { api("/branding").then(setBrand).catch(() => {}); }, []);
  useEffect(() => { setOpen(false); }, [path]);
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    clearMe();
    router.push("/login");
  }
  // Sessão inválida ou expirada (o middleware só vê se o cookie existe): volta ao login.
  useEffect(() => {
    if (!isLogin && !loading && !me) router.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  }, [isLogin, loading, me, router]);
  if (isLogin) return <>{children}</>;
  // Nada do app aparece antes de /auth/me confirmar o usuário: sem piscar o layout logado.
  if (!me) return <div className="min-h-screen bg-paper" aria-busy="true" />;
  if (bare) return <>{children}</>;

  const item = ({ href, label, icon: I, badge }: any) => {
    const on = href === "/" ? path === "/" : path.startsWith(href);
    return (
      <Link key={href} href={href} aria-current={on ? "page" : undefined}
        className={`relative flex min-h-11 items-center gap-2.5 rounded px-3 text-sm transition-colors duration-150 md:min-h-9 ${on ? "nav-on font-medium" : "text-blue-100 hover:bg-white/10 hover:text-white"}`}>
        <I size={18} weight={on ? "fill" : "regular"} aria-hidden />
        <span className="flex-1">{label}</span>
        {badge && openAlerts > 0 && <span className="num rounded-full bg-crit px-1.5 text-label font-medium text-white" aria-label={`${openAlerts} abertos`}>{openAlerts}</span>}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#conteudo" className="sr-only z-50 rounded bg-surface px-3 py-2 text-sm text-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Pular para o conteúdo</a>
      <aside className="sidebar flex shrink-0 flex-col bg-ceia text-white md:sticky md:top-0 md:h-screen md:w-60 md:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:pb-1 md:pt-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.ceia_logo} alt="CEIA — Centro de Excelência em Inteligência Artificial" className="h-8 w-auto max-w-full object-contain md:h-10" />
          <button className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-white hover:bg-white/10 md:hidden"
            aria-expanded={open} aria-controls="nav-principal" aria-label={open ? "Fechar menu" : "Abrir menu"} onClick={() => setOpen((o) => !o)}>
            {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
        <div id="nav-principal" className={`${open ? "flex" : "hidden"} flex-1 flex-col md:flex`}>
          <nav aria-label="Principal" className="space-y-4 px-2 py-3">
            {GROUPS.filter((g) => !g.adminOnly || me?.role === "admin").map((g) => (
              <div key={g.label}>
                <div className="px-3 pb-1 text-label font-medium text-blue-200/80">{g.label}</div>
                <div className="space-y-0.5">{g.items.map(item)}</div>
              </div>
            ))}
          </nav>
          <div className="mt-auto space-y-3 border-t border-white/10 px-2 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.ufg_logo} alt="Universidade Federal de Goiás" className="ml-3 h-10 w-auto self-start" />
            {/* Linha da conta: nome à esquerda, tema e sair como ícones à direita. */}
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">{item({ href: "/account", label: me ? me.name || me.username : "Minha conta", icon: CircleUser })}</div>
              <button onClick={() => choose(THEME_NEXT[pref])} title={`Tema: ${THEME[pref].label} (clique para ${THEME[THEME_NEXT[pref]].label.toLowerCase()})`}
                aria-label={`Tema ${THEME[pref].label.toLowerCase()}. Mudar para ${THEME[THEME_NEXT[pref]].label.toLowerCase()}`} className={iconBtn}>
                {(() => { const I = THEME[pref].icon; return <I size={16} aria-hidden />; })()}
              </button>
              {me && <button onClick={logout} title="Sair" aria-label="Sair" className={iconBtn}><LogOut size={16} aria-hidden /></button>}
            </div>
          </div>
        </div>
      </aside>
      <main id="conteudo" className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6"><div className="mx-auto max-w-content">{children}</div></main>
    </div>
  );
}
