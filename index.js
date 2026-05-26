const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ComponentType, AttachmentBuilder, PermissionFlagsBits
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const Database = require('better-sqlite3');
const path = require('path');

const TOKEN     = '';
const CLIENT_ID = '';

const DAILY_AMOUNT   = 100;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// ═══════════════════════════════════════════════════════════════════
//  SQLite Installation
// ═══════════════════════════════════════════════════════════════════
const db = new Database(path.join(__dirname, 'blackjack.db'));

// WAL Mode: Faster Writes, Reduced Disk I/O
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS balances (
    userId  TEXT PRIMARY KEY,
    amount  INTEGER NOT NULL DEFAULT 500
  );

  CREATE TABLE IF NOT EXISTS daily (
    userId    TEXT PRIMARY KEY,
    lastClaim INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS stats (
    userId     TEXT PRIMARY KEY,
    wins       INTEGER NOT NULL DEFAULT 0,
    losses     INTEGER NOT NULL DEFAULT 0,
    pushes     INTEGER NOT NULL DEFAULT 0,
    blackjacks INTEGER NOT NULL DEFAULT 0,
    games      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS languages (
    userId TEXT PRIMARY KEY,
    lang   TEXT NOT NULL DEFAULT 'en'
  );

  CREATE TABLE IF NOT EXISTS server_languages (
    guildId TEXT PRIMARY KEY,
    lang    TEXT NOT NULL DEFAULT 'en'
  );
`);

// Prepared Statements (for Better Performance)
const stmts = {
  getBalance:    db.prepare('SELECT amount FROM balances WHERE userId = ?'),
  setBalance:    db.prepare('INSERT INTO balances (userId, amount) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET amount = excluded.amount'),
  getDaily:      db.prepare('SELECT lastClaim FROM daily WHERE userId = ?'),
  setDaily:      db.prepare('INSERT INTO daily (userId, lastClaim) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET lastClaim = excluded.lastClaim'),
  getStats:      db.prepare('SELECT * FROM stats WHERE userId = ?'),
  initStats:     db.prepare('INSERT OR IGNORE INTO stats (userId) VALUES (?)'),
  addWin:        db.prepare('UPDATE stats SET games = games+1, wins = wins+1 WHERE userId = ?'),
  addWinBJ:      db.prepare('UPDATE stats SET games = games+1, wins = wins+1, blackjacks = blackjacks+1 WHERE userId = ?'),
  addLoss:       db.prepare('UPDATE stats SET games = games+1, losses = losses+1 WHERE userId = ?'),
  addPush:       db.prepare('UPDATE stats SET games = games+1, pushes = pushes+1 WHERE userId = ?'),
  getUserLang:   db.prepare('SELECT lang FROM languages WHERE userId = ?'),
  setUserLang:   db.prepare('INSERT INTO languages (userId, lang) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET lang = excluded.lang'),
  getServerLang: db.prepare('SELECT lang FROM server_languages WHERE guildId = ?'),
  setServerLang: db.prepare('INSERT INTO server_languages (guildId, lang) VALUES (?, ?) ON CONFLICT(guildId) DO UPDATE SET lang = excluded.lang'),
  leaderboard:   db.prepare('SELECT userId, amount FROM balances ORDER BY amount DESC LIMIT ?'),
};

// ═══════════════════════════════════════════════════════════════════
//  Data Functions
// ═══════════════════════════════════════════════════════════════════

// BALANCE
const STARTING_BALANCE = 500;

function getBalance(userId) {
  const row = stmts.getBalance.get(userId);
  if (!row) {
    stmts.setBalance.run(userId, STARTING_BALANCE);
    return STARTING_BALANCE;
  }
  return row.amount;
}

function setBalance(userId, amount) {
  const val = Math.max(0, amount);
  stmts.setBalance.run(userId, val);
  return val;
}

function changeBalance(userId, delta) {
  return setBalance(userId, getBalance(userId) + delta);
}

function getLeaderboard(n = 10) {
  return stmts.leaderboard.all(n).map(r => [r.userId, r.amount]);
}

// DAILY
function formatCooldown(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function claimDaily(userId) {
  const row  = stmts.getDaily.get(userId);
  const now  = Date.now();
  const last = row?.lastClaim || 0;
  const diff = now - last;
  if (diff < DAILY_COOLDOWN) return { success: false, remaining: DAILY_COOLDOWN - diff };
  stmts.setDaily.run(userId, now);
  return { success: true, amount: DAILY_AMOUNT, balance: changeBalance(userId, DAILY_AMOUNT) };
}

// STATS
function getStats(userId) {
  stmts.initStats.run(userId);
  const row = stmts.getStats.get(userId);
  return row || { wins: 0, losses: 0, pushes: 0, blackjacks: 0, games: 0 };
}

function recordResult(userId, result) {
  stmts.initStats.run(userId);
  if (result === 'blackjack') stmts.addWinBJ.run(userId);
  else if (result === 'won')  stmts.addWin.run(userId);
  else if (result === 'push') stmts.addPush.run(userId);
  else                        stmts.addLoss.run(userId);
}

// LANGUAGE
function getLang(userId, guildId) {
  const userRow = stmts.getUserLang.get(userId);
  if (userRow) return userRow.lang;
  if (guildId) {
    const serverRow = stmts.getServerLang.get(guildId);
    if (serverRow) return serverRow.lang;
  }
  return 'en';
}

// ═══════════════════════════════════════════════════════════════════
//  Language System
// ═══════════════════════════════════════════════════════════════════
const STRINGS = {
  en: {
    bjTitle:           '🃏 BlackJack',
    dealer:            'DEALER',
    you:               'YOU',
    hand:              'HAND',
    total:             'Total',
    bust:              'BUST!',
    blackjack:         'BLACKJACK!',
    bet:               'BET',
    balance:           'BALANCE',
    hitBtn:            '🃏 HIT',
    standBtn:          '✋ STAND',
    doubleBtn:         '💰 DOUBLE',
    splitBtn:          '✂️ SPLIT',
    newBetBtn:         '🔄 New Bet',
    sameBetBtn:        '♻️ Same Bet Again',
    selectBet:         '💰 **Select your bet** (Balance: ₺{bal})',
    dealing:           '♠️ Dealing with ₺{bet}...',
    insufficientBal:   '❌ Insufficient balance! Your balance: ₺{bal}',
    noBalance:         '❌ You have no balance left!',
    noDouble:          '❌ Not enough balance to double!',
    noSplit:           '❌ Not enough balance to split!',
    timeout:           '⏰ Time is up!',
    footerLock:        'Only you can see this 🔒 • Balance: ₺{bal}',
    dealerLine:        '**Dealer:** {show}\n**Your hand:** {hand} = **{total}**\nBet: ₺{bet}{doubled}',
    dealerLineSplit:   '**Dealer:** {show}\n**Hand 1 {active1}:** {hand1} = **{total1}**{dbld1}\n**Hand 2 {active2}:** {hand2} = **{total2}**{dbld2}\nBet: ₺{bet} each',
    resultLine:        '**{result}**\nYou: **{pt}** • Dealer: **{dt}**\nPayout: **{pay}** • New balance: **₺{bal}**',
    resultLineSplit:   '**Hand 1:** {r1} (You: {p1} • Dealer: {dt}) → {pay1}\n**Hand 2:** {r2} (You: {p2} • Dealer: {dt}) → {pay2}\nTotal payout: **{totalPay}** • New balance: **₺{bal}**',
    resultBJ:          '🎰 BLACKJACK! Congratulations!',
    resultWon:         '✅ YOU WIN!',
    resultLost:        '❌ YOU LOST!',
    resultBust:        '💥 BUST! Exceeded 21!',
    resultPush:        '🤝 PUSH!',
    splitPlaying1:     '▶ Playing Hand 1...',
    splitPlaying2:     '▶ Playing Hand 2...',
    balTitle:          '💰 Your Balance',
    balDesc:           '{user}, your balance: **₺{bal}**',
    balFooterEmpty:    'No balance! Ask an admin.',
    balFooterPlay:     '/bj <bet> to play',
    rulesTitle:        '🃏 BlackJack Rules',
    rulesGoal:         'Get as close to 21 as possible without going over, beating the dealer.',
    rulesCards:        '2–10 → Face value\nJ, Q, K → 10 pts\nA → 1 or 11 (whichever is better)',
    rulesActions:      '**HIT** — Draw a card\n**STAND** — Keep your hand\n**DOUBLE** — Double bet, draw one card\n**SPLIT** — Split a pair into two hands (equal bet required)',
    rulesDealer:       'Dealer stands at 17, draws on 16 or below.',
    rulesPayout:       'Win → 1:1\nBlackJack → 3:2\nPush → Bet returned',
    rulesBust:         'Going over 21 is always a BUST — instant loss, no push possible.',
    rulesPush:         'Equal totals (no bust) → Push. If dealer busts, all non-bust players win.',
    rulesSplit:        'Split pairs into 2 hands. Each hand plays independently. Blackjack after split pays 1:1.',
    rulesFooter:       '/bj <bet> to play • Only you can see this 🔒',
    langChanged:       '✅ Your language set to **English**.',
    serverLangChanged: '✅ Server language set to **{lang}**.',
    doubled:           ' × 2 (doubled)',
    lbTitle:           '🏆 Chip Leaderboard',
    lbDesc:            'Top {n} richest players on the server!',
    lbFooter:          'Updated live • /bjchipleader',
    lbEmpty:           'No players yet! Be the first with /bj',
    dailyTitle:        '🎁 Daily Reward',
    dailyClaimed:      '✅ You claimed your **₺{amount}** daily reward!\nNew balance: **₺{bal}**',
    dailyCooldown:     '⏳ You already claimed today!\nNext reward in: **{time}**',
    dailyFooter:       'Come back every 24 hours!',
    adminOnly:         '❌ You need **Manage Server** permission for this command.',
    statsTitle:        '📊 Your Stats',
    statsDesc:         '{user} — Game Statistics',
    statsWins:         'Wins',
    statsLosses:       'Losses',
    statsPushes:       'Pushes',
    statsBJs:          'Blackjacks',
    statsWinRate:      'Win Rate',
    statsFooter:       'BlackJack',
    helpTitle:         '📖 BlackJack — Commands',
    helpFooter:        'BlackJack • /bj to play',
    helpDesc:          'All available commands:',
    multiTitle:        '🃏 BlackJack Multiplayer',
    multiLobbyOpen:    '🎰 **Open Multiplayer Lobby!**\nPress **Join** to sit down (max {max} players).\nGame starts in **{sec} seconds** or when host presses Start.',
    multiLobbyInvite:  '🎰 **{host} invited {target} to BlackJack!**\nPress **Join** to accept.\nGame starts in **{sec} seconds** or when host presses Start.',
    multiJoinBtn:      '✅ Join',
    multiStartBtn:     '▶️ Start Game',
    multiPlayers:      'Players',
    multiRound:        'Round {n}',
    multiSelectBet:    '💰 Select your bet for this round (Balance: ₺{bal})',
    multiResult:       '**{user}** → {result} (₺{pay})',
    multiRoundSummary: '📋 Round {n} Summary',
    multiGameOver:     '🏆 Game Over!',
    multiWinner:       '🥇 Winner: **{user}** with **₺{bal}**',
    multiNoPlayers:    '❌ Not enough players to start!',
    multiAlreadyIn:    '❌ You are already in this lobby!',
    multiNotEnough:    '❌ Need at least 2 players to start!',
    multiLobbyFull:    '❌ Lobby is full!',
    multiYourTurn:     '🎯 **{user}**, it\'s your turn!',
    multiDealerResult: '🏦 Dealer: **{total}**{bust}',
    multiBetPrompt:    '💰 **{user}**, select your bet! (Balance: ₺{bal})',
  },
  tr: {
    bjTitle:           '🃏 BlackJack',
    dealer:            'KURPİYER',
    you:               'SEN',
    hand:              'EL',
    total:             'Toplam',
    bust:              'BUST!',
    blackjack:         'BLACKJACK!',
    bet:               'BAHİS',
    balance:           'BAKİYE',
    hitBtn:            '🃏 HIT — Kart Çek',
    standBtn:          '✋ STAND — Dur',
    doubleBtn:         '💰 DOUBLE — İkiye Katla',
    splitBtn:          '✂️ SPLIT — Böl',
    newBetBtn:         '🔄 Yeni Bahis Seç',
    sameBetBtn:        '♻️ Aynı Bahisle Tekrar',
    selectBet:         '💰 **Bahis seç** (Bakiye: ₺{bal})',
    dealing:           '♠️ ₺{bet} bahisle yeni el dağıtılıyor...',
    insufficientBal:   '❌ Yetersiz bakiye! Bakiyen: ₺{bal}',
    noBalance:         '❌ Bakiyen kalmadı!',
    noDouble:          '❌ Double için yeterin yok!',
    noSplit:           '❌ Split için yeterin yok!',
    timeout:           '⏰ Süre doldu!',
    footerLock:        'Bu masa sadece sana görünür 🔒 • Bakiye: ₺{bal}',
    dealerLine:        '**Kurpiyer:** {show}\n**Senin elin:** {hand} = **{total}**\nBahis: ₺{bet}{doubled}',
    dealerLineSplit:   '**Kurpiyer:** {show}\n**El 1 {active1}:** {hand1} = **{total1}**{dbld1}\n**El 2 {active2}:** {hand2} = **{total2}**{dbld2}\nBahis: ₺{bet} her el',
    resultLine:        '**{result}**\nSen: **{pt}** • Kurpiyer: **{dt}**\nKazanç: **{pay}** • Yeni bakiye: **₺{bal}**',
    resultLineSplit:   '**El 1:** {r1} (Sen: {p1} • Kurpiyer: {dt}) → {pay1}\n**El 2:** {r2} (Sen: {p2} • Kurpiyer: {dt}) → {pay2}\nToplam kazanç: **{totalPay}** • Yeni bakiye: **₺{bal}**',
    resultBJ:          '🎰 BLACKJACK! Tebrikler!',
    resultWon:         '✅ KAZANDIN!',
    resultLost:        '❌ KAYBETTİN!',
    resultBust:        "💥 BUST! 21'i geçtin!",
    resultPush:        '🤝 BERABERE!',
    splitPlaying1:     '▶ El 1 oynanıyor...',
    splitPlaying2:     '▶ El 2 oynanıyor...',
    balTitle:          '💰 Bakiyen',
    balDesc:           '{user}, bakiyen: **₺{bal}**',
    balFooterEmpty:    'Bakiyen bitti! Yöneticiden bakiye iste.',
    balFooterPlay:     '/bj <bahis> ile oyna',
    rulesTitle:        '🃏 BlackJack Kuralları',
    rulesGoal:         "Kurpiyeri geçmeden 21'e en yakın eli toplamak.",
    rulesCards:        '2–10 → Yüz değeri\nJ, Q, K → 10 puan\nA → 1 veya 11 (sana en iyi olan)',
    rulesActions:      '**HIT** — Bir kart daha çek\n**STAND** — El dursun\n**DOUBLE** — Bahsi ikiye katla, tek kart\n**SPLIT** — Çift kartı iki ele böl (aynı bahis gerekli)',
    rulesDealer:       "Kurpiyer 17'de durur, 16 ve altında kart çeker.",
    rulesPayout:       'Kazanç → 1:1\nBlackJack → 3:2\nBerabere → Bahis geri alınır',
    rulesBust:         "21'i geçmek her zaman BUST'tır — anında yenilgi, berabere mümkün değil.",
    rulesPush:         'Eşit toplam (bust olmadan) → Berabere. Kurpiyer bust olursa, bust olmayan tüm oyuncular kazanır.',
    rulesSplit:        'Çift kartları 2 ele böl. Her el bağımsız oynanır. Split sonrası Blackjack 1:1 öder.',
    rulesFooter:       '/bj <bahis> ile oyna • Sadece sen görebilirsin 🔒',
    langChanged:       '✅ Dilin **Türkçe** olarak ayarlandı.',
    serverLangChanged: '✅ Sunucu dili **{lang}** olarak ayarlandı.',
    doubled:           ' × 2 (doubled)',
    lbTitle:           '🏆 Chip Sıralaması',
    lbDesc:            'Sunucunun en zengin {n} oyuncusu!',
    lbFooter:          'Anlık güncellenir • /bjchipleader',
    lbEmpty:           'Henüz oyuncu yok! /bj ile ilk sen ol',
    dailyTitle:        '🎁 Günlük Ödül',
    dailyClaimed:      '✅ Günlük **₺{amount}** ödülün alındı!\nYeni bakiye: **₺{bal}**',
    dailyCooldown:     '⏳ Bugünkü ödülünü zaten aldın!\nSonraki ödül: **{time}** sonra',
    dailyFooter:       'Her 24 saatte bir geri gel!',
    adminOnly:         '❌ Bu komut için **Sunucuyu Yönet** yetkisi gerekiyor.',
    statsTitle:        '📊 İstatistiklerin',
    statsDesc:         '{user} — Oyun İstatistikleri',
    statsWins:         'Kazanılan',
    statsLosses:       'Kaybedilen',
    statsPushes:       'Berabere',
    statsBJs:          'Blackjack',
    statsWinRate:      'Kazanma Oranı',
    statsFooter:       'BlackJack',
    multiTitle:        '🃏 BlackJack Multiplayer',
    multiLobbyOpen:    '🎰 **Açık Multiplayer Lobisi!**\nKatılmak için **Katıl** butonuna bas (max {max} oyuncu).\nOyun **{sec} saniye** içinde veya host başlatınca başlar.',
    multiLobbyInvite:  '🎰 **{host}, {target} kişisini BlackJack\'e davet etti!**\nKatılmak için **Katıl** butonuna bas.\nOyun **{sec} saniye** içinde veya host başlatınca başlar.',
    multiJoinBtn:      '✅ Katıl',
    multiStartBtn:     '▶️ Başlat',
    multiPlayers:      'Oyuncular',
    multiRound:        'Tur {n}',
    multiSelectBet:    '💰 Bu tur için bahis seç (Bakiye: ₺{bal})',
    multiResult:       '**{user}** → {result} (₺{pay})',
    multiRoundSummary: '📋 Tur {n} Özeti',
    multiGameOver:     '🏆 Oyun Bitti!',
    multiWinner:       '🥇 Kazanan: **{user}** — **₺{bal}**',
    multiNoPlayers:    '❌ Başlamak için yeterli oyuncu yok!',
    multiAlreadyIn:    '❌ Zaten bu lobidesin!',
    multiNotEnough:    '❌ En az 2 oyuncu gerekli!',
    multiLobbyFull:    '❌ Lobi dolu!',
    multiYourTurn:     '🎯 **{user}**, sıra sende!',
    multiDealerResult: '🏦 Kurpiyer: **{total}**{bust}',
    multiBetPrompt:    '💰 **{user}**, bahsini seç! (Bakiye: ₺{bal})',
    helpTitle:         '📖 BlackJack — Tüm Komutlar',
    helpFooter:        'BlackJack • /bj ile oynamaya başla',
  }
};

function t(lang, key, vars = {}) {
  let str = (STRINGS[lang] || STRINGS['en'])[key] || key;
  for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, v);
  return str;
}

// ═══════════════════════════════════════════════════════════════════
//  SLASH COMMANDS
// ═══════════════════════════════════════════════════════════════════
const commands = [
  new SlashCommandBuilder()
    .setName('bj')
    .setDescription('Play BlackJack / BlackJack oyna')
    .addIntegerOption(opt =>
      opt.setName('bet').setDescription('Bet amount / Bahis miktarı').setRequired(true).setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('bjbalance')
    .setDescription('Check your balance / Bakiyeni gör'),
  new SlashCommandBuilder()
    .setName('bjrules')
    .setDescription('BlackJack rules / BlackJack kuralları'),
  new SlashCommandBuilder()
    .setName('bjlanguage')
    .setDescription('Set your personal language / Kişisel dilini ayarla')
    .addStringOption(opt =>
      opt.setName('language').setDescription('en / tr').setRequired(true)
        .addChoices({name:'English',value:'en'},{name:'Türkçe',value:'tr'})
    ),
  new SlashCommandBuilder()
    .setName('bjserverlanguage')
    .setDescription('Set server default language (Admin only) / Sunucu dilini ayarla (Sadece Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
      opt.setName('language').setDescription('en / tr').setRequired(true)
        .addChoices({name:'English',value:'en'},{name:'Türkçe',value:'tr'})
    ),
  new SlashCommandBuilder()
    .setName('bjchipleader')
    .setDescription('Top 10 chip leaderboard / En zengin 10 oyuncu'),
  new SlashCommandBuilder()
    .setName('bjdaily')
    .setDescription('Claim your daily ₺100 chips / Günlük ₺100 chip al'),
  new SlashCommandBuilder()
    .setName('bjstats')
    .setDescription('View your game statistics / Oyun istatistiklerini gör'),
  new SlashCommandBuilder()
    .setName('bjmulti')
    .setDescription('Multiplayer BlackJack / Çok oyunculu BlackJack')
    .addUserOption(opt =>
      opt.setName('user').setDescription('Invite a specific user (optional) / Belirli bir kullanıcıyı davet et (opsiyonel)').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('bjhelp')
    .setDescription('All commands list / Tüm komutları göster'),
];

async function registerCommands() {
  const rest = new REST({version:'10'}).setToken(TOKEN);
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), {body:commands});
    console.log('✅ Slash commands registered!');
  } catch (err) { console.error('Command registration error:', err); }
}

// ═══════════════════════════════════════════════════════════════════
//  Card System
// ═══════════════════════════════════════════════════════════════════
const SUITS = [
  {symbol:'♣',color:'#1a1a1a'},
  {symbol:'♦',color:'#CC0000'},
  {symbol:'♥',color:'#CC0000'},
  {symbol:'♠',color:'#1a1a1a'},
];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function createDecks(n=6) {
  const deck=[];
  for (let d=0;d<n;d++) for (const suit of SUITS) for (const rank of RANKS) deck.push({suit,rank});
  return deck;
}
function shuffle(arr) {
  const a=[...arr];
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function cardValue(rank) {
  if (['J','Q','K'].includes(rank)) return 10;
  if (rank==='A') return 11;
  return parseInt(rank);
}
function handTotal(hand) {
  let total=hand.reduce((s,c)=>s+cardValue(c.rank),0);
  let aces=hand.filter(c=>c.rank==='A').length;
  while (total>21&&aces-->0) total-=10;
  return total;
}
function isBlackjack(hand) { return hand.length===2&&handTotal(hand)===21; }
function canSplit(hand) {
  if (hand.length !== 2) return false;
  return cardValue(hand[0].rank) === cardValue(hand[1].rank);
}

// ═══════════════════════════════════════════════════════════════════
//  CANVAS — CARDS
// ═══════════════════════════════════════════════════════════════════
const CW=230, CH=330, CRADIUS=18;

const PIP_LAYOUTS = {
  1:  [[0.5,0.5]],
  2:  [[0.5,0.22],[0.5,0.78]],
  3:  [[0.5,0.18],[0.5,0.5],[0.5,0.82]],
  4:  [[0.27,0.22],[0.73,0.22],[0.27,0.78],[0.73,0.78]],
  5:  [[0.27,0.22],[0.73,0.22],[0.5,0.5],[0.27,0.78],[0.73,0.78]],
  6:  [[0.27,0.18],[0.73,0.18],[0.27,0.5],[0.73,0.5],[0.27,0.82],[0.73,0.82]],
  7:  [[0.27,0.16],[0.73,0.16],[0.5,0.31],[0.27,0.48],[0.73,0.48],[0.27,0.80],[0.73,0.80]],
  8:  [[0.27,0.14],[0.73,0.14],[0.5,0.28],[0.27,0.45],[0.73,0.45],[0.5,0.62],[0.27,0.80],[0.73,0.80]],
  9:  [[0.27,0.14],[0.73,0.14],[0.27,0.32],[0.73,0.32],[0.5,0.5],[0.27,0.68],[0.73,0.68],[0.27,0.86],[0.73,0.86]],
  10: [[0.27,0.13],[0.73,0.13],[0.5,0.26],[0.27,0.39],[0.73,0.39],[0.27,0.61],[0.73,0.61],[0.5,0.74],[0.27,0.87],[0.73,0.87]],
};

function roundRect(ctx,x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function drawFaceCard(ctx, x, y, rank, suit) {
  const col = suit.color;
  const sym = suit.symbol;
  const cx  = x + CW / 2;
  const cy  = y + CH / 2;

  const skinTone   = '#f5d5a8';
  const skinShadow = '#c8a070';
  const hairColors = { J: '#8B4513', Q: '#2c1a6e', K: '#1a1a1a' };
  const robeColors = { J: '#1a3a6e', Q: '#6e1a3a', K: '#1a5c1a' };
  const accentCol  = { J: '#4a7aae', Q: '#ae4a7a', K: '#4aae6a' };
  const hairCol    = hairColors[rank];
  const robeCol    = robeColors[rank];
  const accentC    = accentCol[rank];

  roundRect(ctx, x + 10, y + 52, CW - 20, CH - 104, 4);
  ctx.strokeStyle = robeCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5; ctx.stroke();
  ctx.globalAlpha = 1;
  roundRect(ctx, x + 12, y + 54, CW - 24, CH - 108, 3);
  ctx.strokeStyle = accentC; ctx.lineWidth = 1; ctx.globalAlpha = 0.3; ctx.stroke();
  ctx.globalAlpha = 1;

  function drawHalf(ctx, originY, flipped) {
    ctx.save();
    if (flipped) {
      ctx.translate(cx, originY);
      ctx.scale(1, -1);
      ctx.translate(-cx, -originY);
    }

    const top = originY;
    const bodyTop    = top + 42;
    const bodyBot    = top + (CH / 2) - 10;
    const shoulderW  = 52;
    const waistW     = 38;

    ctx.beginPath();
    ctx.moveTo(cx - shoulderW, bodyTop + 10);
    ctx.quadraticCurveTo(cx - shoulderW - 4, bodyTop + 20, cx - waistW, bodyTop + 40);
    ctx.lineTo(cx - waistW - 10, bodyBot);
    ctx.lineTo(cx + waistW + 10, bodyBot);
    ctx.lineTo(cx + waistW, bodyTop + 40);
    ctx.quadraticCurveTo(cx + shoulderW + 4, bodyTop + 20, cx + shoulderW, bodyTop + 10);
    ctx.closePath();
    ctx.fillStyle = robeCol;
    ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = accentC; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, bodyTop + 8); ctx.lineTo(cx, bodyBot);
    ctx.strokeStyle = accentC; ctx.lineWidth = 1; ctx.globalAlpha = 0.4; ctx.stroke(); ctx.globalAlpha = 1;

    for (let b = 1; b <= 3; b++) {
      const by = bodyTop + 14 + b * 14;
      ctx.beginPath();
      ctx.moveTo(cx - waistW - 4, by); ctx.lineTo(cx + waistW + 4, by);
      ctx.strokeStyle = accentC; ctx.lineWidth = 1; ctx.globalAlpha = 0.25; ctx.stroke(); ctx.globalAlpha = 1;
    }

    ctx.font = '22px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col; ctx.globalAlpha = 0.3;
    ctx.fillText(sym, cx, bodyTop + 55);
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.moveTo(cx - shoulderW, bodyTop + 12);
    ctx.quadraticCurveTo(cx - shoulderW - 20, bodyTop + 30, cx - shoulderW - 16, bodyTop + 60);
    ctx.strokeStyle = robeCol; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = accentC; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + shoulderW, bodyTop + 12);
    ctx.quadraticCurveTo(cx + shoulderW + 20, bodyTop + 30, cx + shoulderW + 16, bodyTop + 60);
    ctx.strokeStyle = robeCol; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = accentC; ctx.lineWidth = 1; ctx.stroke();

    if (rank === 'K') {
      ctx.beginPath();
      ctx.moveTo(cx - shoulderW - 10, bodyTop + 56);
      ctx.lineTo(cx - shoulderW - 4, bodyTop + 14);
      ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#B8860B'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - shoulderW - 10, bodyTop + 52, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700'; ctx.fill();
      ctx.strokeStyle = '#B8860B'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - shoulderW - 10, bodyTop + 52, 3, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();

      const sx = cx + shoulderW + 8, sy = bodyTop + 20;
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(sx + 20, sy); ctx.lineTo(sx + 22, sy + 28);
      ctx.lineTo(sx + 10, sy + 38); ctx.lineTo(sx - 2, sy + 28); ctx.closePath();
      ctx.fillStyle = accentC; ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = accentC; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = '14px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = col; ctx.fillText(sym, sx + 10, sy + 20);

    } else if (rank === 'Q') {
      ctx.beginPath();
      ctx.moveTo(cx + shoulderW + 12, bodyTop + 56);
      ctx.quadraticCurveTo(cx + shoulderW + 18, bodyTop + 28, cx + shoulderW + 10, bodyTop + 14);
      ctx.strokeStyle = '#2d7a2d'; ctx.lineWidth = 2.5; ctx.stroke();
      const fx = cx + shoulderW + 10, fy = bodyTop + 10;
      const petalOffsets = [[0,-8],[6,-4],[6,4],[0,8],[-6,4],[-6,-4]];
      petalOffsets.forEach(([dx,dy]) => {
        ctx.beginPath(); ctx.arc(fx+dx, fy+dy, 4, 0, Math.PI*2);
        ctx.fillStyle = col; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
      });
      ctx.beginPath(); ctx.arc(fx, fy, 4.5, 0, Math.PI*2);
      ctx.fillStyle = '#FFD700'; ctx.fill();

      const fanX = cx - shoulderW - 10, fanY = bodyTop + 38;
      for (let fi = -3; fi <= 3; fi++) {
        ctx.beginPath();
        ctx.moveTo(fanX, fanY + 20);
        const rad = (fi / 8) * Math.PI;
        ctx.lineTo(fanX + Math.sin(rad) * 28, fanY + 20 - Math.cos(rad) * 28);
        ctx.strokeStyle = accentC; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(fanX, fanY + 20, 5, -Math.PI*0.5, Math.PI*0.5);
      ctx.fillStyle = '#FFD700'; ctx.fill();

    } else {
      ctx.beginPath();
      ctx.moveTo(cx - shoulderW - 18, bodyTop + 62);
      ctx.lineTo(cx + shoulderW + 12, bodyTop + 8);
      ctx.strokeStyle = '#ccc'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.stroke();
      const hx = cx - shoulderW - 8, hy = bodyTop + 50;
      ctx.beginPath();
      ctx.moveTo(hx - 12, hy + 6); ctx.lineTo(hx + 12, hy - 6);
      ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(hx - 10, hy + 8, 5, 0, Math.PI*2);
      ctx.fillStyle = '#FFD700'; ctx.fill();
      ctx.strokeStyle = '#B8860B'; ctx.lineWidth = 1; ctx.stroke();
    }

    ctx.beginPath(); ctx.roundRect(cx - 6, bodyTop - 14, 12, 18, 3);
    ctx.fillStyle = skinTone; ctx.fill();
    ctx.strokeStyle = skinShadow; ctx.lineWidth = 0.5; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 18, bodyTop + 10);
    ctx.quadraticCurveTo(cx, bodyTop + 18, cx + 18, bodyTop + 10);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;

    const headCY = top + 24;
    const headRX = 18, headRY = 21;

    if (rank === 'Q') {
      ctx.beginPath();
      ctx.ellipse(cx, headCY + 4, headRX + 10, headRY + 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = hairCol; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.ellipse(cx - headRX - 6, headCY + 10, 8, 14, -0.2, 0, Math.PI * 2);
      ctx.fillStyle = hairCol; ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + headRX + 6, headCY + 10, 8, 14, 0.2, 0, Math.PI * 2);
      ctx.fillStyle = hairCol; ctx.fill();
    } else if (rank === 'K') {
      ctx.beginPath();
      ctx.ellipse(cx, headCY + 6, headRX + 6, headRY + 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = hairCol; ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - headRX - 2, headCY + 12, 7, 12, -0.15, 0, Math.PI * 2);
      ctx.fillStyle = hairCol; ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + headRX + 2, headCY + 12, 7, 12, 0.15, 0, Math.PI * 2);
      ctx.fillStyle = hairCol; ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(cx, headCY + 4, headRX + 8, headRY + 14, 0, 0, Math.PI * 2);
      ctx.fillStyle = hairCol; ctx.fill();
    }

    ctx.beginPath();
    ctx.ellipse(cx, headCY, headRX, headRY, 0, 0, Math.PI * 2);
    ctx.fillStyle = skinTone;
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 5; ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = skinShadow; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#1a0a00';
    ctx.beginPath(); ctx.ellipse(cx - 6, headCY - 2, 2.8, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 6, headCY - 2, 2.8, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx - 5.2, headCY - 2.8, 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 6.8, headCY - 2.8, 0.9, 0, Math.PI * 2); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - 9, headCY - 6.5); ctx.quadraticCurveTo(cx - 6, headCY - 8, cx - 3, headCY - 6.5);
    ctx.strokeStyle = hairCol; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 3, headCY - 6.5); ctx.quadraticCurveTo(cx + 6, headCY - 8, cx + 9, headCY - 6.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 2, headCY + 2);
    ctx.quadraticCurveTo(cx - 3, headCY + 5, cx, headCY + 6);
    ctx.quadraticCurveTo(cx + 3, headCY + 5, cx + 2, headCY + 2);
    ctx.strokeStyle = skinShadow; ctx.lineWidth = 1; ctx.stroke();

    if (rank === 'Q') {
      ctx.beginPath();
      ctx.moveTo(cx - 5, headCY + 10);
      ctx.quadraticCurveTo(cx, headCY + 13, cx + 5, headCY + 10);
      ctx.strokeStyle = '#c04060'; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 5, headCY + 10); ctx.quadraticCurveTo(cx, headCY + 8.5, cx + 5, headCY + 10);
      ctx.fillStyle = '#c04060'; ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1;
    } else if (rank === 'K') {
      ctx.beginPath();
      ctx.moveTo(cx - 5, headCY + 9); ctx.lineTo(cx + 5, headCY + 9);
      ctx.strokeStyle = '#a07050'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 7, headCY + 6);
      ctx.quadraticCurveTo(cx - 4, headCY + 5, cx - 1, headCY + 7);
      ctx.moveTo(cx + 1, headCY + 7);
      ctx.quadraticCurveTo(cx + 4, headCY + 5, cx + 7, headCY + 6);
      ctx.strokeStyle = hairCol; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 4, headCY + 14);
      ctx.quadraticCurveTo(cx, headCY + 16, cx + 4, headCY + 14);
      ctx.strokeStyle = hairCol; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 4, headCY + 10);
      ctx.quadraticCurveTo(cx + 2, headCY + 13, cx + 5, headCY + 10);
      ctx.strokeStyle = '#a07050'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    if (rank === 'K') {
      const crownBase = headCY - headRY + 2;
      ctx.beginPath();
      ctx.moveTo(cx - 20, crownBase);
      ctx.lineTo(cx - 18, crownBase - 14);
      ctx.lineTo(cx - 10, crownBase - 7);
      ctx.lineTo(cx, crownBase - 20);
      ctx.lineTo(cx + 10, crownBase - 7);
      ctx.lineTo(cx + 18, crownBase - 14);
      ctx.lineTo(cx + 20, crownBase);
      ctx.closePath();
      ctx.fillStyle = '#FFD700'; ctx.fill();
      ctx.strokeStyle = '#B8860B'; ctx.lineWidth = 1.5; ctx.stroke();
      [[cx, crownBase - 18], [cx - 13, crownBase - 10], [cx + 13, crownBase - 10]].forEach(([gx, gy], i) => {
        ctx.beginPath(); ctx.arc(gx, gy, i === 0 ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? col : '#FF4444'; ctx.fill();
        ctx.strokeStyle = '#B8860B'; ctx.lineWidth = 0.5; ctx.stroke();
      });
      ctx.fillStyle = '#B8860B'; ctx.globalAlpha = 0.5;
      ctx.fillRect(cx - 20, crownBase - 5, 40, 5);
      ctx.globalAlpha = 1;

    } else if (rank === 'Q') {
      const tiaraY = headCY - headRY;
      ctx.beginPath();
      ctx.moveTo(cx - 18, tiaraY + 2);
      ctx.lineTo(cx - 14, tiaraY - 10);
      ctx.lineTo(cx - 7, tiaraY - 5);
      ctx.lineTo(cx, tiaraY - 18);
      ctx.lineTo(cx + 7, tiaraY - 5);
      ctx.lineTo(cx + 14, tiaraY - 10);
      ctx.lineTo(cx + 18, tiaraY + 2);
      ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
      [[cx, tiaraY - 16], [cx - 12, tiaraY - 8], [cx + 12, tiaraY - 8]].forEach(([gx, gy], i) => {
        ctx.beginPath(); ctx.arc(gx, gy, i === 0 ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#FF44AA' : col; ctx.fill();
        ctx.strokeStyle = '#B8860B'; ctx.lineWidth = 0.5; ctx.stroke();
      });

    } else {
      const hatBase = headCY - headRY + 2;
      ctx.beginPath();
      ctx.moveTo(cx - 22, hatBase + 2);
      ctx.lineTo(cx - 16, hatBase - 10);
      ctx.quadraticCurveTo(cx, hatBase - 16, cx + 16, hatBase - 10);
      ctx.lineTo(cx + 22, hatBase + 2);
      ctx.closePath();
      ctx.fillStyle = robeCol; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = accentC; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 22, hatBase); ctx.lineTo(cx + 22, hatBase); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + 12, hatBase - 8);
      ctx.quadraticCurveTo(cx + 26, hatBase - 26, cx + 20, hatBase - 40);
      ctx.moveTo(cx + 12, hatBase - 8);
      ctx.quadraticCurveTo(cx + 30, hatBase - 22, cx + 20, hatBase - 40);
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.75; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 12, hatBase - 8);
      ctx.quadraticCurveTo(cx + 28, hatBase - 24, cx + 20, hatBase - 40);
      ctx.quadraticCurveTo(cx + 16, hatBase - 26, cx + 12, hatBase - 8);
      ctx.fillStyle = col; ctx.globalAlpha = 0.5; ctx.fill(); ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  const topHalfOriginY = y + 4;
  drawHalf(ctx, topHalfOriginY, false);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, -1);
  ctx.translate(-cx, -cy);
  drawHalf(ctx, topHalfOriginY, false);
  ctx.restore();

  ctx.font = '18px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = col;
  ctx.globalAlpha = 0.6;
  ctx.fillText(sym + ' ' + sym + ' ' + sym, cx, cy);
  ctx.globalAlpha = 1;
}

function drawCard(ctx,card,x,y,faceDown=false) {
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,0.55)'; ctx.shadowBlur=18; ctx.shadowOffsetX=5; ctx.shadowOffsetY=8;
  roundRect(ctx,x,y,CW,CH,CRADIUS);
  ctx.fillStyle=faceDown?'#1c2b5e':'#FFFFFF'; ctx.fill();
  ctx.restore();
  roundRect(ctx,x,y,CW,CH,CRADIUS);
  ctx.strokeStyle=faceDown?'#2a3d7a':'#888'; ctx.lineWidth=2; ctx.stroke();

  if (faceDown) {
    ctx.save();
    roundRect(ctx,x+8,y+8,CW-16,CH-16,8); ctx.clip();
    ctx.fillStyle='#1a3a8a'; ctx.fill();
    ctx.strokeStyle='rgba(100,150,255,0.3)'; ctx.lineWidth=1;
    for (let i=-CH;i<CW+CH;i+=14) {
      ctx.beginPath(); ctx.moveTo(x+i,y); ctx.lineTo(x+i+CH,y+CH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x+i+CH,y); ctx.lineTo(x+i,y+CH); ctx.stroke();
    }
    roundRect(ctx,x+8,y+8,CW-16,CH-16,8);
    ctx.strokeStyle='rgba(150,190,255,0.6)'; ctx.lineWidth=2.5; ctx.stroke();
    ctx.restore();
    return;
  }

  const col=card.suit.color, sym=card.suit.symbol, rank=card.rank;
  const rankNum=parseInt(rank), isFace=['J','Q','K'].includes(rank), isAce=rank==='A';

  ctx.font=`bold 34px "Times New Roman",serif`; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillStyle=col; ctx.fillText(rank,x+11,y+10);
  ctx.font=`28px serif`; ctx.textAlign='center';
  ctx.fillText(sym,x+(rank==='10'?28:23),y+48);

  ctx.save();
  ctx.translate(x+CW-(rank==='10'?11:13),y+CH-10); ctx.rotate(Math.PI);
  ctx.font=`bold 34px "Times New Roman",serif`; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillStyle=col; ctx.fillText(rank,0,0);
  ctx.font=`28px serif`; ctx.textAlign='center'; ctx.fillText(sym,rank==='10'?14:10,38);
  ctx.restore();

  if (isAce) {
    ctx.font=`140px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle=col; ctx.fillText(sym,x+CW/2,y+CH/2+4);
  } else if (isFace) {
    drawFaceCard(ctx, x, y, rank, card.suit);
  } else {
    const layout=PIP_LAYOUTS[rankNum]||[];
    const pipSize=rankNum>=9?30:rankNum>=6?36:44;
    ctx.font=`${pipSize}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle=col;
    for (const [px,py] of layout) {
      const pipX=x+14+(CW-28)*px, pipY=y+62+(CH-96)*py;
      if (py>0.501) { ctx.save(); ctx.translate(pipX,pipY); ctx.rotate(Math.PI); ctx.fillText(sym,0,0); ctx.restore(); }
      else ctx.fillText(sym,pipX,pipY);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CHIP SYSTEM
// ═══════════════════════════════════════════════════════════════════
const CHIP_CONFIG = {
  1:   {color:'#F4A7B9',edge:'#e8889a'},
  5:   {color:'#2d8a3e',edge:'#1d6a2e'},
  10:  {color:'#cc2222',edge:'#991111'},
  50:  {color:'#d4a017',edge:'#a07010'},
  100: {color:'#1a1a1a',edge:'#333333'},
};

function getChipBreakdown(amount) {
  const denoms=[100,50,10,5,1]; const chips=[]; let rem=amount;
  for (const d of denoms) {
    const cnt=Math.floor(rem/d);
    if (cnt>0) { chips.push({value:d,count:Math.min(cnt,5)}); rem-=d*cnt; }
    if (chips.length>=4) break;
  }
  return chips;
}

function drawChip(ctx,cx,cy,radius,value) {
  const cfg=CHIP_CONFIG[value]||CHIP_CONFIG[1];
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=10; ctx.shadowOffsetX=3; ctx.shadowOffsetY=4;
  ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.fillStyle=cfg.color; ctx.fill();
  ctx.restore();
  for (let i=0;i<12;i++) {
    const a=(i/12)*Math.PI*2;
    ctx.beginPath(); ctx.arc(cx+Math.cos(a)*(radius-4),cy+Math.sin(a)*(radius-4),4,0,Math.PI*2);
    ctx.fillStyle=i%2===0?'#FFFFFF':cfg.edge; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.strokeStyle=cfg.edge; ctx.lineWidth=2.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,radius*0.72,0,Math.PI*2); ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=2; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,radius*0.68,0,Math.PI*2); ctx.strokeStyle='rgba(212,175,55,0.9)'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,radius*0.62,0,Math.PI*2); ctx.fillStyle='#FFFFFF'; ctx.fill();
  ctx.font=`bold ${radius*0.42}px Georgia,serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='#1a1a1a';
  ctx.fillText(String(value),cx,cy+radius*0.04);
  ctx.font=`bold ${radius*0.16}px Georgia,serif`; ctx.fillText('TOURNAMENT',cx,cy+radius*0.28);
}

function drawChipStack(ctx,cx,cy,value,count,radius=38) {
  for (let i=count-1;i>=0;i--) drawChip(ctx,cx,cy-i*5,radius,value);
}

// ═══════════════════════════════════════════════════════════════════
//  TABLE RENDER
// ═══════════════════════════════════════════════════════════════════
async function renderTable(dealerHand, playerHand, hideDealer, gamePhase, balance, bet, lang='en', splitHand=null, activeHandIndex=0) {
  const GAP=24, PAD=70;
  const isSplit = !!splitHand;
  const maxCards = isSplit
    ? Math.max(dealerHand.length, playerHand.length, splitHand.length, 4)
    : Math.max(dealerHand.length, playerHand.length, 4);
  const W = Math.max(isSplit ? 1600 : 1280, PAD*2 + maxCards*(CW+GAP)+60), H=1120;
  const canvas=createCanvas(W,H); const ctx=canvas.getContext('2d');

  const bgGrad=ctx.createRadialGradient(W/2,H/2,100,W/2,H/2,W*0.75);
  bgGrad.addColorStop(0,'#1e7a3c'); bgGrad.addColorStop(0.45,'#165f2e'); bgGrad.addColorStop(1,'#0a3318');
  ctx.fillStyle=bgGrad; ctx.fillRect(0,0,W,H);

  ctx.save(); ctx.globalAlpha=0.04;
  for (let i=0;i<W;i+=4){ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,H);ctx.stroke();}
  for (let j=0;j<H;j+=4){ctx.beginPath();ctx.moveTo(0,j);ctx.lineTo(W,j);ctx.stroke();}
  ctx.restore();

  ctx.beginPath(); ctx.ellipse(W/2,H/2,W/2-18,H/2-14,0,0,Math.PI*2);
  ctx.strokeStyle='#B8860B'; ctx.lineWidth=7; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(W/2,H/2,W/2-28,H/2-24,0,0,Math.PI*2);
  ctx.strokeStyle='rgba(184,134,11,0.35)'; ctx.lineWidth=2; ctx.stroke();

  ctx.beginPath(); ctx.moveTo(PAD+40,H/2); ctx.lineTo(W-PAD-40,H/2);
  ctx.strokeStyle='rgba(184,134,11,0.45)'; ctx.lineWidth=2; ctx.setLineDash([14,10]); ctx.stroke(); ctx.setLineDash([]);

  const cAX=W-270, cAY=H-230;
  ctx.save(); ctx.beginPath(); roundRect(ctx,cAX-20,cAY-70,240,230,16);
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();
  ctx.strokeStyle='rgba(184,134,11,0.6)'; ctx.lineWidth=2; ctx.stroke(); ctx.restore();
  ctx.font='bold 22px Georgia,serif'; ctx.textAlign='center'; ctx.fillStyle='#FFD700';
  ctx.fillText(t(lang,'bet'),cAX+100,cAY-46);
  ctx.font='bold 34px Georgia,serif'; ctx.fillText(`₺${bet}`,cAX+100,cAY-14);
  const chips=getChipBreakdown(bet);
  if (chips.length>0) {
    const sp=96, sx=cAX+(240-chips.length*sp+sp)/2;
    chips.forEach((chip,idx)=>{
      const cx=sx+idx*sp, cy=cAY+96;
      drawChipStack(ctx,cx,cy,chip.value,Math.min(chip.count,4),40);
      if (chip.count>1){ctx.font='bold 15px Georgia,serif';ctx.textAlign='center';ctx.fillStyle='#FFD700';ctx.fillText(`×${chip.count}`,cx,cy+58);}
    });
  }

  ctx.save(); ctx.beginPath(); roundRect(ctx,20,H-105,250,85,12);
  ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fill();
  ctx.strokeStyle='rgba(184,134,11,0.5)'; ctx.lineWidth=1.5; ctx.stroke(); ctx.restore();
  ctx.font='bold 18px Georgia,serif'; ctx.textAlign='left'; ctx.fillStyle='rgba(255,220,100,0.9)';
  ctx.fillText(t(lang,'balance'),36,H-78);
  ctx.font='bold 32px Georgia,serif'; ctx.fillStyle='#FFD700';
  ctx.fillText(`₺${balance}`,36,H-40);
  getChipBreakdown(Math.min(balance,300)).slice(0,3).forEach((chip,idx)=>{
    drawChip(ctx,295+idx*66,H-62,24,chip.value);
  });

  ctx.font='bold 26px Georgia,serif'; ctx.textAlign='center'; ctx.fillStyle='rgba(255,220,100,0.97)';
  ctx.fillText(t(lang,'dealer'),W/2,40);
  const dTotalStr=hideDealer
    ?`${cardValue(dealerHand[0].rank)} + ?`
    :`${handTotal(dealerHand)}${handTotal(dealerHand)>21?' '+t(lang,'bust'):''}`;
  ctx.font='18px Georgia,serif'; ctx.fillStyle='rgba(255,255,255,0.65)';
  ctx.fillText(`${t(lang,'total')}: ${dTotalStr}`,W/2,72);
  const dW=dealerHand.length*(CW+GAP)-GAP, dSX=(W-dW)/2;
  dealerHand.forEach((card,i)=>drawCard(ctx,card,dSX+i*(CW+GAP),90,hideDealer&&i>0));

  const pLY=H/2+30;

  if (!isSplit) {
    ctx.font='bold 26px Georgia,serif'; ctx.textAlign='center'; ctx.fillStyle='rgba(100,210,255,0.97)';
    ctx.fillText(t(lang,'you'),W/2,pLY);
    const pt=handTotal(playerHand);
    ctx.font='18px Georgia,serif';
    ctx.fillStyle=pt>21?'rgba(255,100,100,0.97)':'rgba(255,255,255,0.65)';
    ctx.fillText(`${t(lang,'total')}: ${pt}${pt>21?' '+t(lang,'bust'):isBlackjack(playerHand)?' '+t(lang,'blackjack'):''}`,W/2,pLY+30);
    const pW=playerHand.length*(CW+GAP)-GAP, pSX=(W-pW)/2;
    playerHand.forEach((card,i)=>drawCard(ctx,card,pSX+i*(CW+GAP),H/2+66,false));
  } else {
    const hands = [playerHand, splitHand];
    const halfW = W / 2;
    hands.forEach((hand, hIdx) => {
      const isActive = hIdx === activeHandIndex;
      const centerX = halfW * hIdx + halfW / 2;
      const handW = hand.length * (CW + GAP) - GAP;
      const handSX = centerX - handW / 2;
      const pt = handTotal(hand);

      if (isActive && !gamePhase) {
        ctx.save(); ctx.globalAlpha = 0.12;
        roundRect(ctx, halfW * hIdx + 20, pLY - 10, halfW - 40, H - pLY - 20, 16);
        ctx.fillStyle = '#4fc3f7'; ctx.fill();
        ctx.restore();
        roundRect(ctx, halfW * hIdx + 20, pLY - 10, halfW - 40, H - pLY - 20, 16);
        ctx.strokeStyle = 'rgba(79,195,247,0.7)'; ctx.lineWidth = 2.5; ctx.stroke();
      }

      ctx.font = 'bold 24px Georgia,serif'; ctx.textAlign = 'center';
      ctx.fillStyle = isActive ? 'rgba(79,195,247,1)' : 'rgba(200,200,200,0.75)';
      ctx.fillText(`${t(lang,'hand')} ${hIdx + 1}${isActive && !gamePhase ? ' ▶' : ''}`, centerX, pLY);
      ctx.font = '18px Georgia,serif';
      ctx.fillStyle = pt > 21 ? 'rgba(255,100,100,0.97)' : 'rgba(255,255,255,0.65)';
      ctx.fillText(
        `${t(lang,'total')}: ${pt}${pt > 21 ? ' ' + t(lang,'bust') : isBlackjack(hand) ? ' ' + t(lang,'blackjack') : ''}`,
        centerX, pLY + 30
      );
      hand.forEach((card, i) => drawCard(ctx, card, handSX + i * (CW + GAP), H / 2 + 66, false));
    });

    ctx.beginPath(); ctx.moveTo(W/2, pLY - 5); ctx.lineTo(W/2, H - 20);
    ctx.strokeStyle = 'rgba(184,134,11,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([10,8]); ctx.stroke(); ctx.setLineDash([]);
  }

  if (gamePhase) {
    ctx.save(); ctx.globalAlpha=0.78; ctx.fillStyle='#000';
    ctx.beginPath(); ctx.roundRect(W/2-300,H/2-48,600,90,20); ctx.fill(); ctx.restore();
    ctx.font='bold 44px Georgia,serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#FFD700'; ctx.shadowColor='rgba(0,0,0,0.95)'; ctx.shadowBlur=18;
    ctx.fillText(gamePhase,W/2,H/2); ctx.shadowBlur=0; ctx.textBaseline='alphabetic';
  }

  return canvas.toBuffer('image/png');
}

