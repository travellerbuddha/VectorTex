> For the complete documentation index, see [llms.txt](https://docs.iyzico.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.iyzico.com/en/advanced/response-signature-validation.md).

# Response Signature Validation

This page was prepared to provide detailed guidance on implementing response signature validation using iyzico's API. Response signature validation is essential for ensuring the authenticity and integrity of data exchanged between merchants and iyzico, particularly in financial transactions. By following the instructions on generating and validating HMAC SHA256 signatures, developers can secure their applications against tampering and unauthorized access. This enhances the overall security of the transaction process, protecting both merchants and customers.

## Overview

The `signature` parameter will be used to validate the service response by utilizing specific response parameters and the merchant's secretKey, thereby enhancing service security between merchant and iyzico using HMAC SHA256.

The `signature` parameter exists on following endpoints;

* [Non-3DS Endpoints](#non-3ds-endpoints)
* [3DS Endpoints](#id-3ds-endpoints)
* ["callbackUrl" Redirection](#callbackurl-redirection)
* [Checkout Form(CF) & PayWithiyzico(PWI) Endpoints](#checkout-form-cf-and-paywithiyzico-pwi-endpoints)
* [Refund Endpoints](#refund-endpoints)

{% hint style="info" %}
The `signature` value must be created by using the parameters from the iyzico API responses.
{% endhint %}

## Non-3DS Endpoints

|         Services        |       Endpoint      |                         Parameter Order                         |
| :---------------------: | :-----------------: | :-------------------------------------------------------------: |
|         Non-3DS         |   `/payment/auth`   | paymentId, currency, basketId, conversationId, paidPrice, price |
|     Non-3DS PreAuth     |  `/payment/preauth` | paymentId, currency, basketId, conversationId, paidPrice, price |
|     Non-3DS PostAuth    | `/payment/postauth` | paymentId, currency, basketId, conversationId, paidPrice, price |
| Retrieve Payment Result |  `/payment/detail`  | paymentId, currency, basketId, conversationId, paidPrice, price |

## 3DS Endpoints

|         Services        |                Endpoint                |                         Parameter Order                         |
| :---------------------: | :------------------------------------: | :-------------------------------------------------------------: |
|      3DS Initialize     |     `/payment/3dsecure/initialize`     |                    paymentId , conversationId                   |
|  3DS PreAuth Initialize | `/payment/3dsecure/initialize/preauth` |                    paymentId, conversationId                    |
|         3DS Auth        |        `/payment/3dsecure/auth`        | paymentId, currency, basketId, conversationId, paidPrice, price |
|       3DS v2 Auth       |       `/payment/v2/3dsecure/auth`      | paymentId, currency, basketId, conversationId, paidPrice, price |
|       3DS PostAuth      |           `/payment/postauth`          | paymentId, currency, basketId, conversationId, paidPrice, price |
| Retrieve Payment Result |            `/payment/detail`           | paymentId, currency, basketId, conversationId, paidPrice, price |

## callbackURL Redirection

|   Services  |                         Parameter Order                        |
| :---------: | :------------------------------------------------------------: |
| callbackURL | conversationData , conversationId, mdStatus, paymentId, status |

## Checkout Form(CF) & PayWithiyzico(PWI) Endpoints

|             Services            |                         Endpoint                        |                                    Parameter Order                                    |
| :-----------------------------: | :-----------------------------------------------------: | :-----------------------------------------------------------------------------------: |
|     CheckoutForm Initialize     |   `/payment/iyzipos/checkoutform/initialize/auth/ecom`  |                                 conversationId, token                                 |
|    Pay with iyzico Initialize   |          `/payment/pay-with-iyzico/initialize`          |                                 conversationId, token                                 |
| CheckoutForm PreAuth Initialize | `/payment/iyzipos/checkoutform/initialize/preauth/ecom` |                                 conversationId, token                                 |
|     Retrieve Payment Result     |     `/payment/iyzipos/checkoutform/auth/ecom/detail`    | paymentStatus, paymentId, currency, basketId, conversationId, paidPrice, price, token |

## Refund Endpoints

|      Services      |       Endpoint       |               Parameter Order              |
| :----------------: | :------------------: | :----------------------------------------: |
|       Refund       |   `/payment/refund`  | paymentId, price, currency, conversationId |
| Amount Base Refund | `/v2/payment/refund` | paymentId, price, currency, conversationId |

## Sample Signature  for Non-3DS Endpoint

In this section, we are going to investigate how to extract `signature` value for a [Non-3DS Endpoints](#non-3ds-endpoints) payment request, `{{baseUrl}}/payment/auth` specifically. Sample covers following steps, relatively;

* Payment Request
* Payment Response
* Signature Comparison

So lets begin with Payment Request;

### Payment Request&#x20;

Assuming you have a full request with the variables `conversationId`, `price`, `paidPrice`, `currency`, and `basketId`, relatively. Our focus will be on these variables for the signature implementation in the `/payment/auth` endpoint.&#x20;

{% hint style="info" %}
If there is a `price` parameter among the parameters that make up the `signature` value, the relevant parameter should be set to trailingZero before the hashString to be encrypted. Please find details below at [Trailing Zero](#trailing-zero) section.
{% endhint %}

```http
POST /payment/auth HTTP/1.1
Host: https://sandbox-api.iyzipay.com
Authorization: IYZWSv2 YOUR_AUTHORIZATION
Content-Type: application/json
{
   ///...
   "conversationId":"conversationId",
   "price":"10.5",
   "paidPrice":"10.5",
   "currency":"TRY",
   "basketId":"basketId",
   ///...
}
```

### Payment Response

Considering that you successfully received a response from the [Payment Request](#payment-request) above, the expected response payload will be as follows:

```json
{
    "status": "success",
    "locale": "tr",
    "systemTime": "...",
    //...
    "conversationId": "conversationId",
    "price": 10.5,
    "paidPrice": 10.5,
    "paymentId": "22416032",
    "currency": "TRY",
    "basketId": "basketId",
    ///...
    "merchantCommissionRate": "...",
    "merchantCommissionRateAmount": "...",
    "iyziCommissionRateAmount": "...",
    "iyziCommissionFee": "...",
    "cardType": "...",
    "cardAssociation": "...",
    ///...
    "itemTransactions": [
        {
            //...
        }
    ],
    ///...
    "signature": "836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173"
}
```

We need to focus on `conversationId`, `price`, `paidPrice`, `paymentId`, `currency`, and `basketId`. Even if the entire response covers multiple details, these are the key elements.

### Signature Comparison

At last, it is time to check if signatures are matching, for this sample we have used;

* `/payment/auth` endpoint
* `/payment/auth` endpoint signature [requires](#non-3ds-endpoints), relatively;
  * `paymentId`&#x20;
  * `currency`&#x20;
  * `basketId`&#x20;
  * `conversationId`&#x20;
  * `paidPrice`&#x20;
  * `price` variables

So lets check if those matches by the HMAC SHA 256 algorithm;

```javascript
function generateResponseSignature(params) {
    var dataToEncrypt = params.join(seperator);
    var encryptedData = CryptoJS.HmacSHA256(dataToEncrypt, secretKey);
    var hashedSignature = CryptoJS.enc.Hex.stringify(encryptedData);
    return data;
}
```

Let's verify if they match using the HMAC-SHA-256 algorithm:

```javascript
Endpoint: /payment/auth

// Merchant Secret Key
var secretKey: sandbox-qaIiLIxhjMgx3LSKIVvp6j17NunHOFtD

// Seperator must be ":"
var seperator: ":"

// Response Parameters
var paymentId: 22416032
var currency: TRY
var basketId: basketId
var conversationId: conversationId
var paidPrice: 10.5
var price: 10.5

function generateResponseSignature(params) {
    var dataToEncrypt = params.join(seperator);
    // dataToEncrypt: 22416032:TRY:basketId:conversationId:10.5:10.5
    
    var encryptedData = CryptoJS.HmacSHA256(dataToEncrypt, secretKey);
    // encryptedData : 836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173
    
    var hashedSignature = CryptoJS.enc.Hex.stringify(encryptedData);
    // hashedSignature : 836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173
    
    return data;
}
```

The `signature` value from response is

* `836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173`&#x20;

hashedSignature value from the method;

* `836c3a6c8db86c81043f2ca74edb13518b54a813f454f8dd762f0dd658610173`&#x20;

Both values are equal, confirming the response from iyzico.

## Trailing Zero

In the context of iyzico's response signature validation refer to zeros that appear after the decimal point in price parameters. These trailing zeros need to be included in the validation process to ensure the accuracy of the HMAC SHA256 signature algorithm. For an instance, a price of `"price":"50.00"` should be treated as `"50"` during signature creation and validation.

For instance, consider the following values received from the service response;

* `"price":"10"` after trailing zeros it should be `10`&#x20;
* `"price":"10.0"` after trailing zeros it should be `10`&#x20;
* `"price":"10.5"` after trailing zeros it should be `10.5`&#x20;
* `"price":"10.50"` after trailing zeros it should be `10.5`&#x20;
* `"price":"10.510"` after trailing zeros it should be `10.51`&#x20;
* `"price":"10.5105"`  after trailing zeros it should be `10.5105`&#x20;
* `"price":"10.51050"`  after trailing zeros it should be `10.5105`

{% hint style="info" %}
Please note that handling trailing zeros is a process that merchants need to address in their codebase before calculating the signature. This function is not directly provided by iyzico.
{% endhint %}
