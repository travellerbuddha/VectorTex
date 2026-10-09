# TexHoliday

Kendi müşteri sitesi, booking engine, Payload içerik yönetimi, operasyon paneli, fiyatlandırma, finansal kayıtlar, sağlayıcı connector'ları, seçilebilir ödeme altyapısı ve tek müşteri tahsilatlı dinamik paketleme.

- Şartname: [`docs/spec/TEXHOLIDAY_GUNCEL_UYGULAMA_PLANI.md`](docs/spec/TEXHOLIDAY_GUNCEL_UYGULAMA_PLANI.md) (v2.0, 9 Ekim 2026)
- R0 kanıt raporu: [`docs/r0/R0-kanit-raporu.md`](docs/r0/R0-kanit-raporu.md)
- Durum: [`docs/plan/is-paketleri.md`](docs/plan/is-paketleri.md) · [`docs/plan/canli-kapilari.md`](docs/plan/canli-kapilari.md) · [`docs/plan/test-matrisi.md`](docs/plan/test-matrisi.md)
- Mimari kararlar: [`docs/adr/`](docs/adr/)

> İlk canlı sürüm G01–G09 geçmeden açılmaz. Bu repodaki testler mock ve yerel PostgreSQL/Redis üzerindedir; sağlayıcı sandbox/production kanıtı değildir.

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

`apps/web` (Next.js 16.3.8 + Payload 3.90.2, `cms` şeması) bir sonraki aşamadır (P05/P06/P16).

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
pnpm --filter @texholiday/db permissions:bootstrap <personelId>   # ilk izin yöneticisi (yalnız bir kez, ADR-0007)
```
