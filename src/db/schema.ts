import { mysqlTable, serial, varchar, mysqlEnum, timestamp } from "drizzle-orm/mysql-core";

export const users = mysqlTable("usuarios", {
    id: serial("id").primaryKey(),
    nombre: varchar("nombre", { length: 255 }).notNull(),
    correo: varchar("correo", { length: 255 }).notNull().unique(),
    institucion: varchar("institucion", { length: 255 }),
    password: varchar("password", { length: 255 }).notNull(),
    rol: mysqlEnum("rol", ["autor", "revisor", "administrador"]).default("autor"),
    createdAt: timestamp("created_at").defaultNow(),
});