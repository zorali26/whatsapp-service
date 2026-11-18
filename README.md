# WhatsApp Asistan

Kişisel WhatsApp hattınız için sunucuda 7/24 çalışan, DeepSeek destekli yapay zekâ asistanı.

**Ne yapar?**
- Tüm sohbetlerinizi okur, veritabanına kaydeder
- Gelen her mesajda sohbetin özetini ve **konunun gittiği yönü** çıkarır
- Seçili kişilere/gruplara **insan gibi gecikme + "yazıyor..." durumu** ile otomatik yanıt verir
- Diğer sohbetler için onayınıza sunulan **cevap taslakları** hazırlar
- Panelden dilediğiniz sohbete soru sorun: *"Bu sohbette konu nereye gidiyor?"*
- Mesaj silme: kendi mesajınız → herkes için; karşı tarafın mesajı → yalnızca sizin ekranınızda

---

## ÖNEMLİ: Risk ve Yasal Sınırlar

1. **Bu bir "risksiz" çözüm değildir.** WhatsApp, kişisel hesaba bağlanan üçüncü taraf otomasyonu kullanım koşullarında yasaklar. Bu proje, WhatsApp Web'i **gerçek bir Chromium tarayıcı** ile ("gerçek insan gibi") kullanır ve insan benzeri gecikmeler ekler — ama ban riski hiçbir zaman %0 değildir. Riski gerçekten sıfıra indiren tek yol WhatsApp Business Platform (Cloud API) kullanmaktır; bu proje bilinçli olarak o yolu seçmemiştir.
2. **Başkasının mesajını herkes için silemezsiniz.** WhatsApp buna izin vermez. Sistem; sizin mesajınızı "herkesten sil" (yaklaşık 2 gün içinde), karşı tarafın mesajını ise yalnızca "benden sil" yapabilir.
3. Bu sistem **sizin kendi numaranız, sizin verileriniz** içindir. Numaranızı siz bağlarsınız, sohbetleriniz sizin sunucunuzda/diskinizde kalır. Karşı tarafın rızası olmadan otomatik yanıt verilen gruplarda/kişilerde dikkatli olun.

---

## Kurulum (Yerel)

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
# .env icinde PANEL_TOKEN ve DEEPSEEK_API_KEY doldurun
npm start
```

1. Konsoldaki QR kodu (veya `http://localhost:3000/qr` sayfasını) telefonunuzla tarayın:
   WhatsApp → **Bağlı Cihazlar → Cihaz Bağla**.
2. Panel: `http://localhost:3000` — kullanıcı adı **admin**, şifre `.env` içindeki `PANEL_TOKEN`.

## Render'a Dağıtım (7/24)

1. Bu klasörü bir GitHub reposuna push'layın.
2. [render.com](https://render.com) → **New → Blueprint** → repoyu seçin (`render.yaml` algılanır).
3. Render panelinde `PANEL_TOKEN` ve `DEEPSEEK_API_KEY` değerlerini girin, `OWNER_NAME`'i düzenleyin.
4. Deploy bitince servis adresine gidin → kullanıcı adı `admin`, şifre `PANEL_TOKEN`.
5. `https://<servis>.onrender.com/qr` adresini açın, telefonla tarayın. Oturum `/data` diskine yazılır; sonraki deploy'larda QR gerekmez.

**Notlar:**
- Render **Free** plan 15 dakikada bir uyur ve diski kalıcı değildir → 7/24 isteniyorsa **Starter** plan (2 GB RAM) gerekir.
- Oturumun kalıcı olması için `render.yaml` içindeki `disk` tanımı şarttır. Disk yoksa her deploy'da yeniden QR okutmanız gerekir.
- DeepSeek maliyeti: `deepseek-chat` ile sohbet başına birkaç sentin altında; yoğun mesaj trafiğinde "fatura dikkat" uyarısı.

## Panel Kullanımı

| Sekme | İşlevi |
|---|---|
| Sohbetlerim | Tüm sohbetler, AI özeti + konunun gittiği yön, "Şimdi özetle", otomatik yanıt aç/kapa + kişi bazlı talimat |
| Onay Bekleyenler | AI'nın hazırladığı cevap taslakları; düzenleyip gönderin veya yok sayın |
| Sohbete Sor | Yapay zekâya o sohbet hakkında serbest soru sorun |
| Kayıtlar | Sistem logları (hata ayıklama) |

**Otomatik yanıt açma:** Sohbetlerim sekmesinde ilgili sohbetin sağındaki "KAPALI — onayınızı bekler" yazısına tıklayın → ACIK olur. Kişiye özel talimat (örn. "Kısa ve net konuş, randevu için Cuma de") yazıp kaydedin. O kişinden gelen her mesajda asistan otomatik yanıtlar; diğer sohbetler taslak olarak onayınıza düşer.

## Güvenlik

- Panel `PANEL_TOKEN` ile Basic Auth arkasındadır — boş bırakmayın, kimseyle paylaşmayın.
- DeepSeek'e giden veriler sohbet metinleridir; ifşası sizin sorumluluğunuzda.
- `.env` dosyası repoya **girmemelidir** (`.gitignore` hazırdır).

## Dosya Yapısı

```
src/config.js      Ayarlar (.env)
src/db.js          SQLite (sohbetler, mesajlar, oneriler, kurallar, loglar)
src/ai.js          DeepSeek API (ozet, yon tahmini, cevap taslagi, soru-cevap)
src/whatsapp.js    WhatsApp Web istemcisi (QR, insan gibi gonderim, silme)
src/handlers.js    Gelen mesaj akisi (kaydet → analiz → otomatik/onay)
src/server.js      Panel API + Basic Auth
public/index.html  Panel arayuzu
Dockerfile         Render/Docker imaji (sistem Chromium)
render.yaml        Render Blueprint
```

## Sorun Giderme

- **QR sürekli yenileniyor / bağlanmıyor:** Sunucu oturumu diskte değilse her deploy'da QR okutulur. Render'da disk bağlı olduğundan emin olun.
- **"DeepSeek API hatasi 401":** `DEEPSEEK_API_KEY` yanlış veya eksik.
- **Chromium başlamıyor:** Render'da Docker runtime kullanıldığından emin olun (Native yok). Yerelde Node 20+ kullanın.
- **Hesabımda olağandışı aktivite uyarısı gelirse:** Otomasyonu hemen kapatın (süreç durdurun), birkaç gün normal telefon kullanımına dönün.
