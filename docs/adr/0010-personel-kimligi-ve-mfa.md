# ADR-0010 — Personel kimliği, zorunlu MFA ve `/yonetim`

- Durum: Kabul edildi (2026-10-09). İşletme önceliği: yönetim paneli (`/yonetim`) ilk iş.
- İlgili: şartname §16 (tek giriş `/yonetim`, roller), §17 (çalışan MFA, brute-force/rate limit, denetim izi), ADR-0003 (`cms`/`core` ayrımı), ADR-0007 (izinler).

## Bağlam

- Şartname tek bir giriş noktası istiyor: `/yonetim`. Menüler role göre görünür. Çalışanlar için MFA zorunlu.
- Müşteri ve çalışan kimlikleri ayrı tutulmalı.
- Operasyon ekranları siparişleri ve finansı `core` üzerinden okur. Payload yalnız içeriği yönetir; içerik henüz kurulmadı (P06).
- Yetki tek kaynaktan gelir: `core.staff_permission_grants` (ADR-0007). Bu yüzden kimlik de aynı çekirdekte olmalı.

## Karar

1. **Personel kimliği `core` içindedir.** Tablolar:
   - `core.staff_users`: e-posta (küçük harfe çevrilmiş, benzersiz), ad, durum (`INVITED`, `ACTIVE`, `DISABLED`).
   - `core.staff_sessions`: oturumlar.
   - `core.staff_setup_tokens`: tek kullanımlık davet ve şifre bağlantıları.

   `staff_permission_grants.staff_id` bu tablodaki kimliktir. Payload eklendiğinde (P06) aynı oturuma güvenen özel bir kimlik doğrulama stratejisi kullanılır, ikinci bir parola tutulmaz.
2. **Giriş iki adımlıdır. MFA herkese zorunludur:**
   - İlk adım şifredir. Şifre `scrypt` ile saklanır (N=2^15, r=8, p=1, rastgele tuz).
   - İkinci adım, Authenticator uygulamasından alınan 6 haneli koddur (TOTP, RFC 6238: HMAC-SHA1, 30 saniye, ±1 adım saat farkı).
   - Bir kod yalnız bir kez geçer (son adım saklanır, yarışa karşı koşullu güncelleme).
   - MFA'yı geçmemiş bir oturum hiçbir izin taşımaz. İlk girişte uygulama kurulumu zorunludur (QR kod + elle girilebilir anahtar).
3. **Gizli bilgiler okunamaz biçimde saklanır:**
   - TOTP anahtarı AES-256-GCM ile şifrelenir. Anahtar `STAFF_MFA_KEY` ortam değişkenindedir; tanımlı değilse uygulama açılmaz. Şifreli değer hesaba bağlıdır (ek doğrulama verisi), başka bir hesaba taşınamaz.
   - Oturum ve bağlantı belirteçlerinin yalnız SHA-256 özeti tutulur.
   - Şifre, kod, belirteç ve anahtar denetim kaydına yazılmaz.
4. **Kaba kuvvete karşı:**
   - Şifre ve kod hataları aynı sayaçta toplanır. Varsayılan 5 hatadan sonra hesap 15 dakika kilitlenir.
   - Hata mesajı tektir: e-postanın mı, şifrenin mi, kodun mu yanlış olduğu ya da hesabın kilitli olduğu söylenmez.
   - Bilinmeyen e-postada da şifre kontrolü kadar süre harcanır.
   - Web katmanı ayrıca IP başına istek sınırı uygular: varsayılan 5 dakikada 30 adım. Ofis çalışanlarının çoğu tek bir dış IP'yi paylaştığı için sınır geniş tutulur; tek hesabı hedefleyen denemeyi hesap kilidi durdurur. Sınır şimdilik süreç içinde tutulur; birden çok sunucuda aynı sınır yük dengeleyicide de uygulanmalıdır.
5. **Oturum:**
   - Rastgele 256 bitlik belirteç `HttpOnly`, `SameSite=Strict` çerezde taşınır; canlıda `Secure` bayrağı da eklenir.
   - 30 dakika işlem yapılmazsa ve en fazla 12 saat sonra oturum kapanır.
   - Yetki yükseldiğinde (MFA sonrası) belirteç yenilenir (session fixation önlemi).
   - İzinler her istekte yeniden okunur; geri alınan izin anında düşer.
   - Formlar yalnız aynı kökenden kabul edilir (CSRF).
