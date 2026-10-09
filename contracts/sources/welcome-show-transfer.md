> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/api-reference/transfers/show-a-transfer.md).

# Show a Transfer

## Show a Transfer

<mark style="color:blue;">`GET`</mark> `{PlatformAddress}/v1/external/transfers/{transfer-id}`

Use this endpoint to view the details of a transfer.

#### Path Parameters

| Name                                           | Type   | Description                                                                                 |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| transfer\_id<mark style="color:red;">\*</mark> | String | <p>The id of a transfer.<br>Required url parameter.<br><br>e.g. /transfers/ARL4w2DB4eZx</p> |

#### Query Parameters

| Name                                       | Type   | Description                          |
| ------------------------------------------ | ------ | ------------------------------------ |
| api\_key<mark style="color:red;">\*</mark> | String | The access key for making API calls. |

#### Headers

| Name          | Type   | Description                                                                                                                                  |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization | String | <p>Authorization token can be used instead of the <strong>api\_key</strong> url parameter.</p><p></p><p>e.g. Authorization: Bearer token</p> |

{% tabs %}
{% tab title="200: OK Successful response" %}

```json
// Non cancelled transfer with driver assigned
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
            "pickup_date_time": "2023-04-30T13:30:00+03:00",
            "booked_date_time": "2023-03-10T18:03:19+02:00",
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
            "driver": {
                "full_name": "Mister Driver",
                "phone_number": "935 548 650",
                "professional_photo_url": "/assets/fallback/default.png",
                "phv_license_number": "862-D-4587",
                "vehicle_type": "coupe",
                "vehicle_model": "Mustang",
                "vehicle_brand": "Ford",
                "vehicle_color": "Yellow",
                "vehicle_plate_number": "TAB 5678",
                "whatsapp_number_link": "https://api.whatsapp.com/send?phone=0",
                "status": "available"
            },
            "additional_notes": "Traveler notes",
            "partner_dashboard_transfer_url": "http://...",
            "transfer_events": [
                {
                    "name": "driver_accepted",
                    "timestamp": "2023-03-10T18:04:01.205+02:00"
                },
                {
                    "name": "driver_at_pickup_location",
                    "timestamp": "2023-03-10T18:04:02.248+02:00"
                },
                {
                    "name": "transfer_finished",
                    "timestamp": "2023-03-10T18:04:03.260+02:00"
                }
            ],
            "operational_status": "Checked without errors",
            "operational_errors_message": null,
            "operational_errors": [],
            "amenities": [
                {
                    "type": "infant_carrier",
                    "quantity": 1
                },
                {
                    "type": "child_seat",
                    "quantity": 1
                },
                {
                    "type": "baby_booster",
                    "quantity": 1
                }
            ]
        }
    }
}

// Cancelled transfer
{
    "data": {
        "id": "BWpYaqy31Bp2",
        "type": "transfers",
        "attributes": {
            "quote_id": "jGXLvbAP",
            "order_id": "w-118550-2",
            "passenger_booking_reference": "PAS115",
            "booking_reference": "BOOK115",
            "transfer_status": "cancelled-by-passenger",
            "traveler_no_show_up": false,
            "cancellation_reason": "Traveler: Traveller asked for cancellation",
            "traveler_cancellation_reason": "Change of plan. I will cancel my whole trip.",
            "cancelled_at": "2023-03-10T18:06:57+02:00",
            "pickup_date_time": "2023-04-30T13:30:00+03:00",
            "booked_date_time": "2023-03-10T18:03:19+02:00",
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
                    "policy": {
                        "hours_from_operation": {
                            "min": 24,
                            "max": "-"
                        },
                        "refund_percentage": 80
                    },
                    "amount": 36.0
                }
            },
            "driver": null,
            "additional_notes": "Traveler notes",
            "partner_dashboard_transfer_url": "http://...",
            "transfer_events": [
                {
                    "name": "driver_accepted",
                    "timestamp": "2023-03-10T18:04:01.205+02:00"
                },
                {
                    "name": "transfer_cancelled",
                    "timestamp": "2023-03-10T18:04:04.271+02:00"
                }
            ],
            "operational_status": "Checked without errors",
            "operational_errors_message": null,
            "operational_errors": [],
            "amenities": []
        }
    }
}
```

{% endtab %}

{% tab title="400: Bad Request " %}

```javascript
```

{% endtab %}

{% tab title="404: Not Found Object not found" %}

```javascript
{
    "errors": [
        {
            "status": "404",
            "code": "not_found",
            "title": "Resource not found",
            "detail": "Transfer with id BWpYaqy31Bp2 is missing"
        }
    ]
}
```

{% endtab %}

{% tab title="500: Internal Server Error " %}

```javascript
```

{% endtab %}
{% endtabs %}

### Response

