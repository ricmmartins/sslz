#!/usr/bin/env node
import { runGreenfieldJourney } from "../tests/greenfield-journey-fixture.mjs";

try {
  const report = await runGreenfieldJourney();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Greenfield journey validation failed: ${error.message}\n`);
  process.exitCode = 1;
}
