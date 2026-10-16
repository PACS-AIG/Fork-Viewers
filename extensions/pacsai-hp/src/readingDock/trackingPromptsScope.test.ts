/**
 * Rev 11 milestone 6, approach C, phase 1 PR 2: the switch radcopilot sets is
 * an OHIF mode customization. Against OHIF's own CustomizationService: set as
 * radcopilot sets it, the gate reads the prompts as off; the mode's exit (a case
 * switch or leaving the mode) and the next mode's entry clear it, so the next
 * mode entered (longitudinal) starts with the prompts on.
 */
import CustomizationService from '@ohif/core/src/services/CustomizationService/CustomizationService';
import {
  TRACKING_PROMPTS_CUSTOMIZATION,
  trackingPromptsOff,
} from '../../../measurement-tracking/src/contexts/TrackedMeasurementsContext/trackingPrompts';

const extensionManager = {
  getRegisteredExtensionIds: () => [] as string[],
  getModuleEntry: () => undefined,
};

function service() {
  const s = new CustomizationService({ configuration: {}, commandsManager: {} as never });
  s.init(extensionManager as never);
  return s;
}

describe("radcopilot's switch in OHIF's CustomizationService", () => {
  it('unset (every other mode): the prompts are on', () => {
    expect(trackingPromptsOff(service() as never)).toBe(false);
  });

  it('set as radcopilot sets it (mode scope): off; the mode exit clears it', () => {
    const s = service();
    s.onModeEnter();
    s.setCustomizations({ [TRACKING_PROMPTS_CUSTOMIZATION]: { $set: false } });
    expect(s.getCustomization(TRACKING_PROMPTS_CUSTOMIZATION)).toBe(false);
    expect(trackingPromptsOff(s as never)).toBe(true);
    s.onModeExit();
    expect(trackingPromptsOff(s as never)).toBe(false);
  });

  it('the next mode entered starts with the prompts on', () => {
    const s = service();
    s.onModeEnter();
    s.setCustomizations({ [TRACKING_PROMPTS_CUSTOMIZATION]: { $set: false } });
    s.onModeEnter(); // another mode's entry, without the exit having run
    expect(trackingPromptsOff(s as never)).toBe(false);
  });
});
