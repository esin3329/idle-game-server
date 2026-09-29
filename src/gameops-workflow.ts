import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { configureCloudflareEnvironment } from './cloudflare-environment.js';
import { failWorkflowAiRun, processAiRunById } from './ai/worker.js';

interface GameOpsWorkflowParams {
  runId: string;
}

export class GameOpsAiWorkflow extends WorkflowEntrypoint<Env, GameOpsWorkflowParams> {
  async run(event: WorkflowEvent<GameOpsWorkflowParams>, step: WorkflowStep): Promise<void> {
    const runId = event.payload?.runId;
    if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) {
      throw new NonRetryableError('Invalid GameOps analysis run ID.');
    }

    configureCloudflareEnvironment(this.env);

    try {
      await step.do(
        'process-gameops-analysis',
        {
          // A provider call may have completed even if its response was lost; never infer again automatically.
          retries: { limit: 0, delay: 1000 },
          timeout: '90 seconds',
        },
        async () => processAiRunById(runId),
      );
    } catch {
      await step.do(
        'record-gameops-workflow-failure',
        {
          retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
          timeout: '30 seconds',
        },
        async () => failWorkflowAiRun(runId, 'AI_WORKFLOW_FAILED'),
      );
      throw new NonRetryableError('GameOps analysis stopped safely.');
    }
  }
}