async function renderMultiTable(dealerHand, playerEntries, hideDealer, gamePhase, lang = 'en') {
  const GAP = 16, CARD_SCALE = 0.72;
  const scW = Math.round(CW * CARD_SCALE), scH = Math.round(CH * CARD_SCALE);
  const maxPlayerCards = Math.max(...playerEntries.map(p => p.hand.length), 2);
  const playerColWidth = maxPlayerCards * (scW + GAP) + 80;
  const totalCols = playerEntries.length;
  const W = Math.max(1400, totalCols * playerColWidth + 120);
  const H = 1020;
  const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');

  const bgGrad = ctx.createRadialGradient(W/2, H/2, 80, W/2, H/2, W * 0.8);
  bgGrad.addColorStop(0, '#1e7a3c'); bgGrad.addColorStop(0.5, '#145a28'); bgGrad.addColorStop(1, '#0a3318');
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);

  ctx.save(); ctx.globalAlpha = 0.035;
  for (let i = 0; i < W; i += 4) { ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,H); ctx.stroke(); }
  for (let j = 0; j < H; j += 4) { ctx.beginPath(); ctx.moveTo(0,j); ctx.lineTo(W,j); ctx.stroke(); }
  ctx.restore();

  ctx.beginPath(); ctx.ellipse(W/2, H/2, W/2-14, H/2-10, 0, 0, Math.PI*2);
  ctx.strokeStyle='#B8860B'; ctx.lineWidth=6; ctx.stroke();

  const divY = H * 0.46;
  ctx.beginPath(); ctx.moveTo(60, divY); ctx.lineTo(W - 60, divY);
  ctx.strokeStyle = 'rgba(184,134,11,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.stroke(); ctx.setLineDash([]);

  ctx.font = 'bold 28px Georgia,serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,220,100,0.97)';
  ctx.fillText(t(lang, 'dealer'), W / 2, 44);

  const dTotalStr = hideDealer
    ? `${cardValue(dealerHand[0].rank)} + ?`
    : `${handTotal(dealerHand)}${handTotal(dealerHand) > 21 ? ' ' + t(lang, 'bust') : ''}`;
  ctx.font = '19px Georgia,serif'; ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(`${t(lang,'total')}: ${dTotalStr}`, W / 2, 75);

  const dCardW = dealerHand.length * (CW + GAP) - GAP;
  const dSX = (W - dCardW) / 2;
  dealerHand.forEach((card, i) => drawCard(ctx, card, dSX + i * (CW + GAP), 95, hideDealer && i > 0));

  const playerAreaY = divY + 18;
  const colWidth = (W - 80) / totalCols;

  playerEntries.forEach((entry, colIdx) => {
    const colX = 40 + colIdx * colWidth;
    const colCenterX = colX + colWidth / 2;
    const pt = handTotal(entry.hand);
    const isActive = entry.isActive;

    if (isActive) {
      ctx.save(); ctx.globalAlpha = 0.15;
      roundRect(ctx, colX + 4, playerAreaY, colWidth - 8, H - playerAreaY - 8, 14);
      ctx.fillStyle = '#4fc3f7'; ctx.fill();
      ctx.restore();
      roundRect(ctx, colX + 4, playerAreaY, colWidth - 8, H - playerAreaY - 8, 14);
      ctx.strokeStyle = 'rgba(79,195,247,0.7)'; ctx.lineWidth = 2.5; ctx.stroke();
    }

    if (entry.result) {
      const resColors = { blackjack:'rgba(255,215,0,0.12)', won:'rgba(39,174,96,0.15)', lost:'rgba(231,76,60,0.15)', bust:'rgba(231,76,60,0.15)', push:'rgba(243,156,18,0.12)' };
      const rc = resColors[entry.result] || 'transparent';
      ctx.save(); ctx.globalAlpha = 1;
      roundRect(ctx, colX + 4, playerAreaY, colWidth - 8, H - playerAreaY - 8, 14);
      ctx.fillStyle = rc; ctx.fill();
      ctx.restore();
    }

    ctx.font = isActive ? 'bold 20px Georgia,serif' : 'bold 18px Georgia,serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isActive ? 'rgba(79,195,247,1)' : 'rgba(255,255,255,0.85)';
    const nameMaxLen = 16;
    const displayName = entry.name.length > nameMaxLen ? entry.name.slice(0, nameMaxLen - 1) + '…' : entry.name;
    ctx.fillText(displayName, colCenterX, playerAreaY + 26);

    ctx.font = '16px Georgia,serif';
    ctx.fillStyle = pt > 21 ? 'rgba(255,100,100,0.95)' : 'rgba(255,255,255,0.65)';
    const bjLabel = isBlackjack(entry.hand) ? ' ' + t(lang,'blackjack') : '';
    const bustLabel = pt > 21 ? ' ' + t(lang,'bust') : '';
    ctx.fillText(`${t(lang,'total')}: ${pt}${bjLabel}${bustLabel}`, colCenterX, playerAreaY + 48);

    const scW2 = Math.round(CW * CARD_SCALE);
    const GAP2 = 16;
    const cardAreaX = colCenterX - (entry.hand.length * (scW2 + GAP2) - GAP2) / 2;
    const cardAreaY = playerAreaY + 58;
    ctx.save();
    ctx.scale(CARD_SCALE, CARD_SCALE);
    entry.hand.forEach((card, ci) => {
      drawCard(ctx, card, (cardAreaX + ci * (scW2 + GAP2)) / CARD_SCALE, cardAreaY / CARD_SCALE, false);
    });
    ctx.restore();

    const betY = H - 130;
    const chipsB = getChipBreakdown(Math.min(entry.bet, 500)).slice(0, 3);
    const chipStartX = colCenterX - chipsB.length * 30 + 14;
    chipsB.forEach((chip, idx) => drawChip(ctx, chipStartX + idx * 54, betY, 22, chip.value));

    ctx.font = 'bold 16px Georgia,serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#FFD700';
    ctx.fillText(`₺${entry.bet}`, colCenterX, betY + 36);

    ctx.font = '14px Georgia,serif'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`₺${entry.balance}`, colCenterX, betY + 56);

    if (entry.result) {
      const resMap = { blackjack:'resultBJ', won:'resultWon', lost:'resultLost', bust:'resultBust', push:'resultPush' };
      const resText = t(lang, resMap[entry.result] || 'resultLost');
      const resColorMap = { blackjack:'#FFD700', won:'#27AE60', lost:'#E74C3C', bust:'#E74C3C', push:'#F39C12' };
      const scH2 = Math.round(CH * CARD_SCALE);
      const bannerH = 38, bannerW = Math.min(colWidth - 20, 300);
      const bx = colCenterX - bannerW / 2, by = playerAreaY + 58 + scH2 + 12;
      ctx.save(); ctx.globalAlpha = 0.85;
      roundRect(ctx, bx, by, bannerW, bannerH, 10);
      ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
      ctx.font = 'bold 17px Georgia,serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = resColorMap[entry.result] || '#FFD700';
      ctx.fillText(resText, colCenterX, by + bannerH / 2);
      ctx.textBaseline = 'alphabetic';
    }

    if (isActive) {
      ctx.font = '26px serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(79,195,247,0.9)';
      ctx.fillText('▲', colCenterX, playerAreaY - 4);
    }
  });

  if (gamePhase) {
    ctx.save(); ctx.globalAlpha = 0.82; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.roundRect(W/2 - 340, H/2 - 52, 680, 100, 22); ctx.fill(); ctx.restore();
    ctx.font = 'bold 48px Georgia,serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFD700'; ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 20;
    ctx.fillText(gamePhase, W/2, H/2); ctx.shadowBlur = 0; ctx.textBaseline = 'alphabetic';
  }

  return canvas.toBuffer('image/png');
}

