import { serve } from "inngest/remix";
import { functions } from "../inngest/functions.js";
import { inngest } from "../inngest/client.js";

const handler = serve({
  client: inngest,
  functions,
});

export { handler as action, handler as loader };
