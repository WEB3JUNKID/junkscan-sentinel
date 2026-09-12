require('dotenv').config();
const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 
const CHAT_ID = process.env.CHAT_ID;
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT; // This is the big JSON string

// --- INITIALIZATION ---
const app = express();
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Init Firebase
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (e) {
    console.error("FIREBASE INIT ERROR: Check your Service Account JSON in Render Env Vars", e);
  }
}
const db = admin.firestore();

// Scan Settings
const CONFIG = {
  minTVL: 5000,
  maxTVL: 1500000,
  scanInterval: 5 * 60 * 1000 // 5 Minutes
};

// --- CORE LOGIC ---

async function runScan() {
  console.log(`[${new Date().toISOString()}] 👁️ SCANNING...`);
  
  try {
    // 1. Fetch from DefiLlama
    const response = await axios.get('https://api.llama.fi/protocols');
    const protocols = response.data;
    
    // 2. Filter (The "Sweet Spot")
    const candidates = protocols.filter(p => 
      p.tvl >= CONFIG.minTVL && 
      p.tvl <= CONFIG.maxTVL &&
      (Date.now()/1000 - p.listedAt) < (86400 * 30) // Listed in last 30 days
    );

    console.log(`Found ${candidates.length} candidates in range.`);

    // 3. Process each candidate
    for (const p of candidates) {
      await processSignal({
        id: p.name.replace(/\//g, '-'), // Sanitize ID
        tag: 'PROTO',
        source: 'DEFILLAMA',
        title: p.name,
        desc: `Chain: ${p.chain} • TVL: $${fmt(p.tvl)}`,
        link: p.url,
        timestamp: Date.now(), // Store as number for sorting
        query: p.name // For Arkham links
      });
    }

  } catch (error) {
    console.error('SCAN ERROR:', error.message);
  }
}

async function processSignal(signal) {
  const docRef = db.collection('signals').doc(signal.id);
  const doc = await docRef.get();

  // If already in DB, skip it.
  if (doc.exists) return;

  // --- NEW SIGNAL FOUND ---
  console.log(`🚨 NEW ALPHA: ${signal.title}`);

  // 1. Save to Database (So the Website sees it)
  await docRef.set(signal);

  // 2. Send Telegram Alert
  await sendTelegramAlert(signal);
}

async function sendTelegramAlert(s) {
  const q = encodeURIComponent(s.query);
  const msg = `🚨 <b>JUNKSCAN SIGNAL</b>\n` +
              `\n<b>${s.title}</b>` +
              `\nSource: ${s.source}` +
              `\n${s.desc}`;

  const opts = {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [ { text: "🔗 OPEN SOURCE", url: s.link } ],
        [
          { text: "🔎 ARKHAM", url: `https://platform.arkhamintelligence.com/explorer/search?q=${q}` },
          { text: "🫧 BUBBLES", url: `https://app.bubblemaps.io/eth/?q=${q}` }
        ],
        [
          { text: "📊 DEXSCR", url: `https://dexscreener.com/search?q=${q}` },
          { text: "🐦 TWITTER", url: `https://twitter.com/search?q=${q}` }
        ]
      ]
    }
  };

  try {
    await bot.sendMessage(CHAT_ID, msg, opts);
  } catch (e) {
    console.error("Telegram Error:", e.message);
  }
}

function fmt(n) {
  if (n > 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n > 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

// --- SERVER SETUP (For UptimeRobot) ---
app.get('/', (req, res) => res.send('SENTINEL ACTIVE 🟢'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  runScan(); // Run once immediately
  setInterval(runScan, CONFIG.scanInterval); // Loop
});
