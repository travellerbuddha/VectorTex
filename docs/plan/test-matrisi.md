# T01–T36 test matrisi — uygulama durumu

Kaynak: şartname §19. Durum: ✅ otomatik test var ve geçiyor · ◐ kısmi (sözleşmeden bağımsız kısım test edildi; gerçek sağlayıcı/arayüz kısmı bekliyor) · ⛔ henüz yok / dış girdiye bağlı.

Ortam etiketi: **mock** = etiketli test dublörü, **db** = gerçek PostgreSQL 16 + Redis 7 (yerel/CI), **sandbox/prod** = sağlayıcı ortamı. Bu tabloda hiçbir satır sandbox veya production kanıtı değildir.

| ID | Senaryo | Durum | Kanıt (dosya) | Ortam | Eksik olan |
|---|---|---|---|---|---|
| T01 | Money/kur/yuvarlama | ✅ | `packages/pricing/test/money.test.ts`, `packages/db/test/invariants.int.test.ts` (dağılım tetikleyicisi) | mock, db | Onaylı kur kaynağı ve yuvarlama politikası (G06) |
| T02 | Net, marj, SSP | ✅ | `packages/pricing/test/policy.test.ts` | mock | Onaylı marj/ücret değerleri (G06) |
| T03 | Çok oda/çocuk/milliyet | ◐ | `packages/connectors/test/connectors.test.ts`, `nuitee-hotel.test.ts` (resmî OpenAPI örnekleri, çok odalı ceza toplama) | mock | Sandbox koşusu (API host izni) |
| T04 | Quote değişimi/expiry | ✅ | `packages/domain/test/state-quote-time.test.ts`, `orchestrator.test.ts` (prebook fiyat değişimi, süresi dolmuş prebook) | mock | — |
| T05 | İptal saat dilimi/DST | ✅ | `packages/domain/test/state-quote-time.test.ts` | mock | Sağlayıcı iptal politikası alan eşlemesi (spec kilidi) |
| T06 | HTTP 200 hata gövdesi | ◐ | `packages/connectors/test/connectors.test.ts` (JSON:API) | mock | Welcome staging doğrulaması |
| T07 | Uçak yolcu/ek hizmet | ⛔ | — | — | `openapiflights.json` kilidi + uçak erişimi |
| T08 | PNR/bilet ayrımı | ✅ | `orchestrator.test.ts` (PNR varken capture yok) | mock | Gerçek biletleme alanları (spec) |
| T09 | Experiences seçenek/soru | ◐ | `connectors.test.ts` | mock | `api-experiences.json` kilidi |
| T10 | Bekleyen aktivite/voucher | ◐ | `orchestrator.test.ts` (PENDING_CONFIRMATION onay sayılmıyor) | mock | Async webhook/voucher akışı (spec) |
| T11 | Transfer lokasyon/saat | ◐ | `connectors.test.ts` | mock | Welcome staging |
| T12 | Tahmini transfer fiyatı | ◐ | `connectors.test.ts` | mock | Welcome firm/estimate alanı (staging) |
| T13 | Sahte redirect/callback | ◐ | Domain durumunu yalnız sunucu `retrieve` değiştirir (`orchestrator.ts`); `iyzico.test.ts` | mock | Web callback route'u (P16) + iyzico sandbox |
| T14 | Tutar/para birimi/kimlik farkı | ✅ | `orchestrator.test.ts` (mismatch → void), `iyzico.test.ts` | mock | iyzico sandbox |
| T15 | İmza/ortam doğrulama | ◐ | `invariants.int.test.ts` (ortam karışımı), `config.test.ts` (host kilidi), `iyzico.test.ts` (yanıt imzası, V3 HPP webhook), `nuitee-hotel.test.ts` (sandbox kaydı production'ı güncellemez) | mock, db | Webhook endpoint'i (P16), iyzico webhook aktivasyonu |
| T16 | Fraud review | ✅ | `orchestrator.test.ts`, `iyzico.test.ts` | mock | fraudStatus kodlarının doküman teyidi |
| T17 | Çift tıklama/iki worker | ✅ | `orchestrator.test.ts`, `order-store.int.test.ts` | mock, db | — |
| T18 | Tekrar/sırası değişmiş webhook | ◐ | `invariants.int.test.ts` (inbox), `orchestrator.test.ts` (geri gitmeyen durum) | mock, db | Webhook endpoint'leri (P16) |
| T19 | Sağlayıcı create yanıtı kayıp | ✅ | `orchestrator.test.ts`, `order-store.int.test.ts`, `nuitee-hotel.test.ts` (4005/2014/5000 → UNKNOWN → lookup) | mock, db | Gerçek clientReference lookup (sandbox) |
| T20 | Capture/refund yanıtı kayıp | ✅ | `orchestrator.test.ts`, `iyzico.test.ts` | mock | Refund komut akışı (P15) |
| T21 | Gateway değişimi | ✅ | `invariants.int.test.ts` (tek canlı ödeme denemesi) | db | — |
| T22 | Desteklenmeyen yetenek | ✅ | `routing.test.ts`, `iyzico.test.ts` | mock | — |
| T23 | Experiences G03 kapalı | ✅ | `routing.test.ts` | mock | — |
| T24 | Paket her adımda hata | ✅ | `orchestrator.test.ts` (6 adım), `order-store.int.test.ts` | mock, db | — |
| T25 | Pakette belirsiz bileşen | ✅ | `orchestrator.test.ts`, `order-store.int.test.ts` | mock, db | — |
| T26 | Tedarikçiler başarılı, capture hatası | ✅ | `orchestrator.test.ts` | mock | — |
| T27 | Tam/kısmi iptal/iade | ◐ | `policy.test.ts` (çift iade yok) | mock | Müşteri iptal/iade komutları (P15) |
| T28 | Restart/Redis kaybı | ✅ | `apps/worker/test/relay.int.test.ts` | db | Üretim yedek/restore kanıtı (T35) |
| T29 | Rol/kayıt erişimi | ⛔ | — | — | P05 |
| T30 | CMS/MFA/Local API | ⛔ | — | — | P05/P06 |
| T31 | Log/belge/secret | ◐ | `config.test.ts` (secret değeri hata mesajında yok, redaction) | mock | Log redaction middleware, signed URL (P05/P15) |
| T32 | Legacy/SEO import | ⛔ | — | — | P17 + içerik/URL envanteri |
| T33 | Mobil/erişilebilirlik | ⛔ | — | — | P16 |
| T34 | Personel kabulü | ⛔ | — | — | P18 (insan testi) |
| T35 | Yük/limit/restore | ⛔ | — | — | Hesap limitleri + barındırma |
| T36 | Onaylı gerçek pilot | ⛔ | — | — | Yetki/bütçe onayı + bütün G kapıları |

Komutlar: `pnpm test` (unit), `pnpm test:integration` (TEST_DATABASE_URL + TEST_REDIS_URL gerekli; ilgili şema/DB silinir).
