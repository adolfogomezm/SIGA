import { defineMiddleware } from "astro:middleware";
import { db } from "./db";
import { usuario } from "./db/schema";
import { eq } from "drizzle-orm";

export const onRequest = defineMiddleware(
    async (context, next) => {
    const { url, cookies, redirect } = context;
    let rol = cookies.get("user_role")?.value;
    const userId = cookies.get("user_id")?.value;

    // Refresh the role from DB so that admin role changes take effect without re-login
    if (userId) {
        try {
            const [user] = await db.select({ rol: usuario.rol })
                .from(usuario)
                .where(eq(usuario.idUsuario, Number(userId)))
                .limit(1);
            if (user && user.rol && user.rol !== rol) {
                rol = user.rol;
                cookies.set("user_role", rol, {
                    path: "/",
                    httpOnly: true,
                    sameSite: "lax",
                });
            }
        } catch (_) {
            // If DB query fails, fall back to cookie value
        }
    }

    if(url.pathname.startsWith("/autor")) {
        if(rol === undefined || rol === "") {
            return redirect("/login?error=UsuarioNoAutorizado");
        }
    }
    if (url.pathname.startsWith("/admin")) {
        if(rol === undefined || rol === "") {
            return redirect("/login?error=UsuarioNoAutorizado");
        }
        if (rol !== "administrador") {
            return redirect("/autor?error=UsuarioNoAutorizado");
        }
    }
    if(url.pathname.startsWith("/revisor")) {
        if(rol === undefined || rol === "") {
            return redirect("/login?error=UsuarioNoAutorizado");
        }
        if (rol !== "revisor" && rol !== "administrador") {
            return redirect("/autor?error=UsuarioNoAutorizado");
        }
    }

    return next();
});