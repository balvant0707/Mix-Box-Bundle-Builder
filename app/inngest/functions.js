import { syncScheduledBoxStatuses } from "../models/boxes.server.js";
import { inngest } from "./client.js";

export const syncScheduledBoxes = inngest.createFunction(
  {
    id: "sync-scheduled-box-statuses",
    name: "Sync scheduled box statuses",
  },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    return step.run("sync scheduled boxes", () => syncScheduledBoxStatuses());
  },
);

export const functions = [syncScheduledBoxes];