async function renderMultiBetScreen(username, balance, lang = 'en') {
  const W = 900, H = 320; const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a3318'); bg.addColorStop(1, '#1e7a3c');
  ctx.fillStyle = bg; roundRect(ctx, 0, 0, W, H, 22); ctx.fill();
  roundRect(ctx, 3, 3, W-6, H-6, 20); ctx.strokeStyle = '#B8860B'; ctx.lineWidth = 3; ctx.stroke();

  ctx.font = 'bold 28px Georgia,serif'; ctx.fillStyle = '#FFD700';
  ctx.textAlign = 'left'; ctx.fillText('💰 ' + t(lang, 'bet').toUpperCase(), 36, 52);
  ctx.font = '20px Georgia,serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(username, 36, 82);
  ctx.font = 'bold 22px Georgia,serif'; ctx.fillStyle = 'rgba(255,220,100,0.9)';
  ctx.fillText(`${t(lang,'balance')}: ₺${balance}`, 36, 114);

  const chipsM = getChipBreakdown(Math.min(balance, 500)).slice(0, 5);
  chipsM.forEach((chip, idx) => {
    drawChipStack(ctx, 380 + idx * 82, 200, chip.value, Math.min(chip.count, 3), 32);
    if (chip.count > 1) {
      ctx.font = 'bold 13px Georgia,serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#FFD700';
      ctx.fillText(`×${chip.count}`, 380 + idx * 82, 246);
    }
  });

  ctx.font = '14px Georgia,serif'; ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.textAlign = 'left'; ctx.fillText('BlackJack Multiplayer • Select your bet below', 36, H - 20);
  return canvas.toBuffer('image/png');
}

