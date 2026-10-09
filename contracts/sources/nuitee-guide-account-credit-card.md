---
updatedAt: 2026-06-18T14:30:39.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# 2. Account Credit Card

Pay directly from the account’s credit card.

To use this method, set the payment `method` at booking to `ACC_CREDIT_CARD`.

<Image align="center" width="300px" src="https://files.readme.io/996fd04-image.png" />

With the `ACC_CREDIT_CARD` method, users pay directly from their account’s credit card. Payments are processed immediately through the attached credit card. This method is typically used when an organization wants to be the merchant of record and when bundling products. In these cases the application is responsible for implementing its own payment layer for its clients to interact with.

**Use Case:**\
For example, an organization offers tours and charges a $100 tour fee. We will imagine that the hotel room costs $145 for one night, and the organization decides to bundle the room and tour fee together. They would add the $100 tour fee to the hotel room rate, making the total $245. This total amount is passed to their chosen payment gateway. The client would then see the bundled cost of $245. Payment is first handled by the application’s payment provider, ensuring the organization receives the full $245 payment. The application would then confirm the payment and use the Nuitee Connect booking endpoint with their `ACC_CREDIT_CARD` method to book the $145 hotel room while pocketing the $100 tour fee.

⭐️ NOTE: Each sandbox key is attached to a hidden testing `ACC_CREDIT_CARD`, allowing use of this option even without an attached credit card. The real account credit card is only attached to the production key.