<table><thead><tr><th width="226">Property</th><th>Type</th><th width="182.33333333333331">Contract</th><th>Description</th></tr></thead><tbody><tr><td>data</td><td>object of <a href="/api-docs/reference/api-reference/transfers/create-a-transfer.md#create-a-transfer">Transfer</a></td><td>Required</td><td>Details of Transfer</td></tr></tbody></table>

### Transfer

<table><thead><tr><th width="297">Property</th><th width="102">Type</th><th width="116">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>quote_id</td><td>String</td><td></td><td>Id of <a href="/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md#quote">Quote</a></td></tr><tr><td>order_id</td><td>String</td><td></td><td>Id of the order</td></tr><tr><td>passenger_booking_reference</td><td>String</td><td></td><td>Passenger booking reference.<br>Can be any string.<br>Can be used by the consumer to identify their travelers</td></tr><tr><td>booking_reference</td><td>String</td><td></td><td>Booking reference. <br>Can be any string. <br>Can be used by the consumer to identify their bookings</td></tr><tr><td>transfer_status</td><td>String</td><td></td><td><p>The status of the transfer.<br>Can be one of:<br>1. confirmed</p><p>2. cancelled-by-api<br>3. cancelled-by-passenger<br>4. cancelled-by-operator<br>5. cancelled-by-welcome<br>6. operated</p></td></tr><tr><td>traveler_no_show_up</td><td>Boolean</td><td></td><td>Indicates whether the traveler did show up for the pickup or not.<br><br>When <code>true</code> it means that the traveler did not show up.</td></tr><tr><td>cancellation_reason</td><td>String</td><td>Optional</td><td><p>Cancellation reason.<br>Can be one of:</p><p>1: Change of plan. I will cancel my whole trip.<br>2: I booked another service.<br>3: I have a problem with your service.</p></td></tr><tr><td>traveler_cancellation_reason</td><td>String</td><td>Optional</td><td>Traveler cancellation reason</td></tr><tr><td>cancelled_at</td><td>String</td><td>Optional</td><td>Cancellation datetime</td></tr><tr><td>pickup_date_time</td><td>String</td><td></td><td>The pickup datetime</td></tr><tr><td>booked_date_time</td><td>String</td><td></td><td>Datetime that transfer was booked</td></tr><tr><td>transport_designator</td><td>String</td><td></td><td><p>Provided transport designator.</p><p></p><p>Can be a flight number, a ferry name or a train station name</p></td></tr><tr><td>from_location</td><td>Hash</td><td></td><td>From location object</td></tr><tr><td>from_location[type]</td><td>String</td><td></td><td>From location type</td></tr><tr><td>from_location[description]</td><td>String</td><td></td><td>From location description</td></tr><tr><td>from_location[lat]</td><td>Double</td><td></td><td>From location latitude</td></tr><tr><td>from_location[lng]</td><td>Double</td><td></td><td>From location longitude</td></tr><tr><td>to_location</td><td>Hash</td><td></td><td>To location object</td></tr><tr><td>to_location[type]</td><td>String</td><td></td><td>To location type</td></tr><tr><td>to_location[description]</td><td>String</td><td></td><td>To location description</td></tr><tr><td>to_location[lat]</td><td>Double</td><td></td><td>To location latitude</td></tr><tr><td>to_location[lng]</td><td>Double</td><td></td><td>To location longitude</td></tr><tr><td>passenger</td><td>Hash</td><td></td><td>Passenger object</td></tr><tr><td>passenger[count]</td><td>Integer</td><td></td><td>Number of passengers</td></tr><tr><td>passenger[name]</td><td>String</td><td></td><td>Passenger name</td></tr><tr><td>passenger[email]</td><td>String</td><td></td><td>Passenger email</td></tr><tr><td>passenger[mobile]</td><td>String</td><td></td><td>Passenger mobile</td></tr><tr><td>service_info</td><td>Hash</td><td></td><td>Service information object</td></tr><tr><td>service_info[type]</td><td>String</td><td></td><td>Type of service</td></tr><tr><td>service_info[vehicle_type]</td><td>String</td><td></td><td>Vehicle type of service</td></tr><tr><td>service_info[max_pax]</td><td>Integer</td><td></td><td>Max number of passengers for service</td></tr><tr><td>service_info[max_lug]</td><td>Integer</td><td></td><td>Max number of luggage for service</td></tr><tr><td>service_info[photo_url]</td><td>String</td><td></td><td>Photo of service</td></tr><tr><td>service_info[photo_urls]</td><td>Array of String</td><td></td><td>Photos of services</td></tr><tr><td>service_info[description]</td><td>String</td><td></td><td>Description of service</td></tr><tr><td>service_info[supplier]</td><td>String</td><td></td><td>Supplier of service</td></tr><tr><td>service_info[passenger_reviews]</td><td>Integer</td><td></td><td>Passenger reviews of service</td></tr><tr><td>fare</td><td>Hash</td><td></td><td>Fare object.<br>Contains pricing information</td></tr><tr><td>fare[price]</td><td>Double</td><td></td><td>Quote price</td></tr><tr><td>fare[currency_code]</td><td>String</td><td></td><td>Price currency</td></tr><tr><td>fare[type]</td><td>String</td><td></td><td>Price type. Can be one of:<br>1. estimated<br>2. confirmed</td></tr><tr><td>fare[refund_cancellation_policy]</td><td>String</td><td></td><td>Refund cancellation policy. This is the policy that will be applied in case of transfer cancellation</td></tr><tr><td>fare[refund_policies]</td><td>Hash</td><td></td><td>Object of available refund policies</td></tr><tr><td>fare[refund_policies][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund_policies][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of the policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr><tr><td>fare[refund]</td><td>Hash</td><td></td><td>Object of applied refund policy</td></tr><tr><td>fare[refund][policy]</td><td>Hash</td><td>Optional</td><td>Object of policy for applied refund</td></tr><tr><td>fare[refund][policy][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund][policy][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund][policy][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr><tr><td>fare[refund][policy][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of the policy</td></tr><tr><td>fare[refund][amount]</td><td>Double</td><td>Optional</td><td>The refunded amount</td></tr><tr><td>driver</td><td>Hash</td><td>Optional</td><td>Object of assigned driver</td></tr><tr><td>driver[full_name]</td><td>String</td><td></td><td>Driver's full name</td></tr><tr><td>driver[phone_number]</td><td>String</td><td></td><td>Driver's phone number</td></tr><tr><td>driver[professional_photo_url]</td><td>String</td><td></td><td>Driver's professional photo url</td></tr><tr><td>driver[phv_license_number]</td><td>String</td><td></td><td>Driver's PHV license</td></tr><tr><td>driver[vehicle_type]</td><td>String</td><td></td><td>Driver's vehicle type</td></tr><tr><td>driver[vehicle_model]</td><td>String</td><td></td><td>Driver's vehicle model</td></tr><tr><td>driver[vehicle_brand]</td><td>String</td><td></td><td>Driver's vehicle brand</td></tr><tr><td>driver[vehicle_color]</td><td>String</td><td></td><td>Driver's vehicle color</td></tr><tr><td>driver[vehicle_plate_number]</td><td>String</td><td></td><td>Driver's vehicle plate number</td></tr><tr><td>driver[whatsapp_number_link]</td><td>String</td><td></td><td>Driver's whatsapp number link</td></tr><tr><td>driver[status]</td><td>String</td><td></td><td>Driver status</td></tr><tr><td>additional_notes</td><td>String</td><td></td><td>Additional information  that where communicated to your transport service provider.</td></tr><tr><td>partner_dashboard_transfer_url</td><td>String</td><td></td><td>Partner dashboard url for the transfer details page</td></tr><tr><td>transfer_events</td><td>Array of Objects</td><td>Optional</td><td>Transfer related events.</td></tr><tr><td>transfer_events[name]</td><td>String</td><td></td><td>Name of event.<br>Can be:<br>1. driver_accepted<br>2. driver_at_pickup_location<br>3. transfer_finished<br>4. transfer_cancelled</td></tr><tr><td>transfer_events[timestamp]</td><td>String</td><td></td><td>Datetime that event occured</td></tr><tr><td>operational_status</td><td>String</td><td></td><td>Operational status of the transfer.<br><br>Can be:<br>1. Pending<br>2. Checked with errors<br>3. Checked without errors</td></tr><tr><td>operational_errors_message</td><td>String</td><td></td><td>The message that indicates whether an autocancelation is scheduled due to operational errors</td></tr><tr><td>operational_errors</td><td>Array of Objects</td><td>Optional</td><td>Operational errors of transfer</td></tr><tr><td>operational_errors[invalid_field]</td><td>String</td><td></td><td>Name of the field that is invalid<br><br>E.g.: transport_designator</td></tr><tr><td>operational_errors[current_value]</td><td>String</td><td></td><td>Current value of the invalid field</td></tr><tr><td>operational_errors[description]</td><td>String</td><td></td><td>A brief description of what could be wrong with the related field</td></tr><tr><td>amenities</td><td>Array of Objects</td><td>Optional</td><td>Information about transfer amenities (e.g. child seats)</td></tr><tr><td>amenities[type]</td><td>String</td><td></td><td>Amenity type (e.g. infant_carrier, child_seat, baby_booster)</td></tr><tr><td>amenities[quantity]</td><td>Integer</td><td></td><td>Amenity quantity (e.g. 2)</td></tr></tbody></table>
