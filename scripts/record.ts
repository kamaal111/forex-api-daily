import { ChildProcess } from 'node:child_process';

import { httpInvocation, startFunctionFramework } from '../utils/functionFramework';
import { type RequestBody, TARGETS } from '..';

const PORT = 8084;
const TARGET = TARGETS.MAIN;

let functionProcess: ChildProcess | null = null;

async function main() {
  const gcpProjectID = `forex-api-daily-${new Date().getTime()}`;
  functionProcess = await startFunctionFramework(TARGET, gcpProjectID, PORT);

  const payload: RequestBody = { record: true, testing: false };
  const response = await httpInvocation(TARGET, PORT, payload);
  const textResponse = await response.text();

  console.log('RESPONSE', textResponse);
}

function cleanUp() {
  functionProcess?.kill();
}

main().catch(console.error).finally(cleanUp);
