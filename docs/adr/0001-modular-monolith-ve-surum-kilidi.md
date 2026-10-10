# ADR-0001 — Modular monolith, ayrı worker ve sürüm kilidi

- Durum: Kabul edildi (2026-10-09)
- Kaynak kararlar: şartname §3, başlangıç promptu "Teknoloji ve veri sınırları"

## Karar

TypeScript pnpm monorepo. Tek Next.js uygulaması (`apps/web`: müşteri sitesi, Payload, `/yonetim`, HTTP API) ve ayrı, sürekli çalışan worker (`apps/worker`). Mikroservis ayrımı yapılmaz. Frappe/ERPNext çekirdek değildir.

| Paket | Sorumluluk | Yasak importlar |
|---|---|---|
| `packages/pricing` | Money, Decimal hesap, dağılım, kur snapshot'ı | Sağlayıcı/gateway, DB |
| `packages/contracts` | Ortak tipler, capability matrisi, kaynak kilidi, port arayüzleri | Sağlayıcı SDK'ları |
| `packages/domain` | Durum makineleri, rota seçimi, teklif kuralları, paket orchestrator | iyzico/Nuitee/Welcome HTTP, Drizzle |
| `packages/db` | Drizzle `core` şeması, migration, repository, Outbox/Inbox | Payload |
| `packages/payments` | `OwnedPaymentGateway` adapterleri (iyzico), registry | Domain dışı iş kuralı |
| `packages/connectors` | Ürün bazlı sağlayıcı adapterleri | Gateway adapterleri |
| `packages/config` | Zod ile ortam doğrulaması, fail-fast | — |

Bağımlılık yönü: `pricing ← contracts ← domain ← (db, payments, connectors) ← apps`. Domain yalnız port arayüzlerini bilir. Bu kural `scripts/check-boundaries.mjs` ile CI'da denetlenir.

## Sürüm kilidi (R0 sürüm keşfi)

Kaynak: npm registry `peerDependencies` (payloadcms.com bu ortamdan erişilemedi; npm metadata Payload paketlerinin kendi beyanıdır).

| Bileşen | Kilit | Gerekçe |
|---|---|---|
| Node.js | 22 LTS (`.nvmrc`, `engines`) | `payload@3.90.2` engines: `^18.20.2 \|\| >=20.9.0`; `next@16.3.8` engines `>=20.9.0` |
| pnpm | 10.28.0 (`packageManager`) | Ortamdaki sürüm |
| payload, @payloadcms/* | 3.90.2 (2026-09-23) | En yeni kararlı, >2 hafta yayında |
| next | 16.3.8 (2026-09-30) | `@payloadcms/next@3.90.2` peer: `>=16.3.3 <17.0.0`; 16.4.0 3 günlük yeni minor olduğu için seçilmedi |
| react / react-dom | 19.2.8 | next 16 peer `^19.0.0`; 19.3.0 yeni minor |
| drizzle-orm / drizzle-kit | 0.45.2 / 0.31.7 | `@payloadcms/db-postgres@3.90.2` ile aynı; iki kopya önlenir |
| pg | 8.20.0 | Payload ile aynı |
| bullmq | 5.81.5 | 6.x yeni major; 5.x kararlı hat |
| zod | 4.x | Dış yanıt doğrulaması |
| decimal.js | 10.6.0 | Para hesabı |
| vitest | 4.1.x | Kararlı hat (5.x yeni) |
| typescript | 5.9.3 | Next/Payload ekosisteminde yaygın; 7.x yerel port yeni |

Otomatik major güncelleme açılmaz. Sürüm yükseltme ayrı PR + bu ADR güncellemesi ile yapılır.

## Sonuç

- Payload yalnız `cms` PostgreSQL şemasını yönetir; core Drizzle yalnız `core` şemasını (ADR-0003).
- Worker, Next.js sürecinden bağımsız ölçeklenir; Redis kaybında DB Outbox'tan toparlar (ADR-0004).
