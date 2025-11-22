import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import waitPort from 'wait-port';

type Targets = 'main';

const ONE_SECOND_IN_MS = 1000;
const WAIT_PORT_TIMEOUT = ONE_SECOND_IN_MS * 10;

export async function startFunctionFramework(target: Targets, gcpProjectID: string, port: number) {
  const projectRoot = process.cwd();
  const indexJsPath = path.join(projectRoot, 'index.js');
  try {
    await fs.access(indexJsPath);
  } catch {
    throw new Error(`❌ index.js does not exist at ${indexJsPath}. Did the compilation step fail?`);
  }

  console.log('🚀 Starting function-framework server');
  const functionFramework = childProcess.exec(
    `TEST=1 GCP_PROJECT_ID=${gcpProjectID} npx functions-framework --target=${target} --signature-type=http --port=${port}`,
  );
  functionFramework.stdout?.on('data', data => {
    console.log(`📤 [function-framework stdout]: ${data}`);
  });
  functionFramework.stderr?.on('data', data => {
    const message = String(data);
    if (message.includes('MetadataLookupWarning')) {
      return;
    }
    console.error(`⚠️ [function-framework stderr]: ${message}`);
  });
  functionFramework.on('error', error => {
    console.error(`❌ [function-framework error]:`, error);
  });

  console.log(`⏳ Waiting to connect to ${port}`);
  const portReady = await waitPort({ host: '127.0.0.1', port, timeout: WAIT_PORT_TIMEOUT });
  if (!portReady) {
    console.error(`❌ Failed to connect to port ${port} after ${WAIT_PORT_TIMEOUT / ONE_SECOND_IN_MS} seconds`);
    functionFramework.kill();
    throw new Error(`Function framework failed to start on port ${port}`);
  }
  console.log(`✅ Connected to ${port}`);
  return functionFramework;
}

export async function httpInvocation(target: Targets, port: number) {
  const baseUrl = `http://localhost:${port}`;
  console.log(`🌐 Invoking '${target}'`);

  return fetch(`${baseUrl}/${target}`);
}
