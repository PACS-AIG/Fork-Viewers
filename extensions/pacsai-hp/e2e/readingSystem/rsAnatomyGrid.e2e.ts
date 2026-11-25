/**
 * RS-36: the 3D anatomy in a cell of the viewer's grid end to end, Chrome
 * launched with SwiftShader's WebGL (rsAnatomyCase.ts). Skipped where the
 * browser still gives no WebGL.
 */
import { test } from '@playwright/test';
import { WEBGL_ARGS, defineAnatomyGridTest } from './rsAnatomyCase';

test.use({ launchOptions: { args: WEBGL_ARGS } });

defineAnatomyGridTest();
