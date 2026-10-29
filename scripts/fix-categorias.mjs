// Repõe as categorias da loja de acordo com a lista definida abaixo.
// Apaga da BD as categorias que não pertencem à lista e não têm produtos,
// e cria/atualiza as corretas. Não toca em produtos.
//
// Uso:  node scripts/fix-categorias.mjs
// Requer DATABASE_URL no .env (ou no ambiente).

import "dotenv/config";
import crypto from "node:crypto";
import pg from "pg";

const TARGET = [
  { name: "Doces", slug: "doces" },
  { name: "Alimentos", slug: "alimentos" },
  { name: "Artesanato", slug: "artesanato" },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL — define-a no .env ou no ambiente.");
  process.exit(1);
}

const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
const client = new pg.Client({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

const newId = () => "c" + crypto.randomBytes(12).toString("hex");

await client.connect();

const { rows: before } = await client.query(
  `SELECT c.id, c.name, c.slug, COUNT(p.id)::int AS produtos
     FROM "Category" c
     LEFT JOIN "Product" p ON p."categoryId" = c.id
     GROUP BY c.id
     ORDER BY c.name`
);
console.log("Categorias antes:");
console.table(before.map(({ id, ...r }) => r));

const targetSlugs = new Set(TARGET.map((t) => t.slug));

for (const c of before) {
  if (targetSlugs.has(c.slug)) continue;
  if (c.produtos > 0) {
    console.warn(`  mantida (tem ${c.produtos} produtos): ${c.name}`);
    continue;
  }
  await client.query(`DELETE FROM "Category" WHERE id = $1`, [c.id]);
  console.log(`  apagada: ${c.name}`);
}

for (const t of TARGET) {
  await client.query(
    `INSERT INTO "Category" (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
    [newId(), t.name, t.slug]
  );
  console.log(`  ok: ${t.name}`);
}

const { rows: after } = await client.query(
  `SELECT name, slug FROM "Category" ORDER BY name`
);
console.log("Categorias depois:");
console.table(after);

await client.end();
console.log("Feito.");
