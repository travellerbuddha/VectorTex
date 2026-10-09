---
updatedAt: 2026-04-24T08:36:00.000Z
agentTools:
  projectIndex: https://docs.liteapi.travel/llms.txt
---

# 1.2 Attach services to prebook (Optional)

## Overview

Add ancillary services such as seat selection or extra baggage to an existing prebook before confirming the final booking.

## When to Use

- **Seat selection** - Allow users to choose specific seats after prebook
- **Extra baggage** - Let users add additional luggage allowance
- **Price update** - Required when services change the total booking cost
- **Voucher discount** - Optional `voucherCode` when attaching services changes the total and you need the discount reflected on the new payment intent

## What You Get

- **Updated prebook** with the selected services attached
- **New payment intent** (`transactionId`, `secretKey`) reflecting the updated total price (after any voucher discount)
- **Same response format** as `POST /flights/prebooks` for easy integration

## Key Features

- **Seat selection**: Assign specific seats to each passenger and segment
- **Extra baggage**: Add checked baggage or overweight allowances
- **Updated payment**: Creates a new Stripe payment intent when the prebook used Stripe (`usePaymentSdk: true`). For whitelabel/CMI prebooks (`used_custom_payment_keys`), no new intent is returned — re-charge via WL and submit a fresh JWT at `POST /flights/bookings`
- **Voucher recalculation**: When a voucher applies, the discount is recomputed against the updated total (journey + ancillaries); invalid or expired vouchers return `400` (same as prebook)
- **Modifies in place**: Updates the existing prebook record in the database

## Quick Start

Provide the `prebookId` in the URL path and `selectedServices` in the request body. Optionally pass `voucherCode` to apply a discount. Use the **new** `transactionId` from this response (not the original prebook `transactionId`) when confirming payment with Stripe and when calling `POST /flights/bookings`.

