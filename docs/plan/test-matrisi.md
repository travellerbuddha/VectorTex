# T01–T36 test matrisi — uygulama durumu

Kaynak: şartname §19. Durum: ✅ otomatik test var ve geçiyor · ◐ kısmi (sözleşmeden bağımsız kısım test edildi; gerçek sağlayıcı/arayüz kısmı bekliyor) · ⛔ henüz yok / dış girdiye bağlı.

Ortam etiketi: **mock** = etiketli test dublörü, **db** = gerçek PostgreSQL 16 + Redis 7 (yerel/CI), **sandbox/prod** = sağlayıcı ortamı. Ortam sütununda **sandbox** yazan satırların kanıtı R0 raporundadır (§10–10.2); hiçbir satır production kanıtı değildir.

| ID | Senaryo | Durum | Kanıt (dosya) | Ortam | Eksik olan |
|---|---|---|---|---|---|
| T01 | Money/kur/yuvarlama | ✅ | `packages/pricing/test/money.test.ts`, `packages/db/test/invariants.int.test.ts` (dağılım tetikleyicisi) | mock, db | Onaylı kur kaynağı ve yuvarlama politikası (G06) |
| T02 | Net, marj, SSP | ✅ | `packages/pricing/test/policy.test.ts` (LOCAL ve ADR-0006 API marjı: komisyon doğrulaması, yuvarlama toleransı, ürün kısıtı), `packages/db/test/commission.int.test.ts` (komisyon alacağı), Nuitee sandbox (%10 marj, `M9KFYzg0w`) | mock, db, sandbox | Onaylı marj/ücret değerleri (G06); komisyon payout mutabakatı (P15) |
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
| T13 | Sahte redirect/callback | ◐ | Domain durumunu yalnız sunucu `retrieve` değiştirir (`orchestrator.ts`); `iyzico.test.ts`; Nuitee tahsilatında dönüş yalnız tetikleyici, URL kimlikleri kullanılmıyor (`provider-managed.test.ts`, dönüş sayfası); sipariş erişimi çerezle, CSRF reddi (`apps/web/e2e`); Nuitee ödeme bileşeninin gerçek dönüşüyle onay (`apps/web/e2e-sandbox/site-flow.sandbox.spec.ts`) | mock, db, sandbox | iyzico sandbox |
| T14 | Tutar/para birimi/kimlik farkı | ✅ | `orchestrator.test.ts` (mismatch → void), `iyzico.test.ts` | mock | iyzico sandbox |
| T15 | İmza/ortam doğrulama | ◐ | `invariants.int.test.ts` (ortam karışımı), `config.test.ts` (host kilidi), `iyzico.test.ts` (yanıt imzası, V3 HPP webhook), `nuitee-hotel.test.ts` (sandbox kaydı production'ı güncellemez) | mock, db | Webhook endpoint'i (P16), iyzico webhook aktivasyonu |
| T16 | Fraud review | ✅ | `orchestrator.test.ts`, `iyzico.test.ts` | mock | fraudStatus kodlarının doküman teyidi |
| T17 | Çift tıklama/iki worker | ✅ | `orchestrator.test.ts`, `order-store.int.test.ts` | mock, db | — |
| T18 | Tekrar/sırası değişmiş webhook | ◐ | `invariants.int.test.ts` (inbox), `orchestrator.test.ts` (geri gitmeyen durum) | mock, db | Webhook endpoint'leri (P16) |
| T19 | Sağlayıcı create yanıtı kayıp | ✅ | `orchestrator.test.ts`, `order-store.int.test.ts`, `nuitee-hotel.test.ts` (4005/2014/5000 → UNKNOWN → lookup); `provider-managed.test.ts` (2014 sonrası yeni referans, süre dolunca gönderilmiş tüm referansların sorgusu, tek kullanımlık işlem); Nuitee sandbox'ta 4005 → sorgu, tükenmiş referans ve tek kullanımlık işlem doğrulandı (`provider-payment.sandbox.spec.ts`) | mock, db, sandbox | Kayıp yanıt senaryosunun sandbox'ta zorlanması |
| T20 | Capture/refund yanıtı kayıp | ✅ | `orchestrator.test.ts`, `iyzico.test.ts` | mock | Refund komut akışı (P15) |
| T21 | Gateway değişimi | ✅ | `invariants.int.test.ts` (tek canlı ödeme denemesi) | db | — |
| T22 | Desteklenmeyen yetenek | ✅ | `routing.test.ts`, `iyzico.test.ts` | mock | — |
| T23 | Experiences G03 kapalı | ✅ | `routing.test.ts` | mock | — |
| T24 | Paket her adımda hata | ✅ | `orchestrator.test.ts` (6 adım), `order-store.int.test.ts` | mock, db | — |
| T25 | Pakette belirsiz bileşen | ✅ | `orchestrator.test.ts`, `order-store.int.test.ts` | mock, db | — |
| T26 | Tedarikçiler başarılı, capture hatası | ✅ | `orchestrator.test.ts` | mock | — |
| T27 | Tam/kısmi iptal/iade | ◐ | `policy.test.ts` (çift iade yok) | mock | Müşteri iptal/iade komutları (P15) |
| T28 | Restart/Redis kaybı | ✅ | `apps/worker/test/relay.int.test.ts` | db | Üretim yedek/restore kanıtı (T35) |
| T29 | Rol/kayıt erişimi | ◐ | `packages/db/test/permission.int.test.ts` (izin verme/geri alma, son yönetici, DB tetikleyicileri), `policy.int.test.ts` (izinsiz düzenleme/onay reddi, SELF onay), `packages/contracts/test/permissions.test.ts` | db | Kayıt kapsamı (record scope), ekran ve giriş (P05) |
| T30 | CMS/MFA/Local API | ⛔ | — | — | P05/P06 |
| T31 | Log/belge/secret | ◐ | `config.test.ts` (secret değeri hata mesajında yok, redaction) | mock | Log redaction middleware, signed URL (P05/P15) |
| T32 | Legacy/SEO import | ⛔ | — | — | P17 + içerik/URL envanteri |
| T33 | Mobil/erişilebilirlik | ◐ | `apps/web/e2e/hotel-booking.spec.ts` (320 px'te yatay taşma yok, etiketli alanlar, rol/isimle erişim, sayfa hatası/hydration yok), 16 px temel yazı, 44 px dokunma alanları, odak çerçevesi, reduced motion; Nuitee ödeme bileşeni 320 px'te taşmasız ve ödenebilir (`site-flow.sandbox.spec.ts`) | mock, sandbox | Tam WCAG 2.2 AA denetimi (ekran okuyucu, kontrast ölçümü), diğer ürün sayfaları |
| T34 | Personel kabulü | ⛔ | — | — | P18 (insan testi) |
| T35 | Yük/limit/restore | ⛔ | — | — | Hesap limitleri + barındırma |
| T36 | Onaylı gerçek pilot | ⛔ | Nuitee otel sandbox zinciri (search→prebook→book→lookup→cancel) geçti; bu pilot değildir | sandbox | Yetki/bütçe onayı + bütün G kapıları |

Komutlar: `pnpm test` (unit), `pnpm test:integration` (TEST_DATABASE_URL + TEST_REDIS_URL gerekli; ilgili şema/DB silinir).
