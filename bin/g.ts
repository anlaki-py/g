#!/usr/bin/env node

import { run } from "../src/cli.ts";

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`g: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
