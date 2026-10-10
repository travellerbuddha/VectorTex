> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/operational-errors.md).

# Operational errors

This page provides information about transfer operational errors

## Introduction

Operational errors are the errors that exist for a transfer, coming from the Traveler's / Booker's side, that prevent the operation of the transfer itself, eventually causing a transfer auto-cancellation.

## Related fields

The fields that will be introduced in this section are available in the responses of the [Show a Transfer](/api-docs/reference/api-reference/transfers/show-a-transfer.md#response) and [Update a Transfer](/api-docs/reference/api-reference/transfers/deprecated-update-a-transfer.md#response) endpoints.

### operational\_status

The `operational_status` field represents the autocheck status of the transfer. It is used to let partners know if a transfer is `pending` autocheck, is `checked without errors` or is `checked with errors`.

### operational\_errors\_message

The `operational_errors_message` field represents the information whether an autocancellation is scheduled or not, so that Partners are aware of any potential / upcoming autocancellation.

### operational\_errors

The `operational_errors` array field represents the autocheck errors that exist for a transfer. It is used to let partners know what are the exact errors so that they will be able to resolve them via the [update transfer endpoint](/api-docs/reference/api-reference/transfers/deprecated-update-a-transfer.md#request-body) or via contacting our support.\
\
After updating a Transfer, the automated checks will run asynchronously in order to redetermine the operational status of the Transfer.

## Examples

### Transfer with autocheck errors and a scheduled autocancelation

This is an example of a created Transfer, that has been auto-checked by Welcome's system and has errors that will eventually cause an autocancellation of this Transfer.

<details>

<summary>Show a Transfer response with autocheck errors</summary>

```json
{
    "data": {
        "id": "BWpYaqy31Bp2",
        "type": "transfers",
        "attributes": {
            "quote_id": "jGXLvbAP",
            "order_id": "w-118550-2",
            "passenger_booking_reference": "PAS115",
            "booking_reference": "BOOK115",
            "transfer_status": "confirmed",
            "traveler_no_show_up": false,
            "cancellation_reason": null,
            "traveler_cancellation_reason": null,
            "cancelled_at": null,
            "pickup_date_time": "2025-04-30T13:30:00+03:00",
            "booked_date_time": "2025-03-10T18:03:19+02:00",
            "transport_designator": "A3 284",
            "from_location": {
                "type": "airport",
                "description": "Athens Airport, Athens International Airport, Eleftherios Venizelos",
                "lat": 37.935647,
                "lng": 23.948416
            },
            "to_location": {
                "type": "pending",
                "description": "Welcome Pickups",
                "lat": 38.057605,
                "lng": 23.541532
            },
            "passenger": {
                "count": 2,
                "name": "Mister Passenger",
                "email": "passenger@welcomepickups.com",
                "mobile": "306911122277"
            },
            "service_info": {
                "type": null,
                "vehicle_type": "sedan",
                "max_pax": 4,
                "max_lug": 4,
                "photo_url": null,
                "photo_urls": null,
                "description": null,
                "supplier": null,
                "passenger_reviews": null
            },
            "fare": {
                "price": 45.0,
                "currency_code": "EUR",
                "type": null,
                "refund_cancellation_policy": "You are eligible for a 80% refund on your booking, for cancellations greater than 24 hours prior to your pick-up departure time.",
                "refund_policies": [
                    {
                        "hours_from_operation": {
                            "min": 24,
                            "max": "-"
                        },
                        "refund_percentage": 80
                    },
                    {
                        "hours_from_operation": {
                            "min": 0,
                            "max": 24
                        },
                        "refund_percentage": 0
                    }
                ],
                "refund": {
                    "policy": null,
                    "amount": null
                }
            },
            "driver": null,
            "additional_notes": "Traveler notes",
            "partner_dashboard_transfer_url": "http://...",
            "transfer_events": [],
            "operational_status": "Checked with errors",
            "operational_errors_message": "Autocheck Fail - Auto-Cancellation scheduled in 23d 13h 55m",
            "operational_errors": [
                {
                    "invalid_field": "transport_designator",
                    "current_value": "A3 284",
                    "description": "Flight number seems to be incorrect: A3 284"
                }
            ]
        }
    }
}
```

</details>

Note the related fields:

```json
{
    "operational_status": "Checked with errors",
    "operational_errors_message": "Autocheck Fail - Auto-Cancellation scheduled in 23d 13h 55m",
    "operational_errors": [
        {
            "invalid_field": "transport_designator",
            "current_value": "A3 284",
            "description": "Flight number seems to be incorrect: A3 284"
        }
    ]
}
```

***

### Transfer with no or resolved autocheck errors

<details>

<summary>Show a Transfer response without autocheck errors</summary>

```json
{
    "data": {
        "id": "BWpYaqy31Bp2",
        "type": "transfers",
        "attributes": {
            "quote_id": "jGXLvbAP",
            "order_id": "w-118550-2",
            "passenger_booking_reference": "PAS115",
            "booking_reference": "BOOK115",
            "transfer_status": "confirmed",
            "traveler_no_show_up": false,
            "cancellation_reason": null,
            "traveler_cancellation_reason": null,
            "cancelled_at": null,
            "pickup_date_time": "2025-04-30T13:30:00+03:00",
            "booked_date_time": "2025-03-10T18:03:19+02:00",
            "transport_designator": "A3 284",
            "from_location": {
                "type": "airport",
                "description": "Athens Airport, Athens International Airport, Eleftherios Venizelos",
                "lat": 37.935647,
                "lng": 23.948416
            },
            "to_location": {
                "type": "pending",
                "description": "Welcome Pickups",
                "lat": 38.057605,
                "lng": 23.541532
            },
            "passenger": {
                "count": 2,
                "name": "Mister Passenger",
                "email": "passenger@welcomepickups.com",
                "mobile": "306911122277"
            },
            "service_info": {
                "type": null,
                "vehicle_type": "sedan",
                "max_pax": 4,
                "max_lug": 4,
                "photo_url": null,
                "photo_urls": null,
                "description": null,
                "supplier": null,
                "passenger_reviews": null
            },
            "fare": {
                "price": 45.0,
                "currency_code": "EUR",
                "type": null,
                "refund_cancellation_policy": "You are eligible for a 80% refund on your booking, for cancellations greater than 24 hours prior to your pick-up departure time.",
                "refund_policies": [
                    {
                        "hours_from_operation": {
                            "min": 24,
                            "max": "-"
                        },
                        "refund_percentage": 80
                    },
                    {
                        "hours_from_operation": {
                            "min": 0,
                            "max": 24
                        },
                        "refund_percentage": 0
                    }
                ],
                "refund": {
                    "policy": null,
                    "amount": null
                }
            },
            "driver": null,
            "additional_notes": "Traveler notes",
            "partner_dashboard_transfer_url": "http://...",
            "transfer_events": [],
            "operational_status": "Checked without errors",
            "operational_errors_message": null,
            "operational_errors": []
        }
    }
}
```

</details>

Note the related fields:

```json
{
    "operational_status": "Checked without errors",
    "operational_errors_message": null,
    "operational_errors": []
}
```