# OpenAPI definition

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "API: Flights",
    "version": "3.0.0",
    "description": "The Flights API provides endpoints for searching flights, managing bookings, and accessing static flight data including airlines and airports."
  },
  "servers": [
    {
      "url": "https://api.liteapi.travel/v3.0"
    }
  ],
  "security": [
    {
      "apikeyAuth": []
    }
  ],
  "components": {
    "securitySchemes": {
      "apikeyAuth": {
        "name": "X-API-Key",
        "type": "apiKey",
        "in": "header"
      }
    },
    "schemas": {
      "FlightSegment": {
        "type": "object",
        "properties": {
          "arrivalTime": {
            "type": "string",
            "description": "Arrival time (ISO 8601)"
          },
          "carrier": {
            "type": "object",
            "properties": {
              "marketingCode": {
                "type": "string",
                "description": "Marketing carrier IATA code"
              },
              "marketingLogo": {
                "type": "string",
                "description": "Marketing carrier logo path/URL"
              },
              "marketingName": {
                "type": "string",
                "description": "Marketing carrier name"
              },
              "operatingCode": {
                "type": "string",
                "description": "Operating carrier IATA code"
              },
              "operatingLogo": {
                "type": "string",
                "description": "Operating carrier logo path/URL"
              },
              "operatingName": {
                "type": "string",
                "description": "Operating carrier name"
              }
            },
            "description": "Marketing and operating carrier details for this segment"
          },
          "departureTime": {
            "type": "string",
            "description": "Departure time (ISO 8601)"
          },
          "destinationCode": {
            "type": "string",
            "description": "Destination IATA code"
          },
          "direction": {
            "type": "string",
            "description": "OUTBOUND or INBOUND"
          },
          "duration": {
            "type": "object",
            "properties": {
              "iso8601": {
                "type": "string",
                "description": "Duration in ISO 8601 format (e.g. PT7H45M)"
              },
              "minutes": {
                "type": "integer",
                "description": "Duration in minutes"
              }
            },
            "description": "Flight duration in ISO 8601 and minutes"
          },
          "flight": {
            "type": "object",
            "properties": {
              "marketingNumber": {
                "type": "string",
                "description": "Flight number as marketed to passengers"
              },
              "operatingNumber": {
                "type": "string",
                "description": "Flight number as operated by the carrier"
              }
            },
            "description": "Marketing and operating flight numbers"
          },
          "originCode": {
            "type": "string",
            "description": "Origin IATA code"
          },
          "originName": {
            "type": "string",
            "description": "Full name of the origin airport"
          },
          "destinationName": {
            "type": "string",
            "description": "Full name of the destination airport"
          },
          "segmentKey": {
            "type": "string",
            "description": "Unique identifier for this segment, used to link with offers, fares, and amenities"
          },
          "stopCount": {
            "type": "integer",
            "description": "Number of en-route (technical) stops inside this segment. 0 means the segment is genuinely non-stop. A technical stop keeps the same flight number and aircraft (no plane change, no bag re-check) but adds ground time, so a one-segment journey can still have stops."
          },
          "stops": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/FlightSegmentStop"
            },
            "description": "En-route (technical) stops inside this segment, in travel order. Omitted when stopCount is 0."
          }
        },
        "description": "A single flight segment (one flight number) within a journey. May contain en-route technical stops (see stopCount / stops)."
      },
      "FlightSegmentStop": {
        "type": "object",
        "properties": {
          "airportCode": {
            "type": "string",
            "description": "IATA code of the airport where the aircraft lands for the technical stop"
          },
          "airportName": {
            "type": "string",
            "description": "Full name of the stop airport"
          },
          "arrivalTime": {
            "type": "string",
            "description": "Local arrival time at the stop airport (ISO 8601)"
          },
          "departureTime": {
            "type": "string",
            "description": "Local departure time from the stop airport (ISO 8601)"
          },
          "duration": {
            "type": "object",
            "properties": {
              "iso8601": {
                "type": "string",
                "description": "Ground time in ISO 8601 format (e.g. PT50M)"
              },
              "minutes": {
                "type": "integer",
                "description": "Ground time in minutes"
              }
            },
            "description": "Time spent on the ground at the stop airport"
          }
        },
        "description": "An en-route (technical) stop within a single segment. Unlike a connection between segments, passengers stay on the same flight number: no plane change and no bag re-check.",
        "example": {
          "airportCode": "GIG",
          "airportName": "Rio Galeão – Tom Jobim International Airport",
          "arrivalTime": "2026-10-17T18:35:00",
          "departureTime": "2026-10-17T19:25:00",
          "duration": {
            "iso8601": "PT50M",
            "minutes": 50
          }
        }
      },
      "FlightPrice": {
        "type": "object",
        "properties": {
          "base": {
            "type": "number",
            "description": "Base fare amount as returned by the supplier (before taxes and fees). Never includes the partner markup."
          },
          "currency": {
            "type": "string",
            "description": "ISO 4217 currency code"
          },
          "fees": {
            "type": "number",
            "description": "Supplier service fees and surcharges plus, when the account passes them to the customer, the LiteAPI platform fees itemised in platformFees. Never includes the partner markup."
          },
          "taxes": {
            "type": "number",
            "description": "Total airline / government taxes applied to the fare, as returned by the supplier. Never includes the partner markup."
          },
          "total": {
            "type": "number",
            "description": "Total selling price, including the partner markup and, when present, platformFees.total. Because base and taxes are supplier values, total may exceed base + taxes + fees when a markup is configured."
          },
          "platformFees": {
            "type": "object",
            "description": "LiteAPI platform fees included in total and fees. Present only when the account passes the fees to the customer. Booking-level amounts (not distributed over perPassenger).",
            "properties": {
              "merchantOfRecord": {
                "type": "number",
                "description": "Merchant-of-record fee: percentage of the full transaction value, charged when LiteAPI collects the payment (Payment SDK / third-party). Removed at book time for credit-line and CREDIT_CARD settlements."
              },
              "ticketing": {
                "type": "number",
                "description": "Ticketing fee: percentage of the net fare with a floor and ceiling, per booking or per passenger depending on the account configuration. Applies to every payment method."
              },
              "total": {
                "type": "number",
                "description": "merchantOfRecord + ticketing"
              }
            }
          },
          "perPassenger": {
            "type": "object",
            "properties": {
              "adult": {
                "type": "object",
                "properties": {
                  "base": {
                    "type": "number",
                    "description": "Base fare for this passenger type"
                  },
                  "currency": {
                    "type": "string",
                    "description": "ISO 4217 currency code"
                  },
                  "fees": {
                    "type": "number",
                    "description": "Fees for this passenger type"
                  },
                  "taxes": {
                    "type": "number",
                    "description": "Taxes for this passenger type (supplier amount, excludes markup)"
                  },
                  "total": {
                    "type": "number",
                    "description": "Total selling price for this passenger type, including the partner markup (may exceed base + taxes + fees)"
                  }
                },
                "description": "Price breakdown for each adult passenger"
              },
              "child": {
                "type": "object",
                "properties": {
                  "base": {
                    "type": "number",
                    "description": "Base fare for this passenger type"
                  },
                  "currency": {
                    "type": "string",
                    "description": "ISO 4217 currency code"
                  },
                  "fees": {
                    "type": "number",
                    "description": "Fees for this passenger type"
                  },
                  "taxes": {
                    "type": "number",
                    "description": "Taxes for this passenger type (supplier amount, excludes markup)"
                  },
                  "total": {
                    "type": "number",
                    "description": "Total selling price for this passenger type, including the partner markup (may exceed base + taxes + fees)"
                  }
                },
                "description": "Price breakdown for each child passenger"
              },
              "infant": {
                "type": "object",
                "properties": {
                  "base": {
                    "type": "number",
                    "description": "Base fare for this passenger type"
                  },
                  "currency": {
                    "type": "string",
                    "description": "ISO 4217 currency code"
                  },
                  "fees": {
                    "type": "number",
                    "description": "Fees for this passenger type"
                  },
                  "taxes": {
                    "type": "number",
                    "description": "Taxes for this passenger type (supplier amount, excludes markup)"
                  },
                  "total": {
                    "type": "number",
                    "description": "Total selling price for this passenger type, including the partner markup (may exceed base + taxes + fees)"
                  }
                },
                "description": "Price breakdown for each infant passenger"
              }
            },
            "description": "Price breakdown per passenger type"
          }
        },
        "description": "Full price breakdown including supplier base fare, taxes and fees, and per-passenger amounts. base, taxes and fees are always the supplier values and never include the partner markup; only total carries it, so total may exceed base + taxes + fees. The markup amount itself is not exposed."
      },
      "FlightMoneyAmount": {
        "type": "object",
        "properties": {
          "amount": {
            "type": "number",
            "description": "Monetary amount"
          },
          "currency": {
            "type": "string",
            "description": "ISO 4217 currency code"
          }
        },
        "description": "A monetary amount with currency"
      },
      "FlightItemPricing": {
        "type": "object",
        "properties": {
          "display": {
            "$ref": "#/components/schemas/FlightMoneyAmount",
            "description": "Customer-facing amount (converted to search currency if applicable)"
          },
          "converted": {
            "type": "boolean",
            "description": "True if FX currency conversion was applied"
          }
        },
        "description": "Pricing for an ancillary item (e.g. baggage)"
      },
      "FlightBookedService": {
        "type": "object",
        "description": "Ancillary service (seat, baggage, etc.) that has been attached to a booking and confirmed by the provider. Returned under booking.bookedServices after /services or /bookings.",
        "required": [
          "serviceId",
          "pricing"
        ],
        "properties": {
          "serviceId": {
            "type": "string",
            "description": "Encoded service identifier (carries provider serviceId, post-margin price, currency, category)"
          },
          "name": {
            "type": "string",
            "description": "Human-readable service name (e.g. 'Seat 1A')"
          },
          "category": {
            "type": "string",
            "description": "Service category (e.g. 'seat', 'baggage')"
          },
          "passengerType": {
            "type": "string",
            "description": "Applicable passenger type (ALL, ADT, CHD, INF)"
          },
          "passengerIndex": {
            "type": "integer",
            "description": "Index of the passenger this service applies to (0-based; matches the passengers[] array)"
          },
          "segmentKey": {
            "type": "string",
            "description": "The flight segment this service applies to (matches journey.segments[].segmentKey)"
          },
          "quantity": {
            "type": "integer",
            "description": "Number of units booked"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time",
            "description": "UTC timestamp when the provider attached the service"
          },
          "phase": {
            "type": "string",
            "description": "Provider phase, e.g. 'post_booking'"
          },
          "status": {
            "type": "string",
            "description": "Provider status of this service, e.g. 'pending', 'confirmed'"
          },
          "pricing": {
            "$ref": "#/components/schemas/FlightItemPricing",
            "description": "Customer-facing price for this service (post-margin)"
          },
          "metadata": {
            "type": "object",
            "description": "Category-specific metadata. Contains exactly one of `seat` (when category is 'seat') or `baggage` (when category is 'baggage').",
            "properties": {
              "seat": {
                "type": "object",
                "description": "Seat details — present only when category is 'seat'",
                "properties": {
                  "available": {
                    "type": "boolean",
                    "description": "Whether this seat is currently available"
                  },
                  "position": {
                    "type": "string",
                    "description": "Physical position (window, middle, aisle)"
                  },
                  "seatColumn": {
                    "type": "string",
                    "description": "Column letter (e.g. A, B, C)"
                  },
                  "seatNumber": {
                    "type": "string",
                    "description": "Full seat label (e.g. 1A)"
                  },
                  "seatRow": {
                    "type": "integer",
                    "description": "Row number"
                  },
                  "seatType": {
                    "type": "string",
                    "description": "Seat class/type (standard, extra_legroom, exit_row, ...)"
                  }
                }
              },
              "baggage": {
                "type": "object",
                "description": "Baggage details — present only when category is 'baggage'",
                "properties": {
                  "bagType": {
                    "type": "string",
                    "description": "Type of bag (e.g. checked, cabin)"
                  },
                  "pieces": {
                    "type": "integer",
                    "description": "Number of bag pieces booked"
                  },
                  "weightKg": {
                    "type": "number",
                    "description": "Weight allowance in kilograms"
                  }
                }
              }
            }
          }
        }
      },
      "FlightOfferPricing": {
        "type": "object",
        "properties": {
          "display": {
            "$ref": "#/components/schemas/FlightPrice",
            "description": "Customer-facing price breakdown (converted to search currency if applicable)"
          },
          "converted": {
            "type": "boolean",
            "description": "True if FX currency conversion was applied"
          }
        },
        "description": "Full offer pricing with per-passenger breakdown"
      },
      "SelectedService": {
        "type": "object",
        "properties": {
          "passengerIndex": {
            "type": "integer",
            "description": "Zero-based index of the passenger this service is for (matches position in passengers array)",
            "example": 0
          },
          "serviceId": {
            "type": "string",
            "description": "Service identifier from servicesAttachable.groups[].services[].serviceId",
            "example": "g6Rwc2lk2SQwMTlkMDY3NC1hMzQzLTc0OGEtYmYyYS1jMDk4ZmNjMTk2ZGGhcMtAfB6PXCj1w6Fjo1VTRA=="
          },
          "quantity": {
            "type": "integer",
            "description": "Number of units of this service to attach",
            "example": 1
          }
        },
        "description": "An ancillary service selected by a passenger (seat, baggage, etc.)"
      },
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": {
              "code": {
                "type": "integer",
                "description": "Numeric error code"
              },
              "message": {
                "type": "string",
                "description": "Short error message"
              },
              "description": {
                "type": "string",
                "description": "Detailed error description"
              },
              "key": {
                "type": "string",
                "description": "JSON path to the offending request field (e.g. bodyRequest.offerId, query.airlinePnr). Present on validation and client-input errors; omitted on auth and server-side errors.",
                "example": "bodyRequest.offerId"
              }
            },
            "description": "Error details"
          }
        },
        "description": "Standard error response envelope",
        "example": {
          "error": {
            "code": 4000,
            "message": "bad request",
            "description": "invalid flight extra charges: usePaymentSdk must be true for Stripe bookings"
          }
        }
      },
      "FlightPrebookBooking": {
        "type": "object",
        "description": "Flight checkout booking snapshot returned on prebook create/get/attach-services. Omits booking-only and internal fields (status, paymentStatus, distributor*, providerEnvironment, ticketLimitTime, cancellation).",
        "properties": {
          "bookingId": {
            "type": "string",
            "description": "Omitted on prebook responses (set after POST /flights/bookings)"
          },
          "bookingRef": {
            "type": "string",
            "description": "FlightHub booking reference (FH-YYM-XXXXXXXX)"
          },
          "status": {
            "type": "string",
            "description": "Omitted on prebook responses. Booking lifecycle status is only returned after POST /flights/bookings."
          },
          "timestamp": {
            "type": "string",
            "description": "Booking creation time (UTC)"
          },
          "offerId": {
            "type": "string",
            "description": "Offer ID from verify stage"
          },
          "journey": {
            "type": "object",
            "properties": {
              "journeyKey": {
                "type": "string",
                "description": "Unique journey identifier"
              },
              "segments": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/FlightSegment"
                },
                "description": "Flight segments in this booking"
              },
              "price": {
                "$ref": "#/components/schemas/FlightPrice",
                "description": "Journey price at time of booking"
              },
              "pricing": {
                "$ref": "#/components/schemas/FlightOfferPricing",
                "description": "Journey pricing (provider FlattenedJourney.pricing)"
              },
              "baggage": {
                "type": "object",
                "description": "Fare baggage allowance on the booked journey (included and paid options; aligns with provider FlattenedJourney.baggage)",
                "properties": {
                  "hasCarryOnBag": {
                    "type": "boolean",
                    "description": "Whether carry-on bag is included"
                  },
                  "hasCheckedBag": {
                    "type": "boolean",
                    "description": "Whether checked bag is included"
                  },
                  "included": {
                    "type": "array",
                    "description": "Baggage included in the fare",
                    "items": {
                      "type": "object",
                      "description": "A single included or paid baggage option on the journey",
                      "properties": {
                        "bagType": {
                          "type": "string",
                          "enum": [
                            "cabin",
                            "checked",
                            "personal"
                          ],
                          "description": "Type of bag: cabin (carry-on), checked, or personal (under-seat / personal item)",
                          "example": "cabin"
                        },
                        "description": {
                          "type": "string",
                          "description": "Human-readable baggage allowance description from the carrier",
                          "example": "1 cabin bag up to 8 kg"
                        },
                        "passengerType": {
                          "type": "string",
                          "enum": [
                            "ADT",
                            "CHD",
                            "INF",
                            "ALL"
                          ],
                          "description": "Passenger type this allowance applies to: ADT (adult), CHD (child), INF (infant), or ALL",
                          "example": "ADT"
                        },
                        "pieces": {
                          "type": "integer",
                          "description": "Number of bag pieces for this option",
                          "example": 1
                        },
                        "pricing": {
                          "allOf": [
                            {
                              "$ref": "#/components/schemas/FlightItemPricing"
                            }
                          ],
                          "description": "Pricing for this baggage item. Included allowances usually have amount 0; paid options carry the surcharge in display.amount / display.currency."
                        },
                        "size": {
                          "type": "string",
                          "description": "Bag size / dimensions when published by the carrier (e.g. 55x40x20)",
                          "example": "55x40x20"
                        },
                        "unit": {
                          "type": "string",
                          "description": "Weight unit for the allowance (e.g. kg)",
                          "example": "kg"
                        },
                        "weightKg": {
                          "type": "number",
                          "description": "Maximum weight per bag in kilograms",
                          "example": 8
                        }
                      }
                    }
                  },
                  "paid": {
                    "type": "array",
                    "description": "Available paid baggage options",
                    "items": {
                      "type": "object",
                      "description": "A single included or paid baggage option on the journey",
                      "properties": {
                        "bagType": {
                          "type": "string",
                          "enum": [
                            "cabin",
                            "checked",
                            "personal"
                          ],
                          "description": "Type of bag: cabin (carry-on), checked, or personal (under-seat / personal item)",
                          "example": "cabin"
                        },
                        "description": {
                          "type": "string",
                          "description": "Human-readable baggage allowance description from the carrier",
                          "example": "1 cabin bag up to 8 kg"
                        },
                        "passengerType": {
                          "type": "string",
                          "enum": [
                            "ADT",
                            "CHD",
                            "INF",
                            "ALL"
                          ],
                          "description": "Passenger type this allowance applies to: ADT (adult), CHD (child), INF (infant), or ALL",
                          "example": "ADT"
                        },
                        "pieces": {
                          "type": "integer",
                          "description": "Number of bag pieces for this option",
                          "example": 1
                        },
                        "pricing": {
                          "allOf": [
                            {
                              "$ref": "#/components/schemas/FlightItemPricing"
                            }
                          ],
                          "description": "Pricing for this baggage item. Included allowances usually have amount 0; paid options carry the surcharge in display.amount / display.currency."
                        },
                        "size": {
                          "type": "string",
                          "description": "Bag size / dimensions when published by the carrier (e.g. 55x40x20)",
                          "example": "55x40x20"
                        },
                        "unit": {
                          "type": "string",
                          "description": "Weight unit for the allowance (e.g. kg)",
                          "example": "kg"
                        },
                        "weightKg": {
                          "type": "number",
                          "description": "Maximum weight per bag in kilograms",
                          "example": 8
                        }
                      }
                    }
                  }
                }
              },
              "terms": {
                "type": "object",
                "properties": {
                  "changeable": {
                    "type": "boolean",
                    "description": "True if the fare allows changes (rebooking)"
                  },
                  "refundable": {
                    "type": "boolean",
                    "description": "True if the fare is refundable"
                  },
                  "summary": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "description": "A single fare policy remark",
                      "properties": {
                        "level": {
                          "type": "string",
                          "description": "Severity of the remark: info, warning, or danger",
                          "example": "warning"
                        },
                        "message": {
                          "type": "string",
                          "description": "Policy message text (e.g. Non-refundable, Changes allowed with fee)",
                          "example": "Changes allowed with fee"
                        }
                      }
                    },
                    "description": "Human-readable policy messages with severity levels"
                  },
                  "changeFee": {
                    "type": "object",
                    "nullable": true,
                    "description": "Change fee details; null when the provider does not publish a fee",
                    "properties": {
                      "pricing": {
                        "type": "object",
                        "nullable": true,
                        "description": "Fee pricing; null when only a percentage is available",
                        "properties": {
                          "display": {
                            "type": "object",
                            "description": "Customer-facing fee amount after FX conversion. Equals the supplier penalty unless a `penalties` markup is configured in the partner's flight markup configuration (the rateSearch markup is not applied to penalties).",
                            "properties": {
                              "amount": {
                                "type": "number",
                                "description": "Monetary amount"
                              },
                              "currency": {
                                "type": "string",
                                "description": "ISO 4217 currency code"
                              }
                            }
                          },
                          "converted": {
                            "type": "boolean",
                            "description": "True when FX conversion was applied"
                          }
                        }
                      },
                      "percent": {
                        "type": "number",
                        "nullable": true,
                        "description": "Fee as a percentage of the base fare (e.g. 100 = full penalty). May appear without pricing."
                      },
                      "applicability": {
                        "type": "string",
                        "enum": [
                          "anytime",
                          "noShow",
                          "beforeDeparture",
                          "afterDeparture"
                        ],
                        "description": "When the fee applies"
                      },
                      "label": {
                        "type": "string",
                        "description": "Human-readable fee description (e.g. 'Change fee (before departure)')"
                      }
                    }
                  },
                  "refundFee": {
                    "type": "object",
                    "nullable": true,
                    "description": "Refund/cancellation fee details; null when the provider does not publish a fee",
                    "properties": {
                      "pricing": {
                        "type": "object",
                        "nullable": true,
                        "description": "Fee pricing; null when only a percentage is available",
                        "properties": {
                          "display": {
                            "type": "object",
                            "description": "Customer-facing fee amount after FX conversion. Equals the supplier penalty unless a `penalties` markup is configured in the partner's flight markup configuration (the rateSearch markup is not applied to penalties).",
                            "properties": {
                              "amount": {
                                "type": "number",
                                "description": "Monetary amount"
                              },
                              "currency": {
                                "type": "string",
                                "description": "ISO 4217 currency code"
                              }
                            }
                          },
                          "converted": {
                            "type": "boolean",
                            "description": "True when FX conversion was applied"
                          }
                        }
                      },
                      "percent": {
                        "type": "number",
                        "nullable": true,
                        "description": "Fee as a percentage of the base fare (e.g. 100 = full penalty). May appear without pricing."
                      },
                      "applicability": {
                        "type": "string",
                        "enum": [
                          "anytime",
                          "noShow",
                          "beforeDeparture",
                          "afterDeparture"
                        ],
                        "description": "When the fee applies"
                      },
                      "label": {
                        "type": "string",
                        "description": "Human-readable fee description (e.g. 'Change fee (before departure)')"
                      }
                    }
                  },
                  "hasChangeFee": {
                    "type": "boolean",
                    "description": "True when the provider signalled that a change fee applies to the fare, even when the actual amount is not published in `changeFee`. Lets clients render a \"change fee applies — amount on request\" remark for fares where the rule is known but the monetary amount is not exposed (common for LCC content distributed via GDS, e.g. U2 / easyJet via Sabre). When `false` or absent, no change fee is known to apply."
                  },
                  "hasRefundFee": {
                    "type": "boolean",
                    "description": "True when the provider signalled that a refund/cancellation fee applies to the fare, even when the actual amount is not published in `refundFee`. Lets clients render a \"cancellation fee applies — amount on request\" remark for fares where the rule is known but the monetary amount is not exposed. When `false` or absent, no refund fee is known to apply."
                  }
                },
                "description": "Booking terms from the provider (change/refund rules and published fees)",
                "nullable": true
              },
              "cabinClass": {
                "type": "string",
                "enum": [
                  "ECONOMY",
                  "PREMIUM_ECONOMY",
                  "BUSINESS",
                  "FIRST",
                  "MIXED"
                ],
                "description": "Normalized cabin class for the whole journey, derived from segmentFares[].cabin (falls back to fare.family). MIXED when segments are booked in different cabins. Omitted when the cabin is unknown.",
                "example": "ECONOMY"
              },
              "fare": {
                "type": "object",
                "properties": {
                  "family": {
                    "type": "string",
                    "description": "Fare family name (e.g. Economy, Business, First)"
                  },
                  "mixedCabin": {
                    "type": "boolean",
                    "description": "True if outbound and inbound legs are in different cabin classes"
                  },
                  "mixedFareFamily": {
                    "type": "boolean",
                    "description": "True when legs are sold under different fare families/brands (e.g. Plus outbound + Basic inbound) combined into one fare. `family` reflects the first leg only; baggage and terms reflect the most restrictive leg."
                  },
                  "seatsRemaining": {
                    "type": "integer",
                    "description": "Number of seats remaining at this fare"
                  }
                },
                "description": "Fare class information"
              },
              "segmentFares": {
                "type": "array",
                "description": "Per-segment fare details",
                "items": {
                  "type": "object",
                  "properties": {
                    "bookingCode": {
                      "type": "string",
                      "description": "Booking/RBD class code (e.g. W, Y, J)"
                    },
                    "cabin": {
                      "type": "string",
                      "description": "Cabin class (e.g. Economy, Business, First)"
                    },
                    "fareBasisCode": {
                      "type": "string",
                      "description": "Fare basis code used for pricing and rules"
                    },
                    "fareFamily": {
                      "type": "string",
                      "description": "Commercial fare family name"
                    },
                    "seatsRemaining": {
                      "type": "integer",
                      "description": "Number of seats remaining at this fare"
                    },
                    "segmentKey": {
                      "type": "string",
                      "description": "Links this fare to the corresponding segment"
                    }
                  }
                }
              }
            },
            "description": "Journey details as confirmed by the provider at booking time"
          },
          "passengers": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "description": "Passenger type code (ADT, CHD, INF)"
                },
                "title": {
                  "type": "string",
                  "description": "Passenger title (Mr, Mrs, Ms, etc.)"
                },
                "firstName": {
                  "type": "string",
                  "description": "Passenger first name as on travel document"
                },
                "lastName": {
                  "type": "string",
                  "description": "Passenger last name as on travel document"
                },
                "middleName": {
                  "type": "string",
                  "description": "Passenger middle name"
                },
                "dateOfBirth": {
                  "type": "string",
                  "description": "Date of birth (YYYY-MM-DD)"
                },
                "birthday": {
                  "type": "string",
                  "format": "date",
                  "description": "Date of birth (YYYY-MM-DD)"
                },
                "gender": {
                  "type": "string",
                  "description": "Passenger gender: M or F"
                },
                "nationality": {
                  "type": "string",
                  "description": "Passenger nationality as ISO country code"
                },
                "passengerType": {
                  "type": "integer",
                  "description": "0=Adult, 1=Child, 2=Infant"
                },
                "documentType": {
                  "type": "string",
                  "description": "Type of travel document (e.g. passport, id_card)"
                },
                "documentNumber": {
                  "type": "string",
                  "description": "Travel document number"
                },
                "documentIssueCountry": {
                  "type": "string",
                  "description": "ISO country code of the document issuing country"
                },
                "documentExpiry": {
                  "type": "string",
                  "description": "Travel document expiry date (YYYY-MM-DD)"
                }
              }
            },
            "description": "Passenger details as submitted and confirmed by the provider"
          },
          "contact": {
            "type": "object",
            "properties": {
              "firstName": {
                "type": "string",
                "description": "Contact first name"
              },
              "lastName": {
                "type": "string",
                "description": "Contact last name"
              },
              "middleName": {
                "type": "string",
                "description": "Contact middle name"
              },
              "email": {
                "type": "string",
                "description": "Contact email address for booking confirmation"
              },
              "phoneCountryCode": {
                "type": "string",
                "description": "Phone country code without + (e.g. 1 for US, 33 for France)"
              },
              "phoneNumber": {
                "type": "string",
                "description": "Phone number without country code"
              }
            },
            "description": "Primary contact person for the booking"
          },
          "order": {
            "type": "object",
            "properties": {
              "reference": {
                "type": "object",
                "properties": {
                  "orderId": {
                    "type": "string",
                    "description": "Booking order / PNR reference ID"
                  },
                  "airlineBookings": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "airlineCode": {
                          "type": "string",
                          "description": "Airline IATA code"
                        },
                        "airlineName": {
                          "type": "string",
                          "description": "Airline name"
                        },
                        "airlinePnr": {
                          "type": "string",
                          "description": "Airline-specific PNR/locator code"
                        },
                        "pnr": {
                          "type": "string",
                          "description": "PNR locator code for this airline"
                        }
                      }
                    },
                    "description": "Per-airline booking references and PNR codes"
                  }
                },
                "description": "Provider and airline reference identifiers"
              },
              "currency": {
                "type": "string",
                "description": "ISO 4217 currency code for this order"
              },
              "status": {
                "type": "string",
                "description": "Order status from the provider (e.g. ticketed, created)"
              },
              "price": {
                "type": "object",
                "properties": {
                  "currency": {
                    "type": "string",
                    "description": "ISO 4217 currency code"
                  },
                  "total": {
                    "type": "number",
                    "description": "Total order price"
                  }
                },
                "description": "Order price as confirmed by the provider"
              },
              "ticketLimitTime": {
                "type": "string",
                "description": "Deadline for ticket issuance (UTC)"
              },
              "timestamp": {
                "type": "string",
                "description": "UTC timestamp when the order was created"
              }
            },
            "description": "Order and provider confirmation details"
          },
          "airlineLocators": {
            "type": "array",
            "description": "Airline-specific PNR/locator codes",
            "items": {
              "type": "object",
              "properties": {
                "airlineCode": {
                  "type": "string",
                  "description": "Airline IATA code"
                },
                "airlinePnr": {
                  "type": "string",
                  "description": "Airline-specific PNR/locator code"
                }
              }
            }
          },
          "pricing": {
            "type": "object",
            "properties": {
              "subtotal": {
                "type": "number",
                "description": "Subtotal before ancillary services"
              },
              "servicesAmount": {
                "type": "number",
                "description": "Total cost of attached ancillary services (seats, baggage, etc.)"
              },
              "seatsAmount": {
                "type": "number",
                "description": "Total cost of seat selections"
              },
              "baggageAmount": {
                "type": "number",
                "description": "Total cost of additional baggage"
              },
              "totalAmount": {
                "type": "number",
                "description": "Grand total charged to the customer: subtotal + services, plus the LiteAPI platform fees when feesIncludedInTotal is true"
              },
              "merchantOfRecordFee": {
                "type": "number",
                "description": "LiteAPI merchant-of-record fee included in totalAmount. Only present when feesIncludedInTotal is true and LiteAPI collects the payment (Payment SDK / third-party); dropped at book time when paying with a credit line or your own card (CREDIT / CREDIT_CARD)."
              },
              "ticketingFee": {
                "type": "number",
                "description": "LiteAPI ticketing fee included in totalAmount (percentage of the net fare with a floor and ceiling). Only present when feesIncludedInTotal is true. Applies to every payment method."
              },
              "feesIncludedInTotal": {
                "type": "boolean",
                "description": "True when the LiteAPI platform fees are added on top of the price and included in totalAmount. Omitted when the account absorbs the fees (they are then deducted from the account commission and not shown)."
              },
              "currency": {
                "type": "string",
                "description": "ISO 4217 currency code"
              }
            },
            "description": "Billing breakdown for this booking including base fare, any ancillary services and, when passed to the customer, the LiteAPI platform fees"
          },
          "payment": {
            "type": "object",
            "properties": {
              "amount": {
                "type": "number",
                "description": "Amount captured for payment"
              },
              "currency": {
                "type": "string",
                "description": "ISO 4217 currency code of the payment"
              }
            },
            "description": "Payment amounts captured for this booking"
          },
          "remarks": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Remark name or category"
                },
                "value": {
                  "type": "string",
                  "description": "Remark content"
                }
              }
            },
            "description": "Reservation remarks or comments from the provider"
          },
          "selectedServices": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/SelectedService"
            },
            "description": "Ancillary services attached to this booking (seats, baggage, etc.)"
          },
          "bookedServices": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/FlightBookedService"
            },
            "description": "Detailed view of the ancillary services confirmed by the provider for this booking, including pricing and per-passenger / per-segment metadata. Present once /services has been called."
          },
          "settings": {
            "type": "object",
            "description": "Booking settings"
          },
          "paymentInput": {
            "type": "object",
            "description": "Echo of payment submitted when creating the booking; may include additional provider-specific fields",
            "additionalProperties": true,
            "properties": {
              "method": {
                "type": "string",
                "enum": [
                  "TRANSACTION_ID",
                  "CREDIT"
                ],
                "description": "How the booking was paid: Stripe (`TRANSACTION_ID`) or credit line (`CREDIT`)"
              },
              "transactionId": {
                "type": "string",
                "description": "Stripe transaction id when `method` is `TRANSACTION_ID`"
              }
            }
          }
        }
      }
    }
  },
  "tags": [
    {
      "name": "Flight Bookings",
      "description": "Checkout flow: **1.** Create a checkout session (PREBOOK) → **1.2** Attach services to prebook (optional) → **2.** Complete a booking. Also includes retrieving a booking by ID."
    }
  ],
  "paths": {
    "/flights/prebooks/{prebookId}/services": {
      "post": {
        "tags": [
          "Flight Bookings"
        ],
        "summary": "1.2 Attach services to prebook (Optional)",
        "description": "## Overview\n\nAdd ancillary services such as seat selection or extra baggage to an existing prebook before confirming the final booking.\n\n## When to Use\n\n- **Seat selection** - Allow users to choose specific seats after prebook\n- **Extra baggage** - Let users add additional luggage allowance\n- **Price update** - Required when services change the total booking cost\n- **Voucher discount** - Optional `voucherCode` when attaching services changes the total and you need the discount reflected on the new payment intent\n\n## What You Get\n\n- **Updated prebook** with the selected services attached\n- **New payment intent** (`transactionId`, `secretKey`) reflecting the updated total price (after any voucher discount)\n- **Same response format** as `POST /flights/prebooks` for easy integration\n\n## Key Features\n\n- **Seat selection**: Assign specific seats to each passenger and segment\n- **Extra baggage**: Add checked baggage or overweight allowances\n- **Updated payment**: Creates a new Stripe payment intent when the prebook used Stripe (`usePaymentSdk: true`). For whitelabel/CMI prebooks (`used_custom_payment_keys`), no new intent is returned — re-charge via WL and submit a fresh JWT at `POST /flights/bookings`\n- **Voucher recalculation**: When a voucher applies, the discount is recomputed against the updated total (journey + ancillaries); invalid or expired vouchers return `400` (same as prebook)\n- **Modifies in place**: Updates the existing prebook record in the database\n\n## Quick Start\n\nProvide the `prebookId` in the URL path and `selectedServices` in the request body. Optionally pass `voucherCode` to apply a discount. Use the **new** `transactionId` from this response (not the original prebook `transactionId`) when confirming payment with Stripe and when calling `POST /flights/bookings`.",
        "parameters": [
          {
            "name": "prebookId",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "The prebook ID (must have provider_booking_id from initial prebook)",
            "example": "019d0674-834d-7db7-9c8b-93fe8e46e7b8"
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": [
                  "selectedServices"
                ],
                "properties": {
                  "selectedServices": {
                    "type": "array",
                    "items": {
                      "$ref": "#/components/schemas/SelectedService"
                    },
                    "description": "Services to attach (from servicesAttachable.groups in prebook response)"
                  },
                  "voucherCode": {
                    "type": "string",
                    "description": "An optional voucher code to apply discounts to the booking. The vouchers API allows creation of these discounts"
                  }
                }
              },
              "example": {
                "selectedServices": [
                  {
                    "passengerIndex": 0,
                    "serviceId": "g6Rwc2lk2SQwMTlkMDY3NC1hMzQzLTc0OGEtYmYyYS1jMDk4ZmNjMTk2ZGGhcMtAfB6PXCj1w6Fjo1VTRA==",
                    "quantity": 1
                  }
                ],
                "voucherCode": "createvoucher83"
              }
            }
          },
          "description": "Selected ancillary services to attach to the prebook"
        },
        "responses": {
          "200": {
            "description": "Services attached successfully; returns updated prebook data with new price and transactionId",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "prebookId": {
                            "type": "string",
                            "description": "Unique prebook identifier"
                          },
                          "booking": {
                            "$ref": "#/components/schemas/FlightPrebookBooking",
                            "description": "Updated booking record after attaching services"
                          },
                          "servicesAttachable": {
                            "type": "object",
                            "properties": {
                              "expiresAt": {
                                "type": "string",
                                "description": "Expiry time for attaching services (ISO 8601)"
                              },
                              "groups": {
                                "type": "array",
                                "description": "Remaining available ancillary services after attachment",
                                "items": {
                                  "type": "object",
                                  "properties": {
                                    "available": {
                                      "type": "boolean",
                                      "description": "Whether any services in this group are currently available"
                                    },
                                    "category": {
                                      "type": "string",
                                      "description": "Service category (e.g. seat, baggage)"
                                    },
                                    "label": {
                                      "type": "string",
                                      "description": "Human-readable group label"
                                    },
                                    "services": {
                                      "type": "array",
                                      "items": {
                                        "type": "object",
                                        "properties": {
                                          "serviceId": {
                                            "type": "string",
                                            "description": "Unique service identifier — use this in selectedServices when attaching"
                                          },
                                          "name": {
                                            "type": "string",
                                            "description": "Human-readable service name (e.g. Seat 7A)"
                                          },
                                          "category": {
                                            "type": "string",
                                            "description": "Service category (e.g. seat, baggage)"
                                          },
                                          "passengerType": {
                                            "type": "string",
                                            "description": "Applicable passenger type (ALL, ADT, CHD, INF)"
                                          },
                                          "segmentKey": {
                                            "type": "string",
                                            "description": "The segment this service applies to"
                                          },
                                          "pricing": {
                                            "$ref": "#/components/schemas/FlightItemPricing",
                                            "description": "Price of this service (amount 0 means included)"
                                          },
                                          "metadata": {
                                            "type": "object",
                                            "description": "Category-specific metadata. Contains exactly one of `seat` (when category is `seat`) or `baggage` (when category is `baggage`).",
                                            "properties": {
                                              "seat": {
                                                "type": "object",
                                                "description": "Seat details — present only when the service category is `seat`",
                                                "properties": {
                                                  "available": {
                                                    "type": "boolean",
                                                    "description": "Whether this seat is currently available for selection"
                                                  },
                                                  "position": {
                                                    "type": "string",
                                                    "description": "Physical position in the row (e.g. window, middle, aisle)"
                                                  },
                                                  "seatColumn": {
                                                    "type": "string",
                                                    "description": "Column letter (e.g. A, B, C)"
                                                  },
                                                  "seatNumber": {
                                                    "type": "string",
                                                    "description": "Full seat label (e.g. 1A)"
                                                  },
                                                  "seatRow": {
                                                    "type": "integer",
                                                    "description": "Row number"
                                                  },
                                                  "seatType": {
                                                    "type": "string",
                                                    "description": "Seat class/type (e.g. standard, extra_legroom, exit_row)"
                                                  }
                                                }
                                              },
                                              "baggage": {
                                                "type": "object",
                                                "description": "Baggage details — present only when the service category is `baggage`",
                                                "properties": {
                                                  "bagType": {
                                                    "type": "string",
                                                    "description": "Type of bag (e.g. checked, cabin)"
                                                  },
                                                  "pieces": {
                                                    "type": "integer",
                                                    "description": "Number of bag pieces included"
                                                  },
                                                  "weightKg": {
                                                    "type": "number",
                                                    "description": "Weight allowance in kilograms"
                                                  }
                                                }
                                              }
                                            }
                                          }
                                        }
                                      },
                                      "description": "Available services in this group"
                                    }
                                  }
                                }
                              }
                            },
                            "description": "Remaining ancillary services available to attach"
                          },
                          "price": {
                            "type": "number",
                            "description": "Updated total price including attached services"
                          },
                          "currency": {
                            "type": "string",
                            "description": "ISO 4217 currency code for the updated price"
                          },
                          "transactionId": {
                            "type": "string",
                            "description": "New Stripe transaction ID reflecting the updated price — use this (not the prebook transactionId) when calling /bookings"
                          },
                          "secretKey": {
                            "type": "string",
                            "description": "New Stripe payment intent secret key for SDK confirmation"
                          },
                          "voucherCode": {
                            "type": "string",
                            "description": "Represents the unique code used to redeem a voucher during the transaction."
                          },
                          "voucherTotalAmount": {
                            "type": "number",
                            "description": "Specifies the total monetary value or discount amount provided by the voucher, in `currency`."
                          },
                          "sellingPriceToUser": {
                            "type": "number",
                            "description": "Amount the customer pays after the voucher discount (`price` minus `voucherTotalAmount`)."
                          }
                        }
                      },
                      "description": "Updated prebook result after attaching services"
                    }
                  }
                },
                "example": {
                  "data": [
                    {
                      "prebookId": "019d0674-834d-7db7-9c8b-93fe8e46e7b8",
                      "booking": {
                        "timestamp": "2026-03-19T14:16:40Z",
                        "journey": {
                          "journeyKey": "30073d47d441f174",
                          "segments": [
                            {
                              "segmentKey": "b4cd7e77",
                              "stopCount": 0,
                              "originCode": "JFK",
                              "originName": "John F. Kennedy International Airport",
                              "destinationCode": "FRA",
                              "destinationName": "Frankfurt Main Airport",
                              "departureTime": "2026-07-02T16:10:00",
                              "arrivalTime": "2026-07-03T05:55:00",
                              "direction": "OUTBOUND",
                              "duration": {
                                "iso8601": "PT7H45M",
                                "minutes": 465
                              },
                              "flight": {
                                "marketingNumber": "2017",
                                "operatingNumber": "2017"
                              },
                              "carrier": {
                                "marketingCode": "DE",
                                "marketingLogo": "https://sandbox.nuitee.flights/static/images/airlines/DE.png",
                                "marketingName": "Condor Flugdienst",
                                "operatingCode": "DE",
                                "operatingLogo": "https://sandbox.nuitee.flights/static/images/airlines/DE.png",
                                "operatingName": "Condor Flugdienst"
                              }
                            },
                            {
                              "segmentKey": "35125125",
                              "stopCount": 0,
                              "originCode": "FRA",
                              "originName": "Frankfurt Main Airport",
                              "destinationCode": "CDG",
                              "destinationName": "Charles de Gaulle International Airport",
                              "departureTime": "2026-07-03T08:30:00",
                              "arrivalTime": "2026-07-03T09:50:00",
                              "direction": "OUTBOUND",
                              "duration": {
                                "iso8601": "PT1H20M",
                                "minutes": 80
                              },
                              "flight": {
                                "marketingNumber": "4265",
                                "operatingNumber": "4265"
                              },
                              "carrier": {
                                "marketingCode": "DE",
                                "marketingLogo": "https://sandbox.nuitee.flights/static/images/airlines/DE.png",
                                "marketingName": "Condor Flugdienst",
                                "operatingCode": "DE",
                                "operatingLogo": "https://sandbox.nuitee.flights/static/images/airlines/DE.png",
                                "operatingName": "Condor Flugdienst"
                              }
                            },
                            {
                              "segmentKey": "f15d5c4e",
                              "stopCount": 0,
                              "originCode": "CDG",
                              "originName": "Charles de Gaulle International Airport",
                              "destinationCode": "FRA",
                              "destinationName": "Frankfurt Main Airport",
                              "departureTime": "2026-08-02T08:25:00",
                              "arrivalTime": "2026-08-02T09:55:00",
                              "direction": "INBOUND",
                              "duration": {
                                "iso8601": "PT1H30M",
                                "minutes": 90
                              },
                              "flight": {
                                "marketingNumber": "4292",
                                "operatingNumber": "4292"
                              },
                              "carrier": {
                                "marketingCode": "DE",
                                "marketingLogo": "https://sandbox.nuitee.flights/static/images/airlines/DE.png",
                                "marketingName": "Condor Flugdienst",
                                "operatingCode": "DE",
                                "operatingLogo": "https://sandbox.nuitee.flights/static/images/airlines/DE.png",
                                "operatingName": "Condor Flugdienst"
                              }
                            },
                            {
                              "segmentKey": "7eccefc8",
                              "stopCount": 0,
                              "originCode": "FRA",
                              "originName": "Frankfurt Main Airport",
                              "destinationCode": "JFK",
                              "destinationName": "John F. Kennedy International Airport",
                              "departureTime": "2026-08-02T11:25:00",
                              "arrivalTime": "2026-08-02T14:10:00",
                              "direction": "INBOUND",
                              "duration": {
                                "iso8601": "PT8H45M",
                                "minutes": 525
                              },
                              "flight": {
                                "marketingNumber": "2016",
                                "operatingNumber": "2016"
                              },
                              "carrier": {
                                "marketingCode": "DE",
                                "marketingLogo": "https://sandbox.nuitee.flights/static/images/airlines/DE.png",
                                "marketingName": "Condor Flugdienst",
                                "operatingCode": "DE",
                                "operatingLogo": "https://sandbox.nuitee.flights/static/images/airlines/DE.png",
                                "operatingName": "Condor Flugdienst"
                              }
                            }
                          ],
                          "pricing": {
                            "display": {
                              "total": 740.27,
                              "currency": "USD",
                              "base": 421.87,
                              "fees": 0,
                              "taxes": 318.4,
                              "perPassenger": {
                                "adult": {
                                  "base": 421.87,
                                  "currency": "USD",
                                  "fees": 0,
                                  "taxes": 318.4,
                                  "total": 740.27
                                },
                                "child": {
                                  "base": 0,
                                  "currency": "USD",
                                  "fees": 0,
                                  "taxes": 0,
                                  "total": 0
                                },
                                "infant": {
                                  "base": 0,
                                  "currency": "USD",
                                  "fees": 0,
                                  "taxes": 0,
                                  "total": 0
                                }
                              }
                            },
                            "converted": true
                          },
                          "terms": {
                            "changeable": true,
                            "refundable": false,
                            "summary": [
                              {
                                "level": "warning",
                                "message": "Change fee applies"
                              },
                              {
                                "level": "danger",
                                "message": "Non-refundable"
                              }
                            ],
                            "changeFee": {
                              "pricing": {
                                "display": {
                                  "amount": 75,
                                  "currency": "USD"
                                },
                                "converted": false
                              },
                              "percent": null,
                              "applicability": "beforeDeparture",
                              "label": "Change fee (before departure)"
                            },
                            "refundFee": null
                          },
                          "cabinClass": "ECONOMY",
                          "fare": {
                            "family": "Economy",
                            "mixedCabin": false,
                            "mixedFareFamily": false,
                            "seatsRemaining": 7
                          },
                          "segmentFares": [
                            {
                              "segmentKey": "b4cd7e77",
                              "bookingCode": "W",
                              "cabin": "Economy",
                              "fareBasisCode": "WRAQ1",
                              "fareFamily": "Economy",
                              "seatsRemaining": 7
                            },
                            {
                              "segmentKey": "35125125",
                              "bookingCode": "K",
                              "cabin": "Economy",
                              "fareBasisCode": "WRAQ1",
                              "fareFamily": "Economy",
                              "seatsRemaining": 7
                            },
                            {
                              "segmentKey": "f15d5c4e",
                              "bookingCode": "U",
                              "cabin": "Economy",
                              "fareBasisCode": "WRAQ1",
                              "fareFamily": "Economy",
                              "seatsRemaining": 7
                            },
                            {
                              "segmentKey": "7eccefc8",
                              "bookingCode": "Y",
                              "cabin": "Economy",
                              "fareBasisCode": "WRAQ1",
                              "fareFamily": "Economy",
                              "seatsRemaining": 7
                            }
                          ]
                        },
                        "passengers": [
                          {
                            "firstName": "JOHN",
                            "lastName": "Doe",
                            "middleName": "Joshua",
                            "birthday": "1996-04-28",
                            "gender": "M",
                            "nationality": "TN",
                            "documentType": "passport",
                            "documentNumber": "123456789",
                            "documentIssueCountry": "US",
                            "documentExpiry": "2030-04-28"
                          }
                        ],
                        "order": {
                          "reference": {
                            "orderId": "OQTYXX",
                            "airlineBookings": [
                              {
                                "airlineCode": "DE",
                                "airlineName": "Condor Flugdienst",
                                "airlinePnr": "DCDE"
                              }
                            ]
                          }
                        },
                        "contact": {
                          "firstName": "JOHN",
                          "email": "j.doe@example.com"
                        },
                        "selectedServices": [
                          {
                            "passengerIndex": 0,
                            "serviceId": "g6Rwc2lk2SQwMTlkMDY3NC1hMzQzLTc0OGEtYmYyYS1jMDk4ZmNjMTk2ZGGhcMtAfB6PXCj1w6Fjo1VTRA==",
                            "quantity": 1
                          }
                        ]
                      },
                      "price": 1149.28,
                      "currency": "USD",
                      "transactionId": "tr_cts_t0LaZePPxdCM_Kyskafml",
                      "secretKey": "pi_3TChUfA123tQbfO9i_secret_fwHM73I13X3g",
                      "voucherCode": "createvoucher83",
                      "voucherTotalAmount": 20,
                      "sellingPriceToUser": 1129.28,
                      "servicesAttachable": {
                        "expiresAt": "2026-03-19T14:31:42.493Z",
                        "groups": [
                          {
                            "available": true,
                            "category": "seat",
                            "label": "Seat Selection",
                            "services": [
                              {
                                "serviceId": "g6Rwc2lk2SQwMTlkMDY3NC1hYWY1LTczMjktODhiNy03OTdlNTc5YWJmZjWhcMtANdR64UeuFKFjo1VTRA==",
                                "name": "Seat 7A",
                                "category": "seat",
                                "passengerType": "ALL",
                                "segmentKey": "35125125",
                                "pricing": {
                                  "display": {
                                    "amount": 21.83,
                                    "currency": "USD"
                                  },
                                  "converted": true
                                },
                                "metadata": {
                                  "seat": {
                                    "available": true,
                                    "position": "window",
                                    "seatColumn": "A",
                                    "seatNumber": "7A",
                                    "seatRow": 7,
                                    "seatType": "extra_legroom"
                                  }
                                }
                              },
                              {
                                "serviceId": "g6Rwc2lk2SQwMTlkMDY3NC1hYWY1LTczMjktODhiNy03OTdmZmYzMTczMGWhcMtANdR64UeuFKFjo1VTRA==",
                                "name": "Seat 7B",
                                "category": "seat",
                                "passengerType": "ALL",
                                "segmentKey": "35125125",
                                "pricing": {
                                  "display": {
                                    "amount": 21.83,
                                    "currency": "USD"
                                  },
                                  "converted": true
                                },
                                "metadata": {
                                  "seat": {
                                    "available": true,
                                    "position": "middle",
                                    "seatColumn": "B",
                                    "seatNumber": "7B",
                                    "seatRow": 7,
                                    "seatType": "standard"
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "available": true,
                            "category": "baggage",
                            "label": "Extra Baggage",
                            "services": [
                              {
                                "serviceId": "g6Rwc2lk2SQwMTlkMDY3NC1iYWcxLTczMjktODhiNy04OTdlNTc5YWJmZjWhcMtANdR64UeuFKFjo1VTRA==",
                                "name": "Standard Check In Baggage 10kg",
                                "category": "baggage",
                                "passengerType": "ALL",
                                "segmentKey": "35125125",
                                "pricing": {
                                  "display": {
                                    "amount": 13.62,
                                    "currency": "USD"
                                  },
                                  "converted": true
                                },
                                "metadata": {
                                  "baggage": {
                                    "bagType": "checked",
                                    "pieces": 1,
                                    "weightKg": 10
                                  }
                                }
                              }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          },
          "400": {
            "description": "Bad request — missing or invalid service parameters",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                },
                "examples": {
                  "missingFieldAncillary": {
                    "summary": "Missing field: ancillary not found",
                    "value": {
                      "error": {
                        "code": 44001,
                        "description": "Required field is missing: ancillary not found",
                        "message": "required field missing: ancillary not found",
                        "key": "bodyRequest.selectedServices"
                      }
                    }
                  },
                  "missingFieldInvalidId": {
                    "summary": "Missing field: invalid ID format",
                    "value": {
                      "error": {
                        "code": 44008,
                        "description": "Required field is missing: invalid ID format",
                        "message": "missing required field: invalid ID format",
                        "key": "bodyRequest"
                      }
                    }
                  },
                  "validationSeatUnavailable": {
                    "summary": "Validation error: seat unavailable",
                    "value": {
                      "error": {
                        "code": 44012,
                        "description": "Validation failed: the requested seat is unavailable",
                        "message": "validation error: seat unavailable",
                        "key": "bodyRequest.selectedServices"
                      }
                    }
                  },
                  "validationSessionExpired": {
                    "summary": "Validation error: session expired",
                    "value": {
                      "error": {
                        "code": 44013,
                        "description": "The search session has expired; search for new flights and create a new prebook — services cannot be attached to this prebook",
                        "message": "validation error: session expired",
                        "key": "bodyRequest"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            "description": "Unauthorized",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                },
                "examples": {
                  "unauthorized": {
                    "summary": "Unauthorized",
                    "value": {
                      "error": {
                        "code": 44003,
                        "description": "Authentication failed",
                        "message": "unauthorized"
                      }
                    }
                  },
                  "credentialFailed": {
                    "summary": "Credential resolution failed",
                    "value": {
                      "error": {
                        "code": 44014,
                        "description": "Authentication failed: credential resolution failed",
                        "message": "unauthorized: credential resolution failed"
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            "description": "Prebook or booking not found",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                },
                "examples": {
                  "bookingNotFound": {
                    "summary": "Booking not found",
                    "value": {
                      "error": {
                        "code": 44004,
                        "description": "The booking was not found",
                        "message": "booking not found",
                        "key": "pathParam.prebookId"
                      }
                    }
                  },
                  "pnrNotFound": {
                    "summary": "PNR not found",
                    "value": {
                      "error": {
                        "code": 44005,
                        "description": "The PNR was not found",
                        "message": "PNR not found",
                        "key": "pathParam.bookingId"
                      }
                    }
                  }
                }
              }
            }
          },
          "409": {
            "description": "Conflict",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                },
                "examples": {
                  "invalidStatusTransition": {
                    "summary": "Invalid status transition",
                    "value": {
                      "error": {
                        "code": 44006,
                        "description": "Services can only be attached before the booking is in status CONFIRMED",
                        "message": "booking status does not allow service attachment",
                        "key": "bodyRequest.prebookId"
                      }
                    }
                  },
                  "serviceConflict": {
                    "summary": "Service conflict",
                    "value": {
                      "error": {
                        "code": 44007,
                        "description": "Service conflict during attachment",
                        "message": "conflict: service conflict",
                        "key": "bodyRequest.prebookId"
                      }
                    }
                  }
                }
              }
            }
          },
          "502": {
            "description": "Provider error during service attachment",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                },
                "examples": {
                  "providerAuthFailedCredential": {
                    "summary": "Provider auth failed: credential resolution",
                    "value": {
                      "error": {
                        "code": 54005,
                        "description": "Provider auth failed: credential resolution failed",
                        "message": "provider auth failed: credential resolution failed",
                        "key": "bodyRequest"
                      }
                    }
                  },
                  "providerAuthFailedGds": {
                    "summary": "Provider auth failed: GDS rejection",
                    "value": {
                      "error": {
                        "code": 54006,
                        "description": "Provider auth failed: rejected by GDS",
                        "message": "provider auth failed: GDS rejection",
                        "key": "bodyRequest"
                      }
                    }
                  },
                  "providerDisabledNotSupported": {
                    "summary": "Provider disabled: services not supported",
                    "value": {
                      "error": {
                        "code": 54016,
                        "description": "Provider disabled: services are not supported",
                        "message": "provider disabled: services not supported",
                        "key": "bodyRequest"
                      }
                    }
                  },
                  "gdsRejection": {
                    "summary": "Provider error: GDS rejection",
                    "value": {
                      "error": {
                        "code": 54001,
                        "description": "Provider error: rejected by GDS",
                        "message": "provider error: GDS rejection"
                      }
                    }
                  },
                  "seatUnavailable": {
                    "summary": "Seat unavailable",
                    "value": {
                      "error": {
                        "code": 54003,
                        "description": "Provider error: the requested seat is unavailable",
                        "message": "provider error: seat unavailable"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```