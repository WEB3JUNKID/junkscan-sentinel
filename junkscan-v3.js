require('dotenv').config();
const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;
const ROOTDATA_KEY = process.env.ROOTDATA_KEY;           // optional
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN; // optional
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;           // optional — 60/hr unauth, 5000/hr with token

const app = express();
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
const ghHeaders = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (e) {
    console.error('FIREBASE INIT ERROR:', e.message);
  }
}
const db = admin.firestore();

const CONFIG = {
  scanInterval: 10 * 60 * 1000,      // widened slightly — GitHub/job scans are heavier than raises polling
  alertThreshold: 35,
  maxFollowersForOpportunity: 5000,
  legacyTVL: { min: 5000, max: 1500000 },
  ghLookbackDays: 14,                 // new repos created in this window
  ghMinWeeklyCommits: 15,             // velocity floor to count as "ramping up"
  jobKeywords: ['growth', 'community', 'marketing', 'bd', 'business development', 'partnerships'],
  jobCryptoTags: ['crypto', 'web3', 'defi', 'blockchain']
};

// ---------- FUNDED SIGNALS (public, everyone sees these) ----------

async function fetchLlamaRaises() {
  const { data } = await axios.get('https://api.llama.fi/raises');
  return (data?.raises || []).map(r => ({
    id: `raise-llama-${r.name}-${r.date}`.replace(/[/\s]/g, '-'),
    tag: 'RAISE', source: 'DEFILLAMA', title: r.name,
    amount: r.amount ? r.amount * 1_000_000 : null,
    investors: [...(r.leadInvestors || []), ...(r.otherInvestors || [])].join(', '),
    date: r.date * 1000, twitter: r.twitter || null,
    link: r.source || 'https://defillama.com/raises', meta: null
  }));
}

async function fetchRootDataRaises() {
  if (!ROOTDATA_KEY) return [];
  const response = await axios.get('https://api.rootdata.com/open/fundraising', {
    headers: { 'X-API-KEY': ROOTDATA_KEY }
  });
  const list = response.data?.data || [];
  return list.map(item => ({
    id: `raise-rootdata-${item.project_name}-${item.date}`.replace(/[/\s]/g, '-'),
    tag: 'RAISE', source: 'ROOTDATA', title: item.project_name,
    amount: item.amount || null, investors: item.investors || 'N/A',
    date: new Date(item.date).getTime(), twitter: item.twitter || null,
    link: `https://www.rootdata.com/Projects/detail/${item.project_name}`, meta: null
  }));
}

async function fetchLlamaProtocols() {
  const { data } = await axios.get('https://api.llama.fi/protocols');
  return data
    .filter(p => p.tvl >= CONFIG.legacyTVL.min && p.tvl <= CONFIG.legacyTVL.max &&
      (Date.now() / 1000 - p.listedAt) < 86400 * 30)
    .map(p => ({
      id: `proto-${p.name}`.replace(/[/\s]/g, '-'),
      tag: 'PROTO', source: 'DEFILLAMA', title: p.name,
      amount: null, investors: null, date: Date.now(),
      twitter: p.twitter || null, link: p.url, meta: null
    }));
}

// ---------- PRE-RAISE SIGNALS (before it's public — this is the edge) ----------
// The goal: reach a team before they've announced funding, before 40 other agencies
// see the same DeFiLlama alert you do and flood their DMs.

async function fetchGithubVelocitySignals() {
  const since = new Date(Date.now() - CONFIG.ghLookbackDays * 86400000).toISOString().split('T')[0];
  const query = `(topic:web3 OR topic:defi OR topic:blockchain) created:>${since}`;
  let results;
  try {
    const { data } = await axios.get('https://api.github.com/search/repositories', {
      params: { q: query, sort: 'updated', order: 'desc', per_page: 25 },
      headers: ghHeaders
    });
    results = data.items || [];
  } catch (e) {
    console.error('GitHub search failed:', e.message);
    return [];
  }

  const signals = [];
  for (const repo of results) {
    try {
      const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
      const commits = await axios.get(`https://api.github.com/repos/${repo.full_name}/commits`, {
        params: { since: since7d, per_page: 100 },
        headers: ghHeaders
      });
      const commitCount = commits.data.length;
      if (commitCount >= CONFIG.ghMinWeeklyCommits) {
        signals.push({
          id: `gh-${repo.full_name}`.replace(/[/\s]/g, '-'),
          tag: 'PRERAISE-GH', source: 'GITHUB', title: repo.owner.login,
          amount: null, investors: null, date: new Date(repo.created_at).getTime(),
          twitter: null, link: repo.html_url,
          meta: `${commitCount} commits in 7d — new repo, high velocity`
        });
      }
    } catch {
      // private stats or rate-limited — skip quietly, don't kill the batch
    }
  }
  return signals;
}

async function fetchJobSignals() {
  let data;
  try {
    const response = await axios.get('https://remoteok.com/api');
    data = response.data;
  } catch (e) {
    console.error('RemoteOK fetch failed:', e.message);
    return [];
  }

  return (Array.isArray(data) ? data : [])
    .filter(job => job.position && job.company && job.tags)
    .filter(job => {
      const tags = (job.tags || []).map(t => String(t).toLowerCase());
      const isCrypto = tags.some(t => CONFIG.jobCryptoTags.includes(t));
      const isGrowthRole = CONFIG.jobKeywords.some(k => job.position.toLowerCase().includes(k));
      return isCrypto && isGrowthRole;
    })
    .map(job => ({
      id: `job-${job.id}`, tag: 'PRERAISE-JOB', source: 'REMOTEOK',
      title: job.company, amount: null, investors: null,
      date: job.date ? new Date(job.date).getTime() : Date.now(),
      twitter: null, link: job.url,
      meta: `Hiring: ${job.position}`
    }));
}

