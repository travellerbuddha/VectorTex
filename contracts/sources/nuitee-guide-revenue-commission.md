---
updatedAt: 2026-08-11T15:52:28.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# Revenue Management and Commission

In the competitive landscape of hotel sales, effective revenue management is not just about setting prices—it’s about making strategic decisions that maximize profitability while staying compliant with hotel partner agreements. At your disposal are the `margin`  and `additionalMarkup` parameters within the [rates endpoint](https://docs.liteapi.travel/reference/post_hotels-rates), which allow you to adjust your commission on each booking dynamically.

However, with this flexibility comes responsibility. Understanding the suggested selling price (SSP) hotels provide is crucial, as selling below the SSP in public domains can lead to rate violations. These violations can harm your relationships with hotel partners and limit your access to future rates. To avoid these pitfalls, it’s essential to consider whether your sales channel should operate as a public-facing platform or as a closed user group.

This guide covers margins, SSP compliance, and when to use closed user groups so you can price competitively without rate violations.

## Key Concepts

**Rate Violations:** Rate violations occur when a seller offers a hotel room at a price lower than the suggested selling price (SSP) in a public forum. Hotels establish SSPs to protect their brand integrity and ensure price consistency across different sales channels. Violating these pricing guidelines can lead to penalties, strained relationships with hotel partners, or even loss of access to future rates. It’s essential to respect SSPs to maintain trust and ongoing collaboration with hotels.

**Closed User Groups (CUGs):** Closed User Groups (CUGs) allow you to offer discounted rates below the SSP without risking rate violations. You can maintain compliance with hotel pricing rules by limiting access to these lower rates to members of a specific group, such as app users or logged-in customers. CUGs allow you to provide attractive offers to loyal customers or specific segments while keeping these special rates out of the public eye, thereby protecting your revenue strategy and partnership agreements.

## Who is the Merchant of Record?

**Nuitee Connect as the Merchant of Record:** When you use Nuitee Connect as the merchant of record through our payment SDK or Whitelabel, you streamline the booking process by allowing us to handle the payment transactions on your behalf. In this scenario, you can dynamically adjust your commission by setting the “margin” parameter, which directly impacts the final selling price to the customer. This method is particularly advantageous for sellers looking to maintain flexibility in their pricing strategy while ensuring compliance with hotel rate guidelines. By letting Nuitee Connect manage the payment process, you benefit from reduced administrative overhead and can focus on optimizing your revenue through strategic margin management.

**You as the Merchant of Record:** Alternatively, if you choose to be the merchant of record, you gain full control over the pricing and bundling of your services. In this setup, you work with net rates (`”margin”: 0`), applying your commission via an alternate payment method, such as through a separate service fee or by bundling the room with other travel-related services like tours or car rentals. This approach allows for greater customization and the opportunity to create unique value propositions for your customers. However, it also requires you to manage the payment process and ensure that your overall pricing strategy remains competitive and compliant with any SSP requirements from hotel partners.

## Earning Money with Nuitee Connect

You earn on each booking via a commissionable rate (`margin`) or by applying your own revenue model on top of net rates. You set the margin; there are no hidden platform fees on that commission. Payouts for confirmed bookings go out weekly.

### Booking Confirmation

A booking is confirmed when a guest completes their stay and checks out of the hotel. Once this happens, your commission will be locked in and included in the next weekly payout. This straightforward process ensures that you receive your earnings promptly, providing financial consistency and reliability.

## Setting your default markup percentage

To set the default margin you will navigate to the commission section in the sidebar. Here, you can increase the account's default Markup. A 0 means net rates; any other value is a commissionable rate, where you earn commission on each booking. You will see an example of the markup you choose.

<Image src="https://files.readme.io/0b22d022cc3624a22ce434abcd99bae3ecdeb256b2e08e17c9813a164cc7fe96-SCR-20251203-sjby.png" align="center" border={true} />

This static default markup will be passed with each rate call and used for attached White Label environments. For dynamic markup, we have two parameters that can be used to adjust markup on the fly.

## Using the "Margin" and "additionalMarkup"  to dynamically adjust rate margin

The `margin` and `additionalMarkup` parameters of the rates endpoint allow sellers (you) to specify a markup or additional markup they wish to earn on each booking.

### What "Margin" Does:

The `margin` parameter is a value representing the percentage commission that the seller earns on each booking. When no value is passed, the default value in your account settings is used. It does support decimals if needed.

**Example:** A margin of `0` returns a net rate, meaning no commission is earned. A margin of `15` adds 15% to the rate, which the seller then earns as a commission.

### How to Use It:

**Setting the Margin (15% Commission)**: Include the "margin" parameter in your API request to specify the desired commission.

```json
{
  "occupancies": [
    {
      "adults": 2
    }
  ],
  "currency": "USD",
  "guestNationality": "US",
  "checkin": "2025-12-30",
  "checkout": "2025-12-31",
  "hotelIds": [
    "lp1897"
  ],
  "margin": 15
}
```

**Net Rate (No Commission)**: Set the margin to `0` if you want to offer the rate without any added commission.

```json
{
  "occupancies": [
    {
      "adults": 2
    }
  ],
  "currency": "USD",
  "guestNationality": "US",
  "checkin": "2025-12-30",
  "checkout": "2025-12-31",
  "hotelIds": [
    "lp1897"
  ],
  "margin": 0
}
```

### Why It’s Useful:

This flexibility allows sellers to control their pricing strategy, either using net rates with other monetization strategies or adding a competitive margin to generate revenue.

### What "additionalMarkup" Does:

The `additionalMarkup` parameter, like `margin` is an integer value representing a percentage of markup; in this case, the markup is added to the default markup rather than overriding it. The total amount is what the seller (you) earns on each booking. When no value is passed, no additional markup is added.

**Example:** A margin of `0` returns a net rate, meaning no commission is earned. A margin of `15` adds 15% to the rate, which the seller then earns as a commission.

### How to Use It:

**Setting an additional markup (15%+ Commission)**: Include the "additional markup" parameter in your API request to increase the desired markup by 15%. That is a 15% of the net rate, not on top of the additional markup.

```json
{
  "occupancies": [
    {
      "adults": 2
    }
  ],
  "currency": "USD",
  "guestNationality": "US",
  "checkin": "2025-12-30",
  "checkout": "2025-12-31",
  "hotelIds": [
    "lp1897"
  ],
  "additionalMarkup": 15
}
```

In this example, if the room's net rate was $100 and the default markup was set to 10%, the total markup would be the default 10% + the 15% additional markup for a total of 25% markup. This example gives a final rate of $125.

## Understanding the `suggestedSellingPrice` (SSP)

### What Is SSP?

The `suggestedSellingPrice` (SSP) is the rate provided by the hotel as the recommended minimum selling price. This acts as a benchmark for sellers.<br />**Purpose:** The SSP is essentially the hotel's guidance on the minimum rate they expect the room to be sold at.<br />Pricing Strategies:<br />**Selling at or Above SSP:** You can freely sell at the SSP or above it in any public-facing platform, such as a website or public app.<br />**Selling Below SSP:** If you choose to sell below the SSP, this must not be done in a public-facing way. This could include:

* Offering lower rates on a mobile app where users must download the app.
* Providing discounts to logged-in users only, ensuring that these lower rates are not accessible to the general public.
* Bundling these rates with other goods and services, like airfares or tours.

### Key Considerations:

**Compliance:** Always ensure that your selling practices align with the SSP guidelines to avoid potential issues with hotel partners.<br />**Flexibility:** The ability to adjust pricing while considering the SSP allows you to optimize your revenue while remaining competitive.

### Practical Example

Suppose a room has a base rate of $100 (retailRate:total) and an SSP of $115 for a hotel room. Here’s how you might use the "margin" parameter:

**Net Rate (No Commission):**

* Request: `{ "margin": 0 }`
* Result: You sell the room at $100, earning no commission. Usually, net rates are used when you are the merchant of record, applying commission via an alternate method or bundling the room with other services.

**Discounted Rate (5% Commission):**

* Request: `{ "margin": 5 }`
* Result: You sell the room at $105, earning a $5 commission. This might be used for a CUG where members get discounted bookings.

**Suggested Rate (15% Commission):**

* Request: `{ "margin": 15 }`
* Result: The selling price becomes $115. You earn $15 as a commission. This rate can be sold publicly on a website.

⭐️ Note: If you offer a room below SSP, ensure that this rate is not publicly accessible (e.g., behind a login wall or in an exclusive app).

## Conclusion

The "margin" parameter offers control over your pricing strategy, allowing you to set commissions while adhering to the hotel's SSP guidelines. Understanding how to use this feature effectively allows you to maximize your revenue opportunities and maintain strong relationships with hotel partners.