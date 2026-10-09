> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/api-reference/transfers/cancel-a-transfer.md).

# Cancel a Transfer

## Cancel a Transfer

<mark style="color:purple;">`PATCH`</mark> `{PlatformAddress}/v1/external/transfers/{transfer-id}/cancel`

Use this endpoint to cancel a transfer.

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

#### Request Body

| Name                 | Type    | Description                                                                                                                                                                     |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cancellation\_reason | Integer | <p>Cancellation reason.<br>Can be one of: <br><br>1: Change of plan. I will cancel my whole trip.<br>2: I booked another service.<br>3: I have a problem with your service.</p> |

{% tabs %}
{% tab title="200: OK Transfer is successfully cancelled" %}

```json
{
    "data": {
        "id": "2VZqda6KJEQb",
        "type": "transfers",
        "attributes": {
            "quote_id": "MbD0gpA9",
            "passenger_booking_reference": "PSN115",
            "transfer_status": "cancelled-by-passenger",
            "cancellation_reason": "Traveler: Traveller asked for cancellation",
            "traveler_cancellation_reason": "Change of plan. I will cancel my whole trip.",
            "cancelled_at": "2023-03-03T10:48:40+02:00",
            "pickup_date_time": "2023-03-09T22:30:00+02:00",
            "booked_date_time": "2023-03-03T10:48:32+02:00",
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
            "additional_notes": "Additional notes"
        }
    }
}
```

{% endtab %}

{% tab title="400: Bad Request Invalid consumer data" %}

```json
// Invalid cancellation reason
{
    "errors": [
        {
            "status": "400",
            "title": "values",
            "detail": "does not have a valid value",
            "source": {
                "parameter": "cancellation_reason"
            }
        }
    ]
}
```

{% endtab %}

{% tab title="404: Not Found Object not found" %}