// ---------- ENRICHMENT ----------

async function getFollowerCount(handle) {
  if (!TWITTER_BEARER || !handle) return null;
  try {
    const clean = handle.replace('@', '').split('/').pop();
    const { data } = await axios.get(
      `https://api.twitter.com/2/users/by/username/${clean}?user.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${TWITTER_BEARER}` } }
    );
    return data?.data?.public_metrics?.followers_count ?? null;
  } catch {
    return null;
  }
}

// ---------- SCORING ----------

function scoreSignal(s, followers, confirmed) {
  let score = 0;
  const daysOld = (Date.now() - s.date) / 86400000;

  if (s.tag === 'RAISE') {
    score += Math.max(0, 30 - daysOld * 10); // decays fast — everyone else sees this too
    if (s.amount) score += Math.min(30, s.amount / 200000);
  }

  if (s.tag === 'PRERAISE-GH') score += 20;   // shipping fast, pre-announcement
  if (s.tag === 'PRERAISE-JOB') score += 15;  // actively scaling comms/BD function
  if (confirmed) score += 25;                 // same org hit BOTH github + job feeds — strong signal

  if (followers !== null) {
    if (followers < CONFIG.maxFollowersForOpportunity) score += 25;
    else if (followers < CONFIG.maxFollowersForOpportunity * 3) score += 10;
  } else if (s.tag === 'RAISE') {
    score += 8; // unknown footprint on a funded project — still worth a manual look
  }

  return Math.round(score);
}

function suggestFit(s, followers, confirmed) {
  if (s.tag.startsWith('PRERAISE')) {
    return confirmed ? 'EARLY OUTREACH NOW (low competition)' : 'WATCHLIST';
  }
  if (s.tag === 'RAISE' && (followers === null || followers < 3000)) return 'AGENCY (awareness)';
  if (s.tag === 'PROTO') return 'IDOLO (credibility)';
  return 'REVIEW MANUALLY';
}

// ---------- PIPELINE ----------

async function processSignal(raw, confirmed) {
  const docRef = db.collection('signals').doc(raw.id);
  const doc = await docRef.get();
  if (doc.exists) return;

  const followers = await getFollowerCount(raw.twitter);
  const score = scoreSignal(raw, followers, confirmed);
  const fit = suggestFit(raw, followers, confirmed);
  const signal = { ...raw, followers, score, fit, createdAt: Date.now() };

  await docRef.set(signal);
  console.log(`🚨 ${signal.title} [${signal.tag}] — score ${score} — ${fit}`);

  if (score >= CONFIG.alertThreshold) await sendTelegramAlert(signal);
}

async function sendTelegramAlert(s) {
  const q = encodeURIComponent(s.title);
  const msg = `🚨 <b>JUNKSCAN — SCORE ${s.score}</b>\n` +
    `\n<b>${s.title}</b>` +
    `\n${s.tag} • ${s.source}` +
    (s.amount ? `\nRaised: $${fmt(s.amount)}` : '') +
    (s.investors ? `\nInvestors: ${s.investors}` : '') +
    (s.meta ? `\n${s.meta}` : '') +
    `\nTwitter followers: ${s.followers !== null ? s.followers : 'unknown'}` +
    `\nSuggested fit: <b>${s.fit}</b>`;

  const rows = [[{ text: '🔗 SOURCE', url: s.link }]];
  if (s.twitter) rows.push([{ text: '🐦 TWITTER', url: `https://twitter.com/${s.twitter.replace('@', '')}` }]);
  rows.push([
    { text: '🔎 ARKHAM', url: `https://platform.arkhamintelligence.com/explorer/search?q=${q}` },
    { text: '📊 DEXSCR', url: `https://dexscreener.com/search?q=${q}` }
  ]);

  try {
    await bot.sendMessage(CHAT_ID, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
  } catch (e) {
    console.error('Telegram Error:', e.message);
  }
}

function fmt(n) {
  if (n > 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n > 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

// normalize a name for cross-source matching (case/whitespace/punctuation insensitive)
function norm(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---------- SCAN LOOP ----------

async function runScan() {
  console.log(`[${new Date().toISOString()}] SCANNING...`);

  const [raisesLlama, raisesRoot, protocols, ghSignals, jobSignals] = await Promise.all([
    fetchLlamaRaises().catch(e => { console.error('LlamaRaises failed:', e.message); return []; }),
    fetchRootDataRaises().catch(e => { console.error('RootData failed:', e.message); return []; }),
    fetchLlamaProtocols().catch(e => { console.error('LlamaProtocols failed:', e.message); return []; }),
    fetchGithubVelocitySignals().catch(e => { console.error('GitHub failed:', e.message); return []; }),
    fetchJobSignals().catch(e => { console.error('Jobs failed:', e.message); return []; })
  ]);

  // cross-reference: same org shipping code AND hiring growth/BD = strongest pre-raise tell
  const jobOrgs = new Set(jobSignals.map(j => norm(j.title)));
  const ghOrgs = new Set(ghSignals.map(g => norm(g.title)));

  const allSignals = [
    ...raisesLlama, ...raisesRoot, ...protocols,
    ...ghSignals.map(g => ({ ...g, confirmed: jobOrgs.has(norm(g.title)) })),
    ...jobSignals.map(j => ({ ...j, confirmed: ghOrgs.has(norm(j.title)) }))
  ];

  for (const s of allSignals) {
    try {
      await processSignal(s, s.confirmed || false);
    } catch (e) {
      console.error(`Signal failed [${s.title}]:`, e.message);
    }
  }
}

app.get('/', (req, res) => res.send('SENTINEL ACTIVE 🟢'));
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  runScan();
  setInterval(runScan, CONFIG.scanInterval);
});