async function renderBalanceCard(userId,username,lang='en') {
  const balance=getBalance(userId);
  const W=600,H=220; const canvas=createCanvas(W,H); const ctx=canvas.getContext('2d');
  const bg=ctx.createLinearGradient(0,0,W,H);
  bg.addColorStop(0,'#0a3318'); bg.addColorStop(1,'#165f2e');
  ctx.fillStyle=bg; roundRect(ctx,0,0,W,H,20); ctx.fill();
  roundRect(ctx,3,3,W-6,H-6,18); ctx.strokeStyle='#B8860B'; ctx.lineWidth=3; ctx.stroke();
  ctx.font='bold 20px Georgia,serif'; ctx.fillStyle='rgba(255,220,100,0.9)';
  ctx.textAlign='left'; ctx.fillText('💰 '+t(lang,'balance'),30,46);
  ctx.font='16px Georgia,serif'; ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillText(username,30,74);
  ctx.font='bold 56px Georgia,serif'; ctx.fillStyle='#FFD700'; ctx.fillText(`₺${balance}`,30,148);
  getChipBreakdown(Math.min(balance,500)).slice(0,5).forEach((chip,idx)=>{
    drawChipStack(ctx,W-220+idx*44,130,chip.value,Math.min(chip.count,3),28);
  });
  ctx.font='13px Georgia,serif'; ctx.fillStyle='rgba(255,255,255,0.4)';
  ctx.fillText('BlackJack • /bj to play',30,H-18);
  return canvas.toBuffer('image/png');
}

