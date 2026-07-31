import { seedExistingV2Database } from "./v2Seed";

const status = document.querySelector<HTMLElement>("#fixture-status");
const counts = document.querySelector<HTMLElement>("#fixture-counts");
const button = document.querySelector<HTMLButtonElement>("#seed-existing-v2");

if (!status || !counts || !button) throw new Error("Fixture seed page is missing required controls.");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Writing deterministic IndexedDB v2 records…";
  try {
    const result = await seedExistingV2Database();
    counts.textContent = JSON.stringify(result, null, 2);
    status.textContent = "Existing v2 fixture prepared. Continue through the extension UI only.";
  } catch (error) {
    status.textContent = `Fixture preparation failed: ${error instanceof Error ? error.message : "Unknown error"}`;
  } finally {
    button.disabled = false;
  }
});
