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
2. **Node.js 22 LTS.** İndirme: https://nodejs.org (22.x sürümünü seçin).
3. **pnpm.** Kurulumdan sonra bir terminal açıp şunu bir kez çalıştırın:
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

Ekranda "TexHoliday yerel demo çalışıyor" yazısı çıkınca tarayıcıda (**Chrome önerilir**) açın:

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

## 4. Neleri deneyebilirsiniz?

- **Otel listesi oluşturma.**
  - Panel → İçerik (site) → Otel listeleri → yeni liste.
  - Bölge seçin ya da "Otel adıyla bul" ile otel ekleyin, sonra yayınlayın.
  - Fiyatlar worker tarafından taranır. MOCK'ta bir dakika içinde, sandbox'ta saniyede bir çağrıyla görünür.
- **Rezervasyon.**
  - Sitede arama yapın, teklif seçin, misafir bilgilerini girin ve ödemeye geçin.
  - MOCK'ta "MOCK: ödemeyi tamamla" düğmesine basın.
  - Sandbox'ta test kartıyla ödeyin: `4242 4242 4242 4242`, ileri bir son kullanma tarihi, CVC `123`.
- **E-postalar.** Rezervasyon onayı ve iptal e-postaları http://localhost:8025 adresinde görünür. Gerçek bir adrese e-posta gitmez.
- **Panel.**
  - Siparişler: durum kontrolü, iptal, iade kaydı.
  - Fiyat politikası: taslak → başka bir hesapla onay.
  - Raporlar: finans, liste fiyatı doğruluğu, reklam sayfa feed'i.
- **İçerik.** Rehber yazısı, SSS ve menü bağlantıları ekleyin.

## 5. Nuitee SANDBOX ile çalıştırma (isteğe bağlı)

1. Nuitee panelinde API anahtarları bölümünden **sandbox** anahtarını kopyalayın. **Asla production anahtarı kullanmayın.**
2. Proje klasöründeki `.env.demo` dosyasını not defteriyle açın ve `NUITEE_API_KEY=` satırına anahtarı yapıştırın.
3. Şunu çalıştırın:
   ```
   pnpm demo:sifirla
   pnpm demo
   ```

Sandbox biçiminde listeler gerçek yerlerle kurulur: Antalya, Swandor otelleri, Mısır, Roma. Fiyatlar worker çalıştıkça dolar.

Sandbox'ın önerilen satış fiyatları yapaydır. Bu yüzden demoda fiyat paritesi kontrolü kapalıdır; bu ayar yalnız sandbox'ta kabul edilir.

## 6. Sorun giderme

| Belirti | Çözüm |
|---|---|
| "Docker bulunamadı ya da çalışmıyor" | Docker Desktop'ı açın, "Engine running" yazısını bekleyin. |
| "Node 22 gerekli" | nodejs.org'dan 22 LTS kurun, terminali kapatıp açın. |
| Port kullanımda (3000, 8025, 1025) | O portu kullanan programı kapatın. |
| Panel girişinde kod kabul edilmiyor | Kodu yeniden alın: `pnpm demo:kod` (kodlar 30 sn geçerli, her biri bir kez kullanılır). |
| Her şeyi baştan kurmak | `pnpm demo:sifirla` ardından `pnpm demo` |
| Kodu güncelledim (`git pull`) | `pnpm install` ardından `pnpm demo` (site gerekirse yeniden derlenir) |

## 7. Güvenlik notları

- `.env.demo` ve `.demo/` klasörü yalnız bu bilgisayardadır ve git'e girmez.
- Demo hesaplarının parolası ve kod anahtarları bu dosyalarda açık durur. Gerçek personel hesabı için kullanılmaz.
- Demo fiyat politikası (otel %10, uçak %8) ve liste ayarları **demo değerleridir**; işletme kararı değildir. Canlıda finans ekibi kendi değerlerini girer.
- Demo komutları production ortamında çalışmaz: betik yalnız `development` + MOCK/SANDBOX ortamında veri yükler.
