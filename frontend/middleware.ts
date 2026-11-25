import { NextResponse, type NextRequest } from "next/server";

// Sem cookie de sessão, nenhuma tela do app é enviada: vai direto para o login, no servidor, sem
// piscar o layout logado. A validade da sessão continua sendo checada pelo backend (/auth/me).
export function middleware(req: NextRequest) {
  if (req.cookies.has("ceia_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Tudo, menos login, API (o backend responde 401 sozinho), arquivos do Next e estáticos.
  matcher: ["/((?!login|api/|_next/|brand/|icon\\.png|favicon\\.ico).*)"],
};
