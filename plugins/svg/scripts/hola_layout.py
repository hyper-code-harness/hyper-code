#!/usr/bin/env python3
"""Isolated hola-graph 0.1.5 adapter: MODE INPUT.json OUTPUT.json.

Install: python3 -m venv ~/.hyper/deps/svg/hola-graph-0.1.5
        ~/.hyper/deps/svg/hola-graph-0.1.5/bin/python -m pip install hola-graph==0.1.5
The Python wrapper is MIT; its bundled Adaptagrams engine is LGPL-2.1-or-later.
Upstream: https://github.com/shakfu/hola-graph (v0.1.5),
          https://github.com/shakfu/adaptagrams
Dependencies stay outside the repository; no vendored native library is distributed.
"""
import importlib.metadata
import json
import math
import sys
from pathlib import Path


def layout(data, mode):
    if importlib.metadata.version("hola-graph") != "0.1.5":
        raise RuntimeError("Expected hola-graph==0.1.5")
    from hola_graph import HolaGraph
    from hola_graph._core import ACALayout

    nodes, edges = data["nodes"], data["edges"]
    by_id = {n["id"]: n for n in nodes}
    adjacency = {n["id"]: [] for n in nodes}
    pairs = set()
    for e in edges:
        a, b = e["from"], e["to"]
        pair = frozenset((a, b))
        if a == b or pair in pairs:
            raise ValueError("HOLA/ACA require a simple graph: self-loops and parallel undirected edges are unsupported")
        pairs.add(pair)
        adjacency[a].append(b)
        adjacency[b].append(a)

    components = []
    visited = set()
    for n in nodes:
        if n["id"] in visited:
            continue
        stack, component = [n["id"]], []
        visited.add(n["id"])
        while stack:
            current = stack.pop()
            component.append(current)
            for other in adjacency[current]:
                if other not in visited:
                    visited.add(other)
                    stack.append(other)
        components.append(component)
    if mode == "incremental":
        components = [list(by_id)]

    boxes, routes, warnings = [], [], []
    offset = 0.0
    for component in components:
        ids = set(component)
        component_nodes = [n for n in nodes if n["id"] in ids]
        component_edges = [e for e in edges if e["from"] in ids]
        g = HolaGraph()
        ns = {}
        spacing = max(max(n["w"], n["h"]) for n in component_nodes) + 40
        columns = max(1, math.ceil(math.sqrt(len(component_nodes))))
        for i, n in enumerate(component_nodes):
            x = n.get("x", (i % columns) * spacing) + n["w"] / 2
            y = n.get("y", (i // columns) * spacing) + n["h"] / 2
            ns[n["id"]] = g.add_node(n["w"], n["h"], x=x, y=y, label=n["id"])
        for e in component_edges:
            g.connect(ns[e["from"]], ns[e["to"]])
        # A singleton has no layout constraints; preserve its seeded position.
        if len(component_nodes) > 1:
            if mode == "hola":
                g.layout()
            else:
                aca = ACALayout(g._graph)
                aca.setAvoidNodeOverlaps(True)
                aca.layout()
                aca.updateGraph()
        local_boxes = [{"id": n["id"], "x": ns[n["id"]].x - n["w"] / 2,
                        "y": ns[n["id"]].y - n["h"] / 2, "w": n["w"], "h": n["h"]}
                       for n in component_nodes]
        native_routes = {}
        if mode == "hola" and component_edges:
            section = g.to_tglf().split("#")[1]
            for line in section.strip().splitlines():
                values = line.split()
                a, b = int(values[0]), int(values[1])
                coords = list(map(float, values[2:]))
                if len(coords) < 4 or len(coords) % 2:
                    raise RuntimeError("Native HOLA edge has no usable route")
                native_routes[(a, b)] = [{"x": coords[i], "y": coords[i + 1]} for i in range(0, len(coords), 2)]
        local_routes = []
        for e in component_edges:
            a, b = ns[e["from"]], ns[e["to"]]
            if mode == "incremental":
                points = [{"x": a.x, "y": a.y}, {"x": b.x, "y": b.y}]
            else:
                points = native_routes.get((a.id, b.id))
                if points is None:
                    reverse = native_routes.get((b.id, a.id))
                    if reverse is None:
                        raise RuntimeError("Native HOLA route missing for " + e["id"])
                    points = list(reversed(reverse))
                if any(abs(p["x"] - q["x"]) > 1e-6 and abs(p["y"] - q["y"]) > 1e-6 for p, q in zip(points, points[1:])):
                    raise RuntimeError("Native HOLA produced a nonorthogonal route")
            local_routes.append({**e, "points": points})
        if mode == "hola" and len(components) > 1:
            xs = [b["x"] for b in local_boxes] + [p["x"] for r in local_routes for p in r["points"]]
            ys = [b["y"] for b in local_boxes] + [p["y"] for r in local_routes for p in r["points"]]
            dx, dy = offset - min(xs), -min(ys)
            for b in local_boxes:
                b["x"] += dx
                b["y"] += dy
            for r in local_routes:
                for p in r["points"]:
                    p["x"] += dx
                    p["y"] += dy
            offset = max([b["x"] + b["w"] for b in local_boxes] + [p["x"] for r in local_routes for p in r["points"]]) + 60
        boxes.extend(local_boxes)
        routes.extend(local_routes)
    if mode == "hola" and len(components) > 1:
        warnings.append("Disconnected components laid out independently and packed horizontally.")
    if mode == "incremental":
        warnings.append("ACA aligns node positions; routes are straight center-to-center segments, not obstacle-avoiding routes.")
    box_map, route_map = {b["id"]: b for b in boxes}, {r["id"]: r for r in routes}
    return {"boxes": [box_map[n["id"]] for n in nodes], "routes": [route_map[e["id"]] for e in edges],
            "metadata": {"algorithm": "HOLA" if mode == "hola" else "ACA", "engine": "hola-graph@0.1.5/" + ("HolaGraph.layout" if mode == "hola" else "_core.ACALayout"),
                         "routing": "orthogonal" if mode == "hola" else "straight", "warnings": warnings}}


if __name__ == "__main__":
    mode, source, target = sys.argv[1:]
    if mode not in ("hola", "incremental"):
        raise ValueError("Expected hola or incremental")
    data = json.loads(Path(source).read_text())
    result = layout(data, mode)
    Path(target).write_text(json.dumps(result, allow_nan=False))
