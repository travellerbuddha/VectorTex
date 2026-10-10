> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/api-reference/transfers/list-transfers.md).

# List Transfers

## List transfers

<mark style="color:blue;">`GET`</mark> `{PlatformAddress}/v1/external/transfers`

Use this endpoint to get a list of Transfers.

#### Query Parameters

| Name                                       | Type   | Description                                                                                           |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| api\_key<mark style="color:red;">\*</mark> | String | The access key for making API calls.                                                                  |
| page                                       | String | Default: 1                                                                                            |
| passenger\_booking\_reference              | String | The passenger booking reference                                                                       |
| booking\_reference                         | String | The booking reference                                                                                 |
| status                                     | String | <p>The status of the transfer. <br>Can be one of: <br>1. confirmed<br>2. operated<br>3. cancelled</p> |

#### Headers

| Name          | Type   | Description                                                                                                                                  |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization | String | <p>Authorization token can be used instead of the <strong>api\_key</strong> url parameter.</p><p></p><p>e.g. Authorization: Bearer token</p> |

{% tabs %}
{% tab title="200: OK Successful response" %}

```javascript
{
    "data": [
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
            "additional_notes": "Traveler notes",
            "partner_dashboard_transfer_url": "http://..."
        },
        ...
    ],
    "links": {
        "self": "/v1/external/cities?country_code=gr&page%5Bnumber%5D=1&page%5Bsize%5D=25",
        "first": "/v1/external/cities?country_code=gr&page%5Bnumber%5D=1&page%5Bsize%5D=25",
        "prev": null,
        "next": null,
        "last": "/v1/external/cities?country_code=gr&page%5Bnumber%5D=1&page%5Bsize%5D=25"
    },
    "meta": {
        "pagination": {
            "total_item_count": 12,
            "filtered_item_count": 12,
            "current_page": 1,
            "total_pages": 1,
            "per_page": 25,
            "next_page": null,
            "previous_page": null
        }
    }
}
```

{% endtab %}

{% tab title="400: Bad Request " %}

```javascript
```

{% endtab %}

{% tab title="401: Unauthorized " %}

```javascript
```

{% endtab %}

{% tab title="500: Internal Server Error " %}

```javascript
```

{% endtab %}
{% endtabs %}

### Response

<table><thead><tr><th width="226">Property</th><th>Type</th><th width="182.33333333333331">Contract</th><th>Description</th></tr></thead><tbody><tr><td>data</td><td>array of <a href="/api-docs/reference/api-reference/transfers/create-a-transfer.md#response">Transfer</a></td><td>required</td><td>List of transfers</td></tr><tr><td>meta["pagination"]</td><td>Hash</td><td>required</td><td></td></tr><tr><td>meta["pagination"]["total_item_count"]</td><td>Integer</td><td>required</td><td></td></tr><tr><td>meta["pagination"]["filtered_item_count"]</td><td>Integer</td><td>required</td><td></td></tr><tr><td>meta["pagination"]["current_page"]</td><td>Integer</td><td>required</td><td></td></tr><tr><td>meta["pagination"]["total_pages"]</td><td>Integer</td><td>required</td><td></td></tr><tr><td>meta["pagination"]["per_page"]</td><td>Integer</td><td>required</td><td></td></tr><tr><td>meta["pagination"]["next_page"]</td><td>Integer</td><td>required</td><td></td></tr><tr><td>meta["pagination"]["previous_page"]</td><td>Integer</td><td>required</td><td></td></tr></tbody></table>

### Transfer

