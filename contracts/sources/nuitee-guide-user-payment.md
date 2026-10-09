---
updatedAt: 2026-07-31T11:19:17.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# 1. User Payment (Nuitee SDK)

Use Nuitee Connect's payment SDK to accept user payment

User payment is used when an application wants to allow its users to pay for their bookings directly using Nuitee Connect's built-in payment SDK. Usually, this payment is with the user’s credit card, but other options, like paying with their Google Pay account, are also available. For information on whether this is the right choice for your use case, review our [Revenue Management and Commission guide](https://docs.liteapi.travel/docs/revenue-management-and-commission).

<Image align="center" width="500px" src="https://files.readme.io/f561c5f-Screenshot_2024-06-04_at_1.55.29_PM.png" />

The first step is to let Nuitee Connect know you plan to allow the user to pay for their booking directly by passing `usePaymentSdk: true` along with the `offerId` during the prebook step.

When you set the `usePaymentSdk` field to `true` during prebook, Nuitee Connect will also return a `secretKey` and `transactionId` along with the response. The Nuitee Connect SDK then uses this key to process the payment. This method handles third-party payment processors in your booking flow.

This method uses frontend javascript to create a secure payment portal for your users. To add this payment portal, you just need to include a reference to the Nuitee Connect payment SDK script:\
`<script src="https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1"></script>`

Load this script and pass in the configuration after calling the prebook endpoint. It should look something like this:

```coffeescript HTML
<html>
  <head>
    <title>Prebook Response</title>
    <script src="https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1"></script>
    <script>
      var liteAPIConfig = {
        publicKey: 'live', //or sandbox for use with a sandbox API key
        appearance: {
          theme: 'flat',
        },
        options: {
          business: {
            name: 'Nuitee Connect',
          },
        },
        targetElement: '#targetElement',
        secretKey: 'pi_3PMY53A4FXPoRk9Y0O7lKP0d_secret_oxPGV4comgzkYDuT2jnr7ZEfo',
        returnUrl: 'https://my.app.travel/Booking/?tid=tr_ct_Tyf0s1wik4-h1cQwmLrGP&pid=VgDuVrk2F',
      };
    var liteAPIPayment = new LiteAPIPayment(liteAPIConfig);
    liteAPIPayment.handlePayment();
    </script>
  </head>
  <body>
    <h1>Prebook Response for Rate: ${rateId}</h1>
    <main>
        <div id="targetElement"></div>
    </main>
	</body>
</html>
```

The target element will be replaced with a payment processor portal when done correctly. The end result will be a form that looks like this:

<Image align="center" src="https://files.readme.io/f561c5f-Screenshot_2024-06-04_at_1.55.29_PM.png" />

Four things to remember about the payment SDK.

1. The publicKey is the environment you are using, and must match your API key’s environment.
   1. For Production set `publicKey: "live"`
   2. For Sandbox  set `publicKey: "sandbox"`
2. The `secretKey` must be the same `secretKey` returned from the prebook API call.
3. Record the `transactionId` and the `prebookId` as they are needed for the next step.
4. . The `returnURL` must be set to the destination where that booking endpoint call will be made. Once the payment is confirmed, the user is sent to the `returnURL` where the last API call can be made To finalize the reservation.

⭐Note: For sandbox bookings use test card `4242424242424242` any three digits for cvv and any future expiration date.

Once the payment call is successful, the user will be redirected to the `returnURL`. There, you can gather the remaining information and book the room using the [Hotel rate book endpoint](https://docs.liteapi.travel/reference/post_rates-book). You will use the `transactionId` and the `prebookId` from the prebook step.

⭐Note: Each call to prebook generates a new `transactionId` and `prebookId`, so it is important that you save the `transactionId` sent to the payment SDK and its corresponding `prebookId` as you will not be able to get them back. In the case of a lost booking, the payment hold will stay for 1-2 business days before being released when the booking is not finalized.

You need the guest information to finalize the booking after successfully using the payment SDK. Let the customer know that the payment was successful, and they need only finalize their guest's details (First Name, Last Name, Email) to complete the process.

Once the guest details are collected, it is time to send them, along with the data you kept from the prebook step, to the Hotel rate book endpoint. Pass along the `prebookId` and set the payment object `method` to `TRANSACTION_ID` and the payment object `transactionId` to the `transactionId` from the prebook step.

The finalized payload should look similar to this:

```coffeescript CURL REQUEST
curl --request POST \
     --url https://book.liteapi.travel/v2.0/rates/book \
     --header 'X-API-Key: sand_c0155ab8-c683-4f26-8f94-b5e92c5797b9' \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data '
{
  "prebookId": "xZFwjDyps",
  "holder": {
    "firstName": "John",
    "lastName": "A Richards",
    "email": "JRastaban@gmail.com"
  },
  "payment": {
    "method": "TRANSACTION_ID",
    "transactionId": "tr_ct_K5NdYC5eG-o4x66FhghMR"
  },
  "guests": [
    {
      "occupancyNumber": 1,
      "remarks": "quiet room please",
      "firstName": "Sunny",
      "lastName": "Mars",
      "email": "s.mars@liteapi.travel"
    }
  ]
}
'
```

Once this operation is complete, the booking will show in your dashboard under bookings.

<Image align="center" src="https://files.readme.io/429ca97-Screenshot_2024-06-05_at_9.57.34_AM.png" />

⭐Note: At this point, the API will return the confirmed booking information. In addition to displaying key information to the customer on this success page, it is usually best to email them a copy for their records and to reference later.