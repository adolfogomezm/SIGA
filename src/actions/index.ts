import { defineAction, ActionError } from "astro:actions";
import { z } from 'astro:schema';
import { db } from '../db';
import {articulo, coautores, usuario} from '../db/schema';
import { eq,and,inArray,like,or } from 'drizzle-orm';

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
                        calificacion: number;
                    }> = [
                        {
                            idUsuario: currentUser.idUsuario,
                            idArticulo: articuloId,
                            rol: "autor",
                            calificacion: -1,
                        },
                    ];

                    for (const coauthorId of coauthorIds) {
                        authorRows.push({
                            idUsuario: coauthorId,
                            idArticulo: articuloId,
                            rol: "coautor",
                            calificacion: -1,
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
                    message: "Error al guardar en la base de datos: " + (error instanceof Error ? error.message : String(error)),
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
    getAllUsuarios: defineAction({
        handler: async () => {
            return db.select()
                .from(usuario);
        }
    }),
    getAllArticulos: defineAction({
        handler: async () => {
            return db.select({
                articulo: articulo,
                autor: usuario.nombre,
                idAutor: usuario.idUsuario
            })
                .from(articulo)
                .innerJoin(
                    coautores,
                    and(
                        eq(articulo.idArticulo, coautores.idArticulo),
                        eq(coautores.rol, 'autor')
                    )
                )
                .innerJoin(
                    usuario,
                    eq(coautores.idUsuario, usuario.idUsuario)
                );
        }
    }),
    getArticuloById: defineAction({
        input: z.object({
            id: z.number().int(),
        }),
        handler: async ({ id }) => {
            const [art] = await db.select({
                articulo: articulo,
                autor: usuario.nombre,
            })
            .from(articulo)
            .innerJoin(coautores, and(eq(articulo.idArticulo, coautores.idArticulo), eq(coautores.rol, 'autor')))
            .innerJoin(usuario, eq(coautores.idUsuario, usuario.idUsuario))
            .where(eq(articulo.idArticulo, id))
            .limit(1);

            return art;
        }
    }),
    updateArticuloEstado: defineAction({
        input: z.object({
            idArticulo: z.number().int(),
            estado: z.enum(["En Revision", "Aprobados", "Rechazados", "Enviado"]),
        }),
        handler: async ({ idArticulo, estado }) => {
            await db.update(articulo)
                .set({ estado })
                .where(eq(articulo.idArticulo, idArticulo));
            
            return { success: true };
        }
    }),
    submitDictamen: defineAction({
        input: z.object({
            idArticulo: z.number().int(),
            dictamen: z.enum(["aprobado", "rechazado", "revision"]),
            calificacion: z.number().int(),
            comentarios: z.string().optional(),
        }),
        handler: async ({ idArticulo, dictamen, calificacion, comentarios }, context) => {
            const userId = context.cookies.get("user_id")?.value;
            if (!userId) {
                throw new ActionError({ code: "UNAUTHORIZED", message: "Debes iniciar sesión." });
            }
            const uid = Number(userId);

            // Check the reviewer was assigned by admin (must have an existing row with dictamen='revision')
            const [existing] = await db.select()
                .from(coautores)
                .where(and(eq(coautores.idUsuario, uid), eq(coautores.idArticulo, idArticulo)))
                .limit(1);

            if (!existing) {
                throw new ActionError({
                    code: "FORBIDDEN",
                    message: "No fuiste asignado como revisor de este artículo.",
                });
            }

            // Block actual authors/coauthors that have no dictamen
            if (existing.rol === 'autor' && !existing.dictamen) {
                throw new ActionError({
                    code: "FORBIDDEN",
                    message: "No puedes evaluar un artículo del que eres autor o colaborador.",
                });
            }

            // Update the existing assigned row
            await db.update(coautores)
                .set({ dictamen, calificacion, comentarios, fechaRevision: new Date() })
                .where(and(eq(coautores.idUsuario, uid), eq(coautores.idArticulo, idArticulo)));

            return { success: true, message: "Dictamen registrado correctamente." };
        }
    }),
    getEvaluacionesArticulo: defineAction({
        input: z.object({
            idArticulo: z.number().int(),
        }),
        handler: async ({ idArticulo }) => {
            const evaluaciones = await db.select({
                idUsuario: coautores.idUsuario,
                dictamen: coautores.dictamen,
                calificacion: coautores.calificacion,
                fechaRevision: coautores.fechaRevision,
                comentarios: coautores.comentarios,
                nombre: usuario.nombre,
            })
            .from(coautores)
            .innerJoin(usuario, eq(coautores.idUsuario, usuario.idUsuario))
            .where(and(
                eq(coautores.idArticulo, idArticulo),
                or(eq(coautores.dictamen, 'aprobado'), eq(coautores.dictamen, 'rechazado'))
            ));

            const total = evaluaciones.length;
            const aprobados = evaluaciones.filter(e => e.dictamen === 'aprobado').length;
            const rechazados = evaluaciones.filter(e => e.dictamen === 'rechazado').length;
            // RF-23: Average score: aprobado=5, rechazado=1, average of all
            const scores = evaluaciones.map(e => e.dictamen === 'aprobado' ? 5 : 1);
            const promedio = total > 0 ? scores.reduce((a, b) => a + b, 0) / total : 0;

            return {
                evaluaciones,
                total,
                aprobados,
                rechazados,
                promedio: Math.round(promedio * 100) / 100,
            };
        }
    }),
    getArticulosParaRevisar: defineAction({
        handler: async (_, context) => {
            const userId = context.cookies.get("user_id")?.value;
            if (!userId) {
                throw new ActionError({ code: "UNAUTHORIZED" });
            }
            const uid = Number(userId);

            // Only get articles where this reviewer was assigned by admin
            // (has a row in coautores with dictamen = 'revision', 'aprobado', or 'rechazado')
            const assigned = await db.select({
                idArticulo: coautores.idArticulo,
                dictamen: coautores.dictamen,
                calificacion: coautores.calificacion,
            })
                .from(coautores)
                .where(and(
                    eq(coautores.idUsuario, uid),
                    or(eq(coautores.dictamen, 'revision'), eq(coautores.dictamen, 'aprobado'), eq(coautores.dictamen, 'rechazado'))
                ));

            if (assigned.length === 0) return [];

            const assignedIds = assigned.map(a => a.idArticulo);

            // Get article details with author name
            const articles = await db.select({
                articulo: articulo,
                autor: usuario.nombre,
            })
                .from(articulo)
                .innerJoin(coautores, and(eq(articulo.idArticulo, coautores.idArticulo), eq(coautores.rol, 'autor')))
                .innerJoin(usuario, eq(coautores.idUsuario, usuario.idUsuario))
                .where(inArray(articulo.idArticulo, assignedIds));

            const assignedMap = new Map(assigned.map(a => [a.idArticulo, a.dictamen]));

            return articles.map(item => ({
                ...item,
                dictamenRevisor: assignedMap.get(item.articulo.idArticulo) || null,
            }));
        }
    }),
    // Admin: get users with rol='revisor' to assign
    getRevisoresDisponibles: defineAction({
        handler: async () => {
            return db.select({
                idUsuario: usuario.idUsuario,
                nombre: usuario.nombre,
                correo: usuario.correo,
                area: usuario.area,
            })
            .from(usuario)
            .where(eq(usuario.rol, 'revisor'));
        }
    }),
    // Admin: get already assigned reviewers for an article
    getRevisoresAsignados: defineAction({
        input: z.object({
            idArticulo: z.number().int(),
        }),
        handler: async ({ idArticulo }) => {
            return db.select({
                idUsuario: coautores.idUsuario,
                nombre: usuario.nombre,
                dictamen: coautores.dictamen,
                calificacion: coautores.calificacion,
            })
            .from(coautores)
            .innerJoin(usuario, eq(coautores.idUsuario, usuario.idUsuario))
            .where(and(
                eq(coautores.idArticulo, idArticulo),
                or(eq(coautores.dictamen, 'revision'), eq(coautores.dictamen, 'aprobado'), eq(coautores.dictamen, 'rechazado'))
            ));
        }
    }),
    // Admin: assign a reviewer to an article
    asignarRevisor: defineAction({
        input: z.object({
            idArticulo: z.number().int(),
            idRevisor: z.number().int(),
        }),
        handler: async ({ idArticulo, idRevisor }) => {
            // Check the user is actually a revisor
            const [rev] = await db.select()
                .from(usuario)
                .where(and(eq(usuario.idUsuario, idRevisor), eq(usuario.rol, 'revisor')))
                .limit(1);

            if (!rev) {
                throw new ActionError({ code: "BAD_REQUEST", message: "El usuario no tiene rol de revisor." });
            }

            // Check not already assigned
            const [already] = await db.select()
                .from(coautores)
                .where(and(eq(coautores.idUsuario, idRevisor), eq(coautores.idArticulo, idArticulo)))
                .limit(1);

            if (already) {
                throw new ActionError({ code: "CONFLICT", message: "Este revisor ya está asignado a este artículo." });
            }

            // Insert assignment row with dictamen='revision' (pending) and calificacion=-1
            await db.insert(coautores).values({
                idUsuario: idRevisor,
                idArticulo,
                rol: 'coautor',
                dictamen: 'revision',
                calificacion: -1,
            });

            return { success: true, message: "Revisor asignado correctamente." };
        }
    }),
    // Admin: remove a reviewer from an article
    removerRevisor: defineAction({
        input: z.object({
            idArticulo: z.number().int(),
            idRevisor: z.number().int(),
        }),
        handler: async ({ idArticulo, idRevisor }) => {
            await db.delete(coautores)
                .where(and(
                    eq(coautores.idUsuario, idRevisor),
                    eq(coautores.idArticulo, idArticulo),
                    eq(coautores.dictamen, 'revision')
                ));
            return { success: true };
        }
    }),
    buscarColaboradores: defineAction({
        input: z.object({
            query: z.string().min(1),
        }),
        handler: async ({ query }) => {
            const isNumeric = /^\d+$/.test(query.trim());
            let results;

            if (isNumeric) {
                results = await db.select({
                    idUsuario: usuario.idUsuario,
                    nombre: usuario.nombre,
                    correo: usuario.correo,
                    institucion: usuario.institucion,
                })
                .from(usuario)
                .where(eq(usuario.idUsuario, Number(query.trim())))
                .limit(10);
            } else {
                results = await db.select({
                    idUsuario: usuario.idUsuario,
                    nombre: usuario.nombre,
                    correo: usuario.correo,
                    institucion: usuario.institucion,
                })
                .from(usuario)
                .where(like(usuario.nombre, `%${query.trim()}%`))
                .limit(10);
            }

            return results;
        }
    }),
    registrarColaboradorRapido: defineAction({
        input: z.object({
            nombre: z.string().min(2),
            correo: z.string().email(),
            institucion: z.string().min(2),
            password: z.string().min(4).max(6),
        }),
        handler: async ({ nombre, correo, institucion, password }) => {
            try {
                const inserted = await db.insert(usuario).values({
                    nombre,
                    correo,
                    institucion,
                    password,
                    rol: 'autor',
                }).$returningId();

                return {
                    success: true,
                    idUsuario: inserted[0].idUsuario,
                    nombre,
                    correo,
                    institucion,
                };
            } catch (e: any) {
                if (e.code === 'ER_DUP_ENTRY' || e.errno === 1062) {
                    throw new ActionError({
                        code: "CONFLICT",
                        message: "Ese correo ya existe en la base de datos.",
                    });
                }
                throw new ActionError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Error al registrar el colaborador.",
                });
            }
        }
    }),
    cambiarRolUsuario: defineAction({
        input: z.object({
            idUsuario: z.number().int(),
            nuevoRol: z.enum(["autor", "revisor", "administrador"]),
        }),
        handler: async ({ idUsuario, nuevoRol }) => {
            const [user] = await db.select()
                .from(usuario)
                .where(eq(usuario.idUsuario, idUsuario))
                .limit(1);

            if (!user) {
                throw new ActionError({ code: "NOT_FOUND", message: "Usuario no encontrado." });
            }

            await db.update(usuario)
                .set({ rol: nuevoRol })
                .where(eq(usuario.idUsuario, idUsuario));

            return { success: true, message: `Rol de ${user.nombre} cambiado a ${nuevoRol}.` };
        }
    }),
};

void server;

