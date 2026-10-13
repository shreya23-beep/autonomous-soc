import React, { useState, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from '@dagrejs/dagre';
import { ShieldAlert, ShieldCheck, RefreshCw, Activity, Lock } from 'lucide-react';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 70;

const getLayoutedElements = (nodes, edges, containedList) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const isContained = containedList.includes(node.id);

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
      style: {
        width: NODE_WIDTH,
        background: isContained ? '#450a0a' : '#0f172a',
        color: isContained ? '#f87171' : '#38bdf8',
        border: isContained ? '2px solid #ef4444' : '1px solid #0284c7',
        borderRadius: 10,
        padding: '10px 14px',
        fontWeight: 600,
        fontSize: '12px',
        boxShadow: isContained 
          ? '0 0 15px rgba(239, 68, 68, 0.4)' 
          : '0 4px 14px rgba(2, 132, 199, 0.2)',
        transition: 'all 0.3s ease',
      },
    };
  });

  return { layoutedNodes, layoutedEdges: edges };
};

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [alerts, setAlerts] = useState([]);
  const [containedEntities, setContainedEntities] = useState([]);
  const [containmentLog, setContainmentLog] = useState([]);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8000/ws/telemetry");

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      const rawNodes = data.nodes.map((n) => ({
        id: n.id,
        data: {
          label: (
            <div className="flex items-center justify-between">
              <span className="truncate">{n.label}</span>
              {containedEntities.includes(n.id) && (
                <Lock className="w-3.5 h-3.5 text-red-400 shrink-0 ml-1" />
              )}
            </div>
          ),
        },
      }));

      const rawEdges = data.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${e.label} [${e.mitre}]`,
        type: 'smoothstep',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: e.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b',
        },
        style: {
          stroke: e.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b',
          strokeWidth: 2,
        },
        labelStyle: {
          fill: '#cbd5e1',
          fontSize: 10,
          fontWeight: 500,
        },
        labelBgStyle: {
          fill: '#090d16',
          fillOpacity: 0.85,
        },
      }));

      const { layoutedNodes, layoutedEdges } = getLayoutedElements(
        rawNodes,
        rawEdges,
        containedEntities
      );

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);

      if (data.alert) {
        setAlerts((prev) => [data.alert, ...prev]);
      }
    };

    return () => ws.close();
  }, [containedEntities, setNodes, setEdges]);

  const handleContain = async (entity) => {
    try {
      const res = await fetch("http://localhost:8000/api/contain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, action_type: "ISOLATE_HOST" })
      });
      const data = await res.json();
      
      setContainedEntities((prev) => [...new Set([...prev, entity])]);
      setContainmentLog((prev) => [data.message, ...prev]);
    } catch (err) {
      console.error("Containment API error:", err);
    }
  };

  const handleReset = async () => {
    try {
      await fetch("http://localhost:8000/api/reset", { method: "POST" });
    } catch (err) {
      console.error(err);
    }
    setNodes([]);
    setEdges([]);
    setAlerts([]);
    setContainedEntities([]);
    setContainmentLog([]);
    window.location.reload();
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Left Canvas: Real-Time Attack Graph */}
      <div className="flex-1 flex flex-col h-full border-r border-slate-800">
        <header className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/60 backdrop-blur">
          <div className="flex items-center gap-3">
            <Activity className="text-sky-400 h-5 w-5 animate-pulse" />
            <span className="font-semibold text-sm tracking-wider uppercase text-sky-300">
              Autonomous SOC: Real-Time Attack Graph Telemetry
            </span>
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reset Stream
          </button>
        </header>

        <div className="flex-1 h-full bg-slate-950 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
          >
            <Background color="#1e293b" gap={20} />
            <Controls className="fill-slate-400 bg-slate-900 border border-slate-800" />
          </ReactFlow>
        </div>
      </div>

      {/* Right Drawer: Triage & Automated Response */}
      <div className="w-[430px] flex flex-col h-full bg-slate-900/40 border-l border-slate-800">
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <ShieldAlert className="text-red-400 h-4 w-4" /> Live Incident Stream
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {alerts.length === 0 ? (
            <p className="text-xs text-slate-500 text-center mt-12">Listening for incoming telemetry...</p>
          ) : (
            alerts.map((alert, i) => {
              const isAlreadyContained = containedEntities.includes(alert.entity);
              return (
                <div key={i} className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-lg shadow-sm">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-bold text-slate-200">{alert.action}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      alert.severity === 'CRITICAL' 
                        ? 'bg-red-950 text-red-400 border border-red-800' 
                        : 'bg-amber-950 text-amber-400 border border-amber-800'
                    }`}>
                      Risk: {alert.risk_score}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-0.5 font-mono">
                    <p>Source: <span className="text-sky-300">{alert.entity}</span></p>
                    <p>Target: <span className="text-slate-300">{alert.target}</span></p>
                    <p>MITRE ID: <span className="text-amber-300">{alert.mitre}</span></p>
                  </div>
                  <button
                    onClick={() => handleContain(alert.entity)}
                    disabled={isAlreadyContained}
                    className={`mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 px-3 font-medium text-xs rounded transition ${
                      isAlreadyContained
                        ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                        : 'bg-red-600/90 hover:bg-red-600 text-white cursor-pointer'
                    }`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {isAlreadyContained ? 'Entity Contained' : 'Isolate Source Entity'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Containment Execution Log */}
        {containmentLog.length > 0 && (
          <div className="p-4 border-t border-slate-800 bg-slate-950/80 max-h-48 overflow-y-auto font-mono text-[11px] text-emerald-400">
            <div className="font-bold text-slate-400 uppercase text-[10px] mb-1">Execution Audit Log</div>
            {containmentLog.map((log, i) => (
              <div key={i} className="py-0.5">✓ {log}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}