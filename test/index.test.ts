import {ChildProcess, exec} from 'child_process';
// eslint-disable-next-line node/no-unpublished-import
import * as waitPort from 'wait-port';

type Targets = 'main';

async function startFunctionFramework(
  target: Targets,
  signature: 'http',
  port: number
) {
  const functionFramework = exec(
    `TEST=1 GCP_PROJECT_ID=forex-api-daily-${new Date().getTime()} npx functions-framework --target=${target} --signature-type=${signature} --port=${port}`
  );
  await waitPort({host: 'localhost', port});
  return functionFramework;
}

function httpInvocation(target: Targets, port: number) {
  const baseUrl = `http://localhost:${port}`;
  return fetch(`${baseUrl}/${target}`);
}

jest.setTimeout(20_000);

describe('main', () => {
  const PORT = 8081;
  let functionFrameworkProcess: ChildProcess | undefined;

  beforeAll(async () => {
    functionFrameworkProcess = await startFunctionFramework(
      'main',
      'http',
      PORT
    );
  });

  afterAll(() => {
    functionFrameworkProcess?.kill();
  });

  it('successfully saves all documents', async () => {
    const response = await httpInvocation('main', PORT);

    expect(response.status).toEqual(200);
    expect(await response.text()).toEqual('SUCCESS 150');
  });
});
