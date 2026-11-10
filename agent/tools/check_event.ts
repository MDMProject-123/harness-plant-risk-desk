import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parseEvent } from '../../lib/scenario.mjs';

export default defineTool({
  description: 'Check the required fields of a draft shift event. This checks shape only. It does not verify the facts or save the draft.',
  inputSchema: z.object({ event: z.record(z.string(), z.unknown()) }),
  execute({ event }) {
    try {
      parseEvent(event);
      return { valid: true, event };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
