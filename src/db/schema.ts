import { mysqlTable, int, varchar, mysqlEnum, timestamp, primaryKey } from "drizzle-orm/mysql-core";

export const usuario = mysqlTable("usuario", {
    idUsuario: int("idUsuario").primaryKey().autoincrement(),
    nombre: varchar("nombre", { length: 50 }),
    correo: varchar("correo", { length: 50 }),
    institucion: varchar("institucion", { length: 50 }),
    password: varchar("password", { length: 6 }),
    rol: mysqlEnum("rol", ["autor", "revisor", "administrador"]),
    createdAt: timestamp("created_at").defaultNow(),
    area: mysqlEnum("area", ["area_1","area_2","area_3"]),
});

export const articulo = mysqlTable("articulo", {
    idArticulo: int("idArticulo").primaryKey().autoincrement(),
    abstract: varchar("abstract", { length: 255 }),
    titulo: varchar("titulo", { length: 45 }),
    ruta: varchar("ruta", { length: 255 }),
    area: mysqlEnum("area", ["area_1","area_2","area_3"]),
    estado: mysqlEnum("estado", ["En Revision", "Aprobados", "Rechazados","Enviado"]),
    date: timestamp("date").defaultNow(),
});

export const coautores = mysqlTable("coautores", {
    idUsuario: int("idUsuario").notNull().references(() => usuario.idUsuario),
    idArticulo: int("idArticulo").notNull().references(() => articulo.idArticulo),
    rol: mysqlEnum("rol", ["autor", "coautor"]),
}, (table) => ({
    pk: primaryKey({ columns: [table.idUsuario, table.idArticulo] }),
}));