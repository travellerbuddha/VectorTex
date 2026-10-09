import * as migration_20261009_230153_cms_initial from './20261009_230153_cms_initial';

export const migrations = [
  {
    up: migration_20261009_230153_cms_initial.up,
    down: migration_20261009_230153_cms_initial.down,
    name: '20261009_230153_cms_initial'
  },
];
