import { defineAction, ActionError } from "astro:actions";
import { z } from 'astro:schema';
import { db } from '../db';
import {articulo, coautores, usuario} from '../db/schema';
import { eq,and } from 'drizzle-orm';

export const server = {
    registrarCuenta: defineAction({
        input: z.object({
            nombre: z.string(),
            correo: z.string().email(),
            institucion: z.string(),
            password: z.string().min(4).max(6),
            area: z.enum(["area_1", "area_2", "area_3"]),
        }),
        handler: async (input) => {
            try {
                await db.insert(usuario).values({
                    nombre: input.nombre,
                    correo: input.correo,
                    institucion: input.institucion,
                    password: input.password,
                    area: input.area,
                });

                return {
                    success: true,
                    message: "Usuario guardado en texto plano correctamente."
                };
            } catch (e: any) {
                if (e.code === 'ER_DUP_ENTRY' || e.errno === 1062) {
                    throw new ActionError({
                        code: "CONFLICT",
                        message: "Ese correo ya existe en la base de datos.",
                    });
                }
                console.error("Error en DB:", e);
                throw new ActionError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Error crítico al guardar en la base de datos.",
                });
            }
        }
    }),
    iniciarSesion: defineAction({
        input: z.object({
            correo: z.string().email(),
            password: z.string(),
        }),
        handler: async (input,context) => {
            const [user] = await db.select()
                .from(usuario)
                .where(eq(usuario.correo, input.correo));

            if (!user || user.password !== input.password) {
                throw new Error("Correo o contraseña incorrectos");
            }

            context.cookies.set("user_name", user.nombre ?? "", { path: "/" });
            context.cookies.set("user_role", user.rol ?? "autor", {
                path: "/",
                httpOnly: true,
                secure: import.meta.env.PROD,
                sameSite: "lax",
            });
            context.cookies.set("user_id", user.idUsuario.toString(), {
                path: "/",
                httpOnly: true,
                secure: import.meta.env.PROD,
                sameSite: "lax"
            });

            return {
                success: true,
                usuario: {
                    nombre: user.nombre,
                    rol: user.rol
                }
            };
        }
    }),
    cerrarSesion: defineAction({
        handler: async (_, context) => {
            context.cookies.delete("user_name", { path: "/" });
            context.cookies.delete("user_role", { path: "/" });
            return { success: true };
        }
    }),
    getArticulos: defineAction({
        handler: async (input, context) => {
            const userId = context.cookies.get("user_id")?.value;

            if (!userId) {
                throw new ActionError({ code: "UNAUTHORIZED" });
            }

            return db.select({
                articulo: articulo
            })
                .from(articulo)
                .innerJoin(
                    coautores,
                    eq(articulo.idArticulo, coautores.idArticulo)
                )
                .innerJoin(
                    usuario,
                    eq(coautores.idUsuario, usuario.idUsuario)
                )
                .where(
                    and(
                        eq(usuario.idUsuario, Number(userId)),
                        eq(usuario.rol, 'autor')
                    )
                );
        }
    }),

};