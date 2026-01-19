import React, { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

type Tool =
    | "freehand"
    | "line"
    | "rect"
    | "circle"
    | "arrow"
    | "select"
    | "move"
    | "eraser"
    | "fill";

type Drawable =
    | {
        id: string;
        type: "freehand";
        points: Point[];
        stroke: string;
        width: number;
    }
    | {
        id: string;
        type: "line" | "arrow";
        start: Point;
        end: Point;
        stroke: string;
        width: number;
    }
    | {
        id: string;
        type: "rect";
        x: number;
        y: number;
        w: number;
        h: number;
        stroke: string;
        width: number;
        fill?: string;
    }
    | {
        id: string;
        type: "circle";
        cx: number;
        cy: number;
        r: number;
        stroke: string;
        width: number;
        fill?: string;
    };

function uid() {
    return Math.random().toString(36).slice(2, 10);
}

function clampRect(x: number, y: number, w: number, h: number) {
    const nx = w < 0 ? x + w : x;
    const ny = h < 0 ? y + h : y;
    const nw = Math.abs(w);
    const nh = Math.abs(h);
    return { x: nx, y: ny, w: nw, h: nh };
}

function dist(a: Point, b: Point) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function distancePointToSegment(p: Point, a: Point, b: Point) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) return dist(p, a);
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * abx, y: a.y + t * aby };
    return dist(p, proj);
}

function pointInRect(p: Point, r: { x: number; y: number; w: number; h: number }) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function pointInCircle(p: Point, c: { cx: number; cy: number; r: number }) {
    return dist(p, { x: c.cx, y: c.cy }) <= c.r;
}

function getCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) {
    // ctxをDPRで拡大しているので、座標はCSSピクセルで取る（倍率を掛けない）
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x, y };
}

function drawArrowHead(ctx: CanvasRenderingContext2D, from: Point, to: Point, size: number) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const a1 = angle + Math.PI * 0.85;
    const a2 = angle - Math.PI * 0.85;

    const p1 = { x: to.x + Math.cos(a1) * size, y: to.y + Math.sin(a1) * size };
    const p2 = { x: to.x + Math.cos(a2) * size, y: to.y + Math.sin(a2) * size };

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
}

