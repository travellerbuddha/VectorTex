# ADR-0017 — Müşteri hesabı: e-posta koduyla giriş ve "Rezervasyonlarım"

- Durum: Kabul edildi (2026-10-10).
- İlgili: §15 (üyelik zorunlu değil, misafir rezervasyonu), ADR-0008 (sipariş erişim belirteci), ADR-0010 (personel girişi), KVKK.

## Bağlam

Müşteri rezervasyonunu yalnız rezervasyonu yaptığı tarayıcıdaki çerezle ya da onay e-postasındaki bağlantıyla görebiliyordu. Başka cihazdan ya da e-postayı bulamadığında rezervasyonuna ulaşamıyordu. Şifreli üyelik hem müşteriye yük, hem bizim için saklanacak bir sır demektir.

## Karar

**Akış:**
1. Müşteri `/tr/hesabim` ya da `/en/account` sayfasına rezervasyonda kullandığı e-posta adresini yazar.
2. Adrese 6 haneli, tek kullanımlık bir kod gider.
3. Kod girilince aynı e-posta adresiyle yapılmış tüm siparişler listelenir.
4. Her sipariş, ödeme sonrası kullanılan sipariş sayfasıyla açılır. Erişim belirteci, oturum sahibinin siparişi için sunucuda üretilir.

**Kod:**
- 10 dakika geçerlidir ve bir kez kullanılır.
- 5 yanlış denemeden sonra geçersiz olur.
- Bir adrese 15 dakikada en çok 3 kod gider. İstemci başına da sınır vardır.
- Veritabanında yalnız HMAC'i durur.
- Kod ekranda asla gösterilmez. E-posta gönderimi yoksa giriş kapalıdır.

**Adres keşfi yok:**
- Kod yalnız rezervasyonu olan adrese gönderilir.
- Ekrandaki yanıt her durumda aynıdır: "Bu adrese ait bir rezervasyon varsa kodu gönderdik".
- Rastgele adreslere e-posta gönderilmez; site spam aracı olamaz.

**Oturum:**
- Rastgele 32 bayt bir değerdir; httpOnly, SameSite=Lax çerezde tutulur, production'da Secure'dur.
- Ömrü 30 gündür. Veritabanında SHA-256'sı durur.
- Çıkışta silinir. Worker süresi dolanları saatte bir temizler.

**Gizlilik:**
- Hesap sayfaları `noindex` ve robots dışıdır.
- Liste yalnız otel adı, tarihler, tutar, durum ve rezervasyon numarasını gösterir.
- Misafir adları ve telefon listelenmez; sipariş sayfası zaten müşteriye aittir.

**Ortam:** Kod ve oturum sağlayıcı ortamına bağlıdır. Sandbox oturumu production siparişlerini göremez.

## Sonuçlar

- Üyelik hâlâ zorunlu değildir; misafir rezervasyonu aynen çalışır.
- Yerel demoda kod e-postaları Mailpit'te görünür (`http://localhost:8025`).
- Canlıda SMTP hesabı gerekir. SMTP yoksa sayfa, girişin kullanılamadığını ve onay e-postasındaki bağlantının kullanılmasını söyler.
