# ADR-0021 — Müşterinin otel rezervasyonunu çevrimiçi iptal etmesi

- Durum: Kabul edildi (2026-10-10).
- İlgili:
  - şartname §16 ve iptal/iade tablosu ("Kısmi müşteri iptali: güncel iptal teklifini onaylat");
  - T27;
  - ADR-0008 (Nuitee tahsilatlı ödeme, sipariş erişim belirteci);
  - ADR-0017 (Rezervasyonlarım);
  - ADR-0019 (komisyon iptalde düşer).

## Bağlam

Müşteri iptal için yalnız bizi arayabiliyordu; personel de panelden iptal ediyordu. Şartname müşteri iptalini de kapsar: güncel iptal maliyeti gösterilir ve müşteri onaylar. İptalin parasal sonucu, müşterinin rezervasyonda kabul ettiği iptal koşuluna bağlıdır. Yanlışlıkla iptal ve "ücretsiz sandım" itirazı en büyük risklerdir.

## Karar

**Kimler, ne zaman:**
- İptali, siparişe erişimi olan kişi yapar. Erişim iki yoldan olur:
  - rezervasyonu yapan tarayıcıdaki sipariş çerezi;
  - aynı e-posta adresiyle "Rezervasyonlarım"a giriş.
- Yalnız otel rezervasyonu iptal edilebilir. Uçakta değişiklik ve iptal Nuitee'nin hizmet ekibinden geçer (ADR-0012).
- Rezervasyon onaylı olmalıdır ve Nuitee'de devam eden bir işlem bulunmamalıdır.
- Giriş gününden önce yapılmalıdır. Giriş günü dünyanın neresinde olursa olsun ilk andan itibaren (UTC+14) çevrimiçi iptal kapanır.
- İptal edilince bir şey iade edilmeli. İade edilmez tarifede ya da ücret ödenen tutarın tamamına ulaştıysa çevrimiçi iptal sunulmaz; müşteri bizimle iletişime geçer.

**Ücret ve onay:**
- Ekranda o anki beklenen iptal ücreti gösterilir. Kaynak, rezervasyondaki iptal koşuludur; personel ekranıyla aynı hesaptır.
- Ücretsizse ücretsiz iptalin son anı gösterilir.
- Müşteri onay kutusunu işaretlemeden düğme çalışmaz. Ücret varsa onay metninde tutar yazar.
- İstek, müşterinin kabul ettiği ücreti taşır. Sunucu bu ücreti o anki beklenen ücretle karşılaştırır. Farklıysa iptal gönderilmez ve müşteriye yeni ücret gösterilir. Örnek: sayfa açıkken ücretsiz iptal süresi bitti.

**İptal komutu personelinkiyle aynıdır:**
- Nuitee çağrısından önce niyet kaydedilir.
- Kayıp yanıt rezervasyon okunarak çözülür, iptal yeniden gönderilmez. Müşteri bu sırada "iptal işleniyor" görür; sayfa bir süre durumu yeniden okur.
- Denetim kaydında aktör `customer:site` olur; kayıtta `requestedByCustomer` ve kabul edilen ücret de bulunur. Panel zaman çizelgesi bunu "Müşteri (site)" olarak gösterir.
- Sonraki adımlar personel iptaliyle aynıdır: iptal e-postası, komisyonun düşmesi (ADR-0019), iade kaydı.

**Red:** Nuitee iptali reddederse rezervasyon geçerli kalır. Müşteriye ekibin kendisiyle iletişime geçeceği söylenir. Panelde **"Müşterinin iptali reddedildi"** görevi açılır (`CUSTOMER_CANCEL_REJECTED`).

**Güvenlik:**
- Durum değiştiren istek aynı köken denetiminden geçer (CSRF).
- Erişim belirteci olmayan kişi siparişi göremez (404).

**İade metni:** Müşteriye "ödediğiniz tutardan varsa iptal ücreti düşülür, kalanı iade edilir; iade işlendiğinde e-posta göndeririz" denir. İadenin karta otomatik ve ne zaman döndüğü Nuitee'den teyit bekliyor (soru 10a). Bu yüzden iadenin yolu ve süresi vaat edilmez.

## Sonuçlar

- Çağrı merkezi yükü azalır: ücretsiz iptal döneminde müşteri kendi iptal eder.
- İade edilmez rezervasyonlar ve giriş günü gelmiş olanlar telefona kalır. İşletme bu kararla iade edilmeyen iptalde müşteriyle konuşma fırsatını korur.
- Kod:
  - `packages/booking/src/cancellation.ts`: personel ve müşteri için ortak ücret hesabı;
  - `BookingApp.customerCancellation` / `customerCancel`;
  - `GET`/`POST /api/v1/orders/{id}/cancellation`;
  - `CancelBooking.tsx`.
- Testler:
  - `packages/booking/test/customer-cancel.int.test.ts`: sahiplik; ücretsiz iptal; politikadaki ücretin onayı; sayfa açıkken değişen ücret; iade yok; giriş günü; red görevi; kayıp yanıtın yeniden gönderilmeden okunması;
  - `apps/web/e2e/customer-cancel.spec.ts`: masaüstü ve 320 px; panel zaman çizelgesi; başka tarayıcıya 404; siteler arası istek reddi.
