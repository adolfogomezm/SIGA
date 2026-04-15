import { defineAction, ActionError } from "astro:actions";
import { z } from 'astro:schema';
import { db } from '../db';
import {articulo, coautores, usuario} from '../db/schema';
import { eq,and,inArray } from 'drizzle-orm';

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
    subirArticulo: defineAction({
        input: z.object({
            title: z.string().max(45),
            abstract: z.string().max(255),
            route: z.string().max(255),
            area: z.enum(["area_1", "area_2", "area_3"]),
            coauthors: z.array(z.number().int().positive()).max(3).default([]),
        }),
        handler: async (input, context) => {
            const userId = context.cookies.get("user_id")?.value;

            if (!userId) {
                throw new ActionError({
                    code: "UNAUTHORIZED",
                    message: "Debes iniciar sesión para subir artículos.",
                });
            }

            const currentUserId = Number(userId);

            if (Number.isNaN(currentUserId)) {
                throw new ActionError({
                    code: "UNAUTHORIZED",
                    message: "Sesión inválida, vuelve a iniciar sesión.",
                });
            }

            const [currentUser] = await db
                .select()
                .from(usuario)
                .where(eq(usuario.idUsuario, currentUserId))
                .limit(1);

            if (!currentUser) {
                throw new ActionError({
                    code: "UNAUTHORIZED",
                    message: "No se encontró el usuario autenticado.",
                });
            }

            const uniqueCoauthorIds = Array.from(new Set(input.coauthors));

            if (uniqueCoauthorIds.length !== input.coauthors.length) {
                throw new ActionError({
                    code: "BAD_REQUEST",
                    message: "No repitas el mismo coautor más de una vez.",
                });
            }

            if (uniqueCoauthorIds.includes(currentUserId)) {
                throw new ActionError({
                    code: "BAD_REQUEST",
                    message: "No puedes agregarte como coautor.",
                });
            }

            const coauthorIds = uniqueCoauthorIds;

            const coauthorUsers = coauthorIds.length
                ? await db
                    .select({ idUsuario: usuario.idUsuario })
                    .from(usuario)
                    .where(inArray(usuario.idUsuario, coauthorIds))
                : [];

            if (coauthorUsers.length !== coauthorIds.length) {
                throw new ActionError({
                    code: "BAD_REQUEST",
                    message: "Uno o más coautores no existen como usuarios registrados.",
                });
            }

            try {
                await db.transaction(async (tx) => {
                    const insertedArticles = await tx.insert(articulo).values({
                        titulo: input.title,
                        abstract: input.abstract,
                        ruta: input.route,
                        area: input.area,
                        estado: "Enviado",
                    }).$returningId();

                    const articuloId = insertedArticles[0]?.idArticulo;

                    if (!articuloId) {
                        throw new ActionError({
                            code: "INTERNAL_SERVER_ERROR",
                            message: "No se pudo obtener el ID del artículo guardado.",
                        });
                    }

                    const authorRows: Array<{
                        idUsuario: number;
                        idArticulo: number;
                        rol: "autor" | "coautor";
                    }> = [
                        {
                            idUsuario: currentUser.idUsuario,
                            idArticulo: articuloId,
                            rol: "autor",
                        },
                    ];

                    for (const coauthorId of coauthorIds) {
                        authorRows.push({
                            idUsuario: coauthorId,
                            idArticulo: articuloId,
                            rol: "coautor",
                        });
                    }

                    await tx.insert(coautores).values(authorRows);
                });

                return {
                    success: true,
                    message: "Artículo subido correctamente.",
                };
            } catch (error) {
                if (error instanceof ActionError) {
                    throw error;
                }

                console.error(error);
                throw new ActionError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Error al guardar en la base de datos.",
                });
            }
        },
    }),
    getEsUsuario: defineAction({
        input: z.object({
            id: z.number().int(),
        }),
        handler: async (input) => {
            const [existeUsuario] = await db
                .select()
                .from(usuario)
                .where(eq(usuario.idUsuario, input.id))
                .limit(1);

            return existeUsuario;
        },
    }),

};

void server;

