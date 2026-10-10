> For the complete documentation index, see [llms.txt](https://welcomepickups.gitbook.io/api-docs/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://welcomepickups.gitbook.io/api-docs/reference/webhooks.md).

# Webhooks

This page provides information about available webhook functionalities

## Webhook Events

Welcome Pickups' API Partners can request the activation of specific webhooks for their integration.\
\
To receive these webhooks, partners must implement an endpoint on their side that can handle POST requests. This endpoint should be configured according to the specifications outlined on this page.

The webhook authentication works with a predefined Bearer token in the authentication header (e.g. `headers['Authorization'] = "Bearer {token}"`). Although optional, we highly recommend generating one and using it.\
\
Once the endpoint is ready, partners can contact **external-api\[at]welcomepickups.com** to request the activation of specific webhook events, providing the implemented endpoint url and the authentication token.

### Transfer Booked

The Transfer booked event is triggered when a transfer is booked and paid

<details>

<summary>Payload</summary>

```json
{
  "event_type": "TRANSFER_BOOKED",
  "transfer_id": "LYwKGoYB3mwx",
  "passenger_booking_reference": "WUtYWI0OS00YjBmLWEyZm",
  "booking_reference": "DMzZTIwYjA0Mzg3IiwiY",
  "puid": "eyJ1c2VyX2lkIjoiYz=",
  "pickup_date_time": "2026-01-15T11:40:00+02:00", // ISO 8601 format with timezone offset
  "booked_date_time": "2025-12-04T17:30:47+02:00", // ISO 8601 format with timezone offset
  "passengers": 1,
  "traveler": {
    "email": "johndoe@gmail.com"
  }
}
```

</details>

### Transfer Driver Assigned

The transfer driver assigned event is triggered when a driver is assigned to a transfer.

<details>

<summary>Payload</summary>

{% code lineNumbers="true" %}

```json
{
  "event_type": "TRANSFER_DRIVER_ASSIGNED",
  "transfer_id": "y2XkgjW4grjG",
  "driver":{
    "first_name":"Alex",
    "last_name":"Alexiou",
    "telephone_number":"+306912345679",
    "photo_url":"https://..."
  },
  "vehicle":{
    "make":"Skoda",
    "model":"E Class",
    "color":"White",
    "registration":"TAB 5678"
  }
}
```

{% endcode %}

</details>

### Transfer canceled

The transfer canceled event is triggered when a transfer is canceled.

<details>

<summary>Payload</summary>

```json
{
  "event_type":"TRANSFER_CANCELED",
  "transfer_id": "y2XkgjW4grjG",
  "occurred_at":"2024-09-09T14:32:27Z"
}
```

</details>

### Transfer Pickup Datetime Changed&#x20;

The Transfer Pickup Datetime Changed event gets triggered when a transfer's pickup\_date\_time is changed.

<details>

<summary>Payload</summary>

```json
{
  "event_type": "TRANSFER_PICKUP_DATETIME_CHANGED",
  "transfer_id": "LYwKGoYB3mwx",
  "passenger_booking_reference": "WUtYWI0OS00YjBmLWEyZm",
  "booking_reference": "DMzZTIwYjA0Mzg3IiwiY",
  "puid": "eyJ1c2VyX2lkIjoiYz=",
  "pickup_date_time": "2026-01-15T11:40:00+02:00", // ISO 8601 format with timezone offset
  "booked_date_time": "2025-12-04T17:30:47+02:00", // ISO 8601 format with timezone offset
  "passengers": 1,
  "traveler": {
    "email": "johndoe@gmail.com"
  }
}
```

</details>

### Driver Departed To Pickup

The driver departed to pickup event is triggered when the driver has just departed for the pickup location.

<details>

<summary>Payload</summary>

{% code lineNumbers="true" %}

```json
{
  "event_type":"DRIVER_DEPARTED_TO_PICKUP",
  "transfer_id": "y2XkgjW4grjG",
  "latitude":null,
  "longitude":null,
  "occurred_at":"2024-09-09T14:32:27Z"
}
```

{% endcode %}

</details>

### Driver Arrived At Pickup

The driver arrived at pickup event is triggered when the driver has reached the pickup location.

<details>

<summary>Payload</summary>

{% code lineNumbers="true" %}

```json
{
  "event_type":"DRIVER_ARRIVED_AT_PICKUP",
  "transfer_id": "y2XkgjW4grjG",
  "latitude":null,
  "longitude":null,
  "occurred_at":"2024-09-09T14:32:27Z"
}
```

{% endcode %}

</details>

### Driver Departed To Dropoff

The driver departed to dropoff event is triggered when the driver successfully met the traveler and departed for the dropoff location.

<details>

<summary>Payload</summary>

{% code lineNumbers="true" %}

```json
{
  "event_type":"DRIVER_DEPARTED_TO_DROPOFF",
  "transfer_id": "y2XkgjW4grjG",
  "latitude":null,
  "longitude":null,
  "occurred_at":"2024-09-09T14:32:27Z"
}
```

{% endcode %}

</details>

### Driver Arrived At Dropoff

The driver arrived at dropoff event is triggered when the driver has reached the dropoff location and the transfer is completed.

<details>

<summary>Payload</summary>

{% code lineNumbers="true" %}

```json
{
  "event_type":"DRIVER_ARRIVED_AT_DROPOFF",
  "transfer_id": "y2XkgjW4grjG",
  "latitude":null,
  "longitude":null,
  "occurred_at":"2024-09-09T14:32:27Z"
}
```

{% endcode %}

</details>

### Driver Submitted Customer No Show

The driver submitted customer no show event is triggered when the driver submits that the customer did not show up to the pickup location.

<details>

<summary>Payload</summary>

{% code lineNumbers="true" %}

```json
{
  "event_type":"DRIVER_SUBMITTED_CUSTOMER_NO_SHOW",
  "transfer_id": "y2XkgjW4grjG",
  "latitude":null,
  "longitude":null,
  "occurred_at":"2024-09-09T14:32:27Z"
}
```

{% endcode %}

</details>
