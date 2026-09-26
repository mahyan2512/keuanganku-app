/**
 * Cloudflare Pages Functions - API Router
 * Path: functions/api/[[route]].js
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function parseRequestInfo(request, params) {
  const url = new URL(request.url);
  const routeParts = Array.isArray(params?.route)
    ? params.route
    : params?.route
    ? [params.route]
    : [];

  const firstSegment = (routeParts[0] || "").toLowerCase();
  const queryMode = (url.searchParams.get("mode") || "").toLowerCase();

  let resource = "transaction";
  if (
    firstSegment === "investment" ||
    firstSegment === "investments" ||
    queryMode === "investment"
  ) {
    resource = "investment";
  } else if (firstSegment === "history" || queryMode === "history") {
    resource = "history";
  } else if (
    firstSegment === "transaction" ||
    firstSegment === "transactions" ||
    queryMode === "transaction"
  ) {
    resource = "transaction";
  }

  const pathId = routeParts.length > 1 ? routeParts[1] : null;
  const queryId = url.searchParams.get("id");
  const id = pathId || queryId || null;
  const month = url.searchParams.get("month") || null;

  return { url, resource, id, month };
}

export async function onRequest(context) {
  const { request } = context;

  // 1. CORS Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. Cek D1 Binding
  const db = context.env.DB || context.env.DATABASE || context.env.d1;
  if (!db) {
    return jsonResponse(
      {
        error:
          "Database D1 belum terhubung! Pastikan D1 binding dengan variable name 'DB' sudah ditambahkan di Cloudflare Pages Dashboard.",
      },
      500
    );
  }

  try {
    switch (request.method) {
      case "GET":
        return await handleGet(context, db);
      case "POST":
        return await handlePost(context, db);
      case "PUT":
        return await handlePut(context, db);
      case "DELETE":
        return await handleDelete(context, db);
      default:
        return jsonResponse(
          { error: `Method ${request.method} tidak didukung` },
          405
        );
    }
  } catch (err) {
    return jsonResponse(
      {
        error: "Terjadi kesalahan internal pada server",
        details: err.message,
      },
      500
    );
  }
}

// === 1. GET DATA ===
async function handleGet(context, db) {
  const { request, params } = context;
  const { resource, month } = parseRequestInfo(request, params);

  if (resource === "investment") {
    const sql = `
      SELECT *, (current_amount - initial_amount) AS profit
      FROM investments
      ORDER BY current_amount DESC
    `;
    const { results } = await db.prepare(sql).all();
    return jsonResponse(results || []);
  }

  if (resource === "history") {
    const sql = `
      SELECT name, amount, strftime('%Y-%m-%d %H:%M', date) AS date_label
      FROM investment_history
      ORDER BY date ASC
    `;
    const { results } = await db.prepare(sql).all();
    return jsonResponse(results || []);
  }

  // Data Transaksi
  if (month) {
    const sql = `
      SELECT * FROM transactions
      WHERE substr(date, 1, 7) = ?
      ORDER BY date DESC, id DESC
    `;
    const { results } = await db.prepare(sql).bind(month).all();
    return jsonResponse(results || []);
  } else {
    const sql = `
      SELECT * FROM transactions
      ORDER BY date DESC, id DESC
    `;
    const { results } = await db.prepare(sql).all();
    return jsonResponse(results || []);
  }
}

// === 2. POST DATA (TAMBAH) ===
async function handlePost(context, db) {
  const { request, params } = context;
  const { resource } = parseRequestInfo(request, params);
  const input = await request.json().catch(() => ({}));

  if (resource === "investment") {
    const type = input.type || "saham";
    const name = input.name || "";
    const initialAmount = Number(input.initial_amount) || 0;
    const currentAmount = Number(input.current_amount) || 0;

    const insertResult = await db
      .prepare(
        `INSERT INTO investments (type, name, initial_amount, current_amount, last_updated)
         VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`
      )
      .bind(type, name, initialAmount, currentAmount)
      .run();

    let lastId = insertResult.meta?.last_row_id;
    if (!lastId) {
      const row = await db.prepare("SELECT last_insert_rowid() AS id").first();
      lastId = row?.id;
    }

    if (lastId) {
      await db
        .prepare(
          `INSERT INTO investment_history (investment_id, name, amount, date)
           VALUES (?, ?, ?, datetime('now', 'localtime'))`
        )
        .bind(lastId, name, currentAmount)
        .run();
    }

    return jsonResponse({ message: "Berhasil disimpan", id: lastId });
  } else {
    const type = input.type || "pengeluaran";
    const category = input.category || "lain_lain";
    const amount = Number(input.amount) || 0;
    const description = input.description || "";
    const date = input.date && input.date.trim() !== "" 
      ? input.date 
      : new Date().toISOString().split("T")[0];

    await db
      .prepare(
        `INSERT INTO transactions (type, category, amount, description, date, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))`
      )
      .bind(type, category, amount, description, date)
      .run();

    return jsonResponse({ message: "Berhasil disimpan" });
  }
}

// === 3. PUT DATA (UPDATE) ===
async function handlePut(context, db) {
  const { request, params } = context;
  const { resource, id } = parseRequestInfo(request, params);

  if (!id) {
    return jsonResponse(
      { error: "ID data harus disertakan untuk melakukan update" },
      400
    );
  }

  const input = await request.json().catch(() => ({}));

  if (resource === "investment") {
    const type = input.type || "saham";
    const name = input.name || "";
    const initialAmount = Number(input.initial_amount) || 0;
    const currentAmount = Number(input.current_amount) || 0;

    await db
      .prepare(
        `UPDATE investments
         SET type = ?, name = ?, initial_amount = ?, current_amount = ?, last_updated = datetime('now', 'localtime')
         WHERE id = ?`
      )
      .bind(type, name, initialAmount, currentAmount, id)
      .run();

    await db
      .prepare(
        `INSERT INTO investment_history (investment_id, name, amount, date)
         VALUES (?, ?, ?, datetime('now', 'localtime'))`
      )
      .bind(id, name, currentAmount)
      .run();

    return jsonResponse({ message: "Berhasil diupdate" });
  } else {
    const type = input.type || "pengeluaran";
    const category = input.category || "lain_lain";
    const amount = Number(input.amount) || 0;
    const description = input.description || "";
    const date = input.date && input.date.trim() !== "" 
      ? input.date 
      : new Date().toISOString().split("T")[0];

    await db
      .prepare(
        `UPDATE transactions
         SET type = ?, category = ?, amount = ?, description = ?, date = ?
         WHERE id = ?`
      )
      .bind(type, category, amount, description, date, id)
      .run();

    return jsonResponse({ message: "Berhasil diupdate" });
  }
}

// === 4. DELETE DATA (HAPUS) ===
async function handleDelete(context, db) {
  const { request, params } = context;
  const { resource, id } = parseRequestInfo(request, params);

  if (!id) {
    return jsonResponse(
      { error: "ID data harus disertakan untuk melakukan penghapusan" },
      400
    );
  }

  if (resource === "investment") {
    await db
      .prepare("DELETE FROM investment_history WHERE investment_id = ?")
      .bind(id)
      .run();
    await db.prepare("DELETE FROM investments WHERE id = ?").bind(id).run();

    return jsonResponse({ message: "Berhasil dihapus" });
  } else {
    await db.prepare("DELETE FROM transactions WHERE id = ?").bind(id).run();
    return jsonResponse({ message: "Berhasil dihapus" });
  }
}