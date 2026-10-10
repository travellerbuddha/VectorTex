# ADR-0005 — Kanıt disiplini, sözleşme kilidi ve mock politikası

- Durum: Kabul edildi (2026-10-09)

## Karar

- Her dış yetenek için dört bağımsız alan: `documentationStatus`, `accountStatus`, `sandboxStatus`, `productionStatus` + `evidence[]`. Kaynak: `contracts/capability-matrix.json` (Zod ile doğrulanır, `packages/contracts`).
- Sağlayıcı sözleşmeleri `contracts/sources.lock.json` içinde tarih + SHA-256 ile kilitlenir (`scripts/pin-contracts.mjs`). Bir connector'ın `requiredSources` listesindeki kaynak `PINNED` değilse connector **production'da etkinleşemez** (config doğrulaması başlangıçta durur).
- Mock adapterler `MOCK_` önekli kimlik taşır, `environment: 'mock'` döndürür ve `APP_ENV=production` iken registry'ye kaydedilemez (başlangıçta hata).
- Sözleşmesi kilitlenmemiş (UNPINNED) bir alan için kod "en iyi tahmin" ile istek göndermez. Kod, kilitli olmayan kaynağa dayanan operasyonda `ContractNotPinnedError` fırlatır ve rota/registry seviyesinde kapalı kalır.
- İkincil kanıt (resmî SDK paketi, integrity hash'li) yalnız birincil kaynağı destekler; birincil kaynak yerine geçmez.

## Sonuç

Build/test başarısı gerçek rezervasyon/ödeme kanıtı değildir; yalnız `productionStatus=PASSED` + onaylı pilot kanıtı G kapılarını geçirir.