<table><thead><tr><th>Property</th><th width="81">Type</th><th width="99">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>quote_id</td><td>String</td><td></td><td>Id of <a href="/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md#quote">Quote</a></td></tr><tr><td>order_id</td><td>String</td><td></td><td>Id of the order</td></tr><tr><td>passenger_booking_reference</td><td>String</td><td></td><td>Passenger booking reference.<br>Can be any string.<br>Can be used by the consumer to identify their travelers</td></tr><tr><td>booking_reference</td><td>String</td><td></td><td>Booking reference. <br>Can be any string. <br>Can be used by the consumer to identify their travelers</td></tr><tr><td>transfer_status</td><td>String</td><td></td><td>The status of the transfer.<br>Can be one of:<br>1. confirmed cancelled-by-api<br>2. cancelled-by-passenger<br>3. cancelled-by-operator<br>4. cancelled-by-welcome<br>5. operated</td></tr><tr><td>traveler_no_show_up</td><td>Boolean</td><td></td><td>Indicates whether the traveler did show up for the pickup or not.<br><br>When <code>true</code> it means that the traveler did not show up.</td></tr><tr><td>cancellation_reason</td><td>String</td><td>Optional</td><td><p>Cancellation reason.<br>Can be one of:</p><p>1: Change of plan. I will cancel my whole trip.<br>2: I booked another service.<br>3: I have a problem with your service.</p></td></tr><tr><td>traveler_cancellation_reason</td><td>String</td><td>Optional</td><td>Traveler cancellation reason</td></tr><tr><td>cancelled_at</td><td>String</td><td>Optional</td><td>Cancellation date time</td></tr><tr><td>pickup_date_time</td><td>String</td><td></td><td>The pickup date time</td></tr><tr><td>booked_date_time</td><td>String</td><td></td><td>Date time that transfer was booked</td></tr><tr><td>from_location</td><td>Hash</td><td></td><td>From location object</td></tr><tr><td>from_location[type]</td><td>String</td><td></td><td>From location type</td></tr><tr><td>from_location[description]</td><td>String</td><td></td><td>From location description</td></tr><tr><td>from_location[lat]</td><td>Double</td><td></td><td>From location latitude</td></tr><tr><td>from_location[lng]</td><td>Double</td><td></td><td>From location longitude</td></tr><tr><td>to_location</td><td>Hash</td><td></td><td>To location object</td></tr><tr><td>to_location[type]</td><td>String</td><td></td><td>To location type</td></tr><tr><td>to_location[description]</td><td>String</td><td></td><td>To location description</td></tr><tr><td>to_location[lat]</td><td>Double</td><td></td><td>To location latitude</td></tr><tr><td>to_location[lng]</td><td>Double</td><td></td><td>To location longitude</td></tr><tr><td>passenger</td><td>Hash</td><td></td><td>Passenger object</td></tr><tr><td>passenger[count]</td><td>Integer</td><td></td><td>Number of passengers</td></tr><tr><td>passenger[name]</td><td>String</td><td></td><td>Passenger name</td></tr><tr><td>passenger[email]</td><td>String</td><td></td><td>Passenger email</td></tr><tr><td>passenger[mobile]</td><td>String</td><td></td><td>Passenger mobile</td></tr><tr><td>service_info</td><td>Hash</td><td></td><td>Service information object</td></tr><tr><td>service_info[type]</td><td>String</td><td></td><td>Type of service</td></tr><tr><td>service_info[vehicle_type]</td><td>String</td><td></td><td>Vehicle type of service</td></tr><tr><td>service_info[max_pax]</td><td>Integer</td><td></td><td>Max number of passengers for service</td></tr><tr><td>service_info[max_lug]</td><td>Integer</td><td></td><td>Max number of luggage for service</td></tr><tr><td>service_info[photo_url]</td><td>String</td><td></td><td>Photo of service</td></tr><tr><td>service_info[photo_urls]</td><td>Array of String</td><td></td><td>Photos of services</td></tr><tr><td>service_info[description]</td><td>String</td><td></td><td>Description of service</td></tr><tr><td>service_info[supplier]</td><td>String</td><td></td><td>Supplier of service</td></tr><tr><td>service_info[passenger_reviews]</td><td>Integer</td><td></td><td>Passenger reviews of service</td></tr><tr><td>fare</td><td>Hash</td><td></td><td>Fare object.<br>Contains pricing information</td></tr><tr><td>fare[price]</td><td>Double</td><td></td><td>Quote price</td></tr><tr><td>fare[currency_code]</td><td>String</td><td></td><td>Price currency</td></tr><tr><td>fare[type]</td><td>String</td><td></td><td>Price type. Can be one of:<br>1. estimated<br>2. confirmed</td></tr><tr><td>fare[refund_cancellation_policy]</td><td>String</td><td></td><td>Refund cancellation policy. This is the policy that will be applied in case of transfer cancellation</td></tr><tr><td>fare[refund_policies]</td><td>Hash</td><td></td><td>Object of available refund policies</td></tr><tr><td>fare[refund_policies][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund_policies][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of the policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr><tr><td>fare[refund]</td><td>Hash</td><td></td><td>Object of applied refund policy</td></tr><tr><td>fare[refund][policy]</td><td>Hash</td><td>Optional</td><td>Object of policy for applied refund</td></tr><tr><td>fare[refund][policy][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund][policy][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund][policy][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr><tr><td>fare[refund][policy][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of the policy</td></tr><tr><td>fare[refund][amount]</td><td>Double</td><td>Optional</td><td>The refunded amount</td></tr><tr><td>additional_notes</td><td>String</td><td></td><td>Additional information  that where communicated to your transport service provider.</td></tr><tr><td>partner_dashboard_transfer_url</td><td>String</td><td></td><td>Partner dashboard url for the transfer details page</td></tr></tbody></table>
