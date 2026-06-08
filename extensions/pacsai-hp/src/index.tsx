import { Types } from '@ohif/core';

import { id } from './id';
import getHangingProtocolModule from './getHangingProtocolModule';
import getCommandsModule from './getCommandsModule';
import { priorOverlayItem, PRIOR_OVERLAY_ITEM_ID } from './overlays/priorOverlayItem';

/**
 * PACS-AI hanging protocols extension.
 *
 * Provides modality-aware current-vs-prior comparison protocols (CT / MR / CR-DX)
 * and a `loadRelevantPriors` command that auto-fetches the most relevant prior
 * study/studies and re-hangs them side by side with the current study.
 */
const pacsaiHpExtension: Types.Extensions.Extension = {
  id,
  getHangingProtocolModule,
  getCommandsModule,
};

export default pacsaiHpExtension;
export { priorOverlayItem, PRIOR_OVERLAY_ITEM_ID };
