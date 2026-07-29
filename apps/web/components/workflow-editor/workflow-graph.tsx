'use client';

import {
  Background,
  Controls,
  ReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { deriveLinearGraph } from '@tasktwin/workflow-editor-core';
import type { WorkflowDefinition } from '@tasktwin/workflow-schema';
import { useMemo } from 'react';

interface StepNodeData extends Record<string, unknown> {
  order: number;
  stepType: string;
  label: string;
}

type StepNode = Node<StepNodeData, 'step'>;

function WorkflowStepNode({ data, selected }: NodeProps<StepNode>) {
  return (
    <div
      className={`flow-step-node${selected ? ' selected' : ''}`}
      aria-label={`Step ${data.order}: ${data.stepType}, ${data.label}`}
    >
      <span>{data.order}</span>
      <div>
        <small>{data.stepType}</small>
        <strong>{data.label}</strong>
      </div>
    </div>
  );
}

const nodeTypes = { step: WorkflowStepNode };

export interface WorkflowGraphProps {
  definition: WorkflowDefinition;
  selectedStepId: string | null;
  onSelectStep(stepId: string): void;
}

export function WorkflowGraph({
  definition,
  selectedStepId,
  onSelectStep,
}: WorkflowGraphProps) {
  const graph = useMemo(() => deriveLinearGraph(definition), [definition]);
  const nodes: StepNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: 'step',
    position: node.position,
    selected: node.id === selectedStepId,
    draggable: false,
    connectable: false,
    deletable: false,
    ariaLabel: `Step ${node.index + 1}: ${node.stepType}, ${node.label}`,
    data: {
      order: node.index + 1,
      stepType: node.stepType,
      label: node.label,
    },
  }));
  const edges = graph.edges.map((edge) => ({
    ...edge,
    focusable: false,
    deletable: false,
  }));

  return (
    <div className="workflow-graph" aria-label="Linear workflow visualization">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable={false}
        elementsSelectable
        onNodeClick={(_event, node) => onSelectStep(node.id)}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.5}
        maxZoom={1.5}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
