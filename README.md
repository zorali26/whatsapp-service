# WhatsApp Asistan

Kişisel WhatsApp hattınız için **ücretsiz** 7/24 çalışan, DeepSeek destekli yapay zekâ asistanı.
WhatsApp Web protokolünü **tarayıcısız** (Baileys, WebSocket) konuşur; Render Free planda (512 MB RAM) sığar.

**Ne yapar?**
- Gelen/giden **tüm mesajları ve eski sohbet geçmişini** kaydeder (bağlantıda tam geçmiş senkronu)
- Her mesajda sohbetin özetini ve **konunun gittiği yönü** çıkarır
- Seçtiğiniz kişilere "yazıyor..." durumu + insan benzeri gecikme ile **direkt otomatik cevap** verir
- Diğer sohbetler için onayınıza gelen **cevap taslakları**
- **Telefonunuza bildirim**: site açıkken toast + sesli okuma (TTS), site kapalıyken Web Push (`🔔 Bildirimleri Aç`)
- Profesyonel panel: canlı aktivite akışı, sohbet arama, iki panelli mesaj görünümü, AI soru-cevap, istatistikler

---

## ÖNEMLİ: Risk ve Sınırlar

1. **Bu çözüm de resmi değildir.** Baileys, WhatsApp Web protokolünü taklit eden açık kaynak bir kütüphanedir ve WhatsApp kullanım koşullarına aykırıdır. Ban riski hiçbir zaman %0 değildir; insan benzeri gecikmeler riski azaltır, sıfırlamaz. Kişisel numaranız risk altındadır.
2. **Karşı tarafın mesajını silemezsiniz** — ne sizin, ne bu sistemin. Bu modda yalnızca KENDİ mesajlarınızı herkes için silebilirsiniz.
3. Verileriniz sizin sunucunuzda kalır; panel `PANEL_TOKEN` ile şifrelidir.

---

## Render FREE Üzerinde Ücretsiz 7/24 (Önerilen Yol)

1. Bu repoyu GitHub'da saklayın (Private).
2. Render → **New → Web Service** (Blueprint yerine elle kurun — Free plan için):
   - Repository: repoyu seçin
   - Runtime: **Docker** (repodaki `Dockerfile` kullanılır, Build/Start komutu sormaz)
   - Instance Type: **Free**
   - Environment Variables: `PANEL_TOKEN` (rastgele şifre), `DEEPSEEK_API_KEY` (`sk-...`), `OWNER_NAME`, `DATA_DIR=/data`
3. Deploy bitince `https://<servis>.onrender.com/qr` adresinden QR'ı okutun (WhatsApp → Bağlı Cihazlar → Cihaz Bağla).
4. **Uyku modunu engellemek için** ücretsiz [cron-job.org](https://cron-job.org) hesabı açın:
   - Create cronjob → URL: `https://<servis>.onrender.com/api/status` → her **10-14 dakikada** bir çalıştırın
   - Basic Auth gerekiyor mu sorarsa: kullanıcı `admin`, şifre `PANEL_TOKEN`
5. **Oturum kalıcılığı:** Free planda disk kalıcı değildir. Redeploy veya servisin yeniden başlatılması sonrası **QR'ı tekrar okutmanız gerekir** (deploylar nadirdir; normal yeniden başlatmalarda oturum korunur). Sıfır QR sürekliliği istiyorsanız ücretsiz **Oracle Cloud Always Free** VM'yi ya da ücretli Starter planı kullanın.

## Web Push Bildirimleri (telefonunuza, site kapalıyken bile)

1. Render → servis → **Environment** → şu 3 satırı ekleyin (anahtarlar proje sahibi tarafından üretildi; ya da kendiniz `npx web-push generate-vapid-keys` ile üretin):
   - `VAPID_PUBLIC_KEY` = `BBA6TEZm10rsZkW4QaIG3Q6F24pFFCmASBfXAG0R0aazSyiiDA4jOm-73QOwuNyg44crN3-tCNPUYqzmkuaFSJU`
   - `VAPID_PRIVATE_KEY` = (gizli tutun — public repoya asla girmemeli)
   - `VAPID_SUBJECT` = `mailto:admin@example.com`
2. Deploy bitince panelden **🔔 Bildirimleri Aç**'a basın → izin verin → test mesajı gelin.
3. iPhone'da: Safari ile siteyi açın → Paylaş → **Ana Ekrana Ekle** (iOS'ta bildirim yalnızca PWA olarak eklendiğinde çalışır).
4. **🔊 Sesli Okuma** düğmesi, site açıkken gelen mesajı Türkçe okur.

## Yerel Kurulum

```bash
npm install
cp .env.example .env   # PANEL_TOKEN ve DEEPSEEK_API_KEY doldurun
npm start
```

- QR'ı konsolda veya `http://localhost:3000/qr` üzerinden okutun
- Panel: `http://localhost:3000` (kullanıcı adı `admin`, şifre `PANEL_TOKEN`)

## Panel Kullanımı

| Sekme | İşlevi |
|---|---|
| Sohbetlerim | Tüm sohbetler + AI özeti + konunun gittiği yön, Otomatik yanıt aç/kapa + kişi bazlı talimat |
| Onay Bekleyenler | AI taslakları; düzenleyip gönderin veya yok sayın |
| Sohbete Sor | AI'ya sohbet hakkında soru sorun ("bu konu nereye gidiyor?" vb.) |
| Kayıtlar | Sistem logları |

## Dosya Yapısı

```
src/baileys -> WhatsApp katmanı src/whatsapp.js (WebSocket, tarayıcısız)
src/handlers.js  Gelen mesaj akışı (kaydet → AI analiz → otomatik / onay listesi)
src/ai.js        DeepSeek API
src/db.js        SQLite (mesajlar, taslaklar, kurallar, loglar)
src/server.js    Panel API + Basic Auth
public/index.html  Panel
Dockerfile / render.yaml  Render dağıtımı
```

## Sorun Giderme

- **QR sürekli yenileniyor:** Telefonunuz internete bağlı mı? 14 gün bağlı kalmazsa WhatsApp cihazı düşürür; yeniden okutun.
- **"DeepSeek API hatasi 401":** `DEEPSEEK_API_KEY` yanlış/eksik — Render → Environment'dan düzeltin.
- **Servis uykuya dalıyor:** cron-job.org ping'i kurun (yukarıda). Free plan inactivity'de uyur.
- **Yeniden başlatma sonrası "bağlı değil":** Free planda oturum dosyaları silinmiştir → `/qr`'dan tekrar okutun.
- **Ban riski:** Olağandışı aktivite uyarısı gelirse servisi durdurun ve birkaç gün otomasyona ara verin.
