> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/api-reference/transfers/create-a-transfer.md).

# Create a Transfer

## Create a Transfer

<mark style="color:green;">`POST`</mark> `{PlatformAddress}/v1/external/transfers`

Use this endpoint to create transfers.

#### Query Parameters

| Name                                       | Type   | Description                          |
| ------------------------------------------ | ------ | ------------------------------------ |
| api\_key<mark style="color:red;">\*</mark> | String | The access key for making API calls. |

#### Headers

| Name          | Type   | Description                                                                                                                                  |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization | String | <p>Authorization token can be used instead of the <strong>api\_key</strong> url parameter.</p><p></p><p>e.g. Authorization: Bearer token</p> |

#### Request Body

<table><thead><tr><th>Name</th><th width="125">Type</th><th>Description</th></tr></thead><tbody><tr><td>quote_id<mark style="color:red;">*</mark></td><td>String</td><td>Id of <a href="/api-docs/reference/api-reference/quotes/show-a-quote.md#quote">Quote</a></td></tr><tr><td>quote_request_id</td><td>String</td><td>Id of <a href="/api-docs/reference/api-reference/quote-requests/show-a-quote-request.md#quote-request">Quote request</a></td></tr><tr><td>passenger_booking_reference</td><td>String</td><td>Internal passenger booking reference that is used in your system</td></tr><tr><td>booking_reference</td><td>String</td><td>Internal booking reference that is used in your system</td></tr><tr><td>passenger<mark style="color:red;">*</mark></td><td>Hash</td><td>Passenger object</td></tr><tr><td>passenger[name]<mark style="color:red;">*</mark></td><td>String</td><td>Passenger full name</td></tr><tr><td>passenger[mobile]<mark style="color:red;">*</mark></td><td>String</td><td>Passenger mobile phone number</td></tr><tr><td>passenger[email]<mark style="color:red;">*</mark></td><td>String</td><td>Passenger email</td></tr><tr><td>passenger[notify]<mark style="color:red;">*</mark></td><td>Boolean</td><td>Notify passenger for transfer</td></tr><tr><td>additional_notes</td><td>String</td><td>Any additional information you would like to communicate to your transport service provider.<br><em>e.g. I need a child booster seat and want to be at the airport 2 hours earlier for my flight.</em></td></tr><tr><td>payment_method<mark style="color:red;">*</mark></td><td>String</td><td><p>The payment method to be used.</p><p>Available options: <em>["credit"]</em></p></td></tr><tr><td>transport_designator</td><td>String</td><td>Transport designator can be a flight number, a ferry name or a train station name<br><br><mark style="color:red;">*</mark> Please note, that the transport designator is <strong>mandatory</strong> for the proper operation of <strong>airport pickup transfers</strong>. (flight number)</td></tr></tbody></table>

### Request example

{% code lineNumbers="true" %}

```json
{
    "quote_id": "{{created_quote_request_quote_id}}",
    "booking_reference": "91ec1f9324753048c0096d036a694f86",
    "passenger_booking_reference": "9c010175-6e8b-41d8-859e-5c0221059727",
    "passenger": {
        "name": "Passenger name",
        "mobile": "+306911122277",
        "email": "passenger@welcomepickups.com",
        "notify": false
    },
    "additional_notes": "Traveler notes",
    "payment_method": "credit",
    "transport_designator": "A3143"
}
```

{% endcode %}

### Response

<table><thead><tr><th width="226">Property</th><th>Type</th><th width="182.33333333333331">Contract</th><th>Description</th></tr></thead><tbody><tr><td>data</td><td>object of <a href="/api-docs/reference/api-reference/transfers/create-a-transfer.md#create-a-transfer">Transfer</a></td><td>Required</td><td>Details of created  Transfer</td></tr></tbody></table>

### Transfer

