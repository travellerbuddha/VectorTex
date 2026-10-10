# G01–G09 canlı kapıları — durum (2026-10-09)

Makine tarafından okunan kaynak: `contracts/capability-matrix.json` → `launchGates`. Bir kapı kanıt olmadan `PASSED` yapılamaz (`parseCapabilityMatrix` reddeder). İlk canlı sürüm yalnız bütün kapılar geçtiğinde açılır (K04).

| Kapı | Durum | Bugünkü engel (tam girdi) |
|---|---|---|
| G01 Otel | NOT_PASSED | Nuitee production erişimi; hesap kartı (ACC_CREDIT_CARD) üretimde tanımlı mı; sözleşmeli CREDIT var mı; iki ödeme rotasının sandbox/pilot kanıtı; iptal takibi. Kilitlenmemiş: api-search/booking/hotel-data.json, user-payment, account-credit-card, credit-line rehberleri |
| G02 Uçak | NOT_PASSED | Uçak ürünü production erişimi; prebook bypass/kredi koşulu ile booking enum'larının hesabımızda birlikte çalıştığına dair yazılı/sandbox kanıt; biletleme ve servis modeli (B2B Relayed) sözleşmesi |
| G03 Experiences | NOT_PASSED | Sabitlenmiş Experiences OpenAPI'si (9 Ekim) yalnız `usePaymentSdk:true` + `TRANSACTION_ID` kabul ediyor; bağımsız funding **belgelenmemiş**. Nuitee'nin yeni ödeme yolunu belgelemesi + hesabımızda açması + pilot gerekli. K09 gereği alternatif sağlayıcı yok; TRY/kendi gateway ve Experiences içeren paket rotaları kodda kapalı (T23) |
| G04 Welcome | NOT_PASSED | Kredi hesabı onayı, staging doğrulaması, production audit + anahtar, webhook kimlik doğrulaması |
| G05 Kendi gateway | NOT_PASSED | iyzico sandbox anahtarları; merchant'ta ön provizyon ve TRY/EUR/USD/GBP tahsilat/settlement (GBP capture dokümanda belirsiz); V3 webhook aktivasyonu (entegrasyon@iyzico.com); `phase` değerleri ve kullanılmayan ön provizyonun serbest bırakılması sandbox'ta doğrulanmalı; yabancı müşteri kimlik politikası |
| G06 Finans/hukuk | NOT_PASSED | Onaylı fiyat politikası (marj/ücret/yuvarlama), kur kaynağı, risk politikası (provizyon güvenlik payı, maruziyet limitleri, funding tercihi), çalışma sermayesi, sözleşmeler, KVKK aktarım, fatura modeli, taksit politikası. Verilen kararlar (9 Ekim 2026): otel marjı Nuitee API'si ile (ADR-0006); komisyon alacağı limiti yok; politika onayı atanabilir izinlerle (ADR-0007); kapalı grup satışı yok, Nuitee tahsilatlı satışta SSP altı teklifler gösterilecek, risk kabul edildi (ADR-0009; politikada `allowBelowSspProviderManaged: true` onaylanmalı) |
| G07 Geçiş | NOT_PASSED | Mevcut site URL/içerik envanteri ve kullanım hakları, legacy rezervasyon erişimi, doğrulanmış müşteri verisi |
| G08 Kalite/operasyon | NOT_PASSED | T01–T36 (bkz. `test-matrisi.md`), kritik açık yok, destek sorumluları, restore kanıtı |
| G09 Yayın | NOT_PASSED | İşletme kabulü, kontrollü pilot, rollback, dört ürünün hazır olması |
