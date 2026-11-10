import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { replayShift } from '../../lib/replay.mjs';
import { loadDemo } from '../../lib/scenario.mjs';

export default defineTool({
  description: 'Run the plant risk rules on a supplied shift scenario, or replay the fictional sample shift when no scenario is supplied. Returns simulated notifications and open commitments with sources.',
  inputSchema: z.object({ scenario: z.record(z.string(), z.unknown()).optional() }),
  execute({ scenario }) {
    return replayShift(scenario ?? loadDemo());
  },
});
