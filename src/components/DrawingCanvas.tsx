import React, { useEffect, useRef, useState } from "react";

type Snapshot = {
    items: Drawable[];
    selectedIds: string[];
    settings: AppSettings;
};
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
    | "fill"
    | "measure"
    | "pan"
    | "resize";

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "t" | "b" | "l" | "r" | "start" | "end";

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
    }
    | {
        id: string;
        type: "measure";
        start: Point;
        end: Point;
        stroke: string;
        width: number;
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
    if (d.type === "measure") {
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

function getResizeHandles(d: Drawable): { id: ResizeHandle; x: number; y: number }[] {
    if (d.type === "rect") {
        return [
            { id: "nw", x: d.x, y: d.y },
            { id: "ne", x: d.x + d.w, y: d.y },
            { id: "sw", x: d.x, y: d.y + d.h },
            { id: "se", x: d.x + d.w, y: d.y + d.h },
        ];
    }
    if (d.type === "circle") {
        return [
            { id: "t", x: d.cx, y: d.cy - d.r },
            { id: "b", x: d.cx, y: d.cy + d.r },
            { id: "l", x: d.cx - d.r, y: d.cy },
            { id: "r", x: d.cx + d.r, y: d.cy },
        ];
    }
    if (d.type === "line" || d.type === "arrow" || d.type === "measure") {
        return [
            { id: "start", x: d.start.x, y: d.start.y },
            { id: "end", x: d.end.x, y: d.end.y },
        ];
    }
    return [];
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

    if (d.type === "measure") {
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
    if (d.type === "measure") {
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

type AppSettings = {
    unit: "mm" | "cm" | "m";
    gridSize: number; // grid px (still used for snapping if desired)
    mmPerPx: number;  // 1px = ? mm
    snapEnabled: boolean;
    // Numerical Inputs
    fixedLength?: string;
    fixedWidth?: string;
    fixedHeight?: string;
    fixedDiameter?: string;
    angleSnapEnabled: boolean;
    fixedAngle: string;
};

type SavePayload = {
    version: number;
    items: Drawable[];
    settings?: AppSettings;
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
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
    const [draft, setDraft] = useState<Drawable | null>(null);

    // History
    const [history, setHistory] = useState<Snapshot[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);

    // Snap
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [gridSize, setGridSize] = useState(10);
    // Scale Settings
    const [unit, setUnit] = useState<"mm" | "cm" | "m">("mm");
    const [mmPerPx, setMmPerPx] = useState(1); // 1px = 1mm (default)

    // Numerical Inputs (Drawing Size)
    // stringで管理して空入力を許容する
    const [fixedLength, setFixedLength] = useState(""); // for line/arrow
    const [fixedWidth, setFixedWidth] = useState("");   // for rect
    const [fixedHeight, setFixedHeight] = useState(""); // for rect
    const [fixedDiameter, setFixedDiameter] = useState(""); // for circle
    const [angleSnapEnabled, setAngleSnapEnabled] = useState(true);
    const [fixedAngle, setFixedAngle] = useState(""); // deg

    const [helpOpen, setHelpOpen] = useState(false);

    const [view, setView] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
    const pointersRef = useRef<Record<number, Point>>({});
    const lastPinchDistRef = useRef<number | null>(null);

    const snapToGrid = (p: Point) => {
        if (!snapEnabled) return p;
        return {
            x: Math.round(p.x / gridSize) * gridSize,
            y: Math.round(p.y / gridSize) * gridSize,
        };
    };

    const snapAngle = (start: Point, end: Point) => {
        if (!snapEnabled) return end;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 4) return end;
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        return {
            x: start.x + Math.cos(snappedAngle) * dist,
            y: start.y + Math.sin(snappedAngle) * dist,
        };
    };

    const pushHistory = (nextItems: Drawable[], nextSelectedIds: string[], settingsOverride?: Partial<AppSettings>) => {
        const newSnapshot: Snapshot = {
            items: nextItems,
            selectedIds: nextSelectedIds,
            settings: {
                unit,
                gridSize,
                mmPerPx,
                snapEnabled,
                fixedLength,
                fixedWidth,
                fixedHeight,
                fixedDiameter,
                angleSnapEnabled,
                fixedAngle,
                ...settingsOverride
            }
        };
        setHistory((prev) => {
            const newHistory = prev.slice(0, historyIndex + 1);
            newHistory.push(newSnapshot);
            return newHistory;
        });
        setHistoryIndex((prev) => prev + 1);
    };

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    const undo = () => {
        if (!canUndo) return;
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        const snap = history[nextIndex];
        setItems(snap.items);
        setSelectedIds(snap.selectedIds);
        setUnit(snap.settings.unit);
        setGridSize(snap.settings.gridSize);
        setMmPerPx(snap.settings.mmPerPx);
        setSnapEnabled(snap.settings.snapEnabled);
        setFixedLength(snap.settings.fixedLength || "");
        setFixedWidth(snap.settings.fixedWidth || "");
        setFixedHeight(snap.settings.fixedHeight || "");
        setFixedDiameter(snap.settings.fixedDiameter || "");
        setAngleSnapEnabled(snap.settings.angleSnapEnabled !== false);
        setFixedAngle(snap.settings.fixedAngle || "");
    };

    const redo = () => {
        if (!canRedo) return;
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        const snap = history[nextIndex];
        setItems(snap.items);
        setSelectedIds(snap.selectedIds);
        setUnit(snap.settings.unit);
        setGridSize(snap.settings.gridSize);
        setMmPerPx(snap.settings.mmPerPx);
        setSnapEnabled(snap.settings.snapEnabled);
        setFixedLength(snap.settings.fixedLength || "");
        setFixedWidth(snap.settings.fixedWidth || "");
        setFixedHeight(snap.settings.fixedHeight || "");
        setFixedDiameter(snap.settings.fixedDiameter || "");
        setAngleSnapEnabled(snap.settings.angleSnapEnabled !== false);
        setFixedAngle(snap.settings.fixedAngle || "");
    };

    // Initial History
    useEffect(() => {
        if (history.length === 0) {
            setHistory([{
                items: [],
                selectedIds: [],
                settings: { unit: "mm", gridSize: 10, mmPerPx: 1, snapEnabled: true, angleSnapEnabled: true, fixedAngle: "" }
            }]);
            setHistoryIndex(0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const movingRef = useRef<{ last: Point } | null>(null);
    const resizingRef = useRef<{ handle: ResizeHandle; startItem: Drawable } | null>(null);

    const duplicateSelected = () => {
        if (selectedIds.length === 0) return;

        const newClones: Drawable[] = [];
        const nextSelectedIds: string[] = [];

        for (const id of selectedIds) {
            const item = items.find((it) => it.id === id);
            if (!item) continue;

            const newItem = JSON.parse(JSON.stringify(item));
            newItem.id = uid();
            const translated = translateDrawable(newItem, 10, 10);
            newClones.push(translated);
            nextSelectedIds.push(translated.id);
        }

        const nextItems = [...items, ...newClones];
        setItems(nextItems);
        setSelectedIds(nextSelectedIds);
        pushHistory(nextItems, nextSelectedIds);
    };

    const deleteSelected = () => {
        if (selectedIds.length === 0) return;
        const nextItems = items.filter((it) => !selectedIds.includes(it.id));
        setItems(nextItems);
        setSelectedIds([]);
        pushHistory(nextItems, []);
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "d") {
                e.preventDefault();
                duplicateSelected();
            }
            if (e.key === "Backspace" || e.key === "Delete") {
                if (document.activeElement?.tagName !== "INPUT") {
                    deleteSelected();
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [items, selectedIds]);



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

        const { w, h, dpr } = sizeRef.current;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // 背景
        ctx.fillStyle = "#d6d6d6";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, view.offsetX * dpr, view.offsetY * dpr);

        const drawOne = (d: Drawable, isSelected: boolean) => {
            ctx.save();
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            // ... (rest of drawOne logic remains the same inside)

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
            } else if (d.type === "measure") {
                ctx.beginPath();
                ctx.moveTo(d.start.x, d.start.y);
                ctx.lineTo(d.end.x, d.end.y);
                ctx.stroke();

                // Draw text
                const distPx = dist(d.start, d.end);

                // 距離(mm) = 距離(px) * mmPerPx
                const distMm = distPx * mmPerPx;

                let val = distMm;
                if (unit === "cm") val = distMm / 10;
                else if (unit === "m") val = distMm / 1000;

                const valStr = val.toFixed(1);
                const text = `${valStr} ${unit}`;

                const cx = (d.start.x + d.end.x) / 2;
                const cy = (d.start.y + d.end.y) / 2;

                ctx.save();
                ctx.fillStyle = d.stroke;
                ctx.font = "bold 14px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                // 背景に白を敷く（見やすくするため）
                const metrics = ctx.measureText(text);
                const bgW = metrics.width + 8;
                const bgH = 20;
                ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                ctx.fillRect(cx - bgW / 2, cy - bgH / 2, bgW, bgH);
                ctx.fillStyle = d.stroke;
                ctx.fillText(text, cx, cy);
                ctx.restore();
            } else if (d.type === "rect") {
                ctx.strokeRect(d.x, d.y, d.w, d.h);
            } else if (d.type === "circle") {
                ctx.beginPath();
                ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Draw angle label for line/arrow draft
            if (!isSelected && d === draft && (d.type === "line" || d.type === "arrow")) {
                const angleRad = Math.atan2(d.end.y - d.start.y, d.end.x - d.start.x);
                let angleDeg = (angleRad * 180) / Math.PI;
                // 表示用に 0-360 に正規化
                angleDeg = ((angleDeg % 360) + 360) % 360;
                const text = `${angleDeg.toFixed(1)}°`;
                ctx.save();
                ctx.fillStyle = "#ef4444";
                ctx.font = "bold 14px sans-serif";
                ctx.fillText(text, d.end.x + 10, d.end.y + 10);
                ctx.restore();
            }

            if (isSelected) {
                const b = getBounds(d);
                ctx.save();
                ctx.strokeStyle = "#2563eb";
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 6]);
                ctx.strokeRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
                ctx.restore();

                // Draw handles
                const handles = getResizeHandles(d);
                ctx.save();
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = "#2563eb";
                ctx.lineWidth = 2;
                for (const h of handles) {
                    ctx.beginPath();
                    ctx.arc(h.x, h.y, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
                ctx.restore();
            }

            ctx.restore();
        };

        for (const it of items) drawOne(it, selectedIds.includes(it.id));
        if (draft) drawOne(draft, false);

        // 複数選択時のグループ枠
        if (selectedIds.length > 1) {
            const selectedItems = items.filter(it => selectedIds.includes(it.id));
            const bounds = selectedItems.map(getBounds);
            const minX = Math.min(...bounds.map(b => b.x));
            const minY = Math.min(...bounds.map(b => b.y));
            const maxX = Math.max(...bounds.map(b => b.x + b.w));
            const maxY = Math.max(...bounds.map(b => b.y + b.h));

            ctx.save();
            ctx.strokeStyle = "rgba(37, 99, 235, 0.5)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(minX - 10, minY - 10, (maxX - minX) + 20, (maxY - minY) + 20);
            ctx.restore();
        }
    }

    useEffect(() => {
        redraw();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, draft, selectedIds, unit, mmPerPx, view]);

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

        const screenP = getCanvasPoint(e, c);
        pointersRef.current[e.pointerId] = screenP;
        const worldP = {
            x: (screenP.x - view.offsetX) / view.scale,
            y: (screenP.y - view.offsetY) / view.scale,
        };

        const ids = Object.keys(pointersRef.current);
        if (ids.length >= 2) {
            // Pinch zoom start (or just clear last pinch dist)
            lastPinchDistRef.current = null;
            return;
        }

        // 図形ツールはグリッドスナップ
        const p = (tool === "freehand" || tool === "select" || tool === "eraser" || tool === "fill" || tool === "move" || tool === "pan")
            ? worldP
            : snapToGrid(worldP);

        if (tool === "pan") {
            movingRef.current = { last: screenP }; // パンはスクリーン座標の差分を使う
            return;
        }

        // Check for resize handle hit if single item selected
        if (selectedIds.length === 1 && (tool === "select" || tool === "move")) {
            const selected = items.find(it => it.id === selectedIds[0]);
            if (selected) {
                const handles = getResizeHandles(selected);
                for (const h of handles) {
                    if (dist(worldP, h) <= 12 / view.scale) {
                        resizingRef.current = { handle: h.id, startItem: JSON.parse(JSON.stringify(selected)) };
                        return;
                    }
                }
            }
        }

        if (tool === "select") {
            const clickedId = pickTop(worldP);
            if (isMultiSelectMode) {
                if (clickedId) {
                    setSelectedIds(prev =>
                        prev.includes(clickedId)
                            ? prev.filter(id => id !== clickedId)
                            : [...prev, clickedId]
                    );
                }
            } else {
                setSelectedIds(clickedId ? [clickedId] : []);
            }
            return;
        }

        if (tool === "fill") {
            const id = pickTop(worldP);
            const targets = (selectedIds.length > 0 && (id && selectedIds.includes(id)))
                ? selectedIds
                : (id ? [id] : []);

            if (targets.length === 0) return;

            setItems((prev) => {
                const next = prev.map((it) => {
                    if (!targets.includes(it.id)) return it;
                    if (it.type === "rect" || it.type === "circle") return { ...it, fill: fillColor };
                    return it;
                });
                pushHistory(next, targets);
                return next;
            });
            setSelectedIds(targets);
            return;
        }

        if (tool === "eraser") {
            const id = pickTop(worldP);
            const targets = (selectedIds.length > 0 && (id && selectedIds.includes(id)))
                ? selectedIds
                : (id ? [id] : []);

            if (targets.length === 0) return;

            setItems((prev) => {
                const next = prev.filter((it) => !targets.includes(it.id));
                pushHistory(next, []);
                return next;
            });
            setSelectedIds([]);
            return;
        }

        if (tool === "move") {
            const id = pickTop(worldP);
            if (id && !selectedIds.includes(id)) {
                setSelectedIds([id]);
            } else if (!id && selectedIds.length === 0) {
                return;
            }
            movingRef.current = { last: worldP };
            return;
        }

        if (tool === "freehand") {
            setDraft({
                id: uid(),
                type: "freehand",
                points: [worldP],
                stroke,
                width: lineWidth,
            });
            return;
        }

        if (tool === "line" || tool === "arrow" || tool === "measure") {
            setDraft({
                id: uid(),
                type: tool,
                start: p,
                end: p,
                stroke,
                width: tool === "measure" ? 1 : lineWidth, // 測定は細め固定でも良いが一旦太さも反映
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

        const screenP = getCanvasPoint(e, c);
        pointersRef.current[e.pointerId] = screenP;

        const ids = Object.keys(pointersRef.current).map(Number);
        if (ids.length >= 2) {
            const p1 = pointersRef.current[ids[0]];
            const p2 = pointersRef.current[ids[1]];
            const d = dist(p1, p2);
            const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            if (lastPinchDistRef.current !== null) {
                const deltaScale = d / lastPinchDistRef.current;
                const nextScale = Math.min(3.0, Math.max(0.5, view.scale * deltaScale));

                // センターを中心にズームするためのオフセット調整
                const worldCenter = {
                    x: (center.x - view.offsetX) / view.scale,
                    y: (center.y - view.offsetY) / view.scale
                };

                setView(() => ({
                    scale: nextScale,
                    offsetX: center.x - worldCenter.x * nextScale,
                    offsetY: center.y - worldCenter.y * nextScale,
                }));
            }
            lastPinchDistRef.current = d;
            return;
        }

        const worldP = {
            x: (screenP.x - view.offsetX) / view.scale,
            y: (screenP.y - view.offsetY) / view.scale,
        };

        if (tool === "pan") {
            const mv = movingRef.current;
            if (!mv) return;
            const dx = screenP.x - mv.last.x;
            const dy = screenP.y - mv.last.y;
            mv.last = screenP;
            setView(prev => ({ ...prev, offsetX: prev.offsetX + dx, offsetY: prev.offsetY + dy }));
            return;
        }

        if (tool === "move") {
            const mv = movingRef.current;
            const rs = resizingRef.current;

            if (rs) {
                let p = snapToGrid(worldP);
                // ... (resize logic same with worldP)
                setItems((prev) => prev.map((it) => {
                    if (!selectedIds.includes(it.id)) return it;
                    if (it.type === "rect") {
                        const start = rs.startItem as typeof it;
                        let { x, y, w, h } = start;
                        if (rs.handle === "nw") {
                            const newX = Math.min(p.x, x + w);
                            const newY = Math.min(p.y, y + h);
                            w = x + w - newX;
                            h = y + h - newY;
                            x = newX;
                        } else if (rs.handle === "ne") {
                            const newY = Math.min(p.y, y + h);
                            w = Math.max(0, p.x - x);
                            h = y + h - newY;
                            y = newY;
                        } else if (rs.handle === "sw") {
                            const newX = Math.min(p.x, x + w);
                            w = x + w - newX;
                            h = Math.max(0, p.y - y);
                            x = newX;
                        } else if (rs.handle === "se") {
                            w = Math.max(0, p.x - x);
                            h = Math.max(0, p.y - y);
                        }
                        return { ...it, x, y, w, h };
                    }
                    if (it.type === "circle") {
                        const start = rs.startItem as typeof it;
                        const newR = dist({ x: start.cx, y: start.cy }, p);
                        return { ...it, r: newR };
                    }
                    if (it.type === "line" || it.type === "arrow" || it.type === "measure") {
                        if (rs.handle === "start") return { ...it, start: p };
                        if (rs.handle === "end") return { ...it, end: p };
                    }
                    return it;
                }));
                return;
            }

            if (!mv || selectedIds.length === 0) return;
            const dx = worldP.x - mv.last.x;
            const dy = worldP.y - mv.last.y;
            mv.last = worldP;

            setItems((prev) => prev.map((it) => (selectedIds.includes(it.id) ? translateDrawable(it, dx, dy) : it)));
            return;
        }

        if (!draft) return;

        if (draft.type === "freehand") {
            setDraft({ ...draft, points: [...draft.points, worldP] });
            return;
        }

        let p = snapToGrid(worldP);

        if (draft.type === "line" || draft.type === "arrow" || draft.type === "measure") {
            const isPrecision = draft.type === "line" || draft.type === "arrow";
            let finalP = p;

            if (isPrecision && fixedAngle !== "" && !isNaN(Number(fixedAngle))) {
                // (A) 角度入力がある (0-360°正規化)
                let deg = Number(fixedAngle);
                deg = ((deg % 360) + 360) % 360;
                const rad = (deg * Math.PI) / 180;

                let lenPx = dist(draft.start, worldP);
                if (fixedLength && Number(fixedLength) > 0) {
                    const lenVal = Number(fixedLength);
                    let baseMm = lenVal;
                    if (unit === "cm") baseMm = lenVal * 10;
                    else if (unit === "m") baseMm = lenVal * 1000;
                    lenPx = baseMm / mmPerPx;
                }

                finalP = {
                    x: draft.start.x + Math.cos(rad) * lenPx,
                    y: draft.start.y + Math.sin(rad) * lenPx
                };
            } else if (isPrecision && angleSnapEnabled) {
                // (B) Angle Snap ON
                finalP = snapAngle(draft.start, p);
                if (fixedLength && Number(fixedLength) > 0) {
                    const lenVal = Number(fixedLength);
                    let baseMm = lenVal;
                    if (unit === "cm") baseMm = lenVal * 10;
                    else if (unit === "m") baseMm = lenVal * 1000;
                    const lenPx = baseMm / mmPerPx;

                    const angle = Math.atan2(finalP.y - draft.start.y, finalP.x - draft.start.x);
                    finalP = { x: draft.start.x + Math.cos(angle) * lenPx, y: draft.start.y + Math.sin(angle) * lenPx };
                }
            } else if (isPrecision && !angleSnapEnabled) {
                // (C) Angle Snap OFF (完全に自由角度)
                finalP = worldP;
                if (fixedLength && Number(fixedLength) > 0) {
                    const lenVal = Number(fixedLength);
                    let baseMm = lenVal;
                    if (unit === "cm") baseMm = lenVal * 10;
                    else if (unit === "m") baseMm = lenVal * 1000;
                    const lenPx = baseMm / mmPerPx;

                    const angle = Math.atan2(finalP.y - draft.start.y, finalP.x - draft.start.x);
                    finalP = { x: draft.start.x + Math.cos(angle) * lenPx, y: draft.start.y + Math.sin(angle) * lenPx };
                }
            } else if (draft.type === "measure") {
                // 寸法ツールは常にSnapAngle (既存挙動維持)
                finalP = snapAngle(draft.start, p);
                if (fixedLength && Number(fixedLength) > 0) {
                    const lenVal = Number(fixedLength);
                    let baseMm = lenVal;
                    if (unit === "cm") baseMm = lenVal * 10;
                    else if (unit === "m") baseMm = lenVal * 1000;
                    const lenPx = baseMm / mmPerPx;

                    const angle = Math.atan2(finalP.y - draft.start.y, finalP.x - draft.start.x);
                    finalP = { x: draft.start.x + Math.cos(angle) * lenPx, y: draft.start.y + Math.sin(angle) * lenPx };
                }
            }

            setDraft({ ...draft, end: finalP });
            return;
        }

        if (draft.type === "rect") {
            let w = p.x - draft.x;
            let h = p.y - draft.y;
            if (fixedWidth && Number(fixedWidth) > 0) {
                const wPx = Number(fixedWidth) / mmPerPx;
                w = (w >= 0 ? 1 : -1) * wPx;
            }
            if (fixedHeight && Number(fixedHeight) > 0) {
                const hPx = Number(fixedHeight) / mmPerPx;
                h = (h >= 0 ? 1 : -1) * hPx;
            }
            const r = clampRect(draft.x, draft.y, w, h);
            setDraft({ ...draft, ...r });
            return;
        }

        if (draft.type === "circle") {
            let r = dist({ x: draft.cx, y: draft.cy }, p);
            if (fixedDiameter && Number(fixedDiameter) > 0) {
                const dMm = Number(fixedDiameter);
                const dPx = dMm / mmPerPx;
                r = dPx / 2;
            }
            setDraft({ ...draft, r });
            return;
        }
    }

    function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
        const c = canvasRef.current;
        if (!c) return;
        c.releasePointerCapture(e.pointerId);
        delete pointersRef.current[e.pointerId];

        if (Object.keys(pointersRef.current).length < 2) {
            lastPinchDistRef.current = null;
        }

        if (movingRef.current || resizingRef.current) {
            if (tool !== "pan") pushHistory(items, selectedIds);
            movingRef.current = null;
            resizingRef.current = null;
            return;
        }

        if (!draft) return;

        const shouldKeep = (() => {
            if (draft.type === "freehand") return draft.points.length > 2;
            if (draft.type === "line" || draft.type === "arrow" || draft.type === "measure") return dist(draft.start, draft.end) > 6;
            if (draft.type === "rect") return draft.w > 6 && draft.h > 6;
            if (draft.type === "circle") return draft.r > 6;
            return true;
        })();

        if (shouldKeep) {
            setItems((prev) => {
                const next = [...prev, draft];
                pushHistory(next, [draft.id]);
                return next;
            });
            setSelectedIds([draft.id]);
        }

        setDraft(null);
    }

    async function saveJSON() {
        const payload: SavePayload = {
            version: 1,
            items,
            settings: {
                unit,
                gridSize,
                mmPerPx,
                snapEnabled,
                fixedLength,
                fixedWidth,
                fixedHeight,
                fixedDiameter,
                angleSnapEnabled,
                fixedAngle,
            },
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
            let newSettings: AppSettings = { unit, gridSize, mmPerPx, snapEnabled, angleSnapEnabled, fixedAngle };
            if (parsed.settings) {
                setUnit(parsed.settings.unit);
                setGridSize(parsed.settings.gridSize);
                // 互換性: 古い mmPerGrid があれば変換、なければ mmPerPx を使う
                // もし mmPerGrid(1gridあたりmm) があるなら、mmPerPx = mmPerGrid / gridSize
                if ((parsed.settings as any).mmPerGrid) {
                    const mpg = (parsed.settings as any).mmPerGrid;
                    const gs = parsed.settings.gridSize || 10;
                    const calculatedMmPerPx = mpg / gs;
                    setMmPerPx(calculatedMmPerPx);
                    newSettings = { ...parsed.settings, mmPerPx: calculatedMmPerPx };
                } else if (parsed.settings.mmPerPx) {
                    setMmPerPx(parsed.settings.mmPerPx);
                    newSettings = parsed.settings;
                } else {
                    newSettings = { ...parsed.settings, mmPerPx: 1 };
                }
                setSnapEnabled(parsed.settings.snapEnabled);
            }
            if (newSettings) {
                setFixedLength(newSettings.fixedLength || "");
                setFixedWidth(newSettings.fixedWidth || "");
                setFixedHeight(newSettings.fixedHeight || "");
                setFixedDiameter(newSettings.fixedDiameter || "");
                setAngleSnapEnabled(newSettings.angleSnapEnabled !== false);
                setFixedAngle(newSettings.fixedAngle || "");
            }
            setSelectedIds([]);
            setDraft(null);

            // JSON読み込み履歴追加 (初期化に近いが履歴として積む)
            pushHistory(parsed.items, [], newSettings);
        } catch (err) {
            alert("Failed to open JSON");
        } finally {
            // 同じファイルを連続で選べるようにリセット
            e.target.value = "";
        }
    }

    function resetProject() {
        if (!confirm("現在の作業内容をすべて消去しますか？")) return;
        setItems([]);
        setSelectedIds([]);
        setDraft(null);
        setHistory([{
            items: [],
            selectedIds: [],
            settings: { unit: "mm", gridSize: 10, mmPerPx: 1, snapEnabled: true, angleSnapEnabled: true, fixedAngle: "" }
        }]);
        setHistoryIndex(0);
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
                        ["measure", "寸法"],
                        ["pan", "✋"],
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
                    <label
                        style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                            background: isMultiSelectMode ? "#dbeafe" : "#f3f4f6",
                            padding: "4px 8px",
                            borderRadius: 8,
                            border: isMultiSelectMode ? "1px solid #3b82f6" : "1px solid #999",
                            cursor: "pointer"
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={isMultiSelectMode}
                            onChange={(e) => setIsMultiSelectMode(e.target.checked)}
                        />
                        Add Select
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                            type="checkbox"
                            checked={snapEnabled}
                            onChange={(e) => {
                                const val = e.target.checked;
                                setSnapEnabled(val);
                                pushHistory(items, selectedIds, { snapEnabled: val });
                            }}
                        />
                        Snap
                    </label>
                    {/* Grid Size selector removed as per requirements */}
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        1px=
                        <input
                            type="number"
                            value={mmPerPx}
                            onChange={(e) => setMmPerPx(Number(e.target.value))}
                            onBlur={(e) => pushHistory(items, selectedIds, { mmPerPx: Number(e.target.value) })}
                            style={{ width: 60, padding: 4, borderRadius: 4 }}
                            step={0.1}
                        />
                        mm
                    </label>
                    <select
                        value={unit}
                        onChange={(e) => {
                            const val = e.target.value as any;
                            setUnit(val);
                            pushHistory(items, selectedIds, { unit: val });
                        }}
                        style={{ padding: "4px", borderRadius: 4 }}
                    >
                        <option value="mm">mm</option>
                        <option value="cm">cm</option>
                        <option value="m">m</option>
                    </select>
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

            {/* 数値入力エリア（ツールに応じて表示） */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", height: 32 }}>
                {(tool === "line" || tool === "arrow") && (
                    <>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            長さ(mm):
                            <input
                                type="number"
                                value={fixedLength}
                                onChange={(e) => setFixedLength(e.target.value)}
                                onBlur={() => pushHistory(items, selectedIds, { fixedLength })}
                                placeholder="自由"
                                style={{ width: 70, padding: 4, borderRadius: 4 }}
                            />
                        </label>
                        <label
                            style={{
                                display: "flex",
                                gap: 6,
                                alignItems: "center",
                                background: angleSnapEnabled ? "#dbeafe" : "#f3f4f6",
                                padding: "4px 8px",
                                borderRadius: 8,
                                border: angleSnapEnabled ? "1px solid #3b82f6" : "1px solid #999",
                                cursor: "pointer"
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={angleSnapEnabled}
                                onChange={(e) => {
                                    const val = e.target.checked;
                                    setAngleSnapEnabled(val);
                                    pushHistory(items, selectedIds, { angleSnapEnabled: val });
                                }}
                            />
                            Angle Snap
                        </label>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            角度(deg):
                            <input
                                type="number"
                                value={fixedAngle}
                                onChange={(e) => setFixedAngle(e.target.value)}
                                onBlur={() => pushHistory(items, selectedIds, { fixedAngle })}
                                placeholder="自由"
                                style={{ width: 70, padding: 4, borderRadius: 4 }}
                                min="-180"
                                max="180"
                            />
                        </label>
                    </>
                )}
                {(tool === "rect") && (
                    <>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            幅(mm):
                            <input
                                type="number"
                                value={fixedWidth}
                                onChange={(e) => setFixedWidth(e.target.value)}
                                onBlur={() => pushHistory(items, selectedIds, { fixedWidth })}
                                placeholder="自由"
                                style={{ width: 70, padding: 4, borderRadius: 4 }}
                            />
                        </label>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            高さ(mm):
                            <input
                                type="number"
                                value={fixedHeight}
                                onChange={(e) => setFixedHeight(e.target.value)}
                                onBlur={() => pushHistory(items, selectedIds, { fixedHeight })}
                                placeholder="自由"
                                style={{ width: 70, padding: 4, borderRadius: 4 }}
                            />
                        </label>
                    </>
                )}
                {(tool === "circle") && (
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        直径(mm):
                        <input
                            type="number"
                            value={fixedDiameter}
                            onChange={(e) => setFixedDiameter(e.target.value)}
                            onBlur={() => pushHistory(items, selectedIds, { fixedDiameter })}
                            placeholder="自由"
                            style={{ width: 70, padding: 4, borderRadius: 4 }}
                        />
                    </label>
                )}
            </div>

            {/* 選択中の図形の数値編集UI */}
            {selectedIds.length === 1 && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", background: "#fef9c3", borderRadius: 12, border: "1px solid #fde047" }}>
                    <span style={{ fontSize: "0.9rem", fontWeight: "bold" }}>選択中:</span>
                    {items.find(it => it.id === selectedIds[0])?.type === "rect" && (() => {
                        const it = items.find(it => it.id === selectedIds[0]) as any;
                        const wVal = (it.w * mmPerPx).toFixed(1);
                        const hVal = (it.h * mmPerPx).toFixed(1);
                        return (
                            <>
                                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                    W:
                                    <input
                                        type="number"
                                        defaultValue={wVal}
                                        onBlur={(e) => {
                                            const val = Number(e.target.value) / mmPerPx;
                                            setItems(prev => {
                                                const next = prev.map(item => item.id === selectedIds[0] && item.type === "rect" ? { ...item, w: val } : item);
                                                pushHistory(next, selectedIds);
                                                return next;
                                            });
                                        }}
                                        style={{ width: 60, padding: 4, borderRadius: 4, border: "1px solid #ccc" }}
                                    />
                                </label>
                                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                    H:
                                    <input
                                        type="number"
                                        defaultValue={hVal}
                                        onBlur={(e) => {
                                            const val = Number(e.target.value) / mmPerPx;
                                            setItems(prev => {
                                                const next = prev.map(item => item.id === selectedIds[0] && item.type === "rect" ? { ...item, h: val } : item);
                                                pushHistory(next, selectedIds);
                                                return next;
                                            });
                                        }}
                                        style={{ width: 60, padding: 4, borderRadius: 4, border: "1px solid #ccc" }}
                                    />
                                </label>
                            </>
                        );
                    })()}
                    {items.find(it => it.id === selectedIds[0])?.type === "circle" && (() => {
                        const it = items.find(it => it.id === selectedIds[0]) as any;
                        const dVal = (it.r * 2 * mmPerPx).toFixed(1);
                        return (
                            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                直径:
                                <input
                                    type="number"
                                    defaultValue={dVal}
                                    onBlur={(e) => {
                                        const val = (Number(e.target.value) / 2) / mmPerPx;
                                        setItems(prev => {
                                            const next = prev.map(item => item.id === selectedIds[0] && item.type === "circle" ? { ...item, r: val } : item);
                                            pushHistory(next, selectedIds);
                                            return next;
                                        });
                                    }}
                                    style={{ width: 60, padding: 4, borderRadius: 4, border: "1px solid #ccc" }}
                                />
                            </label>
                        );
                    })()}
                    {(["line", "arrow", "measure"].includes(items.find(it => it.id === selectedIds[0])?.type || "")) && (() => {
                        const it = items.find(it => it.id === selectedIds[0]) as any;
                        const lenVal = (dist(it.start, it.end) * mmPerPx).toFixed(1);
                        return (
                            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                長さ:
                                <input
                                    type="number"
                                    defaultValue={lenVal}
                                    onBlur={(e) => {
                                        const nextLen = Number(e.target.value) / mmPerPx;
                                        setItems(prev => {
                                            const next = prev.map(item => {
                                                if (item.id !== selectedIds[0] || !("start" in item && "end" in item)) return item;
                                                const d = dist(item.start, item.end);
                                                if (d === 0) return { ...item, end: { x: item.start.x + nextLen, y: item.start.y } };
                                                const ratio = nextLen / d;
                                                return {
                                                    ...item,
                                                    end: {
                                                        x: item.start.x + (item.end.x - item.start.x) * ratio,
                                                        y: item.start.y + (item.end.y - item.start.y) * ratio,
                                                    }
                                                };
                                            });
                                            pushHistory(next, selectedIds);
                                            return next;
                                        });
                                    }}
                                    style={{ width: 60, padding: 4, borderRadius: 4, border: "1px solid #ccc" }}
                                />
                            </label>
                        );
                    })()}
                    <span style={{ fontSize: "0.8rem", color: "#666" }}>{unit}</span>
                </div>
            )}

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
                <button
                    onClick={resetProject}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid #e11d48",
                        background: "#ffe4e6",
                        color: "#e11d48",
                    }}
                >
                    New Project
                </button>
                <div style={{ width: 1, height: 24, background: "#ccc", margin: "0 8px" }} />
                <button
                    onClick={undo}
                    disabled={!canUndo}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid #999",
                        background: canUndo ? "#fff" : "#ddd",
                        opacity: canUndo ? 1 : 0.5,
                        cursor: canUndo ? "pointer" : "default",
                    }}
                >
                    Undo
                </button>
                <button
                    onClick={redo}
                    disabled={!canRedo}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid #999",
                        background: canRedo ? "#fff" : "#ddd",
                        opacity: canRedo ? 1 : 0.5,
                        cursor: canRedo ? "pointer" : "default",
                    }}
                >
                    Redo
                </button>
                <div style={{ width: 1, height: 24, background: "#ccc", margin: "0 8px" }} />
                <button
                    onClick={duplicateSelected}
                    disabled={selectedIds.length === 0}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid #999",
                        background: selectedIds.length > 0 ? "#fff" : "#ddd",
                        opacity: selectedIds.length > 0 ? 1 : 0.5,
                        cursor: selectedIds.length > 0 ? "pointer" : "default",
                    }}
                >
                    Duplicate
                </button>
                <button
                    onClick={deleteSelected}
                    disabled={selectedIds.length === 0}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid #999",
                        background: selectedIds.length > 0 ? "#fee2e2" : "#ddd",
                        color: selectedIds.length > 0 ? "#ef4444" : "#000",
                        opacity: selectedIds.length > 0 ? 1 : 0.5,
                        cursor: selectedIds.length > 0 ? "pointer" : "default",
                    }}
                >
                    Delete Selected
                </button>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", background: "#f3f4f6", padding: "4px 8px", borderRadius: 8, border: "1px solid #ccc" }}>
                    <span style={{ fontSize: "0.9rem", fontWeight: "bold" }}>{Math.round(view.scale * 100)}%</span>
                    <button onClick={() => setView(v => ({ ...v, scale: Math.max(0.5, v.scale - 0.1) }))} style={{ padding: "4px 8px", borderRadius: 4, background: "#fff", border: "1px solid #999" }}>-</button>
                    <button onClick={() => setView(v => ({ ...v, scale: Math.min(3.0, v.scale + 0.1) }))} style={{ padding: "4px 8px", borderRadius: 4, background: "#fff", border: "1px solid #999" }}>+</button>
                    <button onClick={() => setView({ scale: 1, offsetX: 0, offsetY: 0 })} style={{ padding: "4px 8px", borderRadius: 4, background: "#fff", border: "1px solid #999" }}>Reset</button>
                </div>

                <div style={{ marginLeft: 8 }}>
                    <button
                        onClick={() => setHelpOpen(true)}
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            border: "1px solid #999",
                            background: "#fff",
                            cursor: "pointer",
                            fontWeight: "bold",
                            fontSize: "1.2rem",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                        }}
                        title="HELP"
                    >
                        ?
                    </button>
                </div>

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

            {/* ヘルプモーダル */}
            {helpOpen && (
                <div
                    style={{
                        position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
                        background: "rgba(0,0,0,0.5)", zIndex: 1000,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 20
                    }}
                    onClick={() => setHelpOpen(false)}
                >
                    <div
                        style={{
                            background: "#fff", borderRadius: 16, width: "100%", maxWidth: 500,
                            maxHeight: "80vh", overflowY: "auto", position: "relative",
                            padding: "24px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)"
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                            <h2 style={{ margin: 0, fontSize: "1.4rem" }}>使い方ガイド</h2>
                            <button
                                onClick={() => setHelpOpen(false)}
                                style={{ border: "none", background: "none", fontSize: "1.5rem", cursor: "pointer", padding: 4 }}
                            >
                                ×
                            </button>
                        </div>

                        <div style={{ display: "grid", gap: 12 }}>
                            {HELP_ITEMS.map((item, i) => (
                                <details key={i} style={{ border: "1px solid #eee", borderRadius: 8, padding: "8px 12px", background: "#f9fafb" }}>
                                    <summary style={{ fontWeight: "bold", cursor: "pointer", listStyle: "none", outline: "none" }}>
                                        {item.title} <span style={{ fontWeight: "normal", fontSize: "0.85rem", color: "#666", marginLeft: 8 }}>- {item.short}</span>
                                    </summary>
                                    <div style={{ marginTop: 8, fontSize: "0.9rem", color: "#374151", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                                        {item.details}
                                    </div>
                                </details>
                            ))}
                        </div>

                        <div style={{ marginTop: 24, padding: "12px", background: "#eff6ff", borderRadius: 8, fontSize: "0.85rem", color: "#1e40af" }}>
                            <strong>ヒント:</strong> iPadでは2本指でのピンチ操作でズーム、Panツールで画面移動ができます。
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const HELP_ITEMS = [
    {
        title: "✏️ Freehand",
        short: "自由形式の描画",
        details: "ペンや指で自由に線を引きます。iPadでの手書きメモに適しています。"
    },
    {
        title: "／ Line / ➤ Arrow",
        short: "直線と矢印",
        details: "ドラッグで作成します。「Angle Snap」がONなら45度刻みで吸着し、数値を入力すれば指定した長さや角度で正確に描画できます。"
    },
    {
        title: "□ Rect / ◯ Circle",
        short: "基本図形",
        details: "ドラッグで作成します。幅、高さ、直径を数値指定することで、精密な図形を配置できます。作成後に「塗り」ツールで色を付けられます。"
    },
    {
        title: "選択 / 複数選択",
        short: "図形の編集",
        details: "図形をタップして選択します。「Add Select」をONにすると複数を同時に選択でき、まとめて移動、複製、削除が可能です。"
    },
    {
        title: "移動 / ✋ パン",
        short: "位置の調整",
        details: "「移動」ツールは選択した図形を動かします。「Pan(✋)」ツールは画面表示（視点）そのものを移動させます。"
    },
    {
        title: "消し / 塗り",
        short: "削除と着色",
        details: "「消し」ツールで図形を削除します。「塗り」ツールは、選択中の四角や円に指定した色を適用します。"
    },
    {
        title: "寸法 (Measure)",
        short: "距離の測定",
        details: "2点間をドラッグして、その距離をリアルワールドの単位（mm/cm/m）で表示します。DIYの設計図作成に便利です。"
    },
    {
        title: "保存 / 読み込み",
        short: "データの管理",
        details: "PNG Save：画像として保存。\nJSON Save：編集可能なデータとして保存。\nOpen JSON：過去に保存したJSONファイルを読み込みます。"
    },
    {
        title: "Undo / Redo",
        short: "戻す・進む",
        details: "操作を一つ前に戻したり、やり直したりできます。設定の変更も履歴に含まれます。"
    },
    {
        title: "縮尺設定 (1px=Xmm)",
        short: "スケールの調整",
        details: "画面上の1ピクセルが実世界の何ミリに相当するかを設定します。これにより、正確な実寸での作図が可能になります。"
    }
];
