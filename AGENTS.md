# AGENTS.md — bu repoda çalışan geliştirici ve yapay zekâ için kurallar

Önce oku: `docs/spec/` (şartname, başlangıç promptu, yetenek matrisi), `docs/adr/`, `docs/r0/R0-kanit-raporu.md`.

## Değiştirilemez
- K01–K15 kararları (şartname §1). Kapsamı sessizce değiştirme; alternatif tur sağlayıcısı ekleme (K09).
- Üç katman ayrı: SupplierConnector / OwnedPaymentGateway / SupplierSettlement; Nuitee yönetimli ödeme ayrı ProviderManagedPaymentFlow (ADR-0002).
- Domain (`packages/domain`) sağlayıcı/gateway/DB/HTTP import etmez ve marka adı içermez — `pnpm boundaries` denetler.
- Payload yalnız `cms`, Drizzle yalnız `core` şemasını yönetir (ADR-0003).

## Kanıt disiplini
- Endpoint, alan adı, enum veya hesap yetkisi uydurma. Kaynak `contracts/sources.lock.json`'da PINNED değilse o alana dayanan kod production'da açılmaz.
- `capability-matrix.json`'da documentation/account/sandbox/production alanları ayrıdır; kanıtsız `PASSED`/`ENABLED` yazma.
- Marj, ücret, kur kaynağı, risk limiti, taksit ve kimlik politikası işletme girdisidir (G06); varsayılan değer koyma.

## Finansal güvenlik
- Para: `Money` (alt birim bigint). `number` ile para hesaplama yok.
- Timeout/5xx/bozuk yanıt/imza hatası = `UNKNOWN`, asla `FAILED`. UNKNOWN çözülmeden yeni book/prebook/capture/refund yok.
- Dış çağrıdan önce intent + client reference kalıcı yazılır; durum yalnız domain komutlarıyla ve versiyon kontrolüyle değişir.
- Order güncellemesi ve outbox aynı transaction'da. Webhook yalnız sorgu tetikler, durumu doğrudan değiştirmez.
- Mock'lar `MOCK`/test dublörü olarak etiketli; production'da reddedilir.

## Her iş paketinde
Çalışan kod + gerekiyorsa migration + anlamlı test + hata/UNKNOWN yolu + `docs/plan/*` durum güncellemesi. Rapor: değişen davranış, geçen test, mock/sandbox/production ayrımı, dış blokajın tam adı, sonraki iş.
