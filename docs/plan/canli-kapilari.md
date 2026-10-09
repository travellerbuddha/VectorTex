# G01–G09 canlı kapıları — durum (2026-10-09)

Makine tarafından okunan kaynak: `contracts/capability-matrix.json` → `launchGates`. Bir kapı kanıt olmadan `PASSED` yapılamaz (`parseCapabilityMatrix` reddeder). İlk canlı sürüm yalnız bütün kapılar geçtiğinde açılır (K04).

| Kapı | Durum | Bugünkü engel (tam girdi) |
|---|---|---|
| G01 Otel | NOT_PASSED | Nuitee production erişimi; hesap kartı (ACC_CREDIT_CARD) üretimde tanımlı mı; sözleşmeli CREDIT var mı; iki ödeme rotasının sandbox/pilot kanıtı; iptal takibi. Kilitlenmemiş: api-search/booking/hotel-data.json, user-payment, account-credit-card, credit-line rehberleri |
| G02 Uçak | NOT_PASSED | Uçak ürünü production erişimi; prebook bypass/kredi koşulu ile booking enum'larının hesabımızda birlikte çalıştığına dair yazılı/sandbox kanıt; biletleme ve servis modeli (B2B Relayed) sözleşmesi |
| G03 Experiences | NOT_PASSED | Nuitee'nin bağımsız tedarikçi ödeme yolunu **belgelemesi** + hesabımızda açması + pilot. Bugün `documentationStatus=NOT_DOCUMENTED`. K09 gereği alternatif sağlayıcı yok; TRY/kendi gateway ve Experiences içeren paket rotaları kodda kapalı (T23) |
| G04 Welcome | NOT_PASSED | Kredi hesabı onayı, staging doğrulaması, production audit + anahtar, webhook kimlik doğrulaması |
| G05 Kendi gateway | NOT_PASSED | iyzico merchant: ön provizyon özelliği, TRY/EUR/USD/GBP tahsilat ve settlement, V3 webhook aktivasyonu + alan sırası, fraud alanlarının teyidi, yabancı müşteri kimlik politikası; sandbox anahtarları |
| G06 Finans/hukuk | NOT_PASSED | Onaylı fiyat politikası (marj/ücret/yuvarlama), kur kaynağı, risk politikası (provizyon güvenlik payı, maruziyet limitleri, funding tercihi), çalışma sermayesi, sözleşmeler, KVKK aktarım, fatura modeli, taksit politikası |
| G07 Geçiş | NOT_PASSED | Mevcut site URL/içerik envanteri ve kullanım hakları, legacy rezervasyon erişimi, doğrulanmış müşteri verisi |
| G08 Kalite/operasyon | NOT_PASSED | T01–T36 (bkz. `test-matrisi.md`), kritik açık yok, destek sorumluları, restore kanıtı |
| G09 Yayın | NOT_PASSED | İşletme kabulü, kontrollü pilot, rollback, dört ürünün hazır olması |
