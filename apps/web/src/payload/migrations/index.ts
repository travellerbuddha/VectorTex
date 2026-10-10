import * as migration_20261009_230153_cms_initial from './20261009_230153_cms_initial';
import * as migration_20261009_235507_redirects from './20261009_235507_redirects';
import * as migration_20261010_131138_hotel_lists from './20261010_131138_hotel_lists';
import * as migration_20261010_163509_localized_menu_links from './20261010_163509_localized_menu_links';
import * as migration_20261010_165226_tracking_settings from './20261010_165226_tracking_settings';
import * as migration_20261010_172320_price_alert_threshold from './20261010_172320_price_alert_threshold';
import * as migration_20261010_173022_scheduled_publish from './20261010_173022_scheduled_publish';
import * as migration_20261010_183311_site_verification_codes from './20261010_183311_site_verification_codes';

export const migrations = [
  {
    up: migration_20261009_230153_cms_initial.up,
    down: migration_20261009_230153_cms_initial.down,
    name: '20261009_230153_cms_initial',
  },
  {
    up: migration_20261009_235507_redirects.up,
    down: migration_20261009_235507_redirects.down,
    name: '20261009_235507_redirects',
  },
  {
    up: migration_20261010_131138_hotel_lists.up,
    down: migration_20261010_131138_hotel_lists.down,
    name: '20261010_131138_hotel_lists',
  },
  {
    up: migration_20261010_163509_localized_menu_links.up,
    down: migration_20261010_163509_localized_menu_links.down,
    name: '20261010_163509_localized_menu_links',
  },
  {
    up: migration_20261010_165226_tracking_settings.up,
    down: migration_20261010_165226_tracking_settings.down,
    name: '20261010_165226_tracking_settings',
  },
  {
    up: migration_20261010_172320_price_alert_threshold.up,
    down: migration_20261010_172320_price_alert_threshold.down,
    name: '20261010_172320_price_alert_threshold',
  },
  {
    up: migration_20261010_173022_scheduled_publish.up,
    down: migration_20261010_173022_scheduled_publish.down,
    name: '20261010_173022_scheduled_publish',
  },
  {
    up: migration_20261010_183311_site_verification_codes.up,
    down: migration_20261010_183311_site_verification_codes.down,
    name: '20261010_183311_site_verification_codes',
  },
];
