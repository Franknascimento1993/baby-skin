// /api/review.js
// API de avaliações (Vercel, Node.js)

export default async function handler(req, res) {
  const {
    GH_OWNER,
    GH_REPO,
    GH_BRANCH = "main",
    GH_TOKEN,
    ADMIN_PIN = "4321",
    ALLOWED_ORIGINS = ""
  } = process.env;

  // --- CORS (origens permitidas) ---
  const origins = ALLOWED_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-admin-pin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  // --- Vars obrigatórias ---
  if (!GH_OWNER || !GH_REPO || !GH_TOKEN) {
    return res
      .status(500)
      .json({ error: "Variáveis de ambiente ausentes (GH_OWNER, GH_REPO, GH_TOKEN)." });
  }

  const PATH = "data/reviews.json";

  // ----- Helpers GitHub -----
  async function gh(path, init = {}) {
    const url = `https://api.github.com/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(GH_REPO)}/${path}`;
    const r = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${GH_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(init.headers || {})
      }
    });
    return r;
  }

  async function getFile() {
    const r = await gh(`contents/${encodeURIComponent(PATH)}?ref=${encodeURIComponent(GH_BRANCH)}`);
    if (r.status === 404) {
      // ainda não existe: começamos com array vazio
      return { sha: null, data: [] };
    }
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`GH get error: ${r.status} ${t}`);
    }
    const json = await r.json();
    const raw = Buffer.from(json.content || "", "base64").toString("utf8");
    let data = [];
    try { data = JSON.parse(raw || "[]"); } catch { data = []; }
    return { sha: json.sha, data };
  }

  async function putFile(contentStr, sha, message) {
    const body = {
      message,
      branch: GH_BRANCH,
      content: Buffer.from(contentStr).toString("base64"),
      committer: { name: "Reviews Bot", email: "bot@vercel.fn" },
      author: { name: "Reviews Bot", email: "bot@vercel.fn" }
    };
    if (sha) body.sha = sha; // obrigatório ao atualizar

    const r = await gh(`contents/${encodeURIComponent(PATH)}`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`GH put error: ${r.status} ${t}`);
    }
    return r.json();
  }

  // ----- Util -----
  const parseBody = () =>
    typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

  const isAdmin = () => (req.headers["x-admin-pin"] || "").toString() === ADMIN_PIN;

  // ----- Rotas -----
  try {
    // Diagnóstico opcional (pedir com header x-admin-pin)
    if (req.method === "GET" && req.query.diag === "1") {
      if (!isAdmin()) return res.status(401).json({ error: "PIN inválido." });
      try {
        const test = await getFile();
        return res.status(200).json({
          ok: true,
          branch: GH_BRANCH,
          hasSha: !!test.sha,
          count: (test.data || []).length
        });
      } catch (e) {
        return res.status(500).json({ error: String(e.message || e) });
      }
    }

    if (req.method === "GET") {
      const { status } = req.query;
      const { data } = await getFile();
      const list =
        status === "approved"
          ? data.filter(x => x.approved)
          : status === "pending"
          ? data.filter(x => !x.approved)
          : data;
      return res.status(200).json(list);
    }

    if (req.method === "POST") {
      const body = parseBody();
      const rating = Number(body.rating || 5);
      const name = (body.name || "").toString().slice(0, 80);
      const comment = (body.comment || "").toString().slice(0, 3000);
      const photos = Array.isArray(body.photos) ? body.photos.slice(0, 3) : [];

      if (!comment) return res.status(400).json({ error: "Comentário obrigatório." });

      const { sha, data } = await getFile();
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        rating: Math.min(5, Math.max(1, rating)),
        name: name || "Cliente",
        comment,
        photos,
        date: new Date().toISOString(),
        approved: false
      };
      data.push(item);
      await putFile(JSON.stringify(data, null, 2), sha, "chore(review): add new review");
      return res.status(201).json({ ok: true, id: item.id });
    }

    if (req.method === "PATCH") {
      if (!isAdmin()) return res.status(401).json({ error: "PIN inválido." });
      const body = parseBody();
      const { id, action } = body;
      if (!id || !action) return res.status(400).json({ error: "id e action são obrigatórios." });

      const { sha, data } = await getFile();
      const idx = data.findIndex(x => x.id === id);
      if (idx === -1) return res.status(404).json({ error: "Avaliação não encontrada." });

      if (action === "approve") data[idx].approved = true;
      else if (action === "unapprove") data[idx].approved = false;
      else if (action === "delete") data.splice(idx, 1);
      else return res.status(400).json({ error: "Ação inválida." });

      await putFile(JSON.stringify(data, null, 2), sha, `chore(review): ${action} ${id}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Método não permitido." });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