// ═══════════════════════════════════════════════════════════════════
//  GAME LOGIC
// ═══════════════════════════════════════════════════════════════════
const activeGames = new Map();

function newRoundState(bet) {
  return {
    deck: shuffle(createDecks(6)),
    playerHand: [], dealerHand: [],
    splitHand: null,
    splitDoubled: false,
    activeHandIndex: 0,
    isSplit: false,
    bet, doubled: false, phase: 'player', result: null,
    splitResult: null,
    _collector: null, _processing: false,
  };
}
function dealInitial(game) {
  game.playerHand = [game.deck.pop(), game.deck.pop()];
  game.dealerHand = [game.deck.pop(), game.deck.pop()];
}
function dealerPlay(game) {
  while (handTotal(game.dealerHand)<17) game.dealerHand.push(game.deck.pop());
}

function resolveHand(playerHand, dealerHand) {
  const pt = handTotal(playerHand);
  const dt = handTotal(dealerHand);
  if (pt > 21) return 'bust';
  if (isBlackjack(playerHand) && isBlackjack(dealerHand)) return 'push';
  if (isBlackjack(playerHand)) return 'blackjack';
  if (isBlackjack(dealerHand)) return 'lost';
  if (dt > 21) return 'won';
  if (pt > dt) return 'won';
  if (pt === dt) return 'push';
  return 'lost';
}
function resolveGame(game) {
  return resolveHand(game.playerHand, game.dealerHand);
}

