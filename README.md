# TexHoliday

Kendi müşteri sitesi, booking engine, Payload içerik yönetimi, operasyon paneli, fiyatlandırma, finansal kayıtlar, sağlayıcı connector'ları, seçilebilir ödeme altyapısı ve tek müşteri tahsilatlı dinamik paketleme.

- Şartname: [`docs/spec/TEXHOLIDAY_GUNCEL_UYGULAMA_PLANI.md`](docs/spec/TEXHOLIDAY_GUNCEL_UYGULAMA_PLANI.md) (v2.0, 9 Ekim 2026)
- R0 kanıt raporu: [`docs/r0/R0-kanit-raporu.md`](docs/r0/R0-kanit-raporu.md)
- Durum: [`docs/plan/is-paketleri.md`](docs/plan/is-paketleri.md) · [`docs/plan/canli-kapilari.md`](docs/plan/canli-kapilari.md) · [`docs/plan/test-matrisi.md`](docs/plan/test-matrisi.md)
- Mimari kararlar: [`docs/adr/`](docs/adr/)

> İlk canlı sürüm G01–G09 geçmeden açılmaz. CI testleri mock ve yerel PostgreSQL/Redis üzerindedir. Sağlayıcı sandbox kanıtları isteğe bağlı koşulardan gelir ve R0 raporuna (§10–10.3) işlenir. Production kanıtı yoktur.

## Yapı

```text
apps/worker          outbox relay, BullMQ tüketicisi, sipariş orkestrasyonu
packages/config      Zod ortam doğrulaması; production'da boş/sahte secret ve mock reddi
packages/pricing     Money (alt birimde tam sayı), Decimal, FX snapshot, dağılım, tek marj
packages/contracts   port arayüzleri, ExternalOutcome, capability matrisi, kaynak kilidi, HTTP portu
packages/domain      durum makineleri, ödeme rotası, teklif kuralları, paket orchestrator
packages/db          Drizzle `core` şeması, migration'lar, repository'ler, outbox/inbox/idempotency
packages/payments    OwnedPaymentGateway adapterleri (iyzico) ve registry
packages/connectors  ürün bazlı sağlayıcı yardımcıları (sözleşme kilitlenince adapterler)
contracts/           capability-matrix.json, sources.lock.json (SHA-256 kilit)
```

`apps/web` (Next.js 16.3.8): müşteri sitesi ve `/api/v1` uçları. Otel akışı Nuitee tahsilatlı ödemeyle çalışır (ADR-0008). Payload 3.90.2 (`cms` şeması) ve `/yonetim` P05/P06'da eklenecek.

Yerelde MOCK sağlayıcıyla web: `APP_ENV=development PROVIDER_ENV=mock ALLOW_MOCK_ADAPTERS=true PAYLOAD_ENABLED=false DATABASE_URL=… ORDER_ACCESS_SECRET=… TERMS_VERSION=… pnpm web:dev`. İçerik yönetimiyle (P06): `PAYLOAD_ENABLED=true PAYLOAD_SECRET=…` ve bir kez `DATABASE_URL=… PAYLOAD_SECRET=… pnpm cms:migrate`; CMS `/yonetim/icerik` altında, panel girişiyle açılır. Satış için onaylı bir fiyat politikası gerekir (varsayılan yok, G06). Uçtan uca test: `TEST_DATABASE_URL=… pnpm web:e2e`.

## Geliştirme

Gereken: Node 22, pnpm 10.28, PostgreSQL 16, Redis 7.

```bash
pnpm install
cp .env.example .env                 # yalnız yerel değerler
pnpm db:migrate                      # DATABASE_URL üzerinde core şeması
pnpm lint                            # mimari sınırlar + typecheck
pnpm test                            # unit
TEST_DATABASE_URL=... TEST_REDIS_URL=... pnpm test:integration   # tek kullanımlık DB/Redis; silinir
pnpm contracts:pin && pnpm contracts:types   # doküman erişimi açıldığında
pnpm staff:bootstrap <e-posta> "<Ad Soyad>"   # ilk /yonetim hesabı + kurulum bağlantısı (yalnız bir kez, ADR-0010; DATABASE_URL, STAFF_MFA_KEY, PUBLIC_BASE_URL)
# İsteğe bağlı, CI dışı (yalnız sandbox anahtarıyla; her test kendi rezervasyonunu iptal eder):
NUITEE_API_KEY=... NUITEE_KEY_ENVIRONMENT=sandbox pnpm test:sandbox            # bağlayıcı zinciri (hesap kartı)
NUITEE_API_KEY=... NUITEE_KEY_ENVIRONMENT=sandbox TEST_DATABASE_URL=... pnpm web:e2e:sandbox   # Nuitee ödeme bileşeni + site + uçak (ödeme bileşeni → bilet bekleme → iptal)
```
