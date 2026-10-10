-- Staff order commands (/yonetim): cancel at the provider and record provider-made refunds (ADR-0008).

INSERT INTO core.permissions (code, description_tr, description_en) VALUES
  ('orders.cancel', 'Onaylı rezervasyonu sağlayıcıda gerekçeyle iptal etme', 'Cancel a confirmed booking at the provider, with a reason'),
  ('orders.record_refund', 'Sağlayıcının müşteriye yaptığı iadeyi doğruladıktan sonra siparişe kaydetme', 'Record a refund the provider made to the customer, after verifying it');
--> statement-breakpoint

-- Recorded refunds never exceed what the customer paid on that payment attempt (checked at commit time).
CREATE OR REPLACE FUNCTION core.customer_refunds_within_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid bigint; paid_ccy char(3); refunded bigint; mismatch int;
BEGIN
  SELECT amount_minor, currency INTO paid, paid_ccy FROM core.payment_attempts WHERE id = NEW.payment_attempt_id;
  SELECT COALESCE(SUM(amount_minor), 0) INTO refunded FROM core.customer_transactions
    WHERE payment_attempt_id = NEW.payment_attempt_id AND kind = 'REFUND' AND status = 'SUCCEEDED';
  SELECT COUNT(*) INTO mismatch FROM core.customer_transactions
    WHERE payment_attempt_id = NEW.payment_attempt_id AND kind = 'REFUND' AND currency <> paid_ccy;
  IF mismatch > 0 OR refunded > paid THEN
    RAISE EXCEPTION 'refunds (%) exceed or mismatch payment % (%)', refunded, NEW.payment_attempt_id, paid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER customer_refunds_within_payment
  AFTER INSERT OR UPDATE ON core.customer_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.customer_refunds_within_payment();
