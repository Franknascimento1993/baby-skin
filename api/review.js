// /api/review.js
/**
 * API de avaliações para Vercel (Node.js)
 * - Armazena em Franknascimento1993/baby-skin, arquivo data/reviews.json
 * - GET   /api/review?status=approved|pending
 * - POST  /api/review
 * - PATCH /api/review   (admin)  body: { action: 'approve'|'unapprove'|'delete', id }
 *   -> header: X-Admin-Pin: <ADMIN_PIN>
 *
 * Env obrigatórios na Vercel:
 *   GH_OWNER=Franknascimento1993
 *   GH_REPO=baby-skin
 *   GH_BRANCH=main            (ou o branch que você usa no deploy)
 *   GH_TOKEN=<token com repo scope>
 *   ADMIN_PIN=4321            (igual ao que está no index.html, ou altere lá também)
 *   ALLOWED_ORIGINS=https://sonodabelezaoficial.com,https://<seu-projeto>.vercel.app,http://localhost:3000
 */

const PATH = 'data/reviews.json';
const GH = {
  owner: process.env.GH_OWNER,
  repo: process.env.GH_REPO,
  branch: process.env.GH_BRANCH || 'main',
  token: process.env.GH_TOKEN,
};
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const GH_HEADERS = {
  Authorization: `Bearer ${GH.token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

// ---------- Helpers ----------
function setCORS(req, res) {
  const origin = req.headers.origin || '';
  let allowOrigin = '*';

  if (ALLOWED.length && origin) {
    if (ALLOWED.includes('*') || ALLOWED.includes(origin)) {
      allowOrigin = origin;
    } else {
      try {
        // libera *.vercel.app por padrão, se o projeto estiver nesse domínio
        const host = new URL(origin).hostname;
        if (host.endsWith('.vercel.app')) allowOrigin = origin;
      } catch (_) {}
    }
  } else if (origin) {
    // se não configurou ALLOWED_ORIGINS, reflete a origem que chamou
    allowOrigin = origin;
  }

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Pin');
}

function badEnv(res) {
  if (!GH.owner || !GH.repo || !GH.token) {
    res.status(500).json({ error: 'Variáveis de ambiente ausentes (GH_OWNER, GH_REPO, GH_TOKEN).' });
    return true;
  }
  return false;
}

function ok(res, data) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(data);
}

function b64Encode(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}
function b64Decode(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

async function ghGetFile() {
  const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${encodeURIComponent(PATH)}?ref=${encodeURIComponent(GH.branch)}`;
  const r = await fetch(url, { headers: GH_HEADERS });
  if (r.status === 404) return { exists: false };
  if (!r.ok) throw new Error(`GitHub GET ${r.status}`);
  const j = await r.json();
  return {
    exists: true,
    sha: j.sha,
    content: j.content ? JSON.parse(b64Decode(j.content)) : null
  };
}

