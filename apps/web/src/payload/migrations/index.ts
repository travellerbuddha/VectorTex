import * as migration_20261009_230153_cms_initial from './20261009_230153_cms_initial';
import * as migration_20261009_235507_redirects from './20261009_235507_redirects';

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
];
