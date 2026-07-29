import type { WorkflowDefinition } from '@tasktwin/workflow-schema';

const NODE_VERTICAL_GAP = 144;

export interface LinearWorkflowGraphNode {
  id: string;
  index: number;
  stepType: WorkflowDefinition['steps'][number]['type'];
  label: string;
  position: {
    x: number;
    y: number;
  };
}

export interface LinearWorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface LinearWorkflowGraph {
  nodes: LinearWorkflowGraphNode[];
  edges: LinearWorkflowGraphEdge[];
}

export function deriveLinearGraph(
  workflow: WorkflowDefinition,
): LinearWorkflowGraph {
  const nodes = workflow.steps.map((step, index) => ({
    id: step.id,
    index,
    stepType: step.type,
    label: step.name,
    position: {
      x: 0,
      y: index * NODE_VERTICAL_GAP,
    },
  }));

  const edges = workflow.steps.slice(1).map((step, index) => {
    const source = workflow.steps[index];
    if (source === undefined) {
      throw new Error('Workflow graph source step is unavailable.');
    }

    return {
      id: `edge:${source.id}:${step.id}`,
      source: source.id,
      target: step.id,
    };
  });

  return { nodes, edges };
}
