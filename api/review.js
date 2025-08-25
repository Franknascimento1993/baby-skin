// api/review.js
const pathFile = 'data/reviews.json';
const GH = 'https://api.github.com';

function allowCors(req, res) {
  const { ALLOWED_ORIGINS } = process.env;
  const origin = req.headers.origin || '';
  const allow = ALLOWED_ORIGINS
    ? ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : [origin]; // fallback: ecoa origem

  if (origin && allow.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Pin');
}

async function ghGetFile(owner, repo, branch, token) {
  const url = `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(pathFile)}?ref=${branch}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'sdb-reviews' } });
  if (r.status === 404) return { exists: false, content: [], sha: null };
  if (!r.ok) throw new Error(`GH get error: ${r.status}`);
  const j = await r.json();
  const buf = Buffer.from(j.content || '', 'base64').toString('utf8');
  let content = [];
  try { content = JSON.parse(buf || '[]'); } catch { content = []; }
  return { exists: true, content, sha: j.sha };
}

async function ghPutFile(owner, repo, branch, token, contentArr, sha) {
  const url = `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(pathFile)}`;
  const body = {
    message: 'chore(reviews): update reviews.json',
    content: Buffer.from(JSON.stringify(contentArr, null, 2)).toString('base64'),
    branch,
    ...(sha ? { sha } : {})
  };
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'sdb-reviews', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`GH put error: ${r.status}`);
  return r.json();
}

module.exports = async (req, res) => {
  allowCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { GH_OWNER, GH_REPO, GH_BRANCH = 'main', GH_TOKEN, ADMIN_PIN = '4321' } = process.env;
  if (!GH_OWNER || !GH_REPO || !GH_TOKEN) {
    return res.status(500).json({ error: 'Variáveis de ambiente ausentes (GH_OWNER, GH_REPO, GH_TOKEN).' });
  }

  try {
    if (req.method === 'GET') {
      const status = (req.query.status || 'approved').toString();
      const { content } = await ghGetFile(GH_OWNER, GH_REPO, GH_BRANCH, GH_TOKEN);
      const out = status === 'pending' ? content.filter(x => !x.approved) : content.filter(x => x.approved);
      return res.json(out);
    }

    if (req.method === 'POST') {
      const { rating = 5, name = 'Cliente', comment = '', photos = [] } = req.body || {};
      if (!comment.trim()) return res.status(400).json({ error: 'Comentário é obrigatório.' });

      const { content, sha } = await ghGetFile(GH_OWNER, GH_REPO, GH_BRANCH, GH_TOKEN);
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        rating: Math.max(1, Math.min(5, Number(rating) || 5)),
        name: String(name).slice(0, 80),
        comment: String(comment).slice(0, 2000),
        photos: Array.isArray(photos) ? photos.slice(0, 3) : [],
        date: new Date().toISOString(),
        approved: false
      };
      const next = [...content, item];
      await ghPutFile(GH_OWNER, GH_REPO, GH_BRANCH, GH_TOKEN, next, sha);
      return res.json({ ok: true, id: item.id });
    }

    if (req.method === 'PATCH') {
      if (req.headers['x-admin-pin'] !== ADMIN_PIN) return res.status(401).json({ error: 'PIN inválido.' });
      const { action, id } = req.body || {};
      const { content, sha } = await ghGetFile(GH_OWNER, GH_REPO, GH_BRANCH, GH_TOKEN);
      const idx = content.findIndex(x => x.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Item não encontrado.' });

      if (action === 'approve') content[idx].approved = true;
      else if (action === 'unapprove') content[idx].approved = false;
      else if (action === 'delete') content.splice(idx, 1);
      else return res.status(400).json({ error: 'Ação inválida.' });

      await ghPutFile(GH_OWNER, GH_REPO, GH_BRANCH, GH_TOKEN, content, sha);
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Erro interno.' });
  }
};
