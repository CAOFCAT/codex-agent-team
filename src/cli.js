#!/usr/bin/env node
import { main } from './index.js';

main(process.argv.slice(2)).catch((error) => {
  console.error(`agent-team: ${error.message}`);
  process.exitCode = 1;
});