function calcPayout(result, bet, doubled) {
  const m = doubled ? 2 : 1;
  if (result === 'blackjack') return Math.floor(bet * 1.5);
  if (result === 'won')  return bet * m;
  if (result === 'push') return 0;
  return -(bet * m);
}
function resultText(lang, result) {
  const map = {blackjack:'resultBJ', won:'resultWon', lost:'resultLost', bust:'resultBust', push:'resultPush'};
  return t(lang, map[result] || 'resultLost');
}
const RESULT_COLOR = {blackjack:0xFFD700, won:0x27AE60, lost:0xE74C3C, bust:0xE74C3C, push:0xF39C12};

function playerButtons(canDouble, canSplitHand, lang) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hit').setLabel(t(lang,'hitBtn')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('stand').setLabel(t(lang,'standBtn')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('double').setLabel(t(lang,'doubleBtn')).setStyle(ButtonStyle.Danger).setDisabled(!canDouble),
    new ButtonBuilder().setCustomId('split').setLabel(t(lang,'splitBtn')).setStyle(ButtonStyle.Secondary).setDisabled(!canSplitHand),
  );
  return [row];
}
function endButtons(lang) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('newgame').setLabel(t(lang,'newBetBtn')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('newgame_same').setLabel(t(lang,'sameBetBtn')).setStyle(ButtonStyle.Primary),
  )];
}
function betButtons(balance) {
  const opts=[10,25,50,100,200,500].filter(v=>v<=balance);
  if (!opts.length) opts.push(Math.min(1,balance));
  const row=new ActionRowBuilder();
  opts.slice(0,5).forEach(v=>row.addComponents(
    new ButtonBuilder().setCustomId(`bet_${v}`).setLabel(`₺${v}`).setStyle(ButtonStyle.Secondary)
  ));
  return [row];
}

async function buildMsg(game, userId, lang, phase=null) {
  const hideDealer = game.phase === 'player';
  const balance = getBalance(userId);
  const currentBet = game.isSplit ? game.bet : game.bet * (game.doubled ? 2 : 1);

  const buf = await renderTable(
    game.dealerHand, game.playerHand, hideDealer, phase, balance, currentBet, lang,
    game.isSplit ? game.splitHand : null,
    game.isSplit ? game.activeHandIndex : 0
  );
  const att = new AttachmentBuilder(buf, {name:'table.png'});

  const primaryResult = game.result;
  const embedColor = primaryResult ? RESULT_COLOR[primaryResult] : 0x1a6b35;

  const embed = new EmbedBuilder()
    .setTitle(t(lang,'bjTitle'))
    .setColor(embedColor)
    .setImage('attachment://table.png')
    .setFooter({text: t(lang,'footerLock',{bal:balance})});

  if (game.result) {
    if (game.isSplit && game.splitResult !== null) {
      const pay1 = calcPayout(game.result, game.bet, game.doubled);
      const pay2 = calcPayout(game.splitResult, game.bet, game.splitDoubled);
      const total = pay1 + pay2;
      const fmtPay = p => p > 0 ? `+₺${p}` : p === 0 ? '₺0' : `-₺${Math.abs(p)}`;
      embed.setDescription(t(lang,'resultLineSplit',{
        r1: resultText(lang, game.result),
        p1: handTotal(game.playerHand),
        r2: resultText(lang, game.splitResult),
        p2: handTotal(game.splitHand),
        dt: handTotal(game.dealerHand),
        pay1: fmtPay(pay1),
        pay2: fmtPay(pay2),
        totalPay: fmtPay(total),
        bal: getBalance(userId),
      }));
    } else {
      const payout = calcPayout(game.result, game.bet, game.doubled);
      const payStr = payout > 0 ? `+₺${payout}` : payout === 0 ? '₺0' : `-₺${Math.abs(payout)}`;
      embed.setDescription(t(lang,'resultLine',{
        result: resultText(lang, game.result),
        pt: handTotal(game.playerHand), dt: handTotal(game.dealerHand),
        pay: payStr, bal: getBalance(userId)
      }));
    }
  } else if (game.isSplit) {
    embed.setDescription(t(lang,'dealerLineSplit',{
      show: `${game.dealerHand[0].rank}${game.dealerHand[0].suit.symbol} + 🂠`,
      hand1: game.playerHand.map(c=>`${c.rank}${c.suit.symbol}`).join(' '),
      total1: handTotal(game.playerHand),
      active1: game.activeHandIndex === 0 ? '▶' : '',
      dbld1: game.doubled ? t(lang,'doubled') : '',
      hand2: game.splitHand.map(c=>`${c.rank}${c.suit.symbol}`).join(' '),
      total2: handTotal(game.splitHand),
      active2: game.activeHandIndex === 1 ? '▶' : '',
      dbld2: game.splitDoubled ? t(lang,'doubled') : '',
      bet: game.bet,
    }));
  } else {
    embed.setDescription(t(lang,'dealerLine',{
      show: `${game.dealerHand[0].rank}${game.dealerHand[0].suit.symbol} + 🂠`,
      hand: game.playerHand.map(c=>`${c.rank}${c.suit.symbol}`).join(' '),
      total: handTotal(game.playerHand),
      bet: game.bet,
      doubled: game.doubled ? t(lang,'doubled') : ''
    }));
  }

  return {embeds:[embed], files:[att]};
}

async function startGame(interaction, bet, lang) {
  const userId = interaction.user.id;
  const balance = getBalance(userId);
  if (bet > balance) {
    return interaction.editReply({content:t(lang,'insufficientBal',{bal:balance}),embeds:[],files:[],components:[],ephemeral:true});
  }
  const old = activeGames.get(userId);
  if (old?._collector) old._collector.stop('replaced');
  const game = newRoundState(bet);
  dealInitial(game);
  activeGames.set(userId, game);

  if (isBlackjack(game.playerHand)) {
    game.phase = 'done'; dealerPlay(game);
    game.result = resolveGame(game);
    changeBalance(userId, calcPayout(game.result, bet, false));
    recordResult(userId, game.result);
    const msg = await buildMsg(game, userId, lang, resultText(lang, game.result));
    await interaction.editReply({...msg, components:endButtons(lang), ephemeral:true});
    const reply = await interaction.fetchReply();
    setupCollector(reply, interaction, userId, lang);
    return;
  }

  const canDouble = balance >= bet * 2;
  const canSplitBtn = canSplit(game.playerHand) && balance >= bet * 2;
  const msg = await buildMsg(game, userId, lang);
  await interaction.editReply({...msg, components:playerButtons(canDouble, canSplitBtn, lang), ephemeral:true});
  const reply = await interaction.fetchReply();
  setupCollector(reply, interaction, userId, lang);
}

async function showBetScreen(interaction, userId, lang) {
  const bal = getBalance(userId);
  if (bal <= 0) {
    await interaction.editReply({content:t(lang,'noBalance'),embeds:[],files:[],components:[],ephemeral:true});
    return;
  }
  await interaction.editReply({
    content: t(lang,'selectBet',{bal}),
    embeds:[], files:[], components:betButtons(bal), ephemeral:true
  });
  const reply = await interaction.fetchReply();
  const betCollector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === userId && i.customId.startsWith('bet_'),
    time: 120_000, max: 1,
  });
  betCollector.on('collect', async btn => {
    try { await btn.deferUpdate(); } catch (e) { if (e.code!==40060&&e.code!==10062) console.error(e); }
    const newBet = parseInt(btn.customId.split('_')[1]);
    await interaction.editReply({content:t(lang,'dealing',{bet:newBet}),embeds:[],files:[],components:[],ephemeral:true});
    await startGame(interaction, newBet, lang);
  });
  betCollector.on('end',(_,reason)=>{
    if (reason==='time') interaction.editReply({content:t(lang,'timeout'),components:[],embeds:[],files:[]}).catch(()=>{});
  });
}

function setupCollector(reply, interaction, userId, lang) {
  const game = activeGames.get(userId);
  if (!game) return;
  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === userId,
    time: 300_000,
  });
  game._collector = collector;

  collector.on('collect', async btn => {
    const g = activeGames.get(userId);
    if (!g) return;
    if (g._processing) { try { await btn.deferUpdate(); } catch {} return; }
    g._processing = true;
    try { await btn.deferUpdate(); }
    catch (e) { if (e.code!==40060&&e.code!==10062) console.error('deferUpdate:',e); }

    try {
      if (g.phase === 'done') {
        if (btn.customId === 'newgame') {
          collector.stop('replaced');
          await showBetScreen(interaction, userId, lang);
        } else if (btn.customId === 'newgame_same') {
          collector.stop('replaced');
          await newGameSame(interaction, userId, g, lang);
        }
        return;
      }

      const activeHand = g.isSplit && g.activeHandIndex === 1 ? g.splitHand : g.playerHand;
      const isPlayingSplitHand = g.isSplit && g.activeHandIndex === 1;

      if (btn.customId === 'split') {
        const balance = getBalance(userId);
        if (!canSplit(g.playerHand) || balance < g.bet * 2) {
          await interaction.editReply({content: t(lang,'noSplit'), ephemeral:true});
          return;
        }
        changeBalance(userId, -g.bet);
        g.isSplit = true;
        g.splitHand = [g.playerHand.pop()];
        g.playerHand.push(g.deck.pop());
        g.splitHand.push(g.deck.pop());
        g.activeHandIndex = 0;

        const bal = getBalance(userId);
        const canDbl = bal >= g.bet;
        const msg = await buildMsg(g, userId, lang);
        await interaction.editReply({...msg, components: playerButtons(canDbl, false, lang), ephemeral:true});
        return;
      }

      if (btn.customId === 'hit') {
        activeHand.push(g.deck.pop());
        const total = handTotal(activeHand);

        if (total >= 21) {
          if (g.isSplit && g.activeHandIndex === 0) {
            g.activeHandIndex = 1;
            const bal = getBalance(userId);
            const canDbl = bal >= g.bet && g.splitHand.length === 2;
            const msg = await buildMsg(g, userId, lang);
            await interaction.editReply({...msg, components: playerButtons(canDbl, false, lang), ephemeral:true});
          } else {
            await finishGame(interaction, userId, g, lang);
          }
        } else {
          const msg = await buildMsg(g, userId, lang);
          await interaction.editReply({...msg, components: playerButtons(false, false, lang), ephemeral:true});
        }
      } else if (btn.customId === 'stand') {
        if (g.isSplit && g.activeHandIndex === 0) {
          g.activeHandIndex = 1;
          const bal = getBalance(userId);
          const canDbl = bal >= g.bet && g.splitHand.length === 2;
          const msg = await buildMsg(g, userId, lang);
          await interaction.editReply({...msg, components: playerButtons(canDbl, false, lang), ephemeral:true});
        } else {
          await finishGame(interaction, userId, g, lang);
        }
      } else if (btn.customId === 'double') {
        const balance = getBalance(userId);
        if (balance < g.bet) {
          await interaction.editReply({content: t(lang,'noDouble'), ephemeral:true});
          return;
        }
        if (isPlayingSplitHand) {
          g.splitDoubled = true;
        } else {
          g.doubled = true;
        }
        activeHand.push(g.deck.pop());

        if (g.isSplit && g.activeHandIndex === 0) {
          g.activeHandIndex = 1;
          const bal = getBalance(userId);
          const canDbl = bal >= g.bet && g.splitHand.length === 2;
          const msg = await buildMsg(g, userId, lang);
          await interaction.editReply({...msg, components: playerButtons(canDbl, false, lang), ephemeral:true});
        } else {
          await finishGame(interaction, userId, g, lang);
        }
      }
    } finally {
      if (activeGames.get(userId) === g) g._processing = false;
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') {
      interaction.editReply({content:t(lang,'timeout'),components:[],embeds:[],files:[]}).catch(()=>{});
      activeGames.delete(userId);
    }
  });
}

