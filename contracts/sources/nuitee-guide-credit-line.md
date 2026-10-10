---
updatedAt: 2026-08-04T22:34:17.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# 3. Credit Line Payments

This method is used when you have contracted a credit line

Technically, this is the easiest method to use, but requires a credit line contract and a separate payment remediation process. To use this method, set the payment `method` at booking to `CREDIT`.

<Image alt="Previously, this was NONE, which still works for backward compatibility, but CREDIT is recommended for clarity." align="center" width="500px" src="https://files.readme.io/5435206aa0b63fdc386091797ba5ccefe915756ed3a58a16ef7421f024991bda-Screenshot_2025-03-13_at_4.21.39_PM.png">
  Previously, this was NONE, which still works for backward compatibility, but CREDIT is recommended for clarity.
</Image>

That's the only step; the booking will be confirmed and then show up on your credit line for billing purposes.

⭐️ Note: The `CREDIT` method only works once you have a credit line contract with Nuitee Connect. The booking will fail if no credit line has been configured for you account. This method does not work in sandbox mode, and all bookings made via the `CREDIT` method are real bookings. This means you should only book refundable rates while testing this implementation and then cancel them to avoid charges on the credit line.

If you are interested in a credit line, please [contact us](https://www.liteapi.travel/contact/). This process usually involves a credit check and/or a deposit to cover the credit line. This is mainly used when you want to be the merchant of record.