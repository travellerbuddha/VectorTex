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
  - Nuitee "payment not completed" (2014) döndürürse sonraki deneme **yeni** bir `clientReference` ile yapılır. Sandbox (9 Ekim 2026) gösterdi ki 2014 yanıtı o referansı tüketiyor: ödeme sonrası aynı referans 4005 dönüyor ve sorguda rezervasyon çıkmıyor. İlk tasarımdaki "aynı referansla tekrar" bu yüzden düzeltildi.
  - Çift rezervasyona karşı güvence: işlem tek kullanımlık (kullanılmış işlemle yeni referans yine 2014 dönüyor, sandbox kanıtı). Yanıtı belirsiz (UNKNOWN) bir denemeden sonra yeni book yapılmaz; önce o referans sorgulanır.
- **Tarayıcı kapanırsa:** İşçi, son ödeme zamanına kadar artan aralıklarla (20 s → 5 dk) tamamlamayı dener. Süre dolunca, gönderilmiş **bütün** referanslar sorgulanır (yanıtı kaybolmuş bir rezervasyon da bulunur). Rezervasyon yoksa sipariş kapanır; sorgu sonuçsuzsa kapanmaz, sorgu sürer.
- **Kesin red:** Sipariş iptal edilir ve bir operasyon görevi açılır (`PROVIDER_PAYMENT_HOLD`). Müşteriye, kartındaki provizyonun Nuitee tarafından 1–2 iş günü içinde kaldırılacağı söylenir.
- **Fiyat değişirse:** Ön rezervasyonda fiyat veya koşul değişmişse ödeme oturumu hiç açılmaz; yeni teklif ve yeni kabul gerekir (K15).
- **Fiyatlandırma:** Nuitee fiyatı + onaylı politika marjı (API marjı).
  - Kamuya açık fiyat SSP'nin altındaysa teklif varsayılan olarak gösterilmez, çünkü Nuitee tahsil ettiği için fiyatı yerelde yükseltemeyiz. İşletme kararıyla onaylı politika bu teklifleri gösterebilir (ADR-0009, `allowBelowSspProviderManaged`). Her iki durumda da SSP karşılaştırması teklifte kaydedilir.
  - Sandbox'ta SSP yapay ve her marjda fiyatın üstünde. Sitenin sandbox'ta denenebilmesi için `SANDBOX_SKIP_RATE_PARITY=true` var; yalnız `PROVIDER_ENV=sandbox` iken kabul edilir.
  - Nuitee ödemesi (`NUITEE_PAY`) olmayan teklifler gösterilmez.

## Kanıt durumu

| Kanıt | Durum |
|---|---|
| MOCK ortamda uçtan uca tarayıcı testi (masaüstü ve 320 px) | ✅ |
| PostgreSQL senaryoları | ✅ |
| Nuitee sandbox'ta ödeme SDK'lı prebook | ✅ (`vKh3SHrTO`) |
| Nuitee sandbox'ta SDK ile ödeme (test kartı) + `TRANSACTION_ID` rezervasyonu + sorgu + iptal: EUR, USD, GBP | ✅ (R0 §10.2) |
| Kendi sitemiz sandbox'ta, masaüstü ve 320 px: arama → ödeme → onay; CSP ihlali yok | ✅ (R0 §10.2) |
| Production | ⛔ Yapılmadı (canlı anahtar ve işletme onayı gerekir) |

Matris: `nuitee.hotel.provider_managed` sandbox PASSED, EUR/USD/GBP VERIFIED. Production NOT_RUN ve `enabledForProduction: false`. Canlıya açılış G01 kapısına bağlı.

Sandbox testleri isteğe bağlıdır ve CI'da çalışmaz: `pnpm web:e2e:sandbox` (sandbox anahtarı + `NUITEE_KEY_ENVIRONMENT=sandbox` + test veritabanı). Her test kendi rezervasyonunu iptal eder.
