# ADR-0002 — Üç bağlantı katmanı ve ödeme rotası

- Durum: Kabul edildi (2026-10-09)
- Kaynak kararlar: K11–K15, şartname §4–§5

## Karar

1. `SupplierConnector` (ürün bazlı: `HotelConnector`, `FlightConnector`, `ExperienceConnector`, `TransferConnector`): fiyat, müsaitlik, teklif, prebook/hold, book, sorgu, iptal. Her operasyon `READ_ONLY` veya `CREATES_PROVIDER_RESERVATION` olarak sözleşmede işaretlenir.
2. `OwnedPaymentGateway`: TexHoliday adına müşteri tahsilatı. Operasyonlar `capabilities`, `createSession`, `retrieve`, `capture`, `void`, `refund`, `verifyNotification`. İlk adapter iyzico. Desteklenmeyen operasyon `CAPABILITY_NOT_AVAILABLE` döndürür.
3. `SupplierSettlement`: tedarikçi maliyetinin `ACCOUNT_CARD` / `CREDIT_LINE` ile karşılanması; müşteri tahsilatından ayrı kayıt.
4. `ProviderManagedPaymentFlow`: Nuitee'nin müşteri ödemesini yönettiği ürün-özel akış. Capture/refund yeteneği **yoktur**; tip sistemi bu operasyonları sunmaz.

## Rota seçimi

`packages/domain/src/routing` saf fonksiyondur; girdi: sepet kalemleri, istenen tahsilat para birimi, capability snapshot'ı, gateway registry snapshot'ı, onaylı fiyat politikası sürümü. Çıktı: `PaymentRoute[]` (seçilebilir alternatifler, varsayılan işaretli) veya `CAPABILITY_NOT_AVAILABLE` + neden kodları.

Kurallar sırası (matristeki `routing_rules_in_order`):

1. >1 sağlayıcı rezervasyonu / paket → `OWN_GATEWAY`; her kalemde `OWN_GATEWAY_*` funding yeteneği + gateway'de AUTHORIZE, CAPTURE, RETRIEVE, VOID, REFUND, VERIFIED_NOTIFICATION.
2. Tekil Welcome → `OWN_GATEWAY` + Welcome kredi hesabı.
3. Tekil Nuitee + TRY → `OWN_GATEWAY` + ürün-özel bağımsız funding.
4. Tekil Nuitee + desteklenen döviz → varsayılan `PROVIDER_MANAGED`; `OWN_GATEWAY` yalnız tüm yetenekler doğrulanmışsa alternatif.
5. Hiçbiri → `CAPABILITY_NOT_AVAILABLE`, ödeme başlamaz.

"Doğrulanmış" = `accountStatus=ENABLED` ve ortama göre `sandboxStatus=PASSED` (staging) veya `productionStatus=PASSED` + `enabledForProduction=true` (production). `documentationStatus=DOCUMENTED` tek başına rota açmaz.

İş kuralında gateway marka adı geçmez: rota `gatewayId`'yi registry'den, yeteneklere göre seçer. `if (gateway === 'iyzico')` yasaktır.

## Yasak geçici çözümler (koda gömülü)

- iyzico `paymentId`'yi Nuitee `TRANSACTION_ID` olarak göndermek → tip seviyesinde engel: `ProviderManagedTransactionRef` yalnız Nuitee prebook yanıtından üretilir.
- Otel `CREDIT` enum'unu Experiences isteğine kopyalamak → Experiences connector funding tipi ayrı union.
- Paket içinde ikinci müşteri tahsilatı → `CheckoutSession` başına tek `PaymentAttempt` aktif kuralı + DB partial unique index.
- Sessiz para birimi/gateway değişimi → rota snapshot'ı checkout'ta dondurulur; değişiklik yeni QuoteVersion + kabul ister.