async function ghPutFile({ content, sha, message }) {
  const url = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${encodeURIComponent(PATH)}`;
  const body = {
    message,
    content: b64Encode(JSON.stringify(content, null, 2)),
    branch: GH.branch
  };
  if (sha) body.sha = sha;

  const r = await fetch(url, {
    method: 'PUT',
    headers: { ...GH_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const t = await r.text().catch(()=> '');
    const err = new Error(`GitHub PUT ${r.status} ${t}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function newDB() {
  return { approved: [], pending: [] };
}

function sanitizeStr(v, max = 800) {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeReview(input) {
  const rating = Math.max(1, Math.min(5, Number(input.rating || 5)));
  const name = sanitizeStr(input.name || '', 60);
  const comment = sanitizeStr(input.comment || '', 1200);

  // Fotos (até 3), apenas dataURL jpeg/png, tamanho base64 razoável
  const MAX_B64_LEN = 600_000; // ~450KB binário
  let photos = Array.isArray(input.photos) ? input.photos : [];
  photos = photos
    .filter(s => typeof s === 'string' && /^data:image\/(png|jpe?g);base64,/i.test(s))
    .slice(0, 3)
    .map(s => s.slice(0, MAX_B64_LEN)); // corta se exceder

  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    rating,
    name,
    comment,
    photos,
    date: new Date().toISOString(),
    approved: false
  };
}

function mustBeAdmin(req) {
  const pin = req.headers['x-admin-pin'] || req.headers['X-Admin-Pin'] || '';
  return String(pin) === String(ADMIN_PIN);
}

// ---------- Handler ----------
export default async function handler(req, res) {
  setCORS(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (badEnv(res)) return;

  try {
    // Carrega (ou cria) o arquivo de reviews
    let { exists, sha, content } = await ghGetFile();
    if (!exists) {
      content = newDB();
      // cria arquivo vazio no repo
      await ghPutFile({
        content,
        message: 'chore(reviews): init reviews.json'
      });
      // refetch para pegar o sha atual
      const ref = await ghGetFile();
      exists = ref.exists;
      sha = ref.sha;
      content = ref.content || content;
    } else if (!content || typeof content !== 'object') {
      content = newDB();
    }

    // Normaliza estrutura
    content.approved = Array.isArray(content.approved) ? content.approved : [];
    content.pending  = Array.isArray(content.pending)  ? content.pending  : [];

    // ------- GET: listar -------
    if (req.method === 'GET') {
      const status = (req.query.status || 'approved').toString().toLowerCase();
      if (status === 'pending') return ok(res, content.pending);
      return ok(res, content.approved);
    }

    // ------- POST: criar (vai para pending) -------
    if (req.method === 'POST') {
      let body = {};
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
      const review = sanitizeReview(body);
      if (!review.comment) return res.status(400).json({ error: 'Comentário obrigatório.' });

      // Insere no pending
      const db1 = {
        approved: content.approved,
        pending: [...content.pending, review]
      };

      // Tenta salvar; se conflito, refaz merge 1x
      try {
        await ghPutFile({
          content: db1,
          sha,
          message: `chore(reviews): new pending review ${review.id}`
        });
      } catch (err) {
        if (err.status === 409 || err.status === 422) {
          const fresh = await ghGetFile();
          const db2 = fresh.content || newDB();
          db2.pending = Array.isArray(db2.pending) ? [...db2.pending, review] : [review];
          await ghPutFile({
            content: db2,
            sha: fresh.sha,
            message: `chore(reviews): new pending review ${review.id} (retry)`
          });
        } else {
          throw err;
        }
      }

      return ok(res, { ok: true, id: review.id });
    }

    // ------- PATCH: ações admin -------
    if (req.method === 'PATCH') {
      if (!mustBeAdmin(req)) {
        return res.status(401).json({ error: 'Não autorizado (admin).' });
      }

      let body = {};
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
      const { action, id } = body || {};
      if (!id || !action) return res.status(400).json({ error: 'action e id são obrigatórios.' });

      let db = { approved: [...content.approved], pending: [...content.pending] };

      const fromPendingIdx = db.pending.findIndex(x => x.id === id);
      const fromApprovedIdx = db.approved.findIndex(x => x.id === id);

      if (action === 'approve') {
        if (fromPendingIdx >= 0) {
          const [item] = db.pending.splice(fromPendingIdx, 1);
          item.approved = true;
          db.approved.push(item);
        }
      } else if (action === 'unapprove') {
        if (fromApprovedIdx >= 0) {
          const [item] = db.approved.splice(fromApprovedIdx, 1);
          item.approved = false;
          db.pending.push(item);
        }
      } else if (action === 'delete') {
        if (fromPendingIdx >= 0) db.pending.splice(fromPendingIdx, 1);
        if (fromApprovedIdx >= 0) db.approved.splice(fromApprovedIdx, 1);
      } else {
        return res.status(400).json({ error: 'action inválida.' });
      }

      // Commit
      try {
        await ghPutFile({
          content: db,
          sha,
          message: `chore(reviews): ${action} ${id}`
        });
      } catch (err) {
        if (err.status === 409 || err.status === 422) {
          const fresh = await ghGetFile();
          // re-aplica a mudança sobre a versão mais nova
          const newer = {
            approved: Array.isArray(fresh.content?.approved) ? [...fresh.content.approved] : [],
            pending:  Array.isArray(fresh.content?.pending)  ? [...fresh.content.pending]  : []
          };
          const pIdx = newer.pending.findIndex(x => x.id === id);
          const aIdx = newer.approved.findIndex(x => x.id === id);

          if (action === 'approve' && pIdx >= 0) {
            const [item] = newer.pending.splice(pIdx, 1);
            item.approved = true;
            newer.approved.push(item);
          } else if (action === 'unapprove' && aIdx >= 0) {
            const [item] = newer.approved.splice(aIdx, 1);
            item.approved = false;
            newer.pending.push(item);
          } else if (action === 'delete') {
            if (pIdx >= 0) newer.pending.splice(pIdx, 1);
            if (aIdx >= 0) newer.approved.splice(aIdx, 1);
          }

          await ghPutFile({
            content: newer,
            sha: fresh.sha,
            message: `chore(reviews): ${action} ${id} (retry)`
          });
        } else {
          throw err;
        }
      }

      return ok(res, { ok: true });
    }

    // Método não permitido
    res.setHeader('Allow', 'GET,POST,PATCH,OPTIONS');
    return res.status(405).json({ error: 'Método não permitido.' });

  } catch (err) {
    const msg = (err && err.message) ? err.message.slice(0, 300) : 'Erro inesperado';
    return res.status(500).json({ error: msg });
  }
}
