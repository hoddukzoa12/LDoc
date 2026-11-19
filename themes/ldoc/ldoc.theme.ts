// The ldoc theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in ldoc.settings.json and the generated ldoc.settings.ts;
// change them with `astryx experimental theme editor set ldoc ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {ldocSettings} from './ldoc.settings';

export const ldocTheme = defineTheme({
  extends: ldocSettings,
  name: 'ldoc',
});
