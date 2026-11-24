/**
 * RS-36: the anatomy layers end to end, Chrome launched without WebGL, so
 * cornerstone draws the images on its CPU path (rsAnatomyCase.ts).
 */
import { test } from '@playwright/test';
import { CPU_ARGS, defineAnatomyTest } from './rsAnatomyCase';

test.use({ launchOptions: { args: CPU_ARGS } });

defineAnatomyTest('cpu');