```json
{
    "errors": [
        {
            "status": "404",
            "code": "not_found",
            "title": "Resource not found",
            "detail": "Transfer with id 2VZqda6KJEQb is missing"
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

### Request example

{% code lineNumbers="true" %}

```json
{
    "cancellation_reason": 1
}
```

{% endcode %}

### Response

<table><thead><tr><th width="226">Property</th><th>Type</th><th width="182.33333333333331">Contract</th><th>Description</th></tr></thead><tbody><tr><td>data</td><td>object of <a href="/api-docs/reference/api-reference/transfers/create-a-transfer.md#create-a-transfer">Transfer</a></td><td>Required</td><td>Details of cancelled Transfer</td></tr></tbody></table>

### Transfer

<table><thead><tr><th>Property</th><th>Type</th><th width="116">Contract</th><th>Description</th></tr></thead><tbody><tr><td>Id</td><td>String</td><td>Required</td><td>Id of object</td></tr><tr><td>quote_id</td><td>String</td><td></td><td>Id of <a href="/api-docs/reference/api-reference/quote-requests/create-a-quote-request.md#quote">Quote</a></td></tr><tr><td>passenger_booking_reference</td><td>String</td><td></td><td>Passenger booking reference.<br>Can be any string.<br>Can be used by the consumer to identify their travelers</td></tr><tr><td>transfer_status</td><td>String</td><td></td><td>The status of the transfer.<br>Can be one of:<br>1. confirmed cancelled-by-api<br>2. cancelled-by-passenger<br>3. cancelled-by-operator<br>4. cancelled-by-welcome<br>5. operated</td></tr><tr><td>traveler_no_show_up</td><td>Boolean</td><td></td><td>Indicates whether the traveler did show up for the pickup or not.<br><br>When <code>true</code> it means that the traveler did not show up.</td></tr><tr><td>cancellation_reason</td><td>String</td><td>Optional</td><td><p>Cancellation reason.<br>Can be one of:</p><p>1: Change of plan. I will cancel my whole trip.<br>2: I booked another service.<br>3: I have a problem with your service.</p></td></tr><tr><td>traveler_cancellation_reason</td><td>String</td><td>Optional</td><td>Traveler cancellation reason</td></tr><tr><td>cancelled_at</td><td>String</td><td>Optional</td><td>Cancellation date time</td></tr><tr><td>pickup_date_time</td><td>String</td><td></td><td>The pickup date time</td></tr><tr><td>booked_date_time</td><td>String</td><td></td><td>Date time that transfer was booked</td></tr><tr><td>from_location</td><td>Hash</td><td></td><td>From location object</td></tr><tr><td>from_location[type]</td><td>String</td><td></td><td>From location type</td></tr><tr><td>from_location[description]</td><td>String</td><td></td><td>From location description</td></tr><tr><td>from_location[lat]</td><td>Double</td><td></td><td>From location latitude</td></tr><tr><td>from_location[lng]</td><td>Double</td><td></td><td>From location longitude</td></tr><tr><td>to_location</td><td>Hash</td><td></td><td>To location object</td></tr><tr><td>to_location[type]</td><td>String</td><td></td><td>To location type</td></tr><tr><td>to_location[description]</td><td>String</td><td></td><td>To location description</td></tr><tr><td>to_location[lat]</td><td>Double</td><td></td><td>To location latitude</td></tr><tr><td>to_location[lng]</td><td>Double</td><td></td><td>To location longitude</td></tr><tr><td>passenger</td><td>Hash</td><td></td><td>Passenger object</td></tr><tr><td>passenger[count]</td><td>Integer</td><td></td><td>Number of passengers</td></tr><tr><td>passenger[name]</td><td>String</td><td></td><td>Passenger name</td></tr><tr><td>passenger[email]</td><td>String</td><td></td><td>Passenger email</td></tr><tr><td>passenger[mobile]</td><td>String</td><td></td><td>Passenger mobile</td></tr><tr><td>service_info</td><td>Hash</td><td></td><td>Service information object</td></tr><tr><td>service_info[type]</td><td>String</td><td></td><td>Type of service</td></tr><tr><td>service_info[vehicle_type]</td><td>String</td><td></td><td>Vehicle type of service</td></tr><tr><td>service_info[max_pax]</td><td>Integer</td><td></td><td>Max number of passengers for service</td></tr><tr><td>service_info[max_lug]</td><td>Integer</td><td></td><td>Max number of luggage for service</td></tr><tr><td>service_info[photo_url]</td><td>String</td><td></td><td>Photo of service</td></tr><tr><td>service_info[photo_urls]</td><td>Array of String</td><td></td><td>Photos of services</td></tr><tr><td>service_info[description]</td><td>String</td><td></td><td>Description of service</td></tr><tr><td>service_info[supplier]</td><td>String</td><td></td><td>Supplier of service</td></tr><tr><td>service_info[passenger_reviews]</td><td>Integer</td><td></td><td>Passenger reviews of service</td></tr><tr><td>fare</td><td>Hash</td><td></td><td>Fare object.<br>Contains pricing information</td></tr><tr><td>fare[price]</td><td>Double</td><td></td><td>Quote price</td></tr><tr><td>fare[currency_code]</td><td>String</td><td></td><td>Price currency</td></tr><tr><td>fare[type]</td><td>String</td><td></td><td>Price type. Can be one of:<br>1. estimated<br>2. confirmed</td></tr><tr><td>fare[refund_cancellation_policy]</td><td>String</td><td></td><td>Refund cancellation policy. This is the policy that will be applied in case of transfer cancellation</td></tr><tr><td>fare[refund_policies]</td><td>Hash</td><td></td><td>Object of available refund policies</td></tr><tr><td>fare[refund_policies][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund_policies][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of the policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund_policies][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr><tr><td>fare[refund]</td><td>Hash</td><td></td><td>Object of applied refund policy</td></tr><tr><td>fare[refund][policy]</td><td>Hash</td><td>Optional</td><td>Object of policy for applied refund</td></tr><tr><td>fare[refund][policy][hours_from_operation]</td><td>Hash</td><td></td><td>Object of hours from operation for available policies</td></tr><tr><td>fare[refund][policy][hours_from_operation][min]</td><td>Integer</td><td></td><td>Minimum hours from operation for a policy</td></tr><tr><td>fare[refund][policy][hours_from_operation][max]</td><td>Integer</td><td></td><td>Maximum hours from operation for a policy</td></tr><tr><td>fare[refund][policy][refund_percentage]</td><td>Integer</td><td></td><td>The refund percentage of the policy</td></tr><tr><td>fare[refund][amount]</td><td>Double</td><td>Optional</td><td>The refunded amount</td></tr><tr><td>additional_notes</td><td>String</td><td></td><td>Additional information  that where communicated to your transport service provider.</td></tr></tbody></table>
