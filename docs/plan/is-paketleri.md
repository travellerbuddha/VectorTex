# P00–P20 iş paketleri — durum

Kaynak: şartname §18. Durum: ✅ tamam · ◐ kısmi · ⛔ dış blokaj · ⬜ başlanmadı. "Tamam" yalnız kod + test anlamına gelir; sağlayıcı/production kanıtı değildir.

| İş | Durum | Bu repoda olan | Eksik / blokaj |
|---|---|---|---|
| P00 Erişim/kanıt matrisi | ◐ | `contracts/capability-matrix.json` (4 ayrı durum alanı + kanıt), `contracts/sources.lock.json` + `scripts/pin-contracts.mjs`, R0 raporu | Doküman alan adları build ortamından erişilemedi (403) → hash'ler alınamadı. Hesap/yetki kanıtı yok |
| P01 Ödeme/finansman PoC | ⛔ | Rota kuralları ve yetenek değerlendirmesi kodda (`selectPaymentRoutes`) | Nuitee/Welcome/iyzico sandbox anahtarları ve hesap yetkileri; Experiences bağımsız funding (G03) |
| P02 Repo/altyapı | ◐ | pnpm monorepo, sürüm kilidi (ADR-0001), Zod config fail-fast, CI, DB, worker | Render altyapı tanımı, secret manager, `apps/web` (Next+Payload) iskeleti |
| P03 Domain/DB | ✅ | Money, QuoteVersion, Order/Item, ayrı durum makineleri, Drizzle `core` şeması, migration'lar, DB değişmezlikleri | CustomerTransaction/SupplierSettlement için komut akışları P15 ile |
| P04 Kalıcı işler | ✅ | Outbox (SKIP LOCKED, redrive, DEAD), Inbox, idempotency, intent/lease, BullMQ relay, Redis kaybı testi | — |
| P05 Kimlik/yetki | ⬜ | — | Payload auth + MFA, müşteri OTP, rol/kayıt kapsamı |
| P06 Payload/içerik | ⬜ | ADR-0003 (`cms` şeması) | Next 16.3.8 + Payload 3.90.2 kurulum, koleksiyonlar, blok/preview/SEO |
| P07 Connector sözleşmeleri | ◐ | Ürün arayüzleri (`HotelConnector`…), `ExternalOutcome`, capability registry, sözleşme kilidi, OpenAPI→TS üretici | Kilitli OpenAPI dokümanları |
| P08 Fiyatlandırma | ◐ | Net/satış/tek marj, SSP tabanı, dağılım, FX snapshot, onaylı politika tablosu | Onaylı marj/ücret/kur kaynağı/yuvarlama (G06) |
| P09 iyzico adapteri | ◐ | Ön provizyon CF, retrieve, postauth, cancel, item refund, imza doğrulama, registry | Sandbox anahtarı + merchant preauth/döviz teyidi; V3 webhook alan sırası (doküman kilidi) |
| P10 Nuitee otel | ◐ | Çok oda/occupancy/milliyet doğrulaması | `api-search/booking/hotel-data.json` kilidi, sandbox anahtarı, hesap kartı/kredi teyidi |
| P11 Nuitee uçak | ⛔ | Biletleme ayrımı orchestrator'da | `openapiflights.json`, uçak erişimi, prebook bypass teyidi |
| P12 Nuitee Experiences | ⛔ | Katılımcı/soru doğrulaması; bağımsız ödeme rotası kapalı (G03) | `api-experiences.json`, async/voucher, G03 |
| P13 Welcome transfer | ◐ | JSON:API hata ayrımı, referanslar, firm quote ve lokasyon/saat doğrulaması | Welcome dokümanı, staging anahtarı, kredi hesabı, audit |
| P14 Paket orchestrator | ◐ | Tek tahsilat, sıralı onay, compensation, UNKNOWN, capture hatası, deadline; DB ile uçtan uca | Gerçek connector'lar; provider-managed tekil akış orkestrasyonu; G03 üretim şartı |
| P15 Operasyon/finans | ⬜ | Görev/audit/ledger altyapısı | Kuyruk/detay ekranları, iptal/iade komutları, mutabakat |
| P16 Müşteri UX | ⬜ | — | TR/EN mobil akışlar, guest checkout, paket oluşturucu |
| P17 Geçiş/SEO | ⬜ | — | URL/içerik envanteri ve kullanım hakları |
| P18 Kabul/pilot | ⬜ | — | T01–T36 tamamı + yetkili pilot |
| P19 İlk canlı sürüm | ⛔ | — | G01–G09 |
| P20 Sonraki genişleme | ⬜ | `agency_id` yalnız şema hazırlığı (izolasyon sayılmaz) | Ayrı kapsam |
