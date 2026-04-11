// Chirp / Quill / Dashboard / Rook have moved to the Nest Portal addon
// registry. See generative-ai-addons/packages/nest-portal/web/src/addons/index.ts
import { addonRegistry } from './registry';
import { LabelerAddon } from '@birdworks-inc/genu-addon-labeler-web';
import { UsermgmtAddon } from '@birdworks-inc/genu-addon-usermgmt-web';

addonRegistry.push(LabelerAddon);
addonRegistry.push(UsermgmtAddon);
