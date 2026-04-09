import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

const dbUrl = import.meta.env.DATABASE_URL;

if (!dbUrl) {
    throw new Error("No se pudo conectar a la base de datos");
}

const connection = await mysql.createConnection(dbUrl);
export const db = drizzle(connection, { schema, mode: 'default' });
