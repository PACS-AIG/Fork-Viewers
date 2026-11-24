/**
 * RS-36: the anatomy layers end to end, Chrome launched with SwiftShader's
 * WebGL, so cornerstone draws the images with vtk.js (rsAnatomyCase.ts).
 * Skipped where the browser still gives no WebGL.
 */
import { test } from '@playwright/test';
import { WEBGL_ARGS, defineAnatomyTest } from './rsAnatomyCase';

test.use({ launchOptions: { args: WEBGL_ARGS } });

defineAnatomyTest('gpu');
