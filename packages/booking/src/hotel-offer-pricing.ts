import type { HotelOffer } from '@texholiday/contracts';
import { PricingPolicyError, computeSellPrice, toJson, type Money, type MoneyJson, type PricingPolicyVersion } from '@texholiday/pricing';

/** Payment type of the Nuitee payment SDK on an offer; offers without it cannot be paid online through Nuitee. */
export const PROVIDER_PAYMENT_TYPE = 'NUITEE_PAY';

export interface StoredOffer {
  key: string;
  hotelId: string;
  offerRef: string;
  price: MoneyJson;
  commission: MoneyJson;
  sell: MoneyJson;
  payAtProperty: MoneyJson[];
  cancellation: { timezone: string; refundable: boolean; steps: Array<{ from: string; penalty: MoneyJson }>; providerText: string | null };
  occupancyNumbers: number[];
  room: { name: string | null; boardType: string | null; boardName: string | null };
  /** Rate parity record (ADR-0009): the hotel's suggested selling price and whether our price is below it. */
  rateParity: { suggestedSellingPrice: MoneyJson | null; belowSuggestedPrice: boolean };
}

export interface HiddenOffers {
  belowSuggestedPrice: number;
  notPriced: number;
  notPayableOnline: number;
}

/**
 * One customer price per offer: the provider price with our policy margin, checked against the hotel's public floor.
 * The hotel search and the hotel list pages (ADR-0014) both price through this function, so a list price is the price
 * the search showed for the same criteria at that moment.
 */
export function priceHotelOffer(
  offer: HotelOffer,
  policy: PricingPolicyVersion,
  ctx: { supportsApiMargin: boolean; enforceRateParity: boolean },
  hidden: HiddenOffers,
): Omit<StoredOffer, 'key'> | null {
  if (!offer.paymentTypes.includes(PROVIDER_PAYMENT_TYPE)) {
    hidden.notPayableOnline += 1;
    return null;
  }
  let sell: Money;
  try {
    sell = computeSellPrice({
      productType: 'HOTEL',
      paymentMode: 'PROVIDER_MANAGED',
      providerPrice: offer.price,
      providerAppliedMargin: offer.providerAppliedMargin,
      providerSupportsApiMargin: ctx.supportsApiMargin,
      policy,
    }).sell;
  } catch (err) {
    if (!(err instanceof PricingPolicyError)) throw err;
    hidden.notPriced += 1;
    return null;
  }
  // Rate parity: with the provider collecting the payment we cannot raise the price to the hotel's suggested
  // selling price. Below-SSP offers are hidden unless the approved policy says to show them (ADR-0009); either
  // way the comparison is recorded on the offer and, once selected, on the quote.
  const ssp = offer.suggestedSellingPrice;
  const belowSuggestedPrice = ssp !== null && (ssp.currency !== sell.currency || sell.minor < ssp.minor);
  if (belowSuggestedPrice && ctx.enforceRateParity && policy.allowBelowSspProviderManaged !== true) {
    hidden.belowSuggestedPrice += 1;
    return null;
  }
  return {
    hotelId: offer.hotelId,
    offerRef: offer.offerRef,
    price: toJson(offer.price),
    commission: toJson(offer.providerAppliedMargin),
    sell: toJson(sell),
    payAtProperty: offer.payAtProperty.map(toJson),
    cancellation: { ...offer.cancellation, steps: offer.cancellation.steps.map((s) => ({ from: s.from, penalty: toJson(s.penalty) })) },
    occupancyNumbers: [...offer.occupancyNumbers],
    room: offer.room,
    rateParity: { suggestedSellingPrice: ssp ? toJson(ssp) : null, belowSuggestedPrice },
  };
}
