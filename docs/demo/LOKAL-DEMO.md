# Yerel demo: TexHoliday'i kendi bilgisayarınızda çalıştırma

Bu rehber siteyi, yönetim panelini ve içerik yönetimini **sunucuya yüklemeden** kendi bilgisayarınızda çalıştırmayı anlatır. Her şey yalnız sizin bilgisayarınızda kalır: site yalnız `localhost` adresinden açılır, dışarıdan erişilemez.

İki çalışma biçimi vardır:

| Biçim | Ne gerekir | Oteller ve ödeme |
|---|---|---|
| **MOCK** (varsayılan) | Hiçbir anahtar gerekmez | Üç örnek otel (MOCK). Ödeme sayfası taklittir: "MOCK: ödemeyi tamamla" düğmesine basılır. |
| **Nuitee SANDBOX** | Nuitee panelinden alınan **sandbox** API anahtarı | Gerçek sandbox otelleri (Swandor dahil) ve gerçek Nuitee ödeme bileşeni. Ödeme test kartıyla yapılır, gerçek para çekilmez. |

## 1. Bir kez kurulacak programlar

1. **Docker Desktop.** Veritabanı, Redis ve e-posta görüntüleyici bunun içinde çalışır.
   - İndirme: https://www.docker.com/products/docker-desktop/
   - Kurduktan sonra Docker Desktop'ı açın. Sol altta "Engine running" yazısını görmelisiniz.
2. **Node.js 22 LTS.** Proje yalnız Node 22 ile çalışır; 24 ya da 26 kabul edilmez.
   - Bilgisayarda Node yoksa: https://nodejs.org adresinden 22.x sürümünü kurun.
   - **Başka bir Node sürümü varsa** (`node -v` 22 dışında bir şey yazıyorsa), onu silmeden **nvm** ile 22'yi ekleyin. Mac ve Linux'ta:
     ```
     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
     ```
     Terminali kapatıp açın. Proje klasöründe şunları çalıştırın:
     ```
     nvm install 22
     nvm use
     node -v
     ```
     `node -v` artık `v22.…` yazmalıdır. `nvm use`, klasördeki `.nvmrc` dosyasından 22'yi seçer. **Her yeni terminalde proje klasöründe bir kez `nvm use` yazın.**
   - Windows'ta aynı iş için "nvm-windows" kullanılır: https://github.com/coreybutler/nvm-windows. Kurduktan sonra `nvm install 22` ve `nvm use 22`.
3. **pnpm.** Node 22 etkinken bir kez şunu çalıştırın (nvm ile kurduysanız o sürüm için de bir kez):
   ```
   corepack enable
   ```
4. **Git ve proje.**
   - Windows'ta Git yoksa: https://git-scm.com/download/win
   - Sonra:
     ```
     git clone https://github.com/travellerbuddha/VectorTex.git
     cd VectorTex
     pnpm install
     ```

Terminal: Windows'ta "PowerShell", Mac'te "Terminal" uygulaması.

## 2. Demoyu başlatma

Proje klasöründe:

```
pnpm demo
```

İlk çalıştırmada bunlar otomatik yapılır (5–10 dakika):

- Gizli değerler rastgele üretilir ve `.env.demo` dosyasına yazılır.
- Docker'da veritabanı, Redis ve Mailpit (e-posta görüntüleyici) başlatılır.
- Veritabanı tabloları kurulur.
- Demo verileri yüklenir:
  - panel hesapları;
  - demo fiyat politikası;
  - otel listeleri (Antalya, Her Şey Dahil, Bütçe Dostu…);
  - rehber yazıları ve SSS;
  - menü;
  - MOCK biçiminde ayrıca 3 örnek sipariş.
- Site derlenir ve çalıştırılır.

Ekranda "TexHoliday yerel demo çalışıyor" yazısı çıkınca tarayıcıda (**Chrome önerilir**) açın. Adresi tam olarak **`localhost`** ile yazın. `127.0.0.1` yazarsanız ödemeden dönüşte sipariş çerezi farklı adrese düşer ve sipariş açılmaz.

| Ne | Adres |
|---|---|
| Site (Türkçe) | http://localhost:3000/tr |
| Otel listeleri | http://localhost:3000/tr/oteller |
| Seyahat rehberi / SSS | http://localhost:3000/tr/rehber · http://localhost:3000/tr/sss |
| Yönetim paneli | http://localhost:3000/yonetim |
| Gönderilen e-postalar | http://localhost:8025 |

Durdurmak için terminalde **Ctrl+C**. Docker servislerini de kapatmak için: `pnpm demo:durdur`. Veriler saklanır; sonraki `pnpm demo` hızlı açılır.

## 3. Yönetim paneline giriş

Panel iki adımlı doğrulama ister. Demo hesapları ve o anki 6 haneli kodlar için:

```
pnpm demo:kod
```

Bu komut dört şey yazar:

- tüm hesapların ortak parolası;
- her hesabın **o anki** kodu (30 saniye geçerlidir);
- isterseniz telefonunuzdaki Google/Microsoft Authenticator'a eklemek için her hesabın anahtarı;
- aşağıdaki hesaplar.

| Hesap | Yetki |
|---|---|
| yonetici@demo.texholiday.test | Her şey (personel, politika, siparişler, içerik, raporlar) |
| finans@demo.texholiday.test | Fiyat politikası taslağı, siparişlerde maliyet/komisyon, iade kaydı, finans raporu |
| onay@demo.texholiday.test | Fiyat politikasını onaylama (dört göz) |
| icerik@demo.texholiday.test | İçerik ve otel listeleri, reklam feed'i |
| operasyon@demo.texholiday.test | Siparişler, görevler, iptal |

Giriş adımları:

1. `/yonetim` sayfasında e-posta ve parolayı girin.
2. Doğrulama kodu ekranında `pnpm demo:kod` çıktısındaki kodu girin.

## 4. İlk deneme: 10 dakikalık tur

MOCK biçiminde, sırayla:

1. **Arama.**
   - http://localhost:3000/tr adresinde "Nereye?" kutusuna `Antalya` yazın ve listeden **Antalya (MOCK)** seçin.
   - Tarih ve kişi seçip **Ara**'ya basın.
   - Sonuç sayfasında **Filtrele ve sırala** ile ücretsiz iptal, pansiyon ve yıldıza göre daraltıp fiyata ya da puana göre sıralayın, sonra **Uygula**'ya basın. Telefonda bu bölüm başlığına dokununca açılır. Filtreler yalnız gelen sonuçları daraltır; fiyat değişmez.
2. **Teklif seçimi.** "MOCK Kaleiçi Boutique – MOCK Superior Double" için **Seç**'e basın. Bu teklif ücretsiz iptallidir.
3. **Rezervasyon formu.**
   - Ad, soyad, e-posta (ör. `deneme@ornek.test`) ve telefonu (`+905321112233`) girin.
   - Satış koşullarını onaylayıp **Ödemeye geç**'e basın.
