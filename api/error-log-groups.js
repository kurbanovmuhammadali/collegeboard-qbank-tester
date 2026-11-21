import { createGroupingHandler } from '../lib/error-log-grouping.mjs';
export const maxDuration = 60;
const handler = createGroupingHandler();
export const POST = handler;