function getBounds(d: Drawable) {
    if (d.type === "freehand") {
        const xs = d.points.map((p) => p.x);
        const ys = d.points.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (d.type === "line" || d.type === "arrow") {
        const minX = Math.min(d.start.x, d.end.x);
        const maxX = Math.max(d.start.x, d.end.x);
        const minY = Math.min(d.start.y, d.end.y);
        const maxY = Math.max(d.start.y, d.end.y);
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (d.type === "rect") return { x: d.x, y: d.y, w: d.w, h: d.h };
    if (d.type === "circle") return { x: d.cx - d.r, y: d.cy - d.r, w: d.r * 2, h: d.r * 2 };
    return { x: 0, y: 0, w: 0, h: 0 };
}

function hitTest(d: Drawable, p: Point) {
    const tol = Math.max(8, d.width * 2);

    if (d.type === "freehand") {
        for (let i = 0; i < d.points.length - 1; i++) {
            if (distancePointToSegment(p, d.points[i], d.points[i + 1]) <= tol) return true;
        }
        return false;
    }

    if (d.type === "line" || d.type === "arrow") {
        return distancePointToSegment(p, d.start, d.end) <= tol;
    }

    if (d.type === "rect") {
        return pointInRect(p, d);
    }
    if (d.type === "circle") {
        return pointInCircle(p, d);
    }
    return false;
}

function translateDrawable(d: Drawable, dx: number, dy: number): Drawable {
    if (d.type === "freehand") {
        return { ...d, points: d.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    }
    if (d.type === "line" || d.type === "arrow") {
        return {
            ...d,
            start: { x: d.start.x + dx, y: d.start.y + dy },
            end: { x: d.end.x + dx, y: d.end.y + dy },
        };
    }
    if (d.type === "rect") return { ...d, x: d.x + dx, y: d.y + dy };
    if (d.type === "circle") return { ...d, cx: d.cx + dx, cy: d.cy + dy };
    return d;
}

type SavePayload = {
    version: number;
    items: Drawable[];
    meta?: { createdAt: string };
};

async function shareOrDownloadFile(file: File, fallbackName: string) {
    const navAny = navigator as any;

    // Web Share API（ファイル共有）が使えるなら最優先（iPadで「ファイルに保存」しやすい）
    try {
        if (navAny?.canShare?.({ files: [file] }) && navAny?.share) {
            await navAny.share({ files: [file], title: fallbackName });
            return;
        }
    } catch {
        // 失敗したらダウンロードへフォールバック
    }

    // ダウンロード（PC向け）: iOS Safariでは挙動が不安定なことがある
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name || fallbackName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function DrawingCanvas() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [tool, setTool] = useState<Tool>("freehand");
    const [stroke, setStroke] = useState("#111");
    const [lineWidth, setLineWidth] = useState(4);
    const [fillColor, setFillColor] = useState("#c7d2fe");

    const [items, setItems] = useState<Drawable[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<Drawable | null>(null);

    const movingRef = useRef<{ last: Point } | null>(null);



    // canvasの論理サイズ（CSSピクセル）
    const sizeRef = useRef({ w: 900, h: 600, dpr: 1 });

    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;

        const dpr = window.devicePixelRatio || 1;
        const cssW = 900;
        const cssH = 600;

        sizeRef.current = { w: cssW, h: cssH, dpr };

        c.style.width = `${cssW}px`;
        c.style.height = `${cssH}px`;

        c.width = Math.floor(cssW * dpr);
        c.height = Math.floor(cssH * dpr);

        const ctx = c.getContext("2d");
        if (ctx) {
            // 毎回リセットしてからDPR適用（ズレ防止）
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }, []);

    function redraw() {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext("2d");
        if (!ctx) return;

        const { w, h } = sizeRef.current;

        ctx.clearRect(0, 0, w, h);

        // 背景
        ctx.save();
        ctx.fillStyle = "#d6d6d6";
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        const drawOne = (d: Drawable, isSelected: boolean) => {
            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            if (d.type === "rect" || d.type === "circle") {
                if (d.fill) {
                    ctx.fillStyle = d.fill;
                    if (d.type === "rect") ctx.fillRect(d.x, d.y, d.w, d.h);
                    else {
                        ctx.beginPath();
                        ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            ctx.strokeStyle = d.stroke;
            ctx.lineWidth = d.width;

            if (d.type === "freehand") {
                if (d.points.length < 2) return;
                ctx.beginPath();
                ctx.moveTo(d.points[0].x, d.points[0].y);
                for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i].x, d.points[i].y);
                ctx.stroke();
            } else if (d.type === "line") {
                ctx.beginPath();
                ctx.moveTo(d.start.x, d.start.y);
                ctx.lineTo(d.end.x, d.end.y);
                ctx.stroke();
            } else if (d.type === "arrow") {
                ctx.beginPath();
                ctx.moveTo(d.start.x, d.start.y);
                ctx.lineTo(d.end.x, d.end.y);
                ctx.stroke();
                drawArrowHead(ctx, d.start, d.end, Math.max(12, d.width * 3));
            } else if (d.type === "rect") {
                ctx.strokeRect(d.x, d.y, d.w, d.h);
            } else if (d.type === "circle") {
                ctx.beginPath();
                ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
                ctx.stroke();
            }

            if (isSelected) {
                const b = getBounds(d);
                ctx.save();
                ctx.strokeStyle = "#2563eb";
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 6]);
                ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
                ctx.restore();
            }

            ctx.restore();
        };

        for (const it of items) drawOne(it, it.id === selectedId);
        if (draft) drawOne(draft, false);
    }

    useEffect(() => {
        redraw();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, draft, selectedId]);

    function pickTop(p: Point) {
        for (let i = items.length - 1; i >= 0; i--) {
            if (hitTest(items[i], p)) return items[i].id;
        }
        return null;
    }

    function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
        const c = canvasRef.current;
        if (!c) return;
        c.setPointerCapture(e.pointerId);

        const p = getCanvasPoint(e, c);

        if (tool === "select") {
            setSelectedId(pickTop(p));
            return;
        }

        if (tool === "fill") {
            const id = pickTop(p);
            if (!id) return;
            setItems((prev) =>
                prev.map((it) => {
                    if (it.id !== id) return it;
                    if (it.type === "rect" || it.type === "circle") return { ...it, fill: fillColor };
                    return it;
                })
            );
            setSelectedId(id);
            return;
        }

        if (tool === "eraser") {
            const id = pickTop(p);
            if (!id) return;
            setItems((prev) => prev.filter((it) => it.id !== id));
            if (selectedId === id) setSelectedId(null);
            return;
        }

        if (tool === "move") {
            const id = selectedId ?? pickTop(p);
            setSelectedId(id);
            if (!id) return;
            movingRef.current = { last: p };
            return;
        }

        if (tool === "freehand") {
            setDraft({
                id: uid(),
                type: "freehand",
                points: [p],
                stroke,
                width: lineWidth,
            });
            return;
        }

        if (tool === "line" || tool === "arrow") {
            setDraft({
                id: uid(),
                type: tool,
                start: p,
                end: p,
                stroke,
                width: lineWidth,
            });
            return;
        }

        if (tool === "rect") {
            setDraft({
                id: uid(),
                type: "rect",
                x: p.x,
                y: p.y,
                w: 0,
                h: 0,
                stroke,
                width: lineWidth,
            });
            return;
        }

        if (tool === "circle") {
            setDraft({
                id: uid(),
                type: "circle",
                cx: p.x,
                cy: p.y,
                r: 0,
                stroke,
                width: lineWidth,
            });
            return;
        }
    }

    function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
        const c = canvasRef.current;
        if (!c) return;
        const p = getCanvasPoint(e, c);

        if (tool === "move") {
            const mv = movingRef.current;
            if (!mv || !selectedId) return;
            const dx = p.x - mv.last.x;
            const dy = p.y - mv.last.y;
            mv.last = p;

            setItems((prev) => prev.map((it) => (it.id === selectedId ? translateDrawable(it, dx, dy) : it)));
            return;
        }

        if (!draft) return;

        if (draft.type === "freehand") {
            setDraft({ ...draft, points: [...draft.points, p] });
            return;
        }

        if (draft.type === "line" || draft.type === "arrow") {
            setDraft({ ...draft, end: p });
            return;
        }

        if (draft.type === "rect") {
            const w = p.x - draft.x;
            const h = p.y - draft.y;
            const r = clampRect(draft.x, draft.y, w, h);
            setDraft({ ...draft, ...r });
            return;
        }

        if (draft.type === "circle") {
            const r = dist({ x: draft.cx, y: draft.cy }, p);
            setDraft({ ...draft, r });
            return;
        }
    }

    function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
        const c = canvasRef.current;
        if (!c) return;
        c.releasePointerCapture(e.pointerId);

        movingRef.current = null;

        if (!draft) return;

        const shouldKeep = (() => {
            if (draft.type === "freehand") return draft.points.length > 2;
            if (draft.type === "line" || draft.type === "arrow") return dist(draft.start, draft.end) > 6;
            if (draft.type === "rect") return draft.w > 6 && draft.h > 6;
            if (draft.type === "circle") return draft.r > 6;
            return true;
        })();

        if (shouldKeep) {
            setItems((prev) => [...prev, draft]);
            setSelectedId(draft.id);
        }

        setDraft(null);
    }

    async function saveJSON() {
        const payload: SavePayload = {
            version: 1,
            items,
            meta: { createdAt: new Date().toISOString() },
        };
        const text = JSON.stringify(payload, null, 2);
        const fileName = `draw-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        const file = new File([text], fileName, { type: "application/json" });
        await shareOrDownloadFile(file, fileName);
    }

    async function savePNG() {
        const c = canvasRef.current;
        if (!c) return;

        // 画面表示はDPR拡大しているが、エクスポートはそのままBlob化でOK
        //（iPadの「共有」→「ファイルに保存」で確実に保存するのが狙い）
        const blob: Blob | null = await new Promise((resolve) => c.toBlob((b) => resolve(b), "image/png"));
        if (!blob) return;

        const fileName = `draw-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        const file = new File([blob], fileName, { type: "image/png" });
        await shareOrDownloadFile(file, fileName);
    }

    function openJSONPicker() {
        fileInputRef.current?.click();
    }

    async function onOpenFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text) as SavePayload;

            if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
                alert("Invalid JSON format");
                return;
            }

            setItems(parsed.items);
            setSelectedId(null);
            setDraft(null);
        } catch (err) {
            alert("Failed to open JSON");
        } finally {
            // 同じファイルを連続で選べるようにリセット
            e.target.value = "";
        }
    }

    return (
        <div style={{ display: "grid", gap: 12 }}>
            {/* ツールUI */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {(
                    [
                        ["freehand", "✏️"],
                        ["line", "／"],
                        ["rect", "□"],
                        ["circle", "◯"],
                        ["arrow", "➤"],
                        ["select", "選択"],
                        ["move", "移動"],
                        ["eraser", "消し"],
                        ["fill", "塗り"],
                    ] as const
                ).map(([t, label]) => (
                    <button
                        key={t}
                        onClick={() => setTool(t)}
                        style={{
                            padding: "8px 10px",
                            borderRadius: 12,
                            border: tool === t ? "2px solid #111" : "1px solid #999",
                            background: tool === t ? "#fff" : "#f3f4f6",
                        }}
                    >
                        {label}
                    </button>
                ))}

                <div style={{ marginLeft: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        線
                        <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} />
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        太さ
                        <input
                            type="range"
                            min={1}
                            max={16}
                            value={lineWidth}
                            onChange={(e) => setLineWidth(Number(e.target.value))}
                        />
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        塗り色
                        <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)} />
                    </label>
                </div>
            </div>

            {/* 保存UI：PNG/JSONを別ボタン */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button
                    onClick={savePNG}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid #999",
                        background: "#f3f4f6",
                    }}
                >
                    PNG Save
                </button>
                <button
                    onClick={saveJSON}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid #999",
                        background: "#f3f4f6",
                    }}
                >
                    JSON Save
                </button>
                <button
                    onClick={openJSONPicker}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid #999",
                        background: "#f3f4f6",
                    }}
                >
                    Open(JSON)
                </button>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={onOpenFileSelected}
                    style={{ display: "none" }}
                />
            </div>

            <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                    width: "900px",
                    height: "600px",
                    touchAction: "none",
                    borderRadius: 16,
                    background: "#d6d6d6",
                }}
            />
        </div>
    );
}
