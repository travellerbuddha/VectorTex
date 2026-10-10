---
updatedAt: 2026-10-07T13:20:38.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Pricing

This guide covers how to handle prices in the Experiences booking flow so guests are charged the amount you displayed.

## What to use

| Step                             | Amount to use                                               |
| -------------------------------- | ----------------------------------------------------------- |
| Display from booking-options     | Chosen slot `pricing.totals.net` or `priceSummary.netPrice` |
| Prebook `selection.price.amount` | **Same** slot total                                         |
| Charged amount / refunds         | Booking `price`                                             |

Always refresh booking-options if the guest changes date, option, or participants, then pass that new total into prebook. A different amount returns error **2015** (price mismatch).

***

## Booking-options fields

On each available slot you typically see:

* `unitNet` / `totalNet` — line totals for the participant mix
* `totals.net` / `priceSummary.netPrice` — total to charge for that slot

Field names may include `Net` for historical reasons; treat these values as the **price to charge** in Connect.

`options[].price.amount` reflects the lowest available slot total for the requested mix. Checkout must still use the **chosen slot** `totals.net`.

***

## Book / GET booking

* `price` — amount charged for the booking
* Use this value (and cancel-preview amounts) when explaining charges or refunds to guests

***

## UX recommendations

**Price increased after refresh (2015):**

* Explain that availability or price changed
* Re-run booking-options and show the new total
* Require the guest to continue with the new price or go back

**What not to do:**

* Do not invent or round to a different checkout total
* Do not reuse a price from an earlier date or participant mix

***

## Related errors

| Code   | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| `2015` | Price mismatch — refresh booking-options and retry prebook |
| `2016` | Selection rejected (availability, questions, or price)     |

***

## Next

* [Build an Experiences Booking Experience](https://docs.liteapi.travel/docs/build-an-experiences-booking-flow)
* [Booking Flow Recipes](https://docs.liteapi.travel/docs/experiences-booking-flow-recipes)
* [Cancel & Refunds](https://docs.liteapi.travel/docs/experiences-cancel-refunds)

<br />