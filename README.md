# Harness Plant Risk Desk

Replay a shift at an automotive wiring harness plant. See who owns each open commitment, when a line or shipment may be affected, and which alerts still need acknowledgement.

## Run the demo

From the project directory, use Node.js 22.18 or newer:

```sh
npm run demo
```

The demo uses fictional events and runs without installing packages or configuring a model. At 10:00 UTC, it flags a connector shortage projected for 11:00 UTC. It records an escalation at 10:10 UTC because Logistics acknowledges at 10:12 UTC. The same shift shows a crimp press repair slipping, a reported quality hold, and an upcoming Planning commitment.

To replay your own scenario or get machine-readable output:

```sh
node cli.mjs examples/demo-shift.json --json
npm test
```

## Prepare a shift

Copy [the sample shift](examples/demo-shift.json) and update the managers, UTC time window, rules, and events. Put nonpublic files in the ignored `private/` folder. The replay orders events by observation time and uses file order for events with equal timestamps. Use a stable issue ID across updates, acknowledgements, and closure.

| Event | Required information | When it alerts |
| --- | --- | --- |
| Material shortage | Component, line, remaining stock in minutes, replenishment ETA | Replenishment is later than projected stock depletion and depletion enters the configured lead window |
| Downtime | Machine, line, recovery ETA, latest restart time that can protect the shipment | Recovery is later than the latest restart and that restart deadline enters the lead window |
| Quality | Lot, line, failure count, hold status, shipment cutoff | A hold is reported or the failure count meets the configured threshold |
| Department commitment | Title, owner department, line or work area, due time, blocked status | The commitment is still open when due or a reported blocker enters the lead window |
| Acknowledge or resolve | Issue ID, manager name, timestamp, source | The owning manager or plant manager records acknowledgement or closure |

Each observation includes a source and next action. An alert goes to the plant manager and the department owner. The acknowledgement deadline is shortened if the projected impact is sooner than the normal acknowledgement window. A late acknowledgement keeps the escalation in the audit trail and stops further reminders. A worsening forecast or newly reported hold can start a fresh acknowledgement window. Acknowledged issues stay on the action list until resolved or cleared by a newer observation.

Projected times depend on the observations provided. A quality threshold alert asks for review. Hold status comes from the quality observation.

## Use the AI assistant

The optional [eve](https://eve.dev/docs/getting-started) assistant requires Node.js 24 or newer and model access. With an AI Gateway credential configured locally, run:

```sh
npm ci
npm run dev
```

Try “Replay the sample shift and tell me what needs the plant manager's attention” or paste a shift note and ask for a draft event. The assistant calls the same rules as the CLI. Drafts can be reviewed and added to the scenario file for replay.

The first release reads shift files and records simulated notifications. A plant pilot would need a current event feed, a live delivery channel, and thresholds agreed with department managers.

## License

[MIT](LICENSE)
