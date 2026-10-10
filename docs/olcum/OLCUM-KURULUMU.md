# Ölçüm kurulumu: GTM, GA4, Google Ads, Meta, Yandex, Search Console

Sitede ölçüm altyapısı hazır:
- izin bandı (Consent Mode v2);
- çerez politikası sayfası;
- GA4 e-ticaret olayları;
- doğrulama etiketleri.

Bu rehber Google ve diğer hesaplarda yapılacak adımları anlatır. GTM tarafı için hazır bir kapsayıcı dosyası var: **`docs/olcum/gtm-texholiday.json`**. Bu dosyayı içe aktarıp kimlikleri girmeniz yeterli.

> Bu adımlar sizin Google/Meta/Yandex hesaplarınızda yapılır. Sistem bu hesaplara erişmez, oralarda hiçbir şeyi kendisi değiştirmez.

## 1. Sitenin gönderdiği veriler

Analiz izni verilmeden hiçbir veri gitmez. Sitenin `dataLayer`'a gönderdiği olaylar:

| Olay | Ne zaman | İçerik |
| --- | --- | --- |
| `consent_state` | Her sayfa açılışında, kayıtlı izin varsa | `consent_analytics`, `consent_marketing` (true/false) |
| `consent_update` | Ziyaretçi bantta seçim yaptığında | Aynı alanlar |
| `search` | Otel arama sonuç sayfası | `search_term` (bölge adı) |
| `view_item_list` | Arama sonuçları ve otel liste sayfaları | Oteller, sıra, fiyat |
| `view_item` | Otel sayfası | Otel, fiyat |
| `begin_checkout` | Rezervasyon formu | Otel, pansiyon, toplam tutar |
| `add_payment_info` | Ödeme sayfası (sipariş başına bir kez) | Aynı |
| `purchase` | Onay sayfası, rezervasyon kesinleşince (sipariş başına bir kez) | `transaction_id` = sipariş no., `value`, `currency`, ürünler |

Ad, e-posta, telefon gibi kişisel veriler hiçbir olayda yoktur. Tutar müşterinin ödediği toplamdır; marjımız sayfaya hiç yazılmaz.

## 2. Google Tag Manager

1. https://tagmanager.google.com adresinde bir hesap ve **Web** kapsayıcısı oluşturun. `GTM-XXXXXXX` kimliğini not edin.
2. **Yönetici → Kapsayıcıyı içe aktar** yolunu izleyin.
   - Dosya: `gtm-texholiday.json`.
   - Çalışma alanı: mevcut.
   - Seçenek: **Birleştir → Çakışanları yeniden adlandır**.
3. **Değişkenler** bölümünde `CONFIG - …` sabitlerini doldurun:

| Değişken | Nereden alınır |
| --- | --- |
| `CONFIG - GA4 Measurement ID` | GA4 → Yönetici → Veri akışları → Web → Ölçüm kimliği (`G-…`) |
| `CONFIG - AW Conversion ID` | Google Ads → Hedefler → Dönüşümler → "Satın alma" dönüşümü → Etiket kurulumu → GTM: **Dönüşüm kimliği** (yalnız rakamlar) |
| `CONFIG - AW Label - purchase` | Aynı ekrandaki **Dönüşüm etiketi** |
| `CONFIG - Meta Pixel ID` | Meta Events Manager → Veri kaynakları → Pixel kimliği |
| `CONFIG - Yandex Counter ID` | Yandex Metrica → Sayaç ayarları → Sayaç numarası |

   Kullanmadığınız bir platformun etiketlerini **duraklatın** (ör. Yandex yoksa "Yandex - Metrica"). İçinde `XXXX` kalan bir değişkeni yayınlamayın.
4. **Önizleme** (Tag Assistant) ile siteyi açıp kontrol edin:
   - **Reddet:** GTM hiç yüklenmez.
   - **Yalnız analiz:** "GA4 - Google tag" ve "Yandex - Metrica" çalışır; Ads ve Meta çalışmaz.
   - **Tümünü kabul et:** hepsi çalışır.
   - Bir MOCK veya sandbox rezervasyonu yapın. Onay sayfasında `purchase` olayının GA4, Ads ve Meta etiketlerini **bir kez** tetiklediğini görün; sayfa yenilenince yeniden tetiklenmez.
5. **Gönder → Yayınla.**

Kapsayıcıdaki etiketler:

| Etiket | Ne zaman çalışır |
| --- | --- |
| GA4 Google tag, GA4 e-ticaret, GA4 `search` | Analiz izniyle |
| Yandex Metrica (oturum kaydı/Webvisor kapalı) | Analiz izniyle |
| Google Ads tag, Dönüşüm bağlayıcı, Satın alma dönüşümü | Pazarlama izniyle |
| Meta Pixel PageView, `InitiateCheckout`, `Purchase` | Pazarlama izniyle |

