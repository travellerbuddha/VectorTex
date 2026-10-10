import * as migration_20261009_230153_cms_initial from './20261009_230153_cms_initial';
import * as migration_20261009_235507_redirects from './20261009_235507_redirects';
import * as migration_20261010_131138_hotel_lists from './20261010_131138_hotel_lists';

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
    name: '20261010_131138_hotel_lists'
  },
];
