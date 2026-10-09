# ADR-0008 — Geliştirme sırası: önce Nuitee tahsilatlı akış, iyzico sonra

- Durum: Kabul edildi (2026-10-09). İşletme kararı: "En iyisi ödemenin Nuitee tarafından tahsil edildiği senaryodan devam edelim, komple. iyzico'yu sonra entegre ederiz."
- İlgili: şartname §5.1 (Nuitee tarafından yönetilen ödeme), §5.4 (rota kuralları), K03/K04/K13/K14, ADR-0002.

## Karar

1. Müşteri tarafı uçtan uca önce **Nuitee'nin tahsil ettiği ödeme** (`PROVIDER_MANAGED`) ile kurulur: arama → teklif → misafir bilgileri → Nuitee ödeme bileşeni → rezervasyon → durum. Kendi ödeme altyapımız (iyzico) sonraki iştir; mevcut adapter kodu korunur.
2. K kararları değişmez. Bu yüzden kendi ödeme altyapımızı gerektiren rotalar, iyzico gelene kadar **kapalı** kalır ve sitede sunulmaz:
   - TRY ile tahsilat (K13),
   - paketler ve birden fazla ürünlü sepet (K14),
   - tekil Welcome transfer.
   Yani şimdilik EUR, USD ve GBP ile tekil otel satışı açılabilir. Tur/aktivite ve uçak da Nuitee ödemesiyle eklenecek.
3. İlk canlı sürümün kapsamı (K03/K04) değişmez. Kısmi canlı açılış ayrı bir işletme kararı gerektirir.

## Akış (kodda)

- **Ön rezervasyon:** Prebook, `usePaymentSdk: true` ile yapılır. Dönen `transactionId` ve `secretKey` sunucuda saklanır.
  - `secretKey` yalnız siparişin sahibine verilir; erişim httpOnly çerezdeki HMAC belirteciyle sağlanır.
  - `secretKey` denetim kaydına yazılmaz ve ödeme sonuçlanınca silinir.
- **Dönüş:** Tarayıcının dönüşü yalnız tetikleyicidir; URL'deki kimlikler kullanılmaz.
  - Sunucu, kayıtlı prebook ve transaction ile `TRANSACTION_ID` rezervasyonu dener.
  - Nuitee "payment not completed" (2014) döndürürse aynı `clientReference` ile tekrar denenir. Arada bir rezervasyon oluştuysa Nuitee bunu yinelenen istek (4005) olarak bildirir, böylece iki kez rezervasyon yapılmaz.
- **Tarayıcı kapanırsa:** İşçi, son ödeme zamanına kadar artan aralıklarla (20 s → 5 dk) tamamlamayı dener. Süre dolunca, daha önce rezervasyon denendiyse önce sorgu yapılır, sonra sipariş kapanır.
- **Kesin red:** Sipariş iptal edilir ve bir operasyon görevi açılır (`PROVIDER_PAYMENT_HOLD`). Müşteriye, kartındaki provizyonun Nuitee tarafından 1–2 iş günü içinde kaldırılacağı söylenir.
- **Fiyat değişirse:** Ön rezervasyonda fiyat veya koşul değişmişse ödeme oturumu hiç açılmaz; yeni teklif ve yeni kabul gerekir (K15).
- **Fiyatlandırma:** Nuitee fiyatı + onaylı politika marjı (API marjı).
  - Kamuya açık fiyat SSP'nin altındaysa teklif gösterilmez, çünkü Nuitee tahsil ettiği için fiyatı yerelde yükseltemeyiz.
  - Nuitee ödemesi (`NUITEE_PAY`) olmayan teklifler gösterilmez.

## Kanıt durumu

| Kanıt | Durum |
|---|---|
| MOCK ortamda uçtan uca tarayıcı testi (masaüstü ve 320 px) | ✅ |
| PostgreSQL senaryoları | ✅ |
| Nuitee sandbox'ta ödeme SDK'lı prebook | ✅ (`vKh3SHrTO`) |
| Nuitee sandbox'ta SDK ile ödeme + `TRANSACTION_ID` rezervasyonu | ⛔ Yapılmadı |

Son satırın engeli: Ödeme bileşeni `payment-wrapper.liteapi.travel` adresinden yükleniyor ve Stripe adreslerini kullanıyor. Bu adresler bu geliştirme ortamının ağ izninde kapalı.

Bu yüzden `nuitee.hotel.provider_managed` için `sandboxStatus` NOT_RUN ve para birimleri UNVERIFIED kalır. Sonuç olarak staging'de (sandbox) rota da kapalı kalır. Ağ izni verildiğinde Playwright ile sandbox test kartı (4242…) üzerinden kanıt alınacak, ardından matris güncellenecek.
