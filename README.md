# 🃏 BlackJack Discord Bot

A fully-featured Discord BlackJack bot with a canvas-based visual interface and SQLite backend. Supports both solo and multiplayer modes.

---

## ✨ Features

- 🃏 **Full BlackJack gameplay** — Hit, Stand, Double, Split
- 🖼️ **Canvas-rendered table** — Dynamic card and chip visuals for every hand
- 👥 **Multiplayer lobby** — Play with 2–6 players at the same table
- 💰 **Chip economy** — Balance, daily rewards and leaderboard
- 📊 **Player statistics** — Win rate, blackjack count and more
- 🌐 **Multi-language support** — English and Turkish (per user and per server)
- 🗄️ **SQLite database** — Fast and reliable persistent storage with WAL mode
- 🔒 **Ephemeral messages** — Solo games are only visible to you

---

## 📋 Requirements

- [Node.js](https://nodejs.org/) v18+
- A [Discord Bot Token](https://discord.com/developers/applications)

---

## 🚀 Installation

**1. Clone the repo:**
```bash
git clone https://github.com/yourusername/blackjack-bot.git
cd blackjack-bot
```

**2. Install dependencies:**
```bash
npm install discord.js @napi-rs/canvas better-sqlite3
```

**3. Set your token and client ID in `index.js`:**
```js
const TOKEN     = 'YOUR_BOT_TOKEN_HERE';
const CLIENT_ID = 'YOUR_CLIENT_ID_HERE';
```

> ⚠️ Never share your token publicly (GitHub, Discord, etc.)!

**4. Start the bot:**
```bash
node index.js
```

On first run, slash commands are registered automatically and `blackjack.db` is created.

---

## 🎮 Commands

| Command | Description |
|---------|-------------|
| `/bj <bet>` | Play solo BlackJack |
| `/bjmulti [@user]` | Open a multiplayer lobby (2–6 players) |
| `/bjbalance` | Show your chip balance |
| `/bjdaily` | Claim ₺100 every 24 hours |
| `/bjchipleader` | Top 10 richest players |
| `/bjstats` | View your game statistics |
| `/bjrules` | Rules and payout rates |
| `/bjlanguage <en\|tr>` | Set your personal language |
| `/bjserverlanguage <en\|tr>` | Set server default language *(Admin only)* |
| `/bjhelp` | List all commands |

**Prefix command:**
```
!bjbalance  →  Show your balance as a message
```

---

## 🃏 Game Rules

- **Goal:** Get as close to 21 as possible without going over, beating the dealer
- **Card values:** 2–10 face value · J/Q/K = 10 · A = 1 or 11
- **Hit:** Draw another card
- **Stand:** Keep your hand
- **Double:** Double your bet, draw one card
- **Split:** Split a matching pair into two separate hands (equal bet required)
- **Dealer:** Stands at 17, draws on 16 or below

**Payout rates:**

| Result | Payout |
|--------|--------|
| Win | 1:1 |
| BlackJack | 3:2 |
| Push | Bet returned |
| Loss / Bust | Bet lost |

---

## 💾 Database

SQLite (`blackjack.db`) is created automatically. Tables:

| Table | Contents |
|-------|----------|
| `balances` | User balances |
| `daily` | Daily reward timestamps |
| `stats` | Game statistics |
| `languages` | User language preferences |
| `server_languages` | Server language preferences |

---

## 📁 File Structure

```
blackjack-bot/
├── index.js            # Main bot file
├── blackjack.db        # SQLite database (auto-created)
├── package.json
├── package-lock.json
└── README.md
```

---

## 🌐 Language Support

- **`/bjlanguage en`** or **`/bjlanguage tr`** — Set your personal language
- **`/bjserverlanguage en`** or **`/bjserverlanguage tr`** — Set server-wide default *(Admin only)*
- User preference always overrides the server setting

---

## 🔧 Developer Notes

- All canvas rendering is handled by `@napi-rs/canvas` (Node.js native binding)
- Game states are stored in the `activeGames` Map; only persistent data is written to the database
- Multiplayer sessions are managed per-channel in the `multiLobbies` Map
- `process.on('uncaughtException')` and `unhandledRejection` keep the bot stable
- Database is safely closed on SIGINT/SIGTERM signals

---

## 📜 License

MIT — Feel free to use, fork and improve.