async function finishGame(interaction, userId, game, lang) {
  game.phase = 'done';
  dealerPlay(game);

  if (game.isSplit) {
    game.result = resolveHand(game.playerHand, game.dealerHand);
    game.splitResult = resolveHand(game.splitHand, game.dealerHand);

    const pay1 = calcPayout(game.result, game.bet, game.doubled);
    const pay2 = calcPayout(game.splitResult, game.bet, game.splitDoubled);
    changeBalance(userId, pay1 + pay2);

    recordResult(userId, game.result);
    recordResult(userId, game.splitResult);

    let phaseText;
    if (game.result === 'blackjack' || game.splitResult === 'blackjack') phaseText = resultText(lang, 'blackjack');
    else if (game.result === 'won' && game.splitResult === 'won') phaseText = resultText(lang, 'won');
    else if (game.result === 'lost' && game.splitResult === 'lost') phaseText = resultText(lang, 'lost');
    else if (game.result === 'bust' && game.splitResult === 'bust') phaseText = resultText(lang, 'bust');
    else phaseText = '🃏 ' + (lang === 'tr' ? 'Split Sonuç' : 'Split Result');

    const msg = await buildMsg(game, userId, lang, phaseText);
    await interaction.editReply({...msg, components: endButtons(lang), ephemeral:true});
  } else {
    game.result = resolveGame(game);
    changeBalance(userId, calcPayout(game.result, game.bet, game.doubled));
    recordResult(userId, game.result);
    const msg = await buildMsg(game, userId, lang, resultText(lang, game.result));
    await interaction.editReply({...msg, components: endButtons(lang), ephemeral:true});
  }
}

async function newGameSame(interaction, userId, oldGame, lang) {
  const bet = oldGame?.bet || 10;
  const balance = getBalance(userId);
  if (balance <= 0) {
    await interaction.editReply({content:t(lang,'noBalance'),components:[],embeds:[],files:[],ephemeral:true}); return;
  }
  const actual = bet > balance ? Math.min(10, balance) : bet;
  await interaction.editReply({content:t(lang,'dealing',{bet:actual}),embeds:[],files:[],components:[],ephemeral:true});
  await startGame(interaction, actual, lang);
}

// ═══════════════════════════════════════════════════════════════════
//  MULTİPLAYER
// ═══════════════════════════════════════════════════════════════════
const multiLobbies = new Map();
const MAX_MULTI_PLAYERS = 6;
const LOBBY_TIMEOUT = 60_000;

async function buildMultiMsg(lobby, activeUid, gamePhase, lang) {
  const playerEntries = lobby.playerOrder.map(uid => ({
    name: lobby.names?.get(uid) || `User ${uid.slice(-4)}`,
    hand: lobby.hands.get(uid) || [],
    bet: lobby.bets.get(uid) || 0,
    balance: getBalance(uid),
    isActive: uid === activeUid,
    result: lobby.results.get(uid) || null,
  }));

  const buf = await renderMultiTable(
    lobby.dealerHand, playerEntries,
    gamePhase === null,
    gamePhase, lang
  );
  const att = new AttachmentBuilder(buf, { name: 'multi_table.png' });
  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'multiTitle'))
    .setColor(gamePhase ? 0xFFD700 : 0x1a6b35)
    .setImage('attachment://multi_table.png')
    .setFooter({ text: 'BlackJack Multiplayer' });

  if (activeUid && !gamePhase) {
    const name = lobby.names?.get(activeUid) || `<@${activeUid}>`;
    embed.setDescription(t(lang, 'multiYourTurn', { user: `**${name}**` }));
  }

  return { embeds: [embed], files: [att] };
}

async function handleMultiCommand(interaction, lang) {
  const channelId = interaction.channelId;
  const hostId    = interaction.user.id;
  const invitedUser = interaction.options.getUser('user') || null;

  if (multiLobbies.has(channelId)) {
    await interaction.reply({ content: '❌ Bu kanalda zaten aktif bir multiplayer lobisi var!', ephemeral: true });
    return;
  }

  const lobby = {
    hostId,
    players: new Set([hostId]),
    names: new Map([[hostId, interaction.user.displayName || interaction.user.username]]),
    bets: new Map(),
    hands: new Map(),
    results: new Map(),
    dealerHand: [],
    deck: [],
    phase: 'lobby',
    currentPlayerIndex: 0,
    playerOrder: [],
    invitedId: invitedUser?.id || null,
    message: null,
    lobbyMessage: null,
    timeout: null,
  };
  multiLobbies.set(channelId, lobby);

  const hostMention   = `<@${hostId}>`;
  const targetMention = invitedUser ? `<@${invitedUser.id}>` : null;

  const lobbyDesc = invitedUser
    ? t(lang, 'multiLobbyInvite', { host: hostMention, target: targetMention, max: MAX_MULTI_PLAYERS, sec: LOBBY_TIMEOUT/1000 })
    : t(lang, 'multiLobbyOpen',   { max: MAX_MULTI_PLAYERS, sec: LOBBY_TIMEOUT/1000 });

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'multiTitle'))
    .setColor(0xFFD700)
    .setDescription(lobbyDesc)
    .addFields({ name: `👥 ${t(lang,'multiPlayers')} (1/${MAX_MULTI_PLAYERS})`, value: hostMention })
    .setFooter({ text: 'BlackJack Multiplayer' });

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('multi_join').setLabel(t(lang,'multiJoinBtn')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('multi_start').setLabel(t(lang,'multiStartBtn')).setStyle(ButtonStyle.Primary),
  );

  await interaction.reply({ embeds: [embed], components: [joinRow] });
  const lobbyMsg = await interaction.fetchReply();
  lobby.lobbyMessage = lobbyMsg;

  lobby.timeout = setTimeout(async () => {
    if (multiLobbies.get(channelId) === lobby && lobby.phase === 'lobby') {
      if (lobby.players.size < 2) {
        multiLobbies.delete(channelId);
        await lobbyMsg.edit({ content: t(lang,'multiNoPlayers'), embeds: [], components: [] }).catch(()=>{});
        return;
      }
      await startMultiGame(lobby, channelId, lang, interaction);
    }
  }, LOBBY_TIMEOUT);

  const lobbyCollector = lobbyMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => ['multi_join','multi_start'].includes(i.customId),
    time: LOBBY_TIMEOUT + 5000,
  });

  lobbyCollector.on('collect', async btn => {
    try { await btn.deferUpdate(); } catch {}
    const uid = btn.user.id;

    if (btn.customId === 'multi_join') {
      if (lobby.invitedId && uid !== lobby.invitedId && uid !== lobby.hostId) {
        try { await btn.followUp({ content: '❌ Bu lobi özel davetiyeli!', ephemeral: true }); } catch {}
        return;
      }
      if (lobby.players.has(uid)) {
        try { await btn.followUp({ content: t(lang,'multiAlreadyIn'), ephemeral: true }); } catch {}
        return;
      }
      if (lobby.players.size >= MAX_MULTI_PLAYERS) {
        try { await btn.followUp({ content: t(lang,'multiLobbyFull'), ephemeral: true }); } catch {}
        return;
      }
      lobby.players.add(uid);
      lobby.names.set(uid, btn.user.displayName || btn.user.username);

      const playerList = [...lobby.players].map(id=>`<@${id}>`).join('\n');
      const newEmbed = EmbedBuilder.from(embed)
        .spliceFields(0, 1, { name: `👥 ${t(lang,'multiPlayers')} (${lobby.players.size}/${MAX_MULTI_PLAYERS})`, value: playerList });
      await lobbyMsg.edit({ embeds: [newEmbed], components: [joinRow] }).catch(()=>{});
    }

    if (btn.customId === 'multi_start') {
      if (uid !== lobby.hostId) {
        try { await btn.followUp({ content: '❌ Sadece lobi kurucusu başlatabilir!', ephemeral: true }); } catch {}
        return;
      }
      if (lobby.players.size < 2) {
        try { await btn.followUp({ content: t(lang,'multiNotEnough'), ephemeral: true }); } catch {}
        return;
      }
      clearTimeout(lobby.timeout);
      lobbyCollector.stop('started');
      await startMultiGame(lobby, channelId, lang, interaction);
    }
  });

  lobbyCollector.on('end', (_, reason) => {
    if (reason === 'time' && multiLobbies.get(channelId) === lobby && lobby.phase === 'lobby') {
      multiLobbies.delete(channelId);
      lobbyMsg.edit({ content: t(lang,'multiNoPlayers'), embeds: [], components: [] }).catch(()=>{});
    }
  });
}

async function startMultiGame(lobby, channelId, lang, interaction) {
  lobby.phase   = 'betting';
  lobby.deck    = shuffle(createDecks(6));
  lobby.playerOrder = [...lobby.players];

  await lobby.lobbyMessage.edit({ content: '🃏 Oyun başladı! Bahisler toplanıyor...', embeds: [], components: [] }).catch(()=>{});

  for (const uid of lobby.playerOrder) {
    const bal = getBalance(uid);
    if (bal <= 0) { lobby.bets.set(uid, 0); continue; }

    const uname = lobby.names?.get(uid) || `User ${uid.slice(-4)}`;

    const betBuf = await renderMultiBetScreen(uname, bal, lang);
    const betAtt = new AttachmentBuilder(betBuf, { name: 'bet_screen.png' });
    const promptEmbed = new EmbedBuilder()
      .setTitle(t(lang, 'multiTitle'))
      .setColor(0x3498DB)
      .setDescription(t(lang, 'multiBetPrompt', { user: `<@${uid}>`, bal }))
      .setImage('attachment://bet_screen.png')
      .setFooter({ text: 'BlackJack Multiplayer • 30s' });

    const bRow = new ActionRowBuilder();
    [10, 25, 50, 100, 200, 500].filter(v => v <= bal).slice(0, 5).forEach(v =>
      bRow.addComponents(new ButtonBuilder().setCustomId(`mbет_${uid}_${v}`).setLabel(`₺${v}`).setStyle(ButtonStyle.Secondary))
    );

    const betMsg = await interaction.channel.send({ embeds: [promptEmbed], files: [betAtt], components: [bRow] });

    await new Promise(resolve => {
      const c = betMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === uid && i.customId.startsWith(`mbет_${uid}_`),
        time: 30_000, max: 1,
      });
      c.on('collect', async btn => {
        try { await btn.deferUpdate(); } catch {}
        const amt = parseInt(btn.customId.split('_')[2]);
        lobby.bets.set(uid, amt);
        await betMsg.edit({ content: `✅ <@${uid}> → ₺${amt} bahis koydu.`, embeds:[], files:[], components:[] }).catch(()=>{});
        resolve();
      });
      c.on('end', (_, reason) => {
        if (reason === 'time') {
          const def = Math.min(10, bal);
          lobby.bets.set(uid, def);
          betMsg.edit({ content: `⏰ <@${uid}> süre doldu, otomatik ₺${def} bahis.`, embeds:[], files:[], components:[] }).catch(()=>{});
        }
        resolve();
      });
    });
  }

  for (const uid of lobby.playerOrder) {
    lobby.hands.set(uid, [lobby.deck.pop(), lobby.deck.pop()]);
  }
  lobby.dealerHand = [lobby.deck.pop(), lobby.deck.pop()];

  await playMultiTurns(lobby, channelId, lang, interaction);
}

