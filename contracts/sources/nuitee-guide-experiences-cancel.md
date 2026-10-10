---
updatedAt: 2026-10-07T13:20:38.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Cancel & Refunds

Cancel an Experiences booking with a refund quote first, then confirm cancel. Refund amounts match what was charged at booking.

## 1. Cancel preview

```http
GET /v3.0/experiences/bookings/{bookingId}/cancel-preview
```

Example:

```json
{
  "data": {
    "bookingId": "tJHcT_KHA",
    "cancellable": true,
    "policy": {
      "cancellationFee": 0,
      "refundAmount": 101.25,
      "refundType": "FULL",
      "estimateConfidence": "HIGH",
      "currency": "EUR",
      "sellingPrice": 101.25
    }
  }
}
```

Show `refundAmount` / `cancellationFee` before the guest confirms cancel.

## 2. Cancel

```http
POST /v3.0/experiences/bookings/{bookingId}/cancel
```

### Possible outcomes

| `status`                 | Meaning                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `CANCELLATION_REQUESTED` | Cancel accepted; final cancel / refund may still be pending (`refundPending: true`) |
| `CANCELLED`              | Cancel completed                                                                    |

## 3. After cancel

* Poll `GET /v3.0/experiences/bookings/{bookingId}` until `CANCELLED`, **or**
* Listen for `experience.book.cancelled`

Refunds may complete after the cancel request returns. Treat `CANCELLATION_REQUESTED` as success for the cancel action, not as “money already returned.”

***

## Errors

| HTTP    | Typical case                           |
| ------- | -------------------------------------- |
| **400** | Booking already cancelled              |
| **404** | Unknown `bookingId`                    |
| **502** | Temporary failure — retry with backoff |

***

## Best practices

1. Always call **cancel-preview** before cancel in guest UIs
2. Be explicit about pending refunds when `refundPending` is true
3. Use webhooks / polling for final `CANCELLED`

***

## Next

* [Async Confirmation & Webhooks](https://docs.liteapi.travel/docs/experiences-async-confirmation-webhooks)
* [Experiences Pricing](https://docs.liteapi.travel/docs/experiences-pricing)
* [API Reference](https://docs.liteapi.travel/docs/experiences-reference)

<br />