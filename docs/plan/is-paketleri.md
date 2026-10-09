# P00–P20 iş paketleri — durum

Kaynak: şartname §18. Durum: ✅ tamam · ◐ kısmi · ⛔ dış blokaj · ⬜ başlanmadı. "Tamam" yalnız kod + test anlamına gelir; sağlayıcı/production kanıtı değildir.

| İş | Durum | Bu repoda olan | Eksik / blokaj |
|---|---|---|---|
| P00 Erişim/kanıt matrisi | ◐ | 45 kaynak SHA-256 ile kilitli; matris kanıtları hash referanslı; R0 raporu güncel | Hesap/yetki kanıtı yok; sağlayıcı API host'ları ağ politikasında kapalı |
| P01 Ödeme/finansman PoC | ◐ | Rota kuralları ve yetenek değerlendirmesi kodda (`selectPaymentRoutes`); Nuitee otel: hesap kartıyla sandbox zinciri geçti, ödeme SDK'lı prebook geçti | Nuitee/Welcome/iyzico sandbox anahtarları ve hesap yetkileri; Experiences bağımsız funding (G03) |
| P02 Repo/altyapı | ◐ | pnpm monorepo, sürüm kilidi (ADR-0001), Zod config fail-fast, CI, DB, worker | Render altyapı tanımı, secret manager, `apps/web` (Next+Payload) iskeleti |
| P03 Domain/DB | ✅ | Money, QuoteVersion, Order/Item, ayrı durum makineleri, Drizzle `core` şeması, migration'lar, DB değişmezlikleri | CustomerTransaction/SupplierSettlement için komut akışları P15 ile |
| P04 Kalıcı işler | ✅ | Outbox (SKIP LOCKED, redrive, DEAD), Inbox, idempotency, intent/lease, BullMQ relay, Redis kaybı testi | — |
| P05 Kimlik/yetki | ◐ | **Atanabilir personel izinleri (ADR-0007)**: izin kataloğu (TR/EN), rol paketleri, `core.staff_permission_grants` (silinmez, geri alma kayıtlı, son yönetici korunur, DB tetikleyicileri), politika onayında `approve` / `approve_own` (SELF) ayrımı, ilk yönetici kurulum komutu | Payload auth + MFA, müşteri OTP, kayıt kapsamı, /yonetim "İzinler" ekranı |
| P06 Payload/içerik | ⬜ | ADR-0003 (`cms` şeması) | Next 16.3.8 + Payload 3.90.2 kurulum, koleksiyonlar, blok/preview/SEO |
| P07 Connector sözleşmeleri | ◐ | Ürün arayüzleri (`HotelConnector`…), `ExternalOutcome`, capability registry, sözleşme kilidi, OpenAPI→TS üretici | Kilitli OpenAPI dokümanları |
| P08 Fiyatlandırma | ◐ | Net/satış/tek marj, SSP tabanı, dağılım, FX snapshot; **kullanıcının düzenlediği sürümlü fiyat/risk politikaları** (taslak → dört göz onayı → aktif), servis bedeli ve kur politikası; **ADR-0006: kendi ödemede otel/uçak için Nuitee API marjı** (politikadan, komisyon doğrulaması), komisyon alacağı kaydı (`provider_commissions`) | /yonetim düzenleme ekranı (P15/P06); kur kaynağı entegrasyonu; komisyon hak ediş/payout mutabakatı (P15) |
| P09 iyzico adapteri | ◐ | Ön provizyon CF, retrieve, postauth, cancel, kalem iadesi, doküman kilitli imza kuralları, V3 HPP webhook doğrulaması, registry | Sandbox anahtarı; `phase` değerleri ve kullanılmayan ön provizyonun serbest bırakılması sandbox'ta; webhook aktivasyonu |
| P10 Nuitee otel | ◐ | `NuiteeHotelConnector`: search/prebook/book/lookup/get/cancel, kilitli OpenAPI örnekleriyle sözleşme testleri, hata kodu sınıflandırması, sandbox'ta CREDIT engeli; **sandbox zinciri geçti** (hesap kartıyla book + sorgu + iptal) | Production kart/komisyon payout teyidi (soru metni hazır); sipariş→connector köprüsü (oda-misafir eşlemesi checkout ile, P16). `margin:0` reddi ADR-0006 ile aşıldı: API marjı + komisyon zinciri sandbox'ta geçti |
| P11 Nuitee uçak | ⛔ | Biletleme ayrımı orchestrator'da | `openapiflights.json`, uçak erişimi, prebook bypass teyidi |
| P12 Nuitee Experiences | ⛔ | Katılımcı/soru doğrulaması; bağımsız ödeme rotası kapalı (G03) | `api-experiences.json`, async/voucher, G03 |
| P13 Welcome transfer | ◐ | JSON:API hata ayrımı, referanslar, firm quote ve lokasyon/saat doğrulaması | Welcome dokümanı, staging anahtarı, kredi hesabı, audit |
| P14 Paket orchestrator | ◐ | Tek tahsilat, sıralı onay, compensation, UNKNOWN, capture hatası, deadline; DB ile uçtan uca. **Nuitee tahsilatlı tekil akış (ADR-0008)**: `ProviderManagedOrchestrator` (ödeme oturumu, dönüşte/işçide tamamlama, ödenmemişte aynı referansla yeniden deneme, kayıp yanıtta sorgu, süre aşımı, provizyon görevi) | Paketler kendi gateway'imizi bekliyor (iyzico sonra, ADR-0008); G03 üretim şartı |
| P15 Operasyon/finans | ⬜ | Görev/audit/ledger altyapısı | Kuyruk/detay ekranları, iptal/iade komutları, mutabakat |
| P16 Müşteri UX | ◐ | `apps/web` (Next 16.3.8): TR/EN otel akışı — yer önerili arama, sonuçlar (toplam önde, gecelik ortalama, iptal ve tesiste ödeme bilgisi), sunucu tarafı teklif, misafir bilgileriyle üyeliksiz ödeme, Nuitee ödeme bileşeni, dönüş/durum sayfaları; §14 API uçları; CSRF ve sipariş çerezi; Playwright uçtan uca testi (masaüstü + 320 px, MOCK) | Uçak, tur/aktivite, transfer, paket oluşturucu; e-posta bildirimleri; Payload içerik (P06); sandbox'ta gerçek ödeme bileşeni testi (ağ izni) |
| P17 Geçiş/SEO | ⬜ | — | URL/içerik envanteri ve kullanım hakları |
| P18 Kabul/pilot | ⬜ | — | T01–T36 tamamı + yetkili pilot |
| P19 İlk canlı sürüm | ⛔ | — | G01–G09 |
| P20 Sonraki genişleme | ⬜ | `agency_id` yalnız şema hazırlığı (izolasyon sayılmaz) | Ayrı kapsam |
