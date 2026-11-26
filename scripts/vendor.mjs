// Fill vendor/ with the LUNA Builder SDK's script-tag bundle, copied from the installed SDK.
// Not kept in git, so UA's code stays out of this repo. Runs after `npm install`.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('vendor', { recursive: true });
copyFileSync('node_modules/@uaudio/luna-builder-sdk/dist/luna.global.js', 'vendor/luna.global.js');
console.log('vendor/luna.global.js copied from the SDK');
