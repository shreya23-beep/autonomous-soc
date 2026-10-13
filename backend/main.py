import json
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import networkx as nx

app = FastAPI(title="Autonomous SOC Graph Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

attack_graph = nx.DiGraph()
contained_entities = set()

DATA_FILE = Path(__file__).parent / "synthetic_attack_logs.json"

class ContainmentRequest(BaseModel):
    entity: str
    action_type: str = "ISOLATE_HOST"

def process_log(event: dict):
    src = event["source"]
    tgt = event["target"]
    action = event["action"]
    mitre = event.get("mitre_technique", "UNKNOWN")
    severity = event.get("severity", "LOW")

    attack_graph.add_node(src, type="source", label=src)
    attack_graph.add_node(tgt, type="target", label=tgt)
    attack_graph.add_edge(
        src,
        tgt,
        action=action,
        mitre=mitre,
        severity=severity,
        timestamp=event["timestamp"]
    )

    centrality = nx.degree_centrality(attack_graph)
    base_score = centrality.get(src, 0.1) * 2.0
    severity_boost = {"LOW": 0.1, "MEDIUM": 0.3, "HIGH": 0.5, "CRITICAL": 0.8}.get(severity, 0.2)
    risk_score = round(min(1.0, base_score + severity_boost), 2)

    nodes = [{"id": n, "label": n} for n in attack_graph.nodes()]
    edges = [
        {
            "id": f"{u}->{v}-{idx}",
            "source": u,
            "target": v,
            "label": attack_graph[u][v]["action"],
            "mitre": attack_graph[u][v]["mitre"],
            "severity": attack_graph[u][v]["severity"]
        }
        for idx, (u, v) in enumerate(attack_graph.edges())
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "alert": {
            "entity": src,
            "target": tgt,
            "risk_score": risk_score,
            "action": action,
            "mitre": mitre,
            "severity": severity,
            "timestamp": event["timestamp"],
            "is_contained": src in contained_entities
        }
    }

@app.websocket("/ws/telemetry")
async def telemetry_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        with open(DATA_FILE, "r") as f:
            events = json.load(f)

        for event in events:
            payload = process_log(event)
            await websocket.send_text(json.dumps(payload))
            await asyncio.sleep(2.5)

        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass

@app.post("/api/contain")
def trigger_containment(req: ContainmentRequest):
    contained_entities.add(req.entity)
    return {
        "status": "SUCCESS",
        "entity": req.entity,
        "action": req.action_type,
        "message": f"Containment executed: {req.entity} has been isolated across firewall & identity policies."
    }

@app.post("/api/reset")
def reset_graph():
    attack_graph.clear()
    contained_entities.clear()
    return {"status": "RESET_COMPLETE"}