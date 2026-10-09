# ADR-0003 — `cms` ve `core` şema ayrımı

- Durum: Kabul edildi (2026-10-09)

## Karar

- Tek PostgreSQL veritabanı, iki şema: `cms` (Payload `@payloadcms/db-postgres`, `schemaName: 'cms'`) ve `core` (Drizzle, `packages/db`).
- Payload migration'ları yalnız `cms`'e, `packages/db/migrations` yalnız `core`'a dokunur. Drizzle config `schemaFilter: ['core']`.
- Üretimde iki ayrı DB rolü önerilir: `cms_app` (`cms` üzerinde yazma, `core` üzerinde hiçbir yetki) ve `core_app` (`core` yazma). Payload'ın `core`'a erişimi yoktur; `/yonetim` operasyon ekranları core'u Payload koleksiyonu olarak değil, core API üzerinden okur.
- Finansal gerçek (Order, PaymentAttempt, LedgerEntry, QuoteVersion fiyat snapshot'ı) yalnız `core`'dadır. İçerik editörü fiyat/durum değiştiremez.

## Sonuç

- `cms` ↔ `core` arasında foreign key yoktur; ilişki opaque kimlikle (ör. destinasyon slug) kurulur.
- Rezervasyon durumu Payload admin'inde CRUD alanı olarak görünmez.
