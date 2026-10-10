# R0 kanıt raporu — 9 Ekim 2026

Kapsam: başlangıç promptunun "İlk yapacağın işler" 1–7. Bu rapor yalnız bu repodan ve bu build ortamından yapılabilenleri kaydeder. Hiçbir sağlayıcı hesabına giriş yapılmadı; hiçbir sandbox/production rezervasyon veya ödeme denemesi yapılmadı.

## 1. Repo ve mevcut durum

- `travellerbuddha/VectorTex` deposu tamamen boştu (commit yok, AGENTS/CLAUDE dosyası yok). Korunacak kullanıcı değişikliği yoktu.
- Çalışma dalı `claude/wizardly-cori-878nca` uzak depodaki **tek** dal olduğu için GitHub'da varsayılan dal oldu. PR açmak için ayrı bir taban dalı (ör. `main`) gerekir; izin olmadan başka dala push yapılmadı.

## 2. Erişim kontrolü (secret değerleri yazdırılmadan)

| Kontrol | Sonuç |
|---|---|
| Sağlayıcı env değişkenleri (`NUITEE_*`, `IYZICO_*`, `WELCOME_*`, `PAYLOAD_*`, `DATABASE_URL`, `REDIS_URL`) | **Yok.** Ortamda yalnız ilgisiz AWS değişkenleri var (değerleri okunmadı). |
| `docs.liteapi.travel`, `welcomepickups.gitbook.io`, `docs.iyzico.com`, `payloadcms.com` | **Erişilemedi** — ortam ağ politikası CONNECT 403 (curl ve WebFetch). |
| `github.com` / `api.github.com` | 403. `raw.githubusercontent.com` erişilebilir. |
| npm registry | Erişilebilir (sürüm keşfi ve resmî istemci paketleri buradan). |
| Yerel PostgreSQL 16 / Redis 7 | Çalıştırıldı; entegrasyon testleri bunlarla koşuldu. |

Fail-fast doğrulandı: production'da boş/placeholder secret ile worker başlamıyor ve hata mesajında yalnız değişken adı var (`packages/config/test/config.test.ts`, elle smoke test). Gerçek görünümlü secret'larla bile kaynak sözleşmeleri kilitli olmadığı için production worker `iyzico cannot run: required provider contracts are not pinned` ile duruyor.

## 3. Resmî dokümanların sabitlenmesi

`contracts/sources.lock.json` 23 birincil kaynağı listeler; hepsi `UNREACHABLE` (tarih + hata ile). Hiçbiri tahminle doldurulmadı. Erişim açıldığında:

```bash
pnpm contracts:pin     # gövdeleri indirir, SHA-256 ile kilitler (contracts/sources/)
pnpm contracts:types   # yalnız kilitli OpenAPI'lerden TS tipleri üretir
pnpm contracts:check   # CI: kilitli gövdelerin hash'i değişmedi mi
```