4. **Ödeme.** **MOCK: ödemeyi tamamla**'ya basın. Acele etmeniz gerekmez; sayfada istediğiniz kadar kalabilirsiniz. "Rezervasyonunuz kesinleşti." yazısını görürsünüz.
5. **E-posta.** http://localhost:8025 adresinde onay e-postasını açın.
6. **Müşterinin kendi iptali.**
   - Onay sayfasındaki sipariş sayfasında **Rezervasyonu iptal et** kutusu var. Ücretsiz iptal süresi ve ücret, otelin (Nuitee'den gelen) koşulundan gösterilir.
   - Onay kutusunu işaretleyip iptal edin. İptal e-postası Mailpit'e gelir.
   - İade edilmez bir teklifte (ör. "MOCK Lara Beach Resort – MOCK Standard Room") kutu yerine "çevrimiçi iptal edilemez" yazar.
7. **Rezervasyonlarım.**
   - Üst menüden **Rezervasyonlarım**'a gidip aynı e-postayı yazın.
   - Kod Mailpit'e gelir. Kodu girince siparişleriniz listelenir. Telefon ekranında denemek için tarayıcıyı daraltabilirsiniz.
8. **Panel.**
   - http://localhost:3000/yonetim adresinde `operasyon@demo.texholiday.test` ile girin (parola ve kod: `pnpm demo:kod`).
   - Siparişler → iptal ettiğiniz sipariş. Zaman çizelgesinde "İptal istendi · Müşteri (site)" görünür.
   - Başka bir siparişte **Durumu kontrol et**'e basın.
9. **Finans.** `finans@demo.texholiday.test` ile Raporlar → **Komisyon tahsilatı** ve **Finans** ekranlarına bakın (ayrıntı aşağıda).

## 5. Neleri deneyebilirsiniz?

- **Otel listesi oluşturma.**
  - Panel → İçerik (site) → Otel listeleri → yeni liste.
  - Bölge seçin ya da "Otel adıyla bul" ile otel ekleyin, sonra yayınlayın.
  - Fiyatlar worker tarafından taranır. MOCK'ta bir dakika içinde, sandbox'ta saniyede bir çağrıyla görünür.
- **Rezervasyon.**
  - Sitede arama yapın, teklif seçin, misafir bilgilerini girin ve ödemeye geçin.
  - MOCK'ta "MOCK: ödemeyi tamamla" düğmesine basın.
  - Sandbox'ta test kartıyla ödeyin: `4242 4242 4242 4242`, ileri bir son kullanma tarihi, CVC `123`.
- **E-postalar.** Rezervasyon onayı ve iptal e-postaları http://localhost:8025 adresinde görünür. Gerçek bir adrese e-posta gitmez.
- **Rezervasyonlarım.**
  - Sitenin üst menüsündeki "Rezervasyonlarım"a rezervasyonda kullanılan e-postayı yazın (örnek: `ayse.demir@ornek.test`).
  - Giriş kodu http://localhost:8025 adresine gelir.
- **Müşterinin kendi iptali** (ADR-0021).
  - Sipariş sayfasında, otelin iptal koşuluna göre iade varsa **Rezervasyonu iptal et** kutusu çıkar.
  - Ücret varsa tutar onay metninde yazar.
  - İptal personel iptaliyle aynı yoldan gider: e-posta, komisyonun düşmesi, panelde zaman çizelgesi.
- **Uçak.** Üst menü → Uçak. Örnek: `IST` → `AYT`. Yolcu bilgileri, koltuk/bagaj adımı ve MOCK ödeme; bilet bir sonraki okumada düzenlenir.
- **Çerez politikası.** Alt bilgideki "Çerez politikası" bağlantısı (`/tr/cerez-politikasi`). Sitenin kullandığı çerezler koddaki listeden üretilir.
- **Panel.**
  - Siparişler: durum kontrolü, iptal, iade kaydı.
  - Fiyat politikası: taslak → başka bir hesapla onay.
  - Raporlar: finans, liste fiyatı doğruluğu, reklam sayfa feed'i ve **komisyon tahsilatı**.
  - Komisyon tahsilatı: finans hesabıyla "Ödeme bekleyen" komisyonları seçip gelen ödemeyi referans, tarih ve tutarla kaydedin (Nuitee ödemeyi aldığında komisyonu gönderir; konaklama bitmeden gelen tutar peşin tahsil sayılır). Ödemesi alınmış bir siparişi iptal edince komisyon "Nuitee'ye iade/mahsup edilecek" listesine düşer; sonraki ödemede onu da seçerek düşün.
  - Fiyat sapma uyarısı: İçerik → Otel listesi fiyat ayarları → "Fiyat sapma uyarısı (%)". Boşsa uyarı yoktur.
- **İçerik.**
  - Rehber yazısı, SSS ve menü bağlantıları ekleyin.
  - Bir taslağı "Yayınla" düğmesinin yanındaki oktan **"Yayını Planla"** ile ileri bir saate planlayın.
  - Planlanan yayın, uygulama açıkken zamanı gelince dakikada bir kontrolle yayına girer.
- **Ölçüm ve çerez bandı.**
  - İçerik → "Ölçüm ve çerez ayarları"na bir GTM kimliği girilince sitede çerez bandı çıkar.
  - Kimlik yokken hiçbir şey yüklenmez. Demoda gerçek kimlik girmeyin, ölçüm verisi Google'a gider.

## 6. Nuitee SANDBOX ile çalıştırma (isteğe bağlı)

1. Nuitee panelinde API anahtarları bölümünden **sandbox** anahtarını kopyalayın. **Asla production anahtarı kullanmayın.**
2. Proje klasöründeki `.env.demo` dosyasını not defteriyle açın ve `NUITEE_API_KEY=` satırına anahtarı yapıştırın.
3. Şunu çalıştırın:
   ```
   pnpm demo:sifirla
   pnpm demo
   ```

Sandbox biçiminde listeler gerçek yerlerle kurulur: Antalya, Swandor otelleri, Mısır, Roma. Fiyatlar worker çalıştıkça dolar.

Sandbox'ın önerilen satış fiyatları yapaydır. Bu yüzden demoda fiyat paritesi kontrolü kapalıdır; bu ayar yalnız sandbox'ta kabul edilir.

## 7. Sorun giderme

| Belirti | Çözüm |
|---|---|
| "Docker bulunamadı ya da çalışmıyor" | Docker Desktop'ı açın, "Engine running" yazısını bekleyin. |
| "Node 22 gerekli" ya da `ERR_PNPM_UNSUPPORTED_ENGINE … Expected version: >=22.12.0 <23 · Got: v26…` | Node 22 etkin değil. nvm kurduysanız proje klasöründe `nvm use` yazın; kurmadıysanız 1. bölümdeki nvm adımlarını uygulayın. Sonra `corepack enable` ve `pnpm install`. |
| "3000 portunu başka bir program kullanıyor" ya da `EADDRINUSE … 3000` | Başka bir site ya da önceki demo açık. Hangisi olduğunu görmek için Mac'te `lsof -nP -iTCP:3000 -sTCP:LISTEN`, Windows'ta `netstat -ano \| findstr :3000`. O programı kapatın ya da demoyu başka portta açın: Mac'te `DEMO_PORT=3001 pnpm demo`, Windows PowerShell'de `$env:DEMO_PORT=3001; pnpm demo`. Sonra adreslerde 3000 yerine o portu kullanın, örneğin http://localhost:3001/tr. `pnpm demo:kod` son kullanılan portu gösterir. |
| Port kullanımda (8025, 1025) | Mailpit portlarıdır. O portu kullanan programı kapatın. |
| Panel girişinde kod kabul edilmiyor | Kodu yeniden alın: `pnpm demo:kod` (kodlar 30 sn geçerli, her biri bir kez kullanılır). |
| Ödemeden sonra sipariş sayfası açılmıyor | Adres çubuğunda `localhost:3000` olmalı, `127.0.0.1:3000` değil (sipariş çerezi adrese bağlıdır). |
| Her şeyi baştan kurmak | `pnpm demo:sifirla` ardından `pnpm demo` |
| Kodu güncelledim (`git pull`) | `pnpm install` ardından `pnpm demo` (site gerekirse yeniden derlenir) |

## 8. Güvenlik notları

- `.env.demo` ve `.demo/` klasörü yalnız bu bilgisayardadır ve git'e girmez.
- Demo hesaplarının parolası ve kod anahtarları bu dosyalarda açık durur. Gerçek personel hesabı için kullanılmaz.
- Demo fiyat politikası (otel %10, uçak %8) ve liste ayarları **demo değerleridir**; işletme kararı değildir. Canlıda finans ekibi kendi değerlerini girer.
- Demo komutları production ortamında çalışmaz: betik yalnız `development` + MOCK/SANDBOX ortamında veri yükler.
- MOCK biçiminde site, worker ve örnek veri yükleyici aynı MOCK "sağlayıcıyı" paylaşır (`.demo/mock-provider`). Böylece ödemesi sitede alınan rezervasyonu worker tamamlayabilir, örnek siparişler de panelden kontrol edilip iptal edilebilir. `pnpm demo:sifirla` bu klasörü de siler.
