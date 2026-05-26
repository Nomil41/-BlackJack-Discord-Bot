# 🃏 BlackJack Discord Bot

Tam özellikli, canvas tabanlı görsel arayüze sahip, SQLite destekli bir Discord BlackJack botu. Hem tek oyunculu hem de çok oyunculu (multiplayer) modları desteklenir.

---

## ✨ Özellikler

- 🃏 **Gerçekçi BlackJack oyunu** — Hit, Stand, Double, Split
- 🖼️ **Canvas tabanlı masa görseli** — Her el için dinamik kart ve chip görseli render edilir
- 👥 **Multiplayer lobi** — 2–6 oyuncuyla aynı masada oyna
- 💰 **Chip ekonomisi** — Bakiye, günlük ödül ve liderlik tablosu
- 📊 **Oyuncu istatistikleri** — Kazanma oranı, blackjack sayısı vb.
- 🌐 **Çoklu dil desteği** — Türkçe ve İngilizce (kullanıcı ve sunucu bazlı)
- 🗄️ **SQLite veritabanı** — WAL modunda hızlı ve güvenli kalıcı veri
- 🔒 **Ephemeral mesajlar** — Tek oyunculu oyunlar sadece sana görünür

---

## 📋 Gereksinimler

- [Node.js](https://nodejs.org/) v18+
- Bir [Discord Bot Token](https://discord.com/developers/applications)

---

## 🚀 Kurulum

**1. Repoyu klonla:**
```bash
git clone https://github.com/kullanicin/blackjack-bot.git
cd blackjack-bot
```

**2. Bağımlılıkları yükle:**
```bash
npm install discord.js @napi-rs/canvas better-sqlite3
```

**3. `index.js` içinde token ve client ID'yi ayarla:**
```js
const TOKEN     = 'BURAYA_BOT_TOKENINI_YAZ';
const CLIENT_ID = 'BURAYA_CLIENT_ID_YAZ';
```

> ⚠️ Token'ını kesinlikle herkese açık bir yere (GitHub, Discord vb.) yükleme!

**4. Botu başlat:**
```bash
node index.js
```

İlk çalıştırmada slash komutları otomatik olarak kaydedilir ve `blackjack.db` dosyası oluşturulur.

---

## 🎮 Komutlar

| Komut | Açıklama |
|-------|----------|
| `/bj <bahis>` | Tek kişilik BlackJack oyna |
| `/bjmulti [@kullanıcı]` | Çok oyunculu lobi aç (2–6 oyuncu) |
| `/bjbalance` | Chip bakiyeni göster |
| `/bjdaily` | Her 24 saatte ₺100 günlük ödül al |
| `/bjchipleader` | En zengin 10 oyuncu sıralaması |
| `/bjstats` | Oyun istatistiklerini görüntüle |
| `/bjrules` | Kurallar ve ödeme oranları |
| `/bjlanguage <en\|tr>` | Kişisel dilini ayarla |
| `/bjserverlanguage <en\|tr>` | Sunucu varsayılan dilini ayarla *(Admin)* |
| `/bjhelp` | Tüm komutları listele |

**Prefix komutu:**
```
!bjbalance  →  Bakiyeni mesaj olarak göster
```

---

## 🃏 Oyun Kuralları

- **Amaç:** Kurpiyeri geçmeden 21'e en yakın eli topla
- **Kart değerleri:** 2–10 yüz değeri · J/Q/K = 10 · A = 1 veya 11
- **Hit:** Bir kart daha çek
- **Stand:** Elini koru
- **Double:** Bahsi ikiye katla, tek kart çek
- **Split:** Eşit iki kartı iki ayrı ele böl (aynı bahis gerekir)
- **Kurpiyer:** 17'de durur, 16 ve altında çeker

**Ödeme oranları:**

| Sonuç | Ödeme |
|-------|-------|
| Kazanç | 1:1 |
| BlackJack | 3:2 |
| Berabere (Push) | Bahis iade |
| Kayıp / Bust | Bahis gider |

---

## 💾 Veritabanı

SQLite (`blackjack.db`) otomatik olarak oluşturulur. Tablolar:

| Tablo | İçerik |
|-------|--------|
| `balances` | Kullanıcı bakiyeleri |
| `daily` | Günlük ödül zamanları |
| `stats` | Oyun istatistikleri |
| `languages` | Kullanıcı dil tercihleri |
| `server_languages` | Sunucu dil tercihleri |

---

## 📁 Dosya Yapısı

```
blackjack-bot/
├── index.js        # Ana bot dosyası
├── blackjack.db    # SQLite veritabanı (otomatik oluşur)
├── package.json
└── README.md
```

---

## 🌐 Dil Desteği

- **`/bjlanguage en`** veya **`/bjlanguage tr`** — Kişisel dil ayarı
- **`/bjserverlanguage en`** veya **`/bjserverlanguage tr`** — Sunucu geneli varsayılan (Admin yetkisi gerekli)
- Kullanıcı tercihi, sunucu ayarını geçersiz kılar

---

## 🔧 Geliştirici Notları

- Tüm canvas işlemleri `@napi-rs/canvas` ile yapılır (Node.js native binding)
- Oyun state'leri `activeGames` Map'inde tutulur, veritabanına yalnızca kalıcı veriler yazılır
- Multiplayer oyunlar kanal bazlı `multiLobbies` Map'inde yönetilir
- `process.on('uncaughtException')` ve `unhandledRejection` ile bot kararlı tutulur
- SIGINT/SIGTERM sinyallerinde veritabanı güvenle kapatılır

---

## 📜 Lisans

MIT — Dilediğin gibi kullanabilir, fork'layabilir ve geliştirebilirsin.
