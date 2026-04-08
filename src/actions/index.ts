import { defineAction } from 'astro:actions';
import { z } from 'astro:schema';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

export const server = {
    registrarCuenta: defineAction({
        input: z.object({
            nombre: z.string(),
            correo: z.string().email(),
            institucion: z.string(),
            password: z.string().min(4),
        }),
        handler: async (input) => {
            try {
                await db.insert(users).values({
                    nombre: input.nombre,
                    correo: input.correo,
                    institucion: input.institucion,
                    password: input.password,
                });

                return {
                    success: true,
                    message: "Usuario guardado en texto plano correctamente."
                };
            } catch (e) {
                throw new Error("Ese correo ya existe en la base de datos.");
            }
        }
    }),
    iniciarSesion: defineAction({
        input: z.object({
            correo: z.string().email(),
            password: z.string(),
        }),
        handler: async (input) => {
            const [user] = await db.select()
                .from(users)
                .where(eq(users.correo, input.correo));

            if (!user || user.password !== input.password) {
                throw new Error("Correo o contraseña incorrectos");
            }

            return {
                success: true,
                usuario: {
                    nombre: user.nombre,
                    rol: user.rol
                }
            };
        }
    }),
};