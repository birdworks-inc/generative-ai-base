import { addonRegistry } from './registry';
import { LabelerAddon } from '@birdworks-inc/genu-addon-labeler-web';
import { UsermgmtAddon } from '@birdworks-inc/genu-addon-usermgmt-web';
import { ChirpAddon } from '@birdworks-inc/genu-addon-chirp-web';

addonRegistry.push(LabelerAddon);
addonRegistry.push(UsermgmtAddon);
addonRegistry.push(ChirpAddon);
