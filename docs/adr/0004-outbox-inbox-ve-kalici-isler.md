# ADR-0004 — Outbox/Inbox, idempotency ve kalıcı işler

- Durum: Kabul edildi (2026-10-09)

## Karar

- **Outbox esas kayıttır.** Domain komutu (ör. sipariş durum geçişi) ve `core.outbox_events` satırı aynı transaction'da yazılır. BullMQ yalnız dağıtım kanalıdır.
- **Relay**: worker `FOR UPDATE SKIP LOCKED` ile `PENDING` outbox satırlarını kiralar (`locked_until`), BullMQ'ya `jobId = outbox_event.id` ile ekler (BullMQ aynı jobId'yi ikinci kez kuyruğa koymaz), satırı `DISPATCHED` yapar. İşleyici başarıyla bitirince `COMPLETED`.
- **Redis kaybı**: `DISPATCHED` ama `COMPLETED` olmayan ve `dispatched_at` eşiğini aşan satırlar tekrar `PENDING`'e döner (redrive). İşleyiciler idempotent yazılır; geri alınamaz dış çağrılar ayrıca "intent" kaydıyla korunur (aşağıda).
- **Inbox**: webhook/callback `core.inbox_events (source, dedupe_key)` unique. Tekrarı 200 ile kabul edilir, yeniden işlenmez. Webhook hiçbir zaman doğrudan durum değiştirmez; yalnız "sağlayıcı/gateway'den sorgula" işini tetikler. Eski olay yeni durumu geri çeviremez (durum makinesi monoton geçişler + `version`).
- **API idempotency**: `core.idempotency_keys (scope, key)` + `request_hash`. Aynı anahtar farklı gövde → 409. Aynı anahtar + aynı gövde → saklanan yanıt.
- **Dış çağrı intent'i**: `provider_bookings.client_reference` ve `payment_attempts.local_idempotency_key` dış çağrıdan **önce** kalıcı yazılır. Bir intent `IN_FLIGHT` iken ikinci worker aynı çağrıyı yapamaz (koşullu UPDATE ile kiralama). Timeout → `UNKNOWN`; çözüm yalnız sorgu/lookup ile.
- Yerel lock upstream exactly-once garantisi olarak sunulmaz.

## Sonuç

- `UNKNOWN` kayıtlar TTL ile silinmez, başarısız sayılmaz; `OperationTask` açılır.
- Sandbox olayları production kaydını değiştiremez: her dış referans `environment` sütunu taşır ve eşleşme zorunludur.
