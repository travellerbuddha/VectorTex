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

Sandbox gizli test kartı kullanıldığı için kart ekstresi görülemez: kartın komisyon dahil tutarla yüklendiği yanıttaki `price` alanından ve dokümandan çıkarılmıştır. Komisyonun haftalık payout ile check-out sonrası ödenmesi yalnız doküman kanıtıdır (production'da doğrulanacak; soru metni `saglayici-sorulari.md`).
