import type { APIRoute } from "astro";
import fs from "node:fs/promises";
import path from "node:path";

export const POST: APIRoute = async ({ request }) => {
    try {
        const formData = await request.formData();
        const file = formData.get("file") as File;
        
        if (!file) {
            return new Response(JSON.stringify({ error: "No file provided" }), { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const uploadDir = path.join(process.cwd(), "public", "uploads");
        
        await fs.mkdir(uploadDir, { recursive: true });

        const ext = path.extname(file.name);
        const name = path.basename(file.name, ext).replace(/[^a-zA-Z0-9]/g, "_");
        const filename = `${name}_${Date.now()}${ext}`;
        const filePath = path.join(uploadDir, filename);

        await fs.writeFile(filePath, Buffer.from(buffer));

        return new Response(JSON.stringify({ url: `/uploads/${filename}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
        console.error(e);
        return new Response(JSON.stringify({ error: "Upload failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
};