async function playMultiTurns(lobby, channelId, lang, interaction) {
  lobby.phase = 'playing';

  const initMsg = await buildMultiMsg(lobby, lobby.playerOrder[0], null, lang);
  const tableMsg = await interaction.channel.send(initMsg);

  for (const uid of lobby.playerOrder) {
    if (lobby.bets.get(uid) === 0) continue;
    const hand = lobby.hands.get(uid);

    if (isBlackjack(hand)) {
      lobby.results.set(uid, 'blackjack');
      const upd = await buildMultiMsg(lobby, null, null, lang);
      await tableMsg.edit(upd).catch(()=>{});
      continue;
    }

    const turnUpd = await buildMultiMsg(lobby, uid, null, lang);
    await tableMsg.edit(turnUpd).catch(()=>{});

    const turnRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`mt_hit_${uid}`).setLabel(t(lang,'hitBtn')).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`mt_stand_${uid}`).setLabel(t(lang,'standBtn')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`mt_double_${uid}`).setLabel(t(lang,'doubleBtn')).setStyle(ButtonStyle.Danger)
        .setDisabled(getBalance(uid) < lobby.bets.get(uid)),
    );
    const actionMsg = await interaction.channel.send({
      content: `${t(lang, 'multiYourTurn', { user: `<@${uid}>` })}`,
      components: [turnRow],
    });

    await new Promise(resolve => {
      const c = actionMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === uid && i.customId.startsWith(`mt_`) && i.customId.endsWith(`_${uid}`),
        time: 45_000,
      });

      c.on('collect', async btn => {
        try { await btn.deferUpdate(); } catch {}
        const action = btn.customId.split('_')[1];

        if (action === 'hit') {
          hand.push(lobby.deck.pop());
          const total = handTotal(hand);
          if (total > 21) {
            lobby.results.set(uid, 'bust');
            c.stop('done');
            buildMultiMsg(lobby, null, null, lang).then(u => tableMsg.edit(u)).catch(()=>{});
            actionMsg.edit({ content: `💥 <@${uid}> BUST — ${hand.map(c=>`${c.rank}${c.suit.symbol}`).join(' ')} = **${total}**`, components: [] }).catch(()=>{});
            return;
          }
          if (total === 21) {
            c.stop('done');
            buildMultiMsg(lobby, null, null, lang).then(u => tableMsg.edit(u)).catch(()=>{});
            actionMsg.edit({ content: `🃏 <@${uid}> 21! — ${hand.map(c=>`${c.rank}${c.suit.symbol}`).join(' ')}`, components: [] }).catch(()=>{});
            return;
          }
          buildMultiMsg(lobby, uid, null, lang).then(u => tableMsg.edit(u)).catch(()=>{});
          const noDoubleRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`mt_hit_${uid}`).setLabel(t(lang,'hitBtn')).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`mt_stand_${uid}`).setLabel(t(lang,'standBtn')).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`mt_double_${uid}`).setLabel(t(lang,'doubleBtn')).setStyle(ButtonStyle.Danger).setDisabled(true),
          );
          actionMsg.edit({ components: [noDoubleRow] }).catch(()=>{});
        }

        if (action === 'stand') {
          c.stop('done');
          buildMultiMsg(lobby, null, null, lang).then(u => tableMsg.edit(u)).catch(()=>{});
          actionMsg.edit({ content: `✋ <@${uid}> STAND — ${hand.map(c=>`${c.rank}${c.suit.symbol}`).join(' ')} = **${handTotal(hand)}**`, components: [] }).catch(()=>{});
        }

        if (action === 'double') {
          const bet = lobby.bets.get(uid);
          const bal = getBalance(uid);
          if (bal < bet) {
            try { await btn.followUp({ content: t(lang,'noDouble'), ephemeral: true }); } catch {}
            return;
          }
          lobby.bets.set(uid, bet * 2);
          hand.push(lobby.deck.pop());
          c.stop('done');
          buildMultiMsg(lobby, null, null, lang).then(u => tableMsg.edit(u)).catch(()=>{});
          actionMsg.edit({ content: `💰 <@${uid}> DOUBLE — ${hand.map(c=>`${c.rank}${c.suit.symbol}`).join(' ')} = **${handTotal(hand)}**`, components: [] }).catch(()=>{});
        }
      });

      c.on('end', (_, reason) => {
        if (reason === 'time') {
          actionMsg.edit({ content: `⏰ <@${uid}> süre doldu, otomatik STAND.`, components: [] }).catch(()=>{});
          buildMultiMsg(lobby, null, null, lang).then(u => tableMsg.edit(u)).catch(()=>{});
        }
        resolve();
      });
    });
  }

  while (handTotal(lobby.dealerHand) < 17) lobby.dealerHand.push(lobby.deck.pop());

  for (const uid of lobby.playerOrder) {
    if (lobby.results.has(uid)) continue;
    const res = resolveHand(lobby.hands.get(uid), lobby.dealerHand);
    lobby.results.set(uid, res);
  }

  for (const uid of lobby.playerOrder) {
    const res = lobby.results.get(uid) || 'lost';
    const bet = lobby.bets.get(uid) || 0;
    if (bet === 0) continue;
    const pay = calcPayout(res, bet, false);
    changeBalance(uid, pay);
    recordResult(uid, res);
  }

  const finalTableMsg = await buildMultiMsg(lobby, null, t(lang, 'multiGameOver'), lang);
  await tableMsg.edit(finalTableMsg).catch(()=>{});

  multiLobbies.delete(channelId);
}

// ═══════════════════════════════════════════════════════════════════
// COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const lang = getLang(interaction.user.id, interaction.guildId);

  if (interaction.commandName === 'bj') {
    await interaction.deferReply({ephemeral:true});
    await startGame(interaction, interaction.options.getInteger('bet'), lang);
  }

  else if (interaction.commandName === 'bjbalance') {
    await interaction.deferReply();
    const balance = getBalance(interaction.user.id);
    const buf = await renderBalanceCard(interaction.user.id, interaction.user.username, lang);
    const att = new AttachmentBuilder(buf,{name:'balance.png'});
    const embed = new EmbedBuilder()
      .setTitle(t(lang,'balTitle')).setColor(0xFFD700)
      .setImage('attachment://balance.png')
      .setDescription(t(lang,'balDesc',{user:interaction.user.toString(),bal:balance}))
      .setFooter({text:balance<=0?t(lang,'balFooterEmpty'):t(lang,'balFooterPlay')});
    await interaction.editReply({embeds:[embed],files:[att]});
  }

  else if (interaction.commandName === 'bjrules') {
    const embed = new EmbedBuilder()
      .setTitle(t(lang,'rulesTitle')).setColor(0x1a6b35)
      .addFields(
        {name:'🎯 Goal',        value:t(lang,'rulesGoal')},
        {name:'🃏 Card Values', value:t(lang,'rulesCards')},
        {name:'🎮 Actions',     value:t(lang,'rulesActions')},
        {name:'🏦 Dealer',      value:t(lang,'rulesDealer')},
        {name:'💰 Payouts',     value:t(lang,'rulesPayout')},
        {name:'💥 Bust Rule',   value:t(lang,'rulesBust')},
        {name:'🤝 Push',        value:t(lang,'rulesPush')},
        {name:'✂️ Split',       value:t(lang,'rulesSplit')},
      )
      .setFooter({text:t(lang,'rulesFooter')});
    await interaction.reply({embeds:[embed],ephemeral:true});
  }

  else if (interaction.commandName === 'bjlanguage') {
    const chosen = interaction.options.getString('language');
    stmts.setUserLang.run(interaction.user.id, chosen);
    await interaction.reply({content:t(chosen,'langChanged'),ephemeral:true});
  }

  else if (interaction.commandName === 'bjserverlanguage') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({content:t(lang,'adminOnly'),ephemeral:true});
    }
    const chosen   = interaction.options.getString('language');
    stmts.setServerLang.run(interaction.guildId, chosen);
    const langName = chosen === 'tr' ? 'Türkçe' : 'English';
    await interaction.reply({content:t(lang,'serverLangChanged',{lang:langName}),ephemeral:true});
  }

  else if (interaction.commandName === 'bjchipleader') {
    await interaction.deferReply();
    const entries = getLeaderboard(10);
    if (entries.length === 0) {
      return interaction.editReply({
        embeds:[new EmbedBuilder().setTitle(t(lang,'lbTitle')).setColor(0xFFD700)
          .setDescription(t(lang,'lbEmpty')).setFooter({text:t(lang,'lbFooter')})]
      });
    }
    const medals = ['🥇','🥈','🥉'];
    const lines  = [];
    for (let i = 0; i < entries.length; i++) {
      const [userId, balance] = entries[i];
      let name = `User ${userId.slice(-4)}`;
      try {
        if (interaction.guild) {
          const member = await interaction.guild.members.fetch(userId);
          name = member.displayName;
        }
      } catch {}
      const medal = i < 3 ? medals[i] : `**#${i+1}**`;
      lines.push(`${medal} **${name}** — ₺${balance.toLocaleString()}`);
    }
    const embed = new EmbedBuilder().setTitle(t(lang,'lbTitle')).setColor(0xFFD700)
      .setDescription(lines.join('\n')).setFooter({text:t(lang,'lbFooter')});
    await interaction.editReply({ embeds: [embed] });
  }

  else if (interaction.commandName === 'bjdaily') {
    const result = claimDaily(interaction.user.id);
    if (result.success) {
      const embed = new EmbedBuilder().setTitle(t(lang,'dailyTitle')).setColor(0x27AE60)
        .setDescription(t(lang,'dailyClaimed',{amount:result.amount,bal:result.balance}))
        .setFooter({text:t(lang,'dailyFooter')});
      await interaction.reply({embeds:[embed]});
    } else {
      const embed = new EmbedBuilder().setTitle(t(lang,'dailyTitle')).setColor(0xE74C3C)
        .setDescription(t(lang,'dailyCooldown',{time:formatCooldown(result.remaining)}))
        .setFooter({text:t(lang,'dailyFooter')});
      await interaction.reply({embeds:[embed]});
    }
  }

  else if (interaction.commandName === 'bjstats') {
    const stats = getStats(interaction.user.id);
    const total = stats.wins + stats.losses + stats.pushes;
    const wr    = total > 0 ? ((stats.wins/total)*100).toFixed(1)+'%' : '—';
    const embed = new EmbedBuilder().setTitle(t(lang,'statsTitle')).setColor(0x3498DB)
      .setDescription(t(lang,'statsDesc',{user:interaction.user.toString()}))
      .addFields(
        {name:`🏆 ${t(lang,'statsWins')}`,    value:String(stats.wins),       inline:true},
        {name:`💀 ${t(lang,'statsLosses')}`,  value:String(stats.losses),     inline:true},
        {name:`🤝 ${t(lang,'statsPushes')}`,  value:String(stats.pushes),     inline:true},
        {name:`🎰 ${t(lang,'statsBJs')}`,     value:String(stats.blackjacks), inline:true},
        {name:'🎮 Total',                     value:String(total),            inline:true},
        {name:`📈 ${t(lang,'statsWinRate')}`, value:wr,                       inline:true},
      )
      .setFooter({text:t(lang,'statsFooter')});
    await interaction.reply({embeds:[embed]});
  }

  else if (interaction.commandName === 'bjhelp') {
    const isTr = lang === 'tr';
    const embed = new EmbedBuilder()
      .setTitle(t(lang, 'helpTitle'))
      .setColor(0xFFD700)
      .setDescription(isTr ? 'BlackJack botunun tüm komutları:' : 'All BlackJack bot commands:')
      .addFields(
        { name: '🃏 /bj <bahis>', value: isTr ? 'Tek kişilik BlackJack oyna.' : 'Play solo BlackJack.' },
        { name: '👥 /bjmulti [@kullanıcı]', value: isTr ? 'Çok oyunculu lobi aç. Tag opsiyonel.' : 'Open a multiplayer lobby. Tag is optional.' },
        { name: '💰 /bjbalance', value: isTr ? 'Chip bakiyeni göster.' : 'Show your chip balance.' },
        { name: '🎁 /bjdaily', value: isTr ? 'Her 24 saatte ₺100 al.' : 'Claim ₺100 every 24h.' },
        { name: '🏆 /bjchipleader', value: isTr ? 'En zengin 10 oyuncu.' : 'Top 10 richest players.' },
        { name: '📊 /bjstats', value: isTr ? 'Oyun istatistiklerin.' : 'Your game statistics.' },
        { name: '📖 /bjrules', value: isTr ? 'Kurallar ve ödeme oranları.' : 'Rules and payout rates.' },
        { name: '🌐 /bjlanguage <en|tr>', value: isTr ? 'Kişisel dilini ayarla.' : 'Set your personal language.' },
        { name: '🔧 /bjserverlanguage <en|tr>  *(Admin)*', value: isTr ? 'Sunucu dilini ayarla.' : 'Set server default language.' },
      )
      .setFooter({ text: t(lang, 'helpFooter') });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  else if (interaction.commandName === 'bjmulti') {
    await handleMultiCommand(interaction, lang);
  }
});

// PREFIX !bjbalance
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.toLowerCase().startsWith('!bjbalance')) return;
  const lang    = getLang(message.author.id, message.guildId);
  const balance = getBalance(message.author.id);
  try {
    const buf = await renderBalanceCard(message.author.id, message.author.username, lang);
    const att = new AttachmentBuilder(buf,{name:'balance.png'});
    const embed = new EmbedBuilder()
      .setTitle(t(lang,'balTitle')).setColor(0xFFD700)
      .setImage('attachment://balance.png')
      .setDescription(t(lang,'balDesc',{user:message.author.toString(),bal:balance}))
      .setFooter({text:balance<=0?t(lang,'balFooterEmpty'):t(lang,'balFooterPlay')});
    await message.reply({embeds:[embed],files:[att]});
  } catch(err) {
    console.error('!bjbalance error:',err);
    await message.reply(`💰 Balance: **₺${balance}**`);
  }
});

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// ═══════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════
client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} online!`);
  console.log(`🗄️  SQLite veritabanı hazır: blackjack.db`);
  await registerCommands();

  let statusIndex = 0;
  const rotateStatus = () => {
    const guildCount = client.guilds.cache.size;
    const totalUsers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    const statuses = [
      { text: `BlackJack on ${guildCount} servers 🃏`, type: 3 },
      { text: `Serving ${totalUsers} players`, type: 3 },
      { text: `/bjhelp`, type: 2 },
    ];
    const s = statuses[statusIndex % statuses.length];
    client.user.setActivity(s.text, { type: s.type });
    statusIndex++;
  };

  rotateStatus();
  setInterval(rotateStatus, 15_000);

  const gc = client.guilds.cache.size;
  const tu = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
  console.log(`📊 ${gc} sunucu | ${tu} kullanici`);
});

// Bot kapanırken DB'yi güvenle kapat
process.on('SIGINT', () => {
  console.log('📴 Bot kapatılıyor, veritabanı kaydediliyor...');
  db.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

client.login(TOKEN);