Hiçbir etiket "Tüm sayfalar" ile çalışmaz; hepsi izin olaylarına bağlıdır.

## 3. TexHoliday paneli

**İçerik → Ölçüm ve çerez ayarları** ekranında şunları girip kaydedin:

- **GTM kapsayıcı kimliği:** `GTM-…`. GTM varsa GA4 kimliği boş bırakılır; GA4 GTM içinden yüklenir.
- **İzin modu:** **Temel** (önerilen ve varsayılan).
  - KVKK çerez rehberi, analiz ve pazarlama çerezleri için açık rıza ister.
  - Temel modda izin verilmeden Google'a hiçbir istek gitmez. Hazır kapsayıcı bu moda göre kuruludur.
- **Doğrulama kodları** (yalnız `content="…"` içindeki değer):
  - Search Console;
  - Yandex Webmaster;
  - Meta alan adı doğrulaması.
- **Gizlilik / KVKK aydınlatma metni adresi:** varsa şirketin metni. Çerez politikası sayfası sitede hazırdır (`/tr/cerez-politikasi`, `/en/cookie-policy`), çerez bandı ve footer ona bağlantı verir.
- **Çerez bandı metni:** boş bırakılırsa hazır metin kullanılır.

## 4. GA4 ayarları (bir kez)

- **Veri akışı → Gelişmiş ölçüm** açık kalsın. "Tarama geçmişi olaylarına göre sayfa değişiklikleri" seçili olmalı; site sayfalar arasında yeniden yüklenmeden geçer.
- **Veri akışı → Etiket ayarları → İstenmeyen yönlendirmeleri listele** bölümüne şunları ekleyin. Ödemeden dönen müşteri kaynağını kaybetmesin:
  - `liteapi.travel`
  - `stripe.com`
- **Para birimi:** raporlama para birimi EUR. Olaylar kendi para birimini (EUR/USD/GBP) taşır; GA4 kendisi çevirir.
- `purchase` olayı GA4'te önemli etkinlik (key event) olarak işaretlidir.
- **Google Ads bağlantısı:** Yönetici → Ürün bağlantıları → Google Ads.
- **Search Console bağlantısı:** aynı yerden.
- **Veri saklama süresi:** 14 ay.

## 5. Google Ads

- Dönüşüm işlemi: **Satın alma**, kaynak "Web sitesi", değer "her dönüşüm için farklı değer", sayım **Bir**.
- Değer ve para birimi kapsayıcıdan gelir. Sipariş numarası `transaction_id` olarak gider; aynı sipariş iki kez sayılmaz.
- **Gelişmiş dönüşümler** (e-posta karmaları) kurulmadı. Kişisel veri işlediği için ayrı bir KVKK kararı gerektirir.

## 6. Search Console, Yandex Webmaster, Meta

- **Search Console:**
  1. Mülk ekle → **URL öneki** → **HTML etiketi**.
  2. `content` değerini panele yapıştırın, kaydedin, **Doğrula**'ya basın.
  3. Site haritası olarak `https://<alan-adı>/sitemap.xml` gönderin.
- **Yandex Webmaster:** site ekle → **Meta etiket** → kodu panele girin → doğrula → site haritasını ekleyin.
- **Meta:**
  1. Business Ayarları → Marka güvenliği → Alan adları → **Meta etiketi** → kodu panele girin → doğrula.
  2. Events Manager'da alan adı için olay öncelikleri (Aggregated Event Measurement): **Purchase** en üstte, ardından **InitiateCheckout**.

## 7. Sorun giderme

| Belirti | Bakılacak yer |
| --- | --- |
| Bant çıkmıyor | Panelde GTM veya GA4 kimliği girili mi? Kimlik yoksa bilinçli olarak hiçbir şey yüklenmez. |
| GA4'te veri yok | Önizlemede `consent_state`/`consent_update` olayında `consent_analytics` true mu? `CONFIG - GA4 Measurement ID` doğru mu? |
| Satın alma iki kez | GA4 → DebugView'da `transaction_id` aynı mı? Site sipariş başına bir kez gönderir; kapsayıcıda başka bir satın alma etiketi olmadığından emin olun. |
| İçerik Güvenlik Politikası (CSP) hatası | Tarayıcı konsolu. Google, Meta ve Yandex alan adları izinli. Başka bir araç eklenirse `apps/web/next.config.ts`'e alan adı eklenmelidir. |
