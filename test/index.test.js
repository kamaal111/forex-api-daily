const { exec } = require("child_process");
const waitPort = require("wait-port");

async function startFunctionFramework(target, signature, port) {
  const functionFramework = exec(
    `TEST=1 GCP_PROJECT_ID=forex-api-daily-${new Date().getTime()} npx functions-framework --target=${target} --signature-type=${signature} --port=${port}`
  );
  await waitPort({ host: "localhost", port });
  return functionFramework;
}

function httpInvocation(fnUrl, port) {
  const baseUrl = `http://localhost:${port}`;
  return fetch(`${baseUrl}/${fnUrl}`);
}

jest.setTimeout(20_000);

describe("main", () => {
  const PORT = 8081;
  let functionFrameworkProcess;

  beforeAll(async () => {
    functionFrameworkProcess = await startFunctionFramework(
      "main",
      "http",
      PORT
    );
  });

  afterAll(() => {
    functionFrameworkProcess.kill();
  });

  it("successfully saves all documents", async () => {
    const response = await httpInvocation("main", PORT);

    expect(response.status).toEqual(200);
    expect(await response.text()).toEqual("SUCCESS 150");
  });
});
