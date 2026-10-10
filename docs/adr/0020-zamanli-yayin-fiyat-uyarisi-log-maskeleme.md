# ADR-0020 — CMS'te zamanlı yayın, liste fiyatı sapma uyarısı ve log maskeleme

- Durum: Kabul edildi (2026-10-10).
- İlgili: ADR-0003 (cms/core ayrımı), ADR-0010 (personel girişi ve CMS), ADR-0014 (otel liste sayfaları, fiyat doğruluğu), şartname §17 ve T31 (log/belge/secret).

## 1. Zamanlı yayın (Payload "Schedule publish")

**Bağlam.** Kampanya ve sezon sayfaları belli bir saatte yayına girmeli veya kalkmalı. Bunun için birinin o saatte panelde olması gerekmemeli.

**Karar:**
- Sayfa, destinasyon, rehber yazısı, SSS, kampanya ve otel listesi koleksiyonlarında `versions.drafts.schedulePublish` açık.
- Belgenin "Yayınla" menüsünde "Yayını Planla" seçeneği var. Planlanan iş `cms.payload_jobs` tablosunda tutulur.
- Web süreci zamanı gelen işleri dakikada bir çalıştırır:
  - `jobs.autoRun`, kuyruk `default`;
  - `next build` sırasında çalışmaz;
  - `CMS_JOBS_AUTORUN=false` ile kapatılır (ör. birden çok web kopyasından fazlalarında).
- Elle çalıştırma uç noktası `/api/cms/payload-jobs/run` yalnız `content.publish` sahiplerine açıktır.
- **Yetki, planlama anında:**
  - Yayınlama izni olmayan kişiye CMS ne "Yayınla" ne de "Yayını Planla" seçeneğini gösterir.
  - Koleksiyonların güncelleme yetkisi veriye duyarlıdır (`editorsPublishers`): `_status: 'published'` olarak kaydetmek için `content.edit` ve `content.publish` birlikte gerekir.
  - Önceki `guardPublish` kancası ikinci savunma olarak kalır.
- **Yetki, çalışma anında:**
  - İş, planlayan kişi adına ve o kişinin **o andaki** izinleriyle çalışır. İzinler çekirdekten okunur; personel aktif olmalıdır.
  - Arada izni geri alınmış veya hesabı kapatılmış birinin planı hiçbir şey değiştirmez. Belge olduğu gibi kalır, iş hata olarak kaydedilir.
  - Planı doğrudan sunucu fonksiyonuna gönderen bir editör de bu kontrolden geçemez.

**Sonuç:** Payload'ın iş tablosu için `20261010_173022_scheduled_publish` migration'ı eklendi; yalnız `cms` şemasını etkiler.

## 2. Liste fiyatı sapma uyarısı

**Bağlam.** ADR-0014 ölçümü, ziyaretçilerin canlı aramalarını liste fiyatıyla karşılaştırır. Ancak sonuç yalnız rapordaydı.

Listede gösterilen fiyattan yüksek çıkan canlı fiyat iki risk doğurur:
- müşteri güveni zedelenir;
- reklam ve fiyat beyanı açısından hukuki risk oluşur.

**Karar:**
- "Otel listesi fiyat ayarları"na **fiyat sapma uyarısı (%)** alanı eklendi. Boşsa uyarı yoktur; varsayılan konmaz (G06 gibi işletme kararı).
- Uyarı, son 24 saatte sayfada **gösterilmiş** fiyatlara bakar. İki durum sayılır:
  - canlı arama fiyatı eşik kadar veya daha fazla yüksek;
  - otel o tarihte satılamıyor.
- Uyarı panel ana sayfasında görünür, liste fiyatı raporunu görebilenlere. Rapor sayfasında da eşik ve son 24 saatin sayıları yazar.
- Sağlayıcıya ek çağrı yapılmaz. Fiyatlar otomatik değiştirilmez; düzeltme (tarama, liste ayarı) insan kararıdır.

## 3. Log maskeleme (T31)

**Bağlam.** Loglar elle yazılmış JSON satırlarıydı. Hata mesajları kişisel veri taşıyabiliyordu:
- Drizzle sorgu hataları mesajın sonuna parametreleri ekler (`params: e-posta, telefon…`);
- sağlayıcı yanıtlarında misafir adı geçebilir.

**Karar:**
- `@texholiday/contracts` içine `jsonLogger`, `redact`, `redactText` ve `errorMessage` eklendi. Web ve worker'daki bütün loglar bunlardan geçer.
- Hassas alan adlarının değerleri yazılmaz. Örnekler: şifre, token, secret, API anahtarı, cookie, e-posta, telefon, ad/soyad, misafir/yolcu, kart, belge, doğum tarihi, IP, OTP.
- Serbest metinde maskelenenler:
  - e-posta, telefon, IBAN;
  - kart benzeri veya uzun rakam dizileri;
  - Bearer/API anahtarları, JWT ve uzun belirteçler;
  - sorgu hatalarının `params:` kısmı.
- Sipariş numaraları (UUID) okunur kalır; operasyon bunlarla çalışır.
- Kalıcı hata metinleri de aynı maskeden geçer: outbox `last_error` ve liste taraması `last_error`.
- Maskeleme bilinçli olarak geniştir. Logda kaybolan bir rakamın maliyeti düşüktür; sızan bir misafir e-postasının veya anahtarın maliyeti yüksektir.

**Sonuç:** Özel belge için süreli imzalı URL (T31'in diğer yarısı) özel belge saklanmaya başlandığında gelecek. Şu an sistem özel belge saklamıyor.

## Test

- `apps/web/e2e/scheduled-publish.spec.ts`:
  - yayıncı planlar; zamanı gelince sayfa yayına çıkar;
  - editöre seçenek sunulmaz;
  - izinsiz plan çalışma anında hiçbir şey değiştirmez;
  - run uç noktası editöre kapalıdır.
- `packages/booking/test/hotel-lists.int.test.ts`: eşik yokken uyarı yoktur; %4 eşiğinde %5 sapma ve satılamayan otel sayılır, %6 eşiğinde sayılmaz; 24 saat penceresi doğrulanır.
- `packages/contracts/test/log.test.ts`: metin maskeleme, sorgu parametreleri, iç içe alanlar, döngü ve logger satırı.
