import { generateDataset } from "../generate.js";
import { createFakeCin7 } from "./server.js";

const port = Number(process.env.FAKE_CIN7_PORT ?? 4010);
const app = createFakeCin7(generateDataset({ seed: 42, asOf: "2026-11-01", months: 24 }), {
	accountId: process.env.FAKE_CIN7_ACCOUNT_ID ?? "fake-account-id",
	applicationKey: process.env.FAKE_CIN7_APPLICATION_KEY ?? "fake-application-key",
	filesOrigin: process.env.FAKE_CIN7_FILES_ORIGIN,
});

app.listen(port, () => {
	console.log(`fake Cin7 on :${port} (base URL http://localhost:${port}/ExternalApi/v2/)`);
});