6. **Hesap yaşam döngüsü (`staff.manage` izni):**
   - Davet: e-posta ve ad girilir. Tek kullanımlık bağlantı 72 saat geçerlidir. `MAIL_SMTP_URL` + `MAIL_FROM` tanımlıysa bağlantı kişiye e-postayla gider (Türkçe + İngilizce; bağlantı `PUBLIC_BASE_URL` ile kurulur, isteğin Host başlığından değil; SMTP'de TLS zorunlu); panelde gösterilmez. E-posta ayarı yoksa ya da gönderim başarısız olursa bağlantı, oluşturan kişiye ekranda bir kez gösterilir. Bağlantının ham hâli veritabanına, outbox'a ya da loglara yazılmaz; e-posta istek içinde gönderilir. Kişi bağlantıyla şifresini belirler ve Authenticator uygulamasını kurar.
   - Şifre sıfırlama bağlantısı da aynı biçimdedir ve hesabın diğer oturumlarını kapatır.
   - MFA sıfırlama (telefon kaybı) oturumları kapatır; kişi bir sonraki girişte uygulamayı yeniden kurar.
   - Kilit kaldırma yapılabilir.
   - Hesap kapatma oturumları ve açık bağlantıları geçersiz kılar. Kişi kendi hesabını kapatamaz. İzin verebilen son aktif kişi kapatılamaz.
7. **İlk yönetici:** Hiç personel hesabı yokken bir kez çalışır:
   `DATABASE_URL=… STAFF_MFA_KEY=… PUBLIC_BASE_URL=… pnpm staff:bootstrap <e-posta> "<Ad Soyad>"`.
   Komut hesabı Owner/Admin paketiyle açar ve kurulum bağlantısını yazar.
8. **Yeni izinler** (katalog, migration 0007, rol paketleri):

   | İzin | Anlamı |
   |---|---|
   | `staff.manage` | Personel hesabı açma (davet), kapatma, şifre ve MFA sıfırlama |
   | `orders.view` | Siparişleri, misafir bilgilerini ve operasyon görevlerini görüntüleme |
   | `orders.view_financials` | Siparişlerde tedarikçi maliyeti, komisyon ve marjı görüntüleme |
   | `tasks.manage` | Operasyon görevlerini üstlenme ve gerekçeyle kapatma |

   Rol paketlerine dağılım:
   - Owner/Admin: hepsi.
   - Finance ve FinanceApprover: `orders.view`, `orders.view_financials`.
   - Operations: `orders.view`, `tasks.manage`.
   - Viewer: `orders.view`.

## Sonuçlar

- Teknik güvenlik değerleri (`STAFF_SESSION_IDLE_MINUTES`, `STAFF_SESSION_MAX_HOURS`, `STAFF_LOCKOUT_ATTEMPTS`, `STAFF_LOCKOUT_MINUTES`, `STAFF_SETUP_LINK_HOURS`, `STAFF_MIN_PASSWORD_LENGTH`, `STAFF_IP_ATTEMPTS_PER_5_MIN`) işletme girdisi değildir. Varsayılanları NIST SP 800-63B yaklaşımına göredir; sınırlar içinde sıkılaştırılabilir.
- `STAFF_MFA_KEY` kaybolursa kayıtlı Authenticator anahtarları açılamaz. Bu durumda herkesin MFA'sı sıfırlanır ve uygulamalar yeniden kurulur. Anahtar secret manager'da yedeklenmelidir.
- **Kurtarma kodları (9 Ekim 2026):**
  - Kişi "Hesabım" sayfasından 10 tek kullanımlık kod oluşturur. Bunun için doğrulama uygulamasındaki güncel kod istenir; yalnız ele geçirilmiş bir oturum kod üretemez.
  - Kodlar bir kez gösterilir. Veritabanında yalnız `STAFF_MFA_KEY` ile alınmış HMAC özetleri tutulur (`core.staff_recovery_codes`); veritabanı kopyası tek başına kod tahminine yetmez.
  - Kod biçimi: Crockford base32, 10 karakter (`xxxxx-xxxxx`, 50 bit). Büyük/küçük harf, boşluk ve tire önemsizdir; i/l ve o harfleri 1 ve 0 okunur.
  - Girişte doğrulama kodu yerine kurtarma kodu kullanılabilir. Her kod bir kez çalışır. Yanlış kod, yanlış doğrulama kodu gibi kilit sayacına eklenir.
  - Yeni kodlar oluşturulunca kullanılmamış eskiler geçersiz olur. Yönetici MFA'yı sıfırlarsa kullanılmamış kodlar da silinir.
  - Kodu olmayan ya da 2 veya daha az kodu kalan kişiye ana sayfada uyarı gösterilir.
- **İçerik yönetimi (P06):** Payload CMS (`/yonetim/icerik`) ayrı bir şifre kullanmaz. CMS'e girmek için aynı aktif panel oturumu (şifre + MFA) ve `content.edit` / `content.publish` izinlerinden biri gerekir. İzinler her istekte yeniden okunur; bir izin geri alınınca CMS erişimi hemen biter (ADR-0003).
- **WebAuthn/passkey (değerlendirme):** Ertelendi. Passkey'ler alan adına (RP ID) bağlanır: canlı alan adı kesinleşmeden kayıt alınırsa alan adı değişince herkes yeniden kayıt olmak zorunda kalır. Ayrıca sunucu kütüphanesi sürüm politikasına (ADR-0001) göre seçilmelidir. Telefon kaybı durumunu şimdilik kurtarma kodları karşılıyor. Canlı alan adı netleşince passkey, doğrulama uygulamasına ek ikinci adım olarak eklenecek.
- Kanıt: RFC 4226 ve RFC 6238 test vektörleri (`packages/admin/test/crypto.test.ts`); PostgreSQL senaryoları (`staff-auth.int.test.ts`): davet, kurulum, MFA, tekrar kullanılan kod, kilitlenme, oturum süresi, MFA sıfırlama, kapatma kuralları ve denetim kaydında gizli bilgi olmaması.