<table><thead><tr><th width="271">Property</th><th width="90">Type</th><th width="99">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>quote_id</td><td>String</td><td></td><td>Id of <a href="/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md#quote">Quote</a></td></tr><tr><td>order_id</td><td>String</td><td></td><td>Id of the order</td></tr><tr><td>passenger_booking_reference</td><td>String</td><td></td><td>Passenger booking reference.<br>Can be any string.<br>Can be used by the consumer to identify their travelers</td></tr><tr><td>booking_reference</td><td>String</td><td></td><td>Booking reference. <br>Can be any string. <br>Can be used by the consumer to identify their bookings</td></tr><tr><td>transfer_status</td><td>String</td><td></td><td>The status of the transfer.<br>Can be one of:<br>1. confirmed cancelled-by-api<br>2. cancelled-by-passenger<br>3. cancelled-by-operator<br>4. cancelled-by-welcome<br>5. operated</td></tr><tr><td>pickup_date_time</td><td>String</td><td></td><td>The pickup date time</td></tr><tr><td>booked_date_time</td><td>String</td><td></td><td>Date time that transfer was booked</td></tr><tr><td>from_location</td><td>Hash</td><td></td><td>From location object</td></tr><tr><td>from_location[type]</td><td>String</td><td></td><td>From location type</td></tr><tr><td>from_location[description]</td><td>String</td><td></td><td>From location description</td></tr><tr><td>from_location[lat]</td><td>Double</td><td></td><td>From location latitude</td></tr><tr><td>from_location[lng]</td><td>Double</td><td></td><td>From location longitude</td></tr><tr><td>to_location</td><td>Hash</td><td></td><td>To location object</td></tr><tr><td>to_location[type]</td><td>String</td><td></td><td>To location type</td></tr><tr><td>to_location[description]</td><td>String</td><td></td><td>To location description</td></tr><tr><td>to_location[lat]</td><td>Double</td><td></td><td>To location latitude</td></tr><tr><td>to_location[lng]</td><td>Double</td><td></td><td>To location longitude</td></tr><tr><td>passenger</td><td>Hash</td><td></td><td>Passenger object</td></tr><tr><td>passenger[count]</td><td>Integer</td><td></td><td>Number of passengers</td></tr><tr><td>passenger[name]</td><td>String</td><td></td><td>Passenger name</td></tr><tr><td>passenger[email]</td><td>String</td><td></td><td>Passenger email</td></tr><tr><td>passenger[mobile]</td><td>String</td><td></td><td>Passenger mobile</td></tr><tr><td>service_info</td><td>Hash</td><td></td><td>Service information object</td></tr><tr><td>service_info[type]</td><td>String</td><td></td><td>Type of service</td></tr><tr><td>service_info[vehicle_type]</td><td>String</td><td></td><td>Vehicle type of service</td></tr><tr><td>service_info[max_pax]</td><td>Integer</td><td></td><td>Max number of passengers for service</td></tr><tr><td>service_info[max_lug]</td><td>Integer</td><td></td><td>Max number of luggage for service</td></tr><tr><td>service_info[photo_url]</td><td>String</td><td></td><td>Photo of service</td></tr><tr><td>service_info[photo_urls]</td><td>Array of String</td><td></td><td>Photos of services</td></tr><tr><td>service_info[description]</td><td>String</td><td></td><td>Description of service</td></tr><tr><td>service_info[supplier]</td><td>String</td><td></td><td>Supplier of service</td></tr><tr><td>service_info[passenger_reviews]</td><td>Integer</td><td></td><td>Passenger reviews of service</td></tr><tr><td>fare</td><td>Hash</td><td></td><td>Fare object.<br>Contains pricing information</td></tr><tr><td>fare[price]</td><td>Double</td><td></td><td>Quote price</td></tr><tr><td>fare[currency_code]</td><td>String</td><td></td><td>Price currency</td></tr><tr><td>fare[type]</td><td>String</td><td></td><td>Price type. Can be one of:<br>1. estimated<br>2. confirmed</td></tr><tr><td>fare[refund_cancellation_policy]</td><td>String</td><td></td><td>Refund cancellation policy. This is the policy that will be applied in case of transfer cancellation</td></tr><tr><td>fare[refund_policies]</td><td>Hash</td><td></td><td>Object of available refund policies</td></tr><tr><td>fare[refund_policies][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund_policies][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of each policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr><tr><td>additional_notes</td><td>String</td><td></td><td>Additional information  that where communicated to your transport service provider.</td></tr><tr><td>partner_dashboard_transfer_url</td><td>String</td><td></td><td>Partner dashboard url for the transfer details page</td></tr></tbody></table>

{% tabs %}
{% tab title="201: Created Create Transfer" %}

```javascript
{
    "data": {
        "id": "y2XkgjW4grjG",
        "type": "transfers",
        "attributes": {
            "quote_id": "pJEapaJO",
            "order_id": "w-118550-2",
            "passenger_booking_reference": "PAS115",
            "booking_reference": "BOOK115",
            "transfer_status": "confirmed",
            "pickup_date_time": "2023-04-30T13:30:00+03:00",
            "booked_date_time": "2023-03-10T17:59:33+02:00",
            "from_location": {
                "type": "airport",
                "description": "Athens Airport , Athens International Airport, Eleftherios Venizelos",
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
                "price": 118.0,
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
                ]
            },
            "additional_notes": "Traveler notes",
            "partner_dashboard_transfer_url": "http://..."
        }
    }
}
```

{% endtab %}

{% tab title="400: Bad Request " %}

```javascript
// Invalid passenger mobile
{
    "errors": [
        {
            "status": "400",
            "code": "bad_request",
            "title": "Bad request",
            "detail": "Passenger: +6911122277 doesn't seem to be a valid phone number."
        }
    ]
}

// When the price of the quote is estimated instead of confirmed
{
    "errors": [
        {
            "status": "400",
            "code": "bad_request",
            "title": "Bad request",
            "detail": "Cannot book a transfer with an estimated price."
        }
    ]
}
```

{% endtab %}

{% tab title="401: Unauthorized " %}

```json
// Welcome credit card
{
    "errors": [
        {
            "status": "401",
            "code": "unauthorized",
            "title": "Authentication failed",
            "detail": "Welcome credit card is not active."
        }
    ]
}
```

{% endtab %}

{% tab title="404: Not Found " %}

```json
// Requested quote not found
{
    "errors": [
        {
            "status": "404",
            "code": "not_found",
            "title": "Resource not found",
            "detail": "Quote with id e9YP6DkRs is missing"
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
