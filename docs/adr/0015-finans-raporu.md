# ADR-0015 — Finans raporu tanımları (/yonetim)

- Durum: Kabul edildi (2026-10-10).
- İlgili: ADR-0006 (sağlayıcı API marjı ve komisyon alacağı), ADR-0007 (izinler), ADR-0008 (Nuitee tahsilatlı ödeme), P15, §16.

## Bağlam

Finans ekibi, panelden dönem bazında satış, komisyon, iptal ve iade toplamlarını görmek ve satır bazında dosya almak istiyor. Bugünkü satış modeli Nuitee tahsilatlıdır (ADR-0008):

- Müşteri tutarı Nuitee'ye ödenir.
- Bizim gelirimiz, Nuitee'nin konaklamadan sonra ödediği komisyondur (ADR-0006).
- Komisyon alacağı `EXPECTED` olarak doğar ve iptalde `VOIDED` olur. `EARNED` (konaklama sonrası) ve `RECEIVED` (finansın kaydettiği payout) geçişleri ADR-0019 ile eklendi.

Rapor bu yüzden muhasebe defteri değildir. Kayıtlı durumun dönem toplamıdır.

## Karar

**Yer ve yetki.**
- Rapor `/yonetim/raporlar/finans` adresindedir. Satır bazında CSV `/api/v1/staff/finance-report` adresindedir.
- İkisi de yalnız `orders.view_financials` iznine açıktır. İzin sorgu katmanında (`FinanceReports`) denetlenir, yalnız ekranda değil.
- Yalnız okur; hiçbir durumu değiştirmez.

**Dönem.**
- Başlangıç ve bitiş günü dahildir. Günler İstanbul saatine göre alınır.
- Dönem en çok 366 gündür. Geçersiz tarih tahmin edilmez; ekran hatayı gösterir.
- Kısayollar: bu ay, geçen ay, son 30 gün.

**Toplamlar.** Hepsi para birimi başına, kuruş (bigint) cinsinden veritabanında toplanır. Kur çevrimi yapılmaz; farklı para birimleri tek satırda toplanmaz.

| Bölüm | Tanım |
|---|---|
| Siparişler | Dönemde oluşturulan siparişler: duruma göre adet ve müşteri tutarı. |
| Geçerli rezervasyonlar | Bu siparişlerin bugün `CONFIRMED`/`ISSUED` kalemleri, ürün başına: müşteri tutarı ve sağlayıcı fiyatı. Nuitee tahsilatlı satışta sağlayıcı fiyatı bizim komisyonumuzu içerir; ikisinin farkı marj değildir ve ekranda marj hesaplanmaz. |
| Komisyonlar | Bu siparişlerin komisyon alacakları, durum başına. |
| Açık komisyon alacağı | Dönemden bağımsız, bugün `EXPECTED` ve `EARNED` olanlar. |
| İptal edilen kalemler | Bu siparişlerin bugün `CANCELLED` kalemleri. |
| Kaydedilen iadeler | Dönem içinde kaydedilen başarılı iadeler. İade siparişin gününe değil, **kaydedildiği güne** sayılır. |
| Ödeme denemeleri | Dönemde oluşturulan ödeme denemeleri, durum başına. Terk edilen ödemeler de görünür. |

**CSV.**
- Siparişin her kalemi bir satırdır.
- Tutarlar para biriminin kendi ondalık hanesiyle kesin ondalık yazılır (EUR 297.00, JPY 29700). Para birimi her tutarın yanındadır.
- İade sipariş başınadır ve yalnız siparişin ilk satırına yazılır; sütun toplamı doğru kalır.
- Kişisel veri yoktur: ad, e-posta ve telefon yazılmaz. Sipariş ve rezervasyon numaraları, durumlar ve tutarlar vardır.
- Hücreler RFC 4180'e göre tırnaklanır. Formül işaretiyle başlayan metin kaçırılır; sayılar sayı kalır.

## Sonuçlar

- Komisyon tahsilatı (EARNED/RECEIVED, payout referansı) ADR-0019 ile geldi; raporda dönemde gelen ödemeler de görünür. Nuitee ödeme bildiriminin otomatik eşleştirilmesi biçimi netleşince eklenecektir.
- Kendi ödememiz (iyzico) açıldığında rapor aynı tablolardan okur. Ek gerekecek bölüm: müşteri tahsilatı ile tedarikçi ödemesinin ayrımı (`supplier_settlements`).
