---
updatedAt: 2026-10-07T13:20:38.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Async Confirmation & Webhooks

After a successful `POST /v3.0/experiences/bookings`, the booking is often **not** fully confirmed yet. Connect commonly returns `PENDING_CONFIRMATION`. Final confirmation and vouchers arrive asynchronously.

## Booking status lifecycle

| Status                   | Meaning                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `PENDING_CONFIRMATION`   | Payment captured and booking accepted; waiting on confirmation |
| `CONFIRMED`              | Booking confirmed                                              |
| `FAILED`                 | Booking failed                                                 |
| `CANCELLATION_REQUESTED` | Cancel accepted; final cancel / refund may still be pending    |
| `CANCELLED`              | Cancelled                                                      |

Treat book response `PENDING_CONFIRMATION` as success for payment + accept — then wait for confirmation.

***

## How to learn the final state

### Option A — Poll

```http
GET /v3.0/experiences/bookings/{bookingId}
```

Poll until `status` is `CONFIRMED` (or `FAILED` / `CANCELLED`). Voucher fields appear when available.

### Option B — Partner webhooks (recommended)

Subscribe to Experiences events on your Nuitee Connect partner webhook endpoint.

| Event                                  | When                                   |
| -------------------------------------- | -------------------------------------- |
| `experience.book.pending.confirmation` | Book accepted (`PENDING_CONFIRMATION`) |
| `experience.book.confirmed`            | Confirmed                              |
| `experience.book.voucher.available`    | Voucher / ticket ready                 |
| `experience.book.updated.datetime`     | Datetime changed                       |
| `experience.book.updated.price`        | Price updated                          |
| `experience.book.cancelled`            | Cancelled                              |
| `experience.book.failed`               | Failed                                 |

Configure which event types your endpoint receives in dashboard / webhook settings.

***

## Important rules

1. Do **not** treat the book HTTP 200 alone as “voucher ready.”
2. Prefer webhooks for voucher delivery; poll as a fallback.
3. If book returns **502** after payment capture, expect failure handling / refund — surface an error to the guest.
4. Design confirmation UI for a short “confirming your booking” state.

***

## UX recommendations

* After book: “We’re confirming your experience…”
* On `CONFIRMED`: show voucher / reference and send email
* On `FAILED`: apologize and show support path; do not show a voucher

***

## Next

* [Build an Experiences Booking Experience](https://docs.liteapi.travel/docs/build-an-experiences-booking-flow)
* [Booking Flow Recipes](https://docs.liteapi.travel/docs/experiences-booking-flow-recipes)
* [Cancel & Refunds](https://docs.liteapi.travel/docs/experiences-cancel-refunds)

<br />