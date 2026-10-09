-- Site content in Payload (P06, ADR-0003/0010): editing and publishing are separate permissions.
INSERT INTO core.permissions (code, description_tr, description_en) VALUES
  ('content.edit', 'Site içeriği (sayfa, destinasyon, yazı, SSS, kampanya, menü, görsel) taslağı oluşturma ve düzenleme', 'Create and edit site content drafts (pages, destinations, posts, FAQs, campaigns, menus, images)'),
  ('content.publish', 'Site içeriğini yayınlama, yayından kaldırma ve silme', 'Publish, unpublish and delete site content');
