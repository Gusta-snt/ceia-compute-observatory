"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, BarChart3, Bell, FolderKanban, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { api } from "@/lib/api";

const NAV = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/analysis", label: "Análise e capacidade", icon: BarChart3 },
  { href: "/projects", label: "Projetos", icon: FolderKanban },
  { href: "/alerts", label: "Alertas", icon: Bell },
  { href: "/admin", label: "Administração", icon: Settings },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [brand, setBrand] = useState<any>({ name: "CEIA Compute Observatory", ceia_logo: "/brand/ceia.png", ufg_logo: "/brand/ufg.png" });
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    api("/branding").then(setBrand).catch(() => {});
    api("/auth/me").then((u) => setUser(u.username)).catch(() => {});
  }, []);
  if (path.startsWith("/login")) return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col bg-navy-900 text-white md:w-60">
        <div className="bg-white px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.ceia_logo} alt="CEIA — Centro de Excelência em Inteligência Artificial" className="h-10 w-auto" />
        </div>
        <div className="px-4 pb-1 pt-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Activity size={16} className="text-cyan-brand" aria-hidden />{brand.name}</div>
          {brand.demo_mode && <div className="mt-2 border border-amber-300 px-2 py-0.5 text-xs text-amber-200">MODO DEMONSTRAÇÃO</div>}
        </div>
        <nav aria-label="Principal" className="flex flex-row gap-1 overflow-x-auto px-2 py-3 md:flex-col">
          {NAV.map(({ href, label, icon: I }) => {
            const on = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm ${on ? "bg-navy-800 text-white" : "text-slate-300 hover:bg-navy-800/60"}`}>
                <I size={16} aria-hidden />{label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden items-center justify-between gap-2 px-4 py-4 md:flex md:flex-col md:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.ufg_logo} alt="Universidade Federal de Goiás" className="h-12 w-auto" />
          {user && (
            <button className="flex items-center gap-1 text-xs text-slate-300 hover:text-white"
              onClick={async () => { await api("/auth/logout", { method: "POST" }); router.push("/login"); }}>
              <LogOut size={12} aria-hidden /> Sair ({user})
            </button>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
