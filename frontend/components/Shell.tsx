"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, BarChart3, Bell, CircleUser, FolderKanban, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import { api } from "@/lib/api";
import { clearMe, useMe } from "@/lib/me";

const NAV = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/analysis", label: "Análise e capacidade", icon: BarChart3 },
  { href: "/projects", label: "Projetos", icon: FolderKanban },
  { href: "/alerts", label: "Alertas", icon: Bell },
  { href: "/admin", label: "Administração", icon: Settings, adminOnly: true },
  { href: "/users", label: "Usuários", icon: Users, adminOnly: true },
  { href: "/account", label: "Minha conta", icon: CircleUser },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [brand, setBrand] = useState<any>({ name: "CEIA Compute Observatory", ceia_logo: "/brand/ceia.png", ufg_logo: "/brand/ufg.png" });
  const { me } = useMe();
  useEffect(() => { api("/branding").then(setBrand).catch(() => {}); }, []);
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    clearMe();
    router.push("/login");
  }
  if (path.startsWith("/login")) return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col bg-ceia text-white md:sticky md:top-0 md:h-screen md:w-60 md:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.ceia_logo} alt="CEIA — Centro de Excelência em Inteligência Artificial" className="h-9 w-auto max-w-full object-contain md:h-10" />
          {me && (
            <button className="flex items-center gap-1 whitespace-nowrap text-xs text-blue-100 transition-colors hover:text-white md:hidden" onClick={logout}>
              <LogOut size={14} aria-hidden /> Sair
            </button>
          )}
        </div>
        <div className="px-5 pb-1 pt-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-50"><Activity size={16} className="text-cyan-brand" aria-hidden />{brand.name}</div>
          {brand.demo_mode && <div className="mt-2 border border-amber-300 px-2 py-0.5 text-xs text-amber-200">MODO DEMONSTRAÇÃO</div>}
        </div>
        <nav aria-label="Principal" className="flex flex-row gap-1 overflow-x-auto px-2 py-3 md:flex-col">
          {NAV.filter((n) => !n.adminOnly || me?.role === "admin").map(({ href, label, icon: I }) => {
            const on = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={on ? "page" : undefined}
                className={`group relative flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm transition-colors duration-200 ${on ? "bg-white/15 text-white" : "text-blue-100 hover:bg-white/10 hover:text-white"}`}>
                <span aria-hidden className={`absolute bottom-0 left-0 h-0.5 w-full origin-left bg-cyan-brand transition-transform duration-300 md:top-0 md:h-full md:w-0.5 md:origin-top ${on ? "scale-100" : "scale-0"}`} />
                <I size={16} aria-hidden className={`transition-transform duration-200 group-hover:scale-110 ${on ? "text-cyan-brand" : ""}`} />{label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden items-center justify-between gap-2 px-4 py-4 md:flex md:flex-col md:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.ufg_logo} alt="Universidade Federal de Goiás" className="h-12 w-auto" />
          {me && (
            <button className="flex items-center gap-1 text-xs text-blue-100 transition-colors hover:text-white"
              onClick={logout}>
              <LogOut size={12} aria-hidden /> Sair ({me.name || me.username})
            </button>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