İkincil kanıt (integrity hash'li, yalnız destekleyici):

| Kaynak | Kullanım |
|---|---|
| `iyzipay@2.0.70` (sha512-zbhgt3…uigEw==) resmî Node istemcisi | Endpoint yolları, IYZWSv2 yetkilendirme, endpoint'e özgü yanıt imzası alan sıraları, para formatı |
| `liteapi-node-sdk@4.3.2` (sha512-xiTKk4…59KrZHPg==) | Otel temel URL/yol teyidi (`/hotels/rates`, `/rates/prebook`, `/rates/book`, `/bookings?clientReference=`); güncel ödeme enum'larını **içermiyor** (Mart 2025) |

Ortamı açmak için: Claude Code cloud ortamı → Network access → Allowed domains'e `docs.liteapi.travel`, `welcomepickups.gitbook.io`, `docs.iyzico.com`, `payloadcms.com` (ve isteğe bağlı `github.com`) ekleyin. Ayrıntı: https://code.claude.com/docs/en/cloud-environments#network-access

## 4. Sürüm kilidi (Payload uyumluluğu)

npm `peerDependencies` beyanlarından (ADR-0001): Node 22 LTS, Payload/@payloadcms/* 3.90.2, Next 16.3.8 (`@payloadcms/next` peer `>=16.3.3 <17`), React 19.2.8, Drizzle ORM 0.45.2 / kit 0.31.7 (Payload ile aynı), pg 8.20.0, BullMQ 5.81.5, Zod 4.6.5, Vitest 4.1.11, TypeScript 5.9.3. payloadcms.com uyumluluk sayfası erişilemediği için npm beyanı esas alındı; sayfa erişilince ADR-0001'e eklenecek.

## 5. Yetenek kanıtları (documentation / account / sandbox / production ayrı)

Makine kaynağı: `contracts/capability-matrix.json`. Bugün **hiçbir hesap durumu ENABLED değil, hiçbir sandbox/production testi koşulmadı**; bu yüzden routing kodu production'da hiçbir rota açmıyor (`routing.test.ts` "R0 state" testi).

| Yetenek | documentation | account | sandbox | production | Kanıtlamak için gereken tam girdi |
|---|---|---|---|---|---|
| Nuitee otel — Nuitee yönetimli ödeme | DOCUMENTED (iş araştırması 8–9 Ekim) | UNVERIFIED | NOT_RUN | NOT_RUN | Sandbox API anahtarı; hesap para birimleri (EUR/USD/GBP); kilitli `user-payment` + `api-booking.json` |
| Nuitee otel — kendi gateway + hesap kartı (ACC_CREDIT_CARD) | DOCUMENTED | UNVERIFIED | NOT_RUN | NOT_RUN | Nuitee panelinde production hesap kartının tanımlı olduğuna dair kanıt/yazılı teyit; sandbox'ta ACC_CREDIT_CARD book testi |
| Nuitee otel — sözleşmeli CREDIT | DOCUMENTED | UNVERIFIED | NOT_SUPPORTED | NOT_RUN | İmzalı kredi limiti sözleşmesi; yalnız onaylı production pilotunda test (sandbox desteklemiyor) |
| Nuitee uçak — yönetimli ödeme | DOCUMENTED | UNVERIFIED | NOT_RUN | NOT_RUN | Uçak ürünü erişim onayı; `openapiflights.json` |
| Nuitee uçak — bağımsız funding | DOCUMENTED (koşullu) | UNVERIFIED | NOT_RUN | NOT_RUN | Prebook bypass koşulunun hesabımızda açık olduğu + seçilen funding yönteminin hem prebook hem booking'de kabul edildiğine dair Nuitee yazılı cevabı ve sandbox kanıtı. Booking enum'u tek başına kanıt değil; THIRD_PARTY/CMI JWT genel gateway değildir |
| Nuitee Experiences — yönetimli ödeme | DOCUMENTED (Phase 1: usePaymentSdk:true + TRANSACTION_ID) | UNVERIFIED | NOT_RUN | NOT_RUN | Experiences erişimi; `api-experiences.json`; async onay/voucher rehberi |
| Nuitee Experiences — bağımsız funding | **NOT_DOCUMENTED** | UNVERIFIED | NOT_RUN | NOT_RUN | Nuitee'nin yeni ödeme sözleşmesini belgelemesi + hesapta açması. **G03 dış kapısı** |
| Welcome — kendi gateway + kredi hesabı | DOCUMENTED | UNVERIFIED | NOT_RUN | NOT_RUN | Kredi hesabı onayı, staging anahtarı, production audit planı |
| iyzico — AUTHORIZE/CAPTURE/RETRIEVE/VOID/REFUND | DOCUMENTED (+ resmî istemci) | UNVERIFIED | NOT_RUN | NOT_RUN | Sandbox API/secret; merchant'ta ön provizyon açık mı; TRY/EUR/USD/GBP tahsilat/settlement |
| iyzico — V3 webhook | DOCUMENTED | UNVERIFIED | NOT_RUN | NOT_RUN | Webhook aktivasyonu + `X-Iyz-Signature-V3` alan sırasının dokümandan kilitlenmesi (istemcide yok). O zamana kadar webhook reddedilir, durum `retrieve` ile sorgulanır |

## 6. Doküman kilitlenince teyit edilecek açık noktalar

Bunlar kodda **varsayılmadı**; belirsiz durumda adapter `UNKNOWN`/`CAPABILITY_NOT_AVAILABLE` döner:

1. iyzico `phase` değerleri (`PRE_AUTH`/`POST_AUTH`) ve `fraudStatus` kodları (1/0/-1). Bilinmeyen değer → REVIEW / UNKNOWN.
2. iyzico ön provizyonun geçerlilik süresi (risk politikası güvenlik payı buna göre seçilecek).
3. iyzico `retrieve` yanıtında cancel/refund durumunun görünüp görünmediği (aksi halde kayıp void/refund yanıtı operasyon görevine düşer).
4. iyzico v1 `/payment/refund` (kalem işlem bazlı, şartnamenin istediği) ile `/v2/payment/refund` (ödeme bazlı) tercihi.
5. iyzico yabancı müşteri kimlik/pasaport politikası (merchant sözleşmesi). Bugün `REFUSE`: TC kimlik yoksa ödeme başlamaz; sahte TC yok.
6. Nuitee otel prebook'un envanter tuttuğu mu (HELD) yoksa yalnız doğrulama mı (PREPARED); varsayılan PREPARED.
7. Nuitee `maxRates` alanının güncel şemada olup olmadığı (rehber/şema çelişkisi kaydı).
8. Nuitee duplicate `4005` yanıtının lookup ile çözüm akışı.
9. Welcome `quote-requests` / `quote_requests` yol adı, firm/estimate alanı, webhook kimlik doğrulama biçimi.

## 7. İşletme girdileri (G06 — uydurulmadı)

Marj/servis bedeli/vergi; kur kaynağı ve yuvarlama modu; risk politikası (provizyon güvenlik payı, sipariş başına tedarikçi maruziyet limiti, funding tercih sırası, bilinmeyen async süreli ürün satılsın mı); taksit politikası (bugün `[1]`: paidPrice = price); yabancı kimlik politikası. Bunlar `core.pricing_policy_versions` / `core.risk_policy_versions` tablolarına onaylı kayıt olarak girer; onaylı kayıt yoksa ilgili rota açılmaz ve worker sipariş ilerletmez.

## 8. Sonuç

- R0 dış kapıları açık değil: G01–G09 hepsi NOT_PASSED; G03 Nuitee'nin yeni ödeme yolunu belgelemesine bağlı.
- Bağımsız geliştirme P02'den itibaren yapıldı (bkz. `docs/plan/is-paketleri.md`, `docs/plan/test-matrisi.md`).
- Bir sonraki adım için gereken erişimler: yukarıdaki dört alan adına ağ izni; Nuitee sandbox anahtarı; iyzico sandbox API/secret; Welcome staging anahtarı; işletmeden G06 değerleri.

---

## 9. Güncelleme (9 Ekim 2026, doküman erişimi açıldıktan sonra)

Ağ izni verildikten sonra 45 kaynak SHA-256 ile sabitlendi (`contracts/sources/`, `pnpm contracts:check`). Rehberler resmî Markdown sürümleriyle alındı. Sağlayıcı **API** host'ları (`api.liteapi.travel`, `book.liteapi.travel`, `sandbox-api.iyzipay.com`, `api.stgazure.welcomd.com`) hâlâ ağ politikasıyla kapalı; bu yüzden sandbox testi henüz koşulamadı. Nuitee sandbox anahtarı alındı (repo dışında tutuluyor).

### Dokümanla kesinleşenler

| Konu | Bulgu (kaynak) | Koda etkisi |
|---|---|---|
| Nuitee otel — hesap kartı | `ACC_CREDIT_CARD`; her sandbox anahtarında gizli test kartı var, gerçek kart yalnız production anahtarında (account-credit-card) | Sandbox'ta güvenle denenebilir |
| Nuitee otel — CREDIT | Sandbox'ta çalışmaz; **CREDIT ile yapılan her rezervasyon gerçektir** (credit-line) | Sandbox'ta asla kullanılmaz; matris `NOT_SUPPORTED` |
| Nuitee otel — book | `holder.phone` zorunlu; `clientReference` tekrarında 4005 = rezervasyon zaten var; book 2 dakikaya kadar sürebilir, timeout = durum bilinmiyor, yeniden book yok (booking OpenAPI, hotel-integration) | Lease 600 sn yeterli; 4005 → lookup |
| Nuitee otel — iptal politikası | `cancelPolicyInfos[].cancelTime` her zaman GMT; `refundableTag` RFN/NRFN | Deadline dönüşümü UTC |
| Nuitee otel — marj | `margin` (yüzde) hesap varsayılanını ezer; kendi ödemede net fiyat (`margin: 0`) önerilir; SSP altı fiyat herkese açık gösterilemez (revenue guide) | Mevcut tek-marj ve SSP kuralları doğrulandı |
| Nuitee uçak | `usePaymentSdk:false` yalnız "payment bypass" + etkin kredi hattı veya WL/CMI ile; booking enum'unda `ACC_CREDIT_CARD` var, sandbox'ta ücret çekmeden simüle ediyor; `THIRD_PARTY` yalnız WL/CMI imzalı JWT | Bağımsız funding için Nuitee'den yazılı teyit hâlâ gerekli |
| **Nuitee Experiences (G03)** | Phase 1: `usePaymentSdk:true` zorunlu (false → 400/4002); book `payment.method` yalnız `TRANSACTION_ID`; CREDIT/ACC_CREDIT_CARD/WALLET yok; "Phase 2" yok | **G03 dokümana göre geçemez.** Experiences içeren paket ve TRY/kendi gateway rotası kapalı kalır (K09) |
| iyzico | fraudStatus 1/0/-1 doğrulandı; imza alan sıraları + fiyatlarda sondaki sıfırların atılması; refund imzası; webhook V3 HPP formülü; CF için `gsmNumber` zorunlu; ön provizyon 25 gün içinde kapatılmalı (bankaya göre değişebilir) | Adapter güncellendi: telefon zorunlu, imza normalizasyonu, refund imzası, HPP webhook doğrulaması, 25 günlük provizyon süresinden muhafazakâr deadline |
| Welcome | Kimlik: `Authorization: Bearer`; istek gövdeleri düz JSON, yanıtlar JSON:API; `payment_method: "credit"`; tahmini fiyatla rezervasyon reddediliyor; müsaitlik yokluğu HTTP 200 + `errors[]`; webhook kimliği isteğe bağlı Bearer token; production anahtarı audit sonrası | Connector staging anahtarı gelince yazılacak |

### Hâlâ açık (sandbox veya sağlayıcıdan yazılı teyit gerekir)

1. iyzico `phase` değerleri (dokümanda sıralanmıyor) ve ödenmemiş bir ön provizyonun nasıl serbest bırakılacağı: cancel "aynı gün, kısmi değil" diye tanımlı, ön provizyon iptali anlatılmıyor. Yanlış yorum paket compensation'ını etkiler (G05).
2. iyzico GBP capture: post-auth yanıt para birimi listesinde GBP yok.
3. Nuitee uçak: `ACC_CREDIT_CARD` için payment bypass gerekip gerekmediği.
4. Welcome: `booking_reference` tekilliği ve listeleme filtresinin birebir eşleşme semantiği (kayıp create yanıtının çözümü buna dayanıyor); `quote-requests`/`quote_requests` yol farkı.
5. Nuitee Experiences için bağımsız funding: Nuitee'ye resmî talep (G03).

## 10. Nuitee otel sandbox sonuçları (9 Ekim 2026)

API host'larına ağ izni verildikten sonra `pnpm test:sandbox` (bkz. `packages/connectors/test/nuitee-hotel.sandbox.test.ts`) koşuldu. Kimlik bilgisi içermeyen kanıtlar:

| Adım | Sonuç | Referans |
|---|---|---|
| Arama (`/hotels/rates`, lp1897, EUR, %1 marj) | SUCCEEDED, 37 teklif | — |
| Prebook (`usePaymentSdk:false`) | SUCCEEDED, fiyat/iptal/pansiyon değişimi yok | prebook `Iq6EixV6S` |
| Book (`ACC_CREDIT_CARD`, sandbox test kartı) | CONFIRMED, maliyet 1.365,67 EUR | booking `b2MtlGLgA` |
| `clientReference` ile sorgu | CONFIRMED (aynı rezervasyon) | — |
| İptal (`PUT /bookings/{id}`) | CANCELLED, ceza 0, tam iade | — |
| Nuitee ödeme SDK'lı prebook (`usePaymentSdk:true`) | SUCCEEDED; `transactionId` + `secretKey` döndü | prebook `vKh3SHrTO` |

**Çelişki:** `margin: 0` ile (net fiyat) aranan teklifler prebook'ta 7 denemenin hepsinde HTTP 409 / kod 2001 ile reddedildi; %0,5, %1, %5, %10, %12,5 marj ve hesap varsayılanı sorunsuz. Rehber net fiyatı merchant-of-record kullanımı için öneriyor. **Karar (9 Ekim 2026, işletme, B seçeneği): ADR-0006** — kendi ödememizde de otel marjı Nuitee API `margin` parametresiyle, onaylı fiyat politikasındaki orandan uygulanır; net + yerel marj yolu kodda korunur.

Kod etkisi: 2001 artık prebook için kesin red (yeniden arama) olarak sınıflandırılıyor. Matris: `nuitee.hotel.own_gateway.account_card` → account ENABLED (sandbox anahtarı), sandbox PASSED; production NOT_RUN.

### 10.1 ADR-0006 akışı — API marjıyla kendi ödeme (9 Ekim 2026)

| Adım | Sonuç | Referans |
|---|---|---|
| Komisyon ölçümü (arama, %1 / %5 / %12,5, tek oda; %7 iki oda) | `commission` = istenen yüzde × net; en büyük sapma 0,15 baz puan (oda/gece yuvarlaması) | — |
| Arama (%10 marj) | SUCCEEDED, 41 teklif | — |
| Prebook | fiyat 1.521,09 EUR, komisyon 138,27 EUR (net 1.382,82); değişim yok | prebook `nmg5p6zMI` |
| Fiyat çekirdeği (`computeSellPrice`, test politikası) | PROVIDER_API kabul; satış = tedarikçi tahsilatı = 1.521,09; beklenen komisyon 138,27 | — |
| Book (`ACC_CREDIT_CARD`) | CONFIRMED; maliyet 1.521,09 EUR (komisyon dahil); rezervasyonda komisyon 138,27 EUR | booking `M9KFYzg0w` |
| `clientReference` ile sorgu | CONFIRMED, komisyon 138,27 EUR | — |
| İptal | CANCELLED, ceza 0, iade 1.521,09 EUR (komisyon dahil tam tutar) | — |

Sandbox gizli test kartı kullanıldığı için kart ekstresi görülemez: kartın komisyon dahil tutarla yüklendiği yanıttaki `price` alanından ve dokümandan çıkarılmıştır. Komisyonun haftalık payout ile check-out sonrası ödenmesi doküman kanıtıdır. Hesap sahibi ise Nuitee tahsilatlı satışta komisyonun, Nuitee müşterinin ödemesini aldığında hesaba geçtiğini bildirdi (2026-10-10). Sistem iki durumu da karşılar: ödeme konaklamadan önce gelirse peşin tahsil (avans) sayılır, konaklama bitince gelire geçer (ADR-0019, 2. sürüm). İptalde komisyonun geri alınma biçimi açık sorudur (`saglayici-sorulari.md` soru 24).

### 10.2 ADR-0008 akışı — Nuitee tahsilatlı ödeme (9 Ekim 2026)

Ağ izinleri verildikten sonra Nuitee ödeme bileşeni (`payment-wrapper.liteapi.travel`, Stripe test modu) gerçek tarayıcıda Stripe test kartıyla (4242…) ödendi. Komut: `pnpm web:e2e:sandbox` (`apps/web/e2e-sandbox/`). Kanıtlar (kişisel veri yok):

| Adım | Sonuç | Referans |
|---|---|---|
| Ödemeden önce book (`TRANSACTION_ID`) | REJECTED 2014 "payment not completed" | — |
| Ödeme bileşeni (publicKey `sandbox`) | `redirect_status=succeeded`, dönüş URL'sine yönlendirme | EUR, USD, GBP, TRY |
| Ödemeden sonra **aynı** `clientReference` | 4005 (yinelenen); sorguda rezervasyon **yok** → referans tükenmiş | — |
| **Yeni** `clientReference` ile book | CONFIRMED; maliyet = prebook fiyatı; komisyon raporlandı | EUR `NUmPV1UB8`/`u_hFBKBsZ`, USD `3oOlJ5Q30`/`WH6UdsdyB`, GBP `zWf6l2QAB`/`1glSxRgyt`, TRY `dvRi7AhKe`/`mGPpbtdQd` |
| Aynı referansla tekrar | 4005 → sorgu aynı rezervasyonu buldu | — |
| Aynı işlemle üçüncü referans | 2014 → işlem tek kullanımlık, ikinci rezervasyon yok | — |
| İptal (iade edilebilir oran) | CANCELLED, ceza 0 | — |
| Kendi sitemiz, masaüstü ve 320 px: arama → teklif → misafir → ödeme → dönüş → onay | CONFIRMED; sitemizin CSP'si ihlal üretmedi; iptal cezası 0 | sipariş `a4cc0db3…` / `roaGBtWE9`, `eb5fccb2…` / `azYhTLiRy` |
| /yonetim "Durumu kontrol et" (`GET /bookings/{id}`), ödenmiş SDK rezervasyonu | CONFIRMED, değişiklik yok | sipariş `3efbd73f…` / `lobIb_dn4` |
| /yonetim "Rezervasyonu iptal et" (`PUT /bookings/{id}`) | CANCELLED; `cancellation_fee` 0; `refund_amount` 173,36 EUR (müşterinin ödediği tutarın tamamı). Sipariş iptal, ödeme "iade sürüyor", iade doğrulama görevi açıldı; müşteri sayfası iptali gösterdi | aynı |

**TRY (10 Ekim 2026, `SANDBOX_PAYMENT_CURRENCIES=TRY`):**
- Fiyat araması TRY döndü (200 teklif).
- Prebook `dvRi7AhKe`: 68.020,24 TRY. Bu tutara %10 API marjımız (6.183,64 TRY) dahil.
- Ödeme bileşeni Stripe test kartıyla TRY tahsil etti (`redirect_status=succeeded`).
- Book `mGPpbtdQd` CONFIRMED oldu. Maliyet ve komisyon TRY olarak raporlandı.
- İptal: CANCELLED, ceza 0.
- Sonuç: Nuitee TRY'yi doğrudan fiyatlar ve tahsil eder; bizim tarafta kur çevrimi gerekmez.
- Matriste bu yeteneğin TRY tahsilatı `VERIFIED` oldu. Ancak K13 gereği TRY tahsilatı kendi gateway'imize (iyzico) yönlenir. Rota kuralı 3 bunu kodda uygular; bu yüzden TRY satışı iyzico gelene kadar kapalı kalır. Kanıt, K13 değişirse ya da iyzico gelmeden önce bir karar gerekirse içindir.

**Kod etkisi (hata düzeltmesi):** ADR-0008 ilk tasarımı 2014'ten sonra aynı `clientReference` ile yeniden deniyordu. Sandbox, bu referansın tükendiğini gösterdi: müşteri ödese bile sipariş hiç rezerve edilemezdi. Artık 2014'ten sonra her deneme yeni referansla yapılıyor. Vazgeçmeden önce gönderilmiş **tüm** referanslar sorgulanıyor; çift rezervasyona karşı güvence işlemin tek kullanımlık olması (sandbox kanıtı). Mock bağlayıcı da aynı davranışı taklit ediyor.

**Diğer bulgular:**
- **Önerilen satış fiyatı (SSP):** Sandbox'ta SSP yapay. Marj %0–16 arasında net × 1,163, %20 ve üstünde fiyat × (1 + marj). Bu yüzden her marjda fiyat SSP'nin altında kalıyor ve kamuya açık site (fiyat paritesi kuralı, revenue guide) hiçbir teklif göstermiyor. Antalya'da 266 teklifin 266'sı. Sitenin sandbox'ta test edilebilmesi için yalnız `PROVIDER_ENV=sandbox` iken kabul edilen `SANDBOX_SKIP_RATE_PARITY=true` eklendi; başka ortamda uygulama açılmaz. Canlıda SSP'nin otelin gerçek alt fiyatı olduğu doğrulanmalı.
- **Ödeme yöntemleri para birimine göre değişiyor:** USD'de kartın yanında Cash App Pay, Afterpay, Affirm, Amazon Pay ve Klarna listelendi (kart varsayılan değil). Düğme metni İngilizce ("Pay").
- **Geliştirme ortamı ağı:** `r.stripe.com` (analitik), `b.stripecdn.com` ve `merchant-ui-api.stripe.com` (Link) kapalı. Ödeme yine tamamlandı (Stripe pasif captcha hatasını tolere etti). Canlı müşteri tarayıcılarında bu kısıt yok.
- **Hydration hatası düzeltildi:** Ülke adları ve sıralaması Node ile tarayıcıda farklı (TR'de 92 fark, EN'de 4). Liste artık yalnız sunucuda üretiliyor. Mock E2E sayfa hatasında başarısız sayılıyor.

### 10.3 Nuitee uçak — tahsilatlı ödeme, bağlayıcı düzeyi (9 Ekim 2026)

Uçak bağlayıcısı (ADR-0011) sandbox anahtarıyla, gerçek Nuitee ödeme bileşeni ve Stripe test kartıyla denendi. Komut: `pnpm web:e2e:sandbox` (`apps/web/e2e-sandbox/flight-payment.sandbox.spec.ts`); keşif adımları ayrıca elle çalıştırılan, commit edilmeyen bir betikle yapıldı. Yolcu ve iletişim bilgileri uydurma test değerleridir. Kişisel veri ve gizli değer kaydedilmedi. Oluşan her rezervasyon iptal edildi.

| Adım | Sonuç | Referans |
|---|---|---|
| Arama (IST→AYT, 1 yetişkin, EUR, test marjı %10) | 200; 184–231 teklif; fiyat kuruşu kuruşuna eşlendi | — |
| Doğrulama | 200; `offerId` gövdede yok (OpenAPI'deki gibi), değişiklik yok | — |
| Prebook (`usePaymentSdk:true`) | 200; `price` = doğrulanmış fiyat; `transactionId` + `secretKey`; `paymentTypes` TRANSACTION_ID, ACC_CREDIT_CARD; ek hizmet grupları var | `01a12313-b372…` |
| Ödeme bileşeni (publicKey `sandbox`, uçak `secretKey`) | `redirect_status=succeeded`. Dönüş URL'si `payment_intent` ve `payment_intent_client_secret` taşıyor: bu URL kayda yazılmamalı | — |
| `POST /flights/bookings` (belgelenmiş yol) | **307 → `/flights/bookings/`**. Taşıyıcımız yönlendirme izlemediği için ilk koşu UNKNOWN (ağ) döndü; istek rezervasyona ulaşmadı. Bağlayıcı artık sondaki eğik çizgili yolu çağırıyor | ilk koşu, prebook `01a1230c-7ea9…` (rezervasyonsuz) |
| Book (`TRANSACTION_ID`) | 201 `PENDING_CONFIRMATION`; `paymentStatus` "succeeded" (belgelenmemiş değer); maliyet = prebook fiyatı | `01a1231c-c31c…` |
| Aynı prebook ile tekrar | 200, **aynı rezervasyon** (belgelenmiş idempotency); `paymentStatus` "pending" ya da "completed" | aynı |
| Onay ve biletleme | Süre değişken. Bir koşuda 1–3 dakikada `CONFIRMED` + havayolu PNR'ı geldi, bilet verisi yoktu. Başka bir koşuda 4 dakika `PENDING_CONFIRMATION` kaldı. **Son koşuda ~3 dakikada biletlendi:** `ticketData.ticketedAt` doldu (bağlayıcı: `ISSUED`). OpenAPI'de olmayan `ticketData.tickets[]` geldi (bilet numarası, durum "issued", yolcu belge alanları); sandbox'ta bilet numarası PNR ile aynı. `order.status` biletlendikten sonra da "created" kaldı | `01a12301-ba14…`, `01a12313-eed4…`, `01a1231c-c31c…` |
| Ödemeden önce book | **Sandbox reddetmedi**: 201, ardından `CONFIRMED`; bir koşuda biletlendi de. Rehbere göre production reddeder (soru 11) | `01a122fc-cb04…`, `01a12318-0070…`, `01a1231f-fa04…` (biletli, iptal edildi) |
| İptal teklifi | Onaylı rezervasyonda 500 (59099); onay bekleyende 409 (49006); iptali bekleyende 409 (49007) | — |
| İptal — onaylı ve biletli rezervasyon | 200 `CANCELLED`, ücret 0, `refund_amount` = ödenen tutarın tamamı, **`destination: agency_deposit`**, belgelenmemiş `refund_type: "full"`; biletli rezervasyon da iade edilemez tarifeye rağmen tam iadeyle iptal edildi (sandbox) | `01a12301-ba14…`, `01a1231c-c31c…` |
| İptal — onaylanmamış rezervasyon | 202 ve `status: CREATED` (OpenAPI yalnız CONFIRMED yazıyor). Rezervasyon `CREATED` + `cancelIntentAt` olarak kaldı; tekrar 202 (idempotent). 9–19 dakika sonra `CANCELLED` oldu | `01a12310-b741…`, `01a12310-f716…` |
| İptal — ödemesi "pending" kalan rezervasyon | 409 → bağlayıcı UNKNOWN → rezervasyon okundu: `CANCELLED` (belirsiz yanıtın belgelenmiş çözümü) | `01a12313-eed4…` |
| Hız sınırı | Arka arkaya çağrılarda 429 (4290, OpenAPI'de yok) → bağlayıcı UNKNOWN sayıyor, tekrar soruluyor | — |
| Yanıt süresi | `GET /flights/bookings/{id}` 0,2–23 s | — |

**Kod etkisi:**
- Book yolu sondaki eğik çizgiyle çağrılıyor.
- 429 UNKNOWN sayılıyor.
- `cancelIntentAt` bekleyen her durumda `CANCEL_PENDING` sayılıyor.
- 202 iptal yanıtında `CREATED` / `PENDING_CONFIRMATION` kabul ediliyor.
- Bilet numaraları `ticketData.tickets[]` varsa okunuyor; biletlenme kararı yine yalnız `ticketedAt` ile veriliyor. Bu dizideki yolcu belge bilgileri saklanmıyor.
- Sözleşme testleri bu yanıt biçimlerini "SANDBOX SHAPE" etiketiyle içeriyor.

**Sandbox'ın kanıtlayamadıkları:**
- ödemesiz rezervasyonun production'da reddedildiği;
- production biletlemesi (sandbox bilet numarası yapay ve PNR ile aynı);
- iptal teklifi;
- tutarlar: `payment.amount` (22,10 EUR) ile `pricing.totalAmount` (22,76 EUR) farkı;
- iadenin müşteri kartına mı yoksa hesabımıza mı (`agency_deposit`) döndüğü.

Sorular: `saglayici-sorulari.md` 11–19.

### 10.4 Nuitee uçak — marjın yanıttan doğrulanması (10 Ekim 2026)

OpenAPI uçak teklifinde marj tutarını göndermez. Belgelenen kural şudur: `base`, `taxes` ve `fees` tedarikçi değerleridir ve marjı hiçbir zaman içermez; marjı yalnız `total` taşır. Bu yüzden uygulanan marj `total − (base + taxes + fees)` olmalıdır.

Sandbox'ta salt-okunur aramayla doğrulandı:
- arama: IST→AYT, 2 yetişkin + 1 çocuk, EUR, satış noktası TR;
- elle çalıştırılan, commit edilmeyen bir betik kullanıldı; rezervasyon yapılmadı, kişisel veri gönderilmedi.

| `margin.rateSearch` | Teklif | `total / (base+taxes+fees)` | İstenen marjdan sapma | Not |
|---|---|---|---|---|
| 0 | 132 | tam 1,00000 (hepsi) | 0 | `platformFees` hiçbir teklifte yok |
| 10 | 132 | 1,09991–1,10000 | −0,87…0 baz puan (yolcu başı yuvarlama) | negatif marj yok |

Üçüncü bir arka arkaya aramada 429 alındı (ADR-0011'deki gibi UNKNOWN).

**Kod etkisi:**
- `FlightOffer.appliedMarkup` alanı eklendi. Bu alan negatifse teklif fiyatlanmaz.
- Satış fiyatı, onaylı `FLIGHT` kuralıyla mevcut 5 baz puan toleransla karşılaştırılır. Tutmazsa teklif gösterilmez. Örnek: hesapta marj düzenleme kapalıysa hesap varsayılanı uygulanır ve teklif düşer.
- Production hesabında marj düzenlemenin açık olduğu sorulmadı, varsayılmadı (soru 21).

### 10.5 Nuitee uçak — koltuk/bagaj ek hizmetleri (10 Ekim 2026)

Komut: `pnpm web:e2e:sandbox` (`flight-payment.sandbox.spec.ts`, "a seat and a bag attached before payment" testi). Ödeme bileşeni ve Stripe test kartı gerçek. Yolcu bilgileri uydurma. Rezervasyon sonunda iptal edildi.

| Adım | Sonuç | Referans |
|---|---|---|
| Arama (IST→AYT, `rateSearch`/`seats`/`bags` %10, `penalties` 0) | 200; dört kategorili istek kabul edildi (196 teklif) | — |
| Prebook | 38,22 EUR; `servicesAttachable` dolu. İlk denemede 30 sn zaman aşımı → UNKNOWN, sonraki teklif denendi | `01a125af-c7d4…` |
| `GET /flights/prebooks/{id}` | 102 koltuk (68 boş), bagaj yok. Gruplarda `available` alanı yok (OpenAPI'de var); bazı koltuklar 0 fiyatlı. Tutar ve niyet prebook ile aynı | aynı |
| `POST …/services` (en ucuz boş koltuk) | 49,80 EUR = 38,22 + 11,58 (**kuruşu kuruşuna**); **yeni `transactionId` ve `secretKey`**. Yanıtta eklenen hizmet listesi yok | aynı |
| Tekrar `GET` | Aynı yeni niyet ve tutar; `selectedServices` 1 kayıt; `bookedServices` "status: pending", "phase: post_booking"; `pricing.servicesAmount` 11,58; eklenen koltuk artık listede değil | aynı |
| Yeni secret ile ödeme → book (yeni `TRANSACTION_ID`) | `redirect_status=succeeded`; 201 `PENDING_CONFIRMATION`, maliyet 49,80 EUR | `01a125b0-0b56…` |
| İptal | 202 `CANCEL_PENDING` (onay öncesi; R0 §10.3'teki gibi) | aynı |
| IST→LHR | Katalog boş. Belgelenmemiş `notSupported: true` ve `providerErrors` ("Seat selection not available for this airline", `CARRIER_NOT_SUPPORTED`) | `01a125b0-bbb3…` (rezervasyonsuz) |

**Kod etkisi:**
- Grup yalnız açıkça `available: false` ise kapatılır.
- Eklenen liste ve kayıp yanıt GET ile çözülür.
- Tutar eşitliği zorunlu tutulur.
- Belgelenmemiş alanlar okunmaz; katalog boşsa hiçbir şey sunulmaz.

**Kanıtlanamayanlar:**
- bagaj (iki rotada da teklif yoktu);
- koltuğun havayolunca kesinleşmesi;
- hizmet marjının tutara yansıması (marj tutarı gösterilmiyor).

Soru 22.

## 11. Otel liste sayfaları için Nuitee verisi (10 Ekim 2026)

Komut: sandbox anahtarıyla yalnız okuma çağrıları; rezervasyon yok. Ham çıktı paylaşılmadı (anahtar yazdırılmadı).

| Çağrı | Sonuç | Kod etkisi |
|---|---|---|
| `GET /data/places?textQuery=Antalya&language=tr` | İlk sonuç "Antalya" (`locality`, `ChIJwa2t3a6awxQRMy7j-XOfxpU`) | Antalya bir şehir; Belek, Kemer, Side ayrı yerler. Bir liste birden çok yer alır. |
| `GET /data/places?textQuery=Rome` | İlk sonuç **Rome, Georgia (ABD)**; `/data/places/{id}` adres bileşenleri bunu gösterdi. "Roma" (TR) → Roma, İtalya | Panel yer seçerken adres/ülke gösterir. Yer kimliği yazmak yerine öneriden seçilir. |
| `POST /hotels/rates` `placeId` (Antalya, 1 gece, 2 yetişkin, EUR, TR, marj %10, `maxRatesPerHotel` 8, `limit` 50) | 200; 38 otel, 182 oran; 11,2 sn; 0,56 MB | Bölge üyeleri fiyat aramasından bulunur. Çağrı başına bir tarih. |
| Aynı, `boardType: "AI"` | 200; 11 otel, 31 oranın hepsi `AI` | "Her şey dahil" listesi `boardType` ile taranır. Canlı aramaya da `boardType` eklendi; müşteri aynı fiyatı bulabilir. |
| `placeId` Mısır / Rome | 46 otel / 9 otel (ABD'deki Rome) | Yer seçimi kanıtı yukarıda. |
| `GET /data/hotel?hotelId=…&language=tr` / `en` | 200; Türkçe/İngilizce açıklama (HTML), 72 görsel (`static.cupid.travel`), 96 olanak, puan 8/10, 1000 yorum, konum, giriş/çıkış | İçerik düz metne çevrilir; yalnız https görseller. Puan sayfada kaynağıyla gösterilir, işaretlenmez. |
| `/data/hotels` `placeId` belgesi | "merkezin 1 km çevresi" | Bölge listesi için kullanılmaz. |
| `/hotels/min-rates` belgesi | `margin` parametresi yok | Onaylı marjla fiyat vermediği için kullanılmaz. |
| Hız sınırı belgeleri (sabitlendi) | Sandbox 5 istek/sn; production 250 ya da 500 istek/sn (iki belge farklı) | Tarama varsayılan 1 istek/sn ve süreçler arası ortak hızla çalışır. |
| `GET /data/hotels?hotelName=Swandor` (ülkesiz) | 4000 "you must search by either country code, …" | Ad araması ülke kodu ister; panel bulucusu ülke + ad sorar. |
| `GET /data/hotels?hotelName=Swandor&countryCode=TR&language=tr&limit=20` (`nuitee-hotel.sandbox.test.ts`, 10 Ekim 2026) | 200; 2 otel: `lp36ea1` Swandor Hotels & Resorts - Topkapi Palace (Lara, 5★), `lp8ad18` Swandor Hotels & Resorts - Kemer - All Inclusive (Kemer, 5★) | Panelde "Otel adıyla bul": kod tek tıkla ekle/sabitle/çıkar alanına girer. Alanlar sabitlenmiş OpenAPI ile aynı (`id`, `name`, `city`, `country`, `address`, `stars`, `deletedAt`). |

**Kanıtlanamayanlar:**
- arama çağrısı ücreti veya bakma/satma oranı sınırı;
- production hız sınırının kesin değeri;
- içeriklerin kamuya açık, indekslenen sayfalarda kullanım izninin yazılı teyidi (işletme 10 Ekim 2026'da kullanımı onayladı).

Soru 23.

