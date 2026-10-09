> For the complete documentation index, see [llms.txt](https://docs.iyzico.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.iyzico.com/ek-servisler/webhook.md).

# Webhook

{% hint style="warning" %}
&#x20;`X-Iyz-Signature` ve `X-Iyz-Signature-V2` artık desteklenmeyecektir. Kullanıcılarımızın sistemlerini `X-Iyz-Signature-V3` ile uyumlu hale getirmelerini bekliyoruz.
{% endhint %}

iyzico, işlem tamamlandığında uygulamanızı bilgilendirmek için webhook kullanır. (Başarılı, Başarısız) Ödeme girişimi yapıldığında HTTP POST bildirimi ile işlem sonucunu almak mümkündür. İlk bildirim, ilk ödeme girişiminden **10-15 saniye** sonra gönderilecektir.\
\
Bu bir JSON Yükü ve sunucudan sunucuya HTTP isteğidir. iyzico, sunucunuz **"2xx"** durumu ile yanıt verene kadar her 15 dakikada bir bildirim göndermeye devam edecek ve 3 defa tekrar edecektir.

iyzico'da webhook kullanımına yönelik opsiyonel olabilecek tüm ödeme metotları doğrudan sonuçlanmaktadır. Örneğin, başarılı bir ödeme talebinde, en son yanıt tüm ödeme ayrıntılarını içerir. Bununla birlikte, istenirse farklı mekanizmaları tetiklemek için webhook yine de kullanılabilir.

{% hint style="warning" %}
Header'da "`X-IYZ-SIGNATURE-V3`" değerinin gönderilebilmesi için, hesabınız üzerinde webhook signature özelliğinin aktif olması gerekmektedir. Bu özelliğin aktif edilmesi için, <entegrasyon@iyzico.com> adresi ile iletişime geçebilirsiniz.
{% endhint %}

### Webhook nasıl etkinleştirilir?&#x20;

iyzico Merchant Panel'e giriş yaptıktan sonra "Ayarlar > Firma Ayarları" adımında "İşyeri Bildirimleri" başlığından yapabilirsiniz. (HTTPS URL gereklidir)

<figure><img src="https://1970365243-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FkTpM8Bc8GIRKlQDusDr3%2Fuploads%2Fyl4BGFR9mij7PirlXVqF%2Fwebhook1.png?alt=media&amp;token=eb71fc8b-2034-4034-b870-3f4c26ec6d49" alt=""><figcaption></figcaption></figure>

### Webhook Formları

Webhook istekleri 3 farklı formatta olabilir.

* Direct Format
* HPP(Hosted Payment Page) Format
* Abonelik

#### Direkt Format

Aşağıdaki webhook formatı, NON-3DS ve 3DS ödeme taleplerinde görünür.

| Parametre                 | Type   | Açıklama                                                                                                                                                                             |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **paymentConversationId** | string | İlgili ödemenin üye işyeri tarafından gönderilmiş referans numarası                                                                                                                  |
| **merchantId**            | string | Merchant'ın iyzico tarafından atanmış ID numarası.                                                                                                                                   |
| **paymentId**             | string | İlgili ödemenin paymentId bilgisi                                                                                                                                                    |
| **status**                | string | Ödeme durumu. Alabileceği değerler: FAILURE, SUCCESS, INIT\_THREEDS, CALLBACK\_THREEDS, BKM\_POS\_SELECTED, INIT\_APM, INIT\_CONTACTLESS                                             |
| **iyziReferenceCode**     | string | İstek için üretilen unique iyzico referans kodu                                                                                                                                      |
| **iyziEventType**         | string | <p>İstek tipini belirtir. Alabileceği değerler: </p><p>PAYMENT\_API, API\_AUTH, THREE\_DS\_AUTH, THREE\_DS\_CALLBACK, BKM\_AUTH, BALANCE, CONTACTLESS\_AUTH, CONTACTLESS\_REFUND</p> |
| **iyziEventTime**         | long   | Notification oluşturulma zamanının unix timestamp değeridir.                                                                                                                         |
| **iyziPaymentId**         | long   | Ödemeye ait ilgili paymentId.                                                                                                                                                        |

#### Örnek Webhook Bildirimi

```json
{
  "paymentConversationId": "conversationId",
  "merchantId": 3404590,
  "paymentId": 28157248,
  "status": "SUCCESS",
  "iyziReferenceCode": "97f61d20-e66f-4120-82e9-92f4a183370a",
  "iyziEventType": "API_AUTH",
  "iyziEventTime": 1766730778396,
  "iyziPaymentId": 28157248
}
```

#### HPP Format

Yukarıdakine benzer şekilde, bir sonraki webhook formatı, [**iyzico ile Öde**](/odeme-metotlari/iyzico-ile-ode.md)**,** [**Ödeme Formu**](/odeme-metotlari/odeme-formu.md) ve Tokenize Cüzdan Ödemesi olan barındırılan sayfa çözümlerinde görünür.

| Parametre                 | Type   | Açıklama                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **paymentConversationId** | string | İlgili ödemenin üye işyeri tarafından gönderilmiş referans numarası                                                                                                                                                                                                                                            |
| **merchantId**            | string | Merchant'ın iyzico tarafından atanmış ID numarası.                                                                                                                                                                                                                                                             |
| **token**                 | string | Ödeme formu için üretilmiş ve ödeme detaylarını içeren token değeri                                                                                                                                                                                                                                            |
| **status**                | string | Ödeme durumu. Alabileceği değerler: FAILURE, SUCCESS, INIT\_THREEDS, CALLBACK\_THREEDS, BKM\_POS\_SELECTED, INIT\_APM, INIT\_BANK\_TRANSFER, INIT\_CREDIT, PENDING\_CREDIT, INIT\_CONTACTLESS                                                                                                                  |
| **iyziReferenceCode**     | string | İstek için üretilen unique iyzico referans kodu                                                                                                                                                                                                                                                                |
| **iyziEventType**         | string | <p>İstek tipini belirtir. Alabileceği değerler: CHECKOUT\_FORM\_AUTH, BANK\_TRANSFER\_AUTH, BKM\_AUTH, BALANCE, CONTACTLESS\_AUTH, CONTACTLESS\_REFUND, CREDIT\_PAYMENT\_AUTH, CREDIT\_PAYMENT\_PENDING,CREDIT\_PAYMENT\_INIT, </p><p>PWI\_TKN\_FUND, </p><p>PWI\_TKN\_AUTH,</p><p>PWI\_TKN\_THREEDS\_AUTH</p> |
| **iyziEventTime**         | long   | Notification oluşturulma zamanının unix timestamp değeridir.                                                                                                                                                                                                                                                   |
| **iyziPaymentId**         | long   | Ödemeye ait ilgili paymentId.                                                                                                                                                                                                                                                                                  |

#### Örnek Webhook Bildirimi

```json
{
  "paymentConversationId": "123456789",
  "merchantId": 3404590,
  "status": "SUCCESS",
  "token": "9895e0e6-cd7e-4635-9c33-fe52c337de09",
  "iyziReferenceCode": "a5450da6-6741-431b-bfcf-2ad147b65fe0",
  "iyziEventType": "CHECKOUT_FORM_AUTH",
  "iyziEventTime": 1766733201159,
  "iyziPaymentId": 28157797
}
```

#### Abonelik Bildirimleri

Abonelik özelliğinde, abonelik başlatıldıktan sonra, yalnızca ilk işlem için değil, plan kapsamında düzenli olarak tahsil edilecek ödemeler için de webhook bildirimi alabilirsiniz.

Tekrarlayanan ödemelerin durumunu, iyzico kontrol paneline giriş yaptıktan sonra  "Ayarlar > Firma Ayarları > İşyeri Bildirimleri" sekmesinde bulunan abonelik bildirim alanına tanımlayacağınız bir URL ile öğrenebilirsiniz.

<figure><img src="https://1970365243-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FkTpM8Bc8GIRKlQDusDr3%2Fuploads%2FmUEm37SzA4MrV3M7F5xe%2Fimage.png?alt=media&amp;token=b4314b25-f6da-4802-be11-f06650c99bcd" alt=""><figcaption></figcaption></figure>

Başarılı ve başarısız işlemlere dair örnek abonelik bildirimleri aşağıdaki gibidir.

**Başarılı**&#x20;

```json
{
  "orderReferenceCode": "ae5fcbf8-4fd2-46e5-b199-8f690ae9fae5",
  "customerReferenceCode": "ff4052ca-0588-40eb-81a9-848c0c409472",
  "subscriptionReferenceCode": "ea0362e2-a1c4-4fda-89f0-3758a5c20a28",
  "iyziReferenceCode": "18d7cc48-a64b-4cd3-ae68-71aff1c76ed9",
  "iyziEventType": "subscription.order.success",
  "iyziEventTime": 1758704403161
}
```

**Başarısız**

```json
{
  "orderReferenceCode": "9ed2d128-b106-464b-8170-84325e75703b",
  "customerReferenceCode": "042f0b61-079a-4a38-9454-6564a3c11a5a",
  "subscriptionReferenceCode": "b0f6d38f-b2d1-4a72-9bf2-bc9375665f3a",
  "iyziReferenceCode": "aac139a9-43db-4f40-82dd-d4e5a77a3d2e",
  "iyziEventType": "subscription.order.failure",
  "iyziEventTime": 1579612261619
}
```

**Abonelik Bildirim Parametreleri**

<table><thead><tr><th>Parametre</th><th width="205.265625">Tip</th><th>Açıklama</th></tr></thead><tbody><tr><td>orderReferenceCode</td><td>String</td><td>İlgili ödeme denemesine ait referans kodu. Başarısız işlemler için retry işleminde kullanılır.</td></tr><tr><td>customerReferenceCode</td><td>String</td><td>Müşteriye ait referans kodu.</td></tr><tr><td>subscriptionReferenceCode</td><td>String</td><td>Abonelik referans kodu.</td></tr><tr><td>iyziReferenceCode</td><td>String</td><td>İstek için üretilen unique iyzico referans kodu.</td></tr><tr><td>iyziEventType</td><td>String</td><td><p>İstek tipini belirtir. Alabileceği değerler:</p><p></p><p>"subscription.order.success",</p><p>"subscription.order.failure"<br></p></td></tr><tr><td>iyziEventTime</td><td>Long</td><td>Notification oluşturulma zamanının unix timestamp değeridir.</td></tr></tbody></table>

### Notifikasyon Validasyonu

İsteğin iyzico üzerinden geldiğini valide etmek için header içinde gönderilen `X-IYZ-SIGNATURE-V3`değeri kullanılabilir ve bu değer yalnızca sahip olduğunuz `SECRET KEY` ile çözülebilir.

{% hint style="warning" %}
&#x20;`X-Iyz-Signature` ve `X-Iyz-Signature-V2` artık desteklenmeyecektir. Kullanıcılarımızın sistemlerini `X-Iyz-Signature-V3` ile uyumlu hale getirmelerini bekliyoruz.
{% endhint %}

#### Direkt Formatın Doğrulanması

`SECRET KEY`, `iyziEventType`, `paymentId`,  `paymentConversationId`, `status` aşağıda verilen sıraya göre oluşturulmalıdır. Bu dizi HMACSHA256 ile hashlenir ve sonuç HEX ile şifrelenir. Son değer, başlıktaki `X-IYZ-SIGNATURE-V3` ile eşleşmelidir.

{% tabs %}
{% tab title="Direkt format için Hashing Örneği" %}

```json
// HMAC için Key oluşturulur
const key = secretKey + iyziEventType + paymentId + paymentConversationId + status;

// HMAC SHA256 ile signature üretilir
const hmac256 = crypto.createHmac('sha256', secretKey)
                       .update(key)
                       .digest('hex');
```

{% endtab %}

{% tab title="PHP" %}

```json
$secretKey = "merchant_secret_key";
$iyziEventType = "iyziEventType_from_webhook_payload";
$paymentId = "iyziPaymentId_from_webhook_payload";
$paymentConversationId = "paymentConversationId_from_webhook_payload";
$status = "status_from_webhook_payload";

$key = $secretKey.$iyziEventType.$paymentId.$paymentConversationId.$status;
$hmac256Signature = bin2hex(hash_hmac('sha256', $key, $secretKey, true));

$signature_v3 = "signature_v3_from_webhook_header";

if ($hmac256Signature == $signature_v3) {
    echo "HMAC-SHA256 Signature Verified: " . $hmac256Signature . "\n";
    echo "Enjoy your code...";
} else {
    echo "Signature verification failed.\n";
}
```

{% endtab %}

{% tab title="Java" %}

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

public class SigV3 {
  public static void main(String[] args) throws Exception {
    String secretKey = "merchant_secret_key";
    String iyziEventType = "iyziEventType_from_webhook_payload";
    String paymentId = "iyziPaymentId_from_webhook_payload";
    String paymentConversationId = "paymentConversationId_from_webhook_payload";
    String status = "status_from_webhook_payload";

    String msg = secretKey + iyziEventType + paymentId + paymentConversationId + status;

    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    byte[] out = mac.doFinal(msg.getBytes(StandardCharsets.UTF_8));

    StringBuilder hex = new StringBuilder(out.length * 2);
    for (byte b : out) hex.append(String.format("%02x", b));
    System.out.println(hex);
  }
}

```

{% endtab %}

{% tab title="Node.js" %}

```json
const crypto = require('crypto');

const secretKey = "merchant_secret_key";
const iyziEventType = "iyziEventType_from_webhook_payload";
const paymentId = "iyziPaymentId_from_webhook_payload";
const paymentConversationId = "paymentConversationId_from_webhook_payload";
const status = "status_from_webhook_payload";

const key = secretKey + iyziEventType + paymentId + paymentConversationId + status;

const signature = crypto
  .createHmac('sha256', secretKey)
  .update(key, 'utf8')
  .digest('hex');

console.log(signature);

```

{% endtab %}

{% tab title=".Net" %}

```json
using System;
using System.Security.Cryptography;
using System.Text;

public class WebhookSignatureValidation
{
    public static void Main()
    {
        string secretKey = "merchant_secret_key";
        string iyziEventType = "iyziEventType_from_webhook_payload";
        string paymentId = "iyziPaymentId_from_webhook_payload";
        string paymentConversationId = "paymentConversationId_from_webhook_payload";
        string status = "status_from_webhook_payload";

        string key = secretKey + iyziEventType + paymentId + paymentConversationId + status;
        string hmac256Signature = CalculateHMACSHA256(key, secretKey);

        string signature_v3 = "signature_v3_from_webhook_header";

        if (hmac256Signature.Equals(signature_v3, StringComparison.OrdinalIgnoreCase))
            Console.WriteLine("Doğrulama başarılı");
        else
            Console.WriteLine("Doğrulama başarısız");
    }

    private static string CalculateHMACSHA256(string data, string key)
    {
        byte[] keyBytes = Encoding.UTF8.GetBytes(key);
        byte[] dataBytes = Encoding.UTF8.GetBytes(data);

        using (var hmac = new HMACSHA256(keyBytes))
        {
            byte[] hmacBytes = hmac.ComputeHash(dataBytes);
            return BitConverter.ToString(hmacBytes).Replace("-", "").ToLowerInvariant();
        }
    }
}

```

{% endtab %}
{% endtabs %}

| Sıralama | Parametre                 | Açıklama                                                                                                                                                                             |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**    | **secretKey**             | Sahip olduğunuz secretKey                                                                                                                                                            |
| **2**    | **iyziEventType**         | <p>İstek tipini belirtir. Alabileceği değerler: </p><p>PAYMENT\_API, API\_AUTH, THREE\_DS\_AUTH, THREE\_DS\_CALLBACK, BKM\_AUTH, BALANCE, CONTACTLESS\_AUTH, CONTACTLESS\_REFUND</p> |
| **3**    | **paymentId**             | İlgili ödemenin paymentId bilgisi                                                                                                                                                    |
| **4**    | **paymentConversationId** | İlgili ödemenin üye işyeri tarafından gönderilmiş referans numarası                                                                                                                  |
| **5**    | **status**                | Ödeme durumu. Alabileceği değerler: FAILURE, SUCCESS, INIT\_THREEDS, CALLBACK\_THREEDS, BKM\_POS\_SELECTED, INIT\_APM, INIT\_CONTACTLESS                                             |

#### HPP Format

`SECRET KEY`, `iyziEventType`, `iyziPaymentId`, `token`, `paymentConversationId`, `status` aşağıda verilen sıraya göre oluşturulmalıdır. Bu dizi HMACSHA256 ile hashlenir ve sonuç HEX ile şifrelenir. Son değer, başlıktaki `X-IYZ-SIGNATURE-V3` ile eşleşmelidir.

{% tabs %}
{% tab title="HPP Format için Hashing Örneği" %}

```json
// HMAC için Key oluşturulur
const key = secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status;

// HMAC SHA256 ile signature üretilir
const hmac256 = crypto.createHmac('sha256', secretKey)
                       .update(key)
                       .digest('hex');
```

{% endtab %}

{% tab title="PHP" %}

```json
$secretKey = "merchant_secret_key";
$iyziEventType = "iyziEventType_from_webhook_payload";
$iyziPaymentId = "iyziPaymentId_from_webhook_payload";
$token = "token_from_webhook_payload";
$paymentConversationId = "paymentConversationId_from_webhook_payload";
$status = "status_from_webhook_payload";

$key = $secretKey.$iyziEventType.$iyziPaymentId.$token.$paymentConversationId.$status;
$hmac256Signature = bin2hex(hash_hmac('sha256', $key, $secretKey, true));

$signature_v3 = "signature_v3_from_webhook_header";

if ($hmac256Signature == $signature_v3) {
    echo "HMAC-SHA256 Signature Verified: " . $hmac256Signature . "\n";
    echo "Enjoy your code...";
} else {
    echo "Signature verification failed.\n";
}
```

{% endtab %}

{% tab title="Java" %}

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

public class SignatureV3Example {

    public static void main(String[] args) throws Exception {

        String secretKey = "merchant_secret_key";

        String iyziEventType = "iyziEventType_from_webhook_payload";
        String iyziPaymentId = "iyziPaymentId_from_webhook_payload";
        String token = "token_from_webhook_payload";
        String paymentConversationId = "paymentConversationId_from_webhook_payload";
        String status = "status_from_webhook_payload";

        String signatureV3FromHeader = "signature_v3_from_webhook_header";

        // key = secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status
        String key = secretKey
                + iyziEventType
                + iyziPaymentId
                + token
                + paymentConversationId
                + status;

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] raw = mac.doFinal(key.getBytes(StandardCharsets.UTF_8));

        StringBuilder hex = new StringBuilder();
        for (byte b : raw) {
            hex.append(String.format("%02x", b));
        }

        String calculated = hex.toString();

        if (calculated.equals(signatureV3FromHeader)) {
            System.out.println("Doğrulama başarılı");
        } else {
            System.out.println("Doğrulama başarısız");
        }
    }
}

```

{% endtab %}

{% tab title="Node.js" %}

```json
const crypto = require("crypto");

const secretKey = "merchant_secret_key";

const iyziEventType = "iyziEventType_from_webhook_payload";
const iyziPaymentId = "iyziPaymentId_from_webhook_payload";
const token = "token_from_webhook_payload";
const paymentConversationId = "paymentConversationId_from_webhook_payload";
const status = "status_from_webhook_payload";

const signatureV3FromHeader = "signature_v3_from_webhook_header";

// key = secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status
const key =
  secretKey +
  iyziEventType +
  iyziPaymentId +
  token +
  paymentConversationId +
  status;

const calculated = crypto
  .createHmac("sha256", secretKey)
  .update(key, "utf8")
  .digest("hex");

if (calculated === signatureV3FromHeader) {
  console.log("Doğrulama başarılı");
} else {
  console.log("Doğrulama başarısız");
}

```

{% endtab %}

{% tab title=".Net" %}

```json
using System;
using System.Security.Cryptography;
using System.Text;

public class WebhookSignatureValidation
{
    public static void Main()
    {
        string secretKey = "merchant_secret_key";
        string iyziEventType = "iyziEventType_from_webhook_payload";
        string iyziPaymentId = "iyziPaymentId_from_webhook_payload";
        string token = "token_from_webhook_payload";
        string paymentConversationId = "paymentConversationId_from_webhook_payload";
        string status = "status_from_webhook_payload";

        string key = secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status;
        string hmac256Signature = CalculateHMACSHA256(key, secretKey);

        string signature_v3 = "signature_v3_from_webhook_header".Trim();

        if (hmac256Signature.Equals(signature_v3, StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine("Doğrulama başarılı");
        }
        else
        {
            Console.WriteLine("Doğrulama başarısız");
        }
    }

    private static string CalculateHMACSHA256(string data, string key)
    {
        byte[] keyBytes = Encoding.UTF8.GetBytes(key);
        byte[] dataBytes = Encoding.UTF8.GetBytes(data);

        using (var hmac = new HMACSHA256(keyBytes))
        {
            byte[] hmacBytes = hmac.ComputeHash(dataBytes);
            return BitConverter.ToString(hmacBytes)
                .Replace("-", "")
                .ToLower(); // hex lowercase
        }
    }
}

```

{% endtab %}
{% endtabs %}

| Sıralama | Paremetre                 | Açıklama                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**    | **secretKey**             | Sahip olduğunuz secretKey.                                                                                                                                                                                                                                                                                    |
| **2**    | **iyziEventType**         | <p>İstek tipini belirtir. Alabileceği değerler: CHECKOUT\_FORM\_AUTH, BANK\_TRANSFER\_AUTH, BKM\_AUTH, BALANCE, CONTACTLESS\_AUTH, CONTACTLESS\_REFUND, CREDIT\_PAYMENT\_AUTH, CREDIT\_PAYMENT\_PENDING,CREDIT\_PAYMENT\_INIT,</p><p>PWI\_TKN\_FUND, </p><p>PWI\_TKN\_AUTH,</p><p>PWI\_TKN\_THREEDS\_AUTH</p> |
| **3**    | **iyziPaymentId**         | Ödemeye ait ilgili paymentId.                                                                                                                                                                                                                                                                                 |
| **4**    | **token**                 | Ödeme formu için üretilmiş ve ödeme detaylarını içeren token değeri                                                                                                                                                                                                                                           |
| **5**    | **paymentConversationId** | İlgili ödemenin üye işyeri tarafından gönderilmiş referans numarası                                                                                                                                                                                                                                           |
| **6**    | **status**                | Ödeme durumu. Alabileceği değerler: FAILURE, SUCCESS, INIT\_THREEDS, CALLBACK\_THREEDS, BKM\_POS\_SELECTED, INIT\_APM, INIT\_BANK\_TRANSFER, INIT\_CREDIT, PENDING\_CREDIT, INIT\_CONTACTLESS                                                                                                                 |

#### Abonelik Bildirimlerinin Doğrulanması

`SECRET KEY`, `merchantId`, `eventType`, `subscriptionReferenceCode`, `orderReferenceCode` ve `customerReferenceCode` aşağıda verilen sıraya göre oluşturulmalıdır. Bu dizi HMACSHA256 ile hashlenir ve sonuç HEX ile şifrelenir. Son değer, başlıktaki `X-IYZ-SIGNATURE-V3` ile eşleşmelidir.

{% tabs %}
{% tab title="Hashing Sample" %}
{% code lineNumbers="true" %}

```javascript
// HMAC için Key (message) oluşturulur
const key = merchantId 
          + secretKey 
          + eventType 
          + subscriptionReferenceCode 
          + orderReferenceCode 
          + customerReferenceCode;

// HMAC SHA256 ile hex formatında signature üretilir 
const hmac256 = crypto.createHmac('sha256', secretKey)
                      .update(key)
                      .digest('hex');

```

{% endcode %}
{% endtab %}

{% tab title="PHP" %}

```php
<?php

$merchantId = "merchantId";
$secretKey  = "secretKey";

$eventType = "eventType_from_webhook_payload";
$subscriptionReferenceCode = "subscriptionReferenceCode_from_webhook_payload";
$orderReferenceCode        = "orderReferenceCode_from_webhook_payload";
$customerReferenceCode     = "customerReferenceCode_from_webhook_payload";

// message = merchantId + secretKey + eventType + subReferenceCode + orderReferenceCode + customerReferenceCode
$message = $merchantId
    . $secretKey
    . $eventType
    . $subscriptionReferenceCode
    . $orderReferenceCode
    . $customerReferenceCode;

// HMAC-SHA256 raw → hex
$hmac256Signature = bin2hex(hash_hmac('sha256', $message, $secretKey, true));

$signature_v3 = "signature_v3_from_webhook_header";

if ($hmac256Signature == $signature_v3) {
    echo "İmza doğrulaması başarılı.";
} else {
    echo "İmza doğrulaması başarısız.";
}

?>
```

{% endtab %}

{% tab title="Java" %}

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

public class WebhookSignatureCheck {
    public static void main(String[] args) throws Exception {
        String merchantId = "merchantId";
        String secretKey  = "secretKey";

        String eventType = "eventType_from_webhook_payload";
        String subscriptionReferenceCode = "subscriptionReferenceCode_from_webhook_payload";
        String orderReferenceCode        = "orderReferenceCode_from_webhook_payload";
        String customerReferenceCode     = "customerReferenceCode_from_webhook_payload";

        // message = merchantId + secretKey + eventType + subscriptionReferenceCode + orderReferenceCode + customerReferenceCode
        String message = merchantId
                + secretKey
                + eventType
                + subscriptionReferenceCode
                + orderReferenceCode
                + customerReferenceCode;

        // HMAC-SHA256 raw → hex
        Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
        SecretKeySpec secret_key = new SecretKeySpec(secretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        sha256_HMAC.init(secret_key);

        byte[] hashBytes = sha256_HMAC.doFinal(message.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : hashBytes) {
            sb.append(String.format("%02x", b));
        }
        String hmac256Signature = sb.toString();

        String signature_v3 = "signature_v3_from_webhook_header";

        if (hmac256Signature.equals(signature_v3)) {
            System.out.println("İmza doğrulaması başarılı.");
        } else {
            System.out.println("İmza doğrulaması başarısız.");
        }
    }
}

```

{% endtab %}

{% tab title="Node.Js" %}

```javascript
const crypto = require("crypto");

const merchantId = "merchantId";
const secretKey  = "secretKey";

const eventType = "eventType_from_webhook_payload";
const subscriptionReferenceCode = "subscriptionReferenceCode_from_webhook_payload";
const orderReferenceCode        = "orderReferenceCode_from_webhook_payload";
const customerReferenceCode     = "customerReferenceCode_from_webhook_payload";

// message = merchantId + secretKey + eventType + subscriptionReferenceCode + orderReferenceCode + customerReferenceCode
const message = merchantId
              + secretKey
              + eventType
              + subscriptionReferenceCode
              + orderReferenceCode
              + customerReferenceCode;

// HMAC-SHA256 raw → hex
const hmac256Signature = crypto.createHmac("sha256", secretKey)
                               .update(message)
                               .digest("hex");

const signature_v3 = "signature_v3_from_webhook_header";

if (hmac256Signature === signature_v3) {
  console.log("İmza doğrulaması başarılı.");
} else {
  console.log("İmza doğrulaması başarısız.");
}

```

{% endtab %}
{% endtabs %}
