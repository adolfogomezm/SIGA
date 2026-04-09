import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(
    (context, next) => {
    const { url, cookies, redirect } = context;
    const rol = cookies.get("user_role")?.value;


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