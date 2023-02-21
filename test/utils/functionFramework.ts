import {exec} from 'child_process';
// eslint-disable-next-line node/no-unpublished-import
import * as waitPort from 'wait-port';

type Targets = 'main';

export async function startFunctionFramework(
  target: Targets,
  gcpProjectID: string,
  port: number
) {
  const functionFramework = exec(
    `TEST=1 GCP_PROJECT_ID=${gcpProjectID} npx functions-framework --target=${target} --signature-type=http --port=${port}`
  );
  await waitPort({host: 'localhost', port});
  return functionFramework;
}

export async function httpInvocation(target: Targets, port: number) {
  const baseUrl = `http://localhost:${port}`;
  return fetch(`${baseUrl}/${target}`);
}
