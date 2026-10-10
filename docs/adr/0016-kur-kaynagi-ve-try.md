# ADR-0016 — Kur kaynağı ve TRY satışı

- Durum: Kabul edildi (2026-10-10).
- İlgili: K13 (TRY tahsilatı kendi gateway'imizle), ADR-0006 (API marjı), ADR-0008 (Nuitee tahsilatlı ödeme), G05, G06, R0 §10.2.

## Bağlam

İşletme iki şey sordu: Nuitee TL fiyat veriyor mu? Vermiyorsa Bloomberg kurları kullanılsın.

10 Ekim 2026 sandbox kanıtı (R0 §10.2):

- Nuitee fiyat aramasını istenen para biriminde (TRY dahil) döndürür.
- Ödeme bileşeni TRY tahsil eder. Rezervasyon, maliyet ve komisyon aynı para birimindedir.
- Bizim tarafta kur çevrimi yoktur.

## Karar

1. **Satış için kur kaynağı gerekmez.** Müşteri, Nuitee'nin o para biriminde verdiği fiyatı öder. Gösterilen ve tahsil edilen tutar aynıdır. Kurdan doğan fark riski bizde oluşmaz.
2. **TRY satışı K13'e bağlı kalır.** TRY tahsilatı kendi gateway'imizle (iyzico) yapılır; rota kuralı 3 bunu kodda uygular. Nuitee'nin TRY tahsil edebildiği artık kanıtlı, ama bu tek başına TRY satışını açmaz. iyzico gelince yeniden değerlendirilir.
   - iyzico ile tahsil edip Nuitee'ye hesap kartıyla ödeyeceğiz. Nuitee'nin TRY fiyatı korunursa yine kur gerekmez. Hesap kartıyla TRY ödemesi henüz doğrulanmadı (G01/G05).
3. **Bloomberg verisi lisanslıdır.** Bloomberg'in herkese açık ücretsiz bir kur API'si yoktur. Veri, Bloomberg Data License, B-PIPE veya Terminal sözleşmesiyle kullanılır; siteden kazımak sözleşmeye aykırıdır. İşletmenin böyle bir lisansı olursa kur kaynağı bağdaştırıcısı eklenir.
4. **Kur gerektiği gün öncelikli kaynak TCMB'dir.** Örnek kullanımlar: farklı para birimlerinin tek para biriminde raporlanması, ya da Nuitee'nin bizi başka para biriminde borçlandırması. TCMB resmî ve ücretsizdir; muhasebe kayıtlarında da kullanılır. Kaynak, alış/satış tarafı ve güvenlik payı fiyat politikasında (G06) onaylı değer olarak tutulur; varsayılan konmaz.
5. **Taksit:** Nuitee ödeme bileşeninde taksit yoktur. Taksit, TRY tahsilatıyla birlikte iyzico'da gelir. Taksit politikası (hangi kartlar, kaç taksit, vade farkını kim üstlenir) işletme kararıdır (G06).

## Sonuçlar

- Kur entegrasyonu şimdilik yazılmaz. Fiyat politikasının `fx` alanı boş kalır; politika kur gerektiren bir rotayı zaten açmaz.
- Finans raporu tutarları para birimi başına toplar ve çevirmez (ADR-0015).
