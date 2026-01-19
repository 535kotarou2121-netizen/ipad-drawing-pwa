import React, { useEffect, useRef, useState } from "react";

type Snapshot = {
    items: Drawable[];
    selectedId: string | null;
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
    | "measure";

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
    const [selectedId, setSelectedId] = useState<string | null>(null);
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

    const pushHistory = (nextItems: Drawable[], nextSelectedId: string | null, settingsOverride?: Partial<AppSettings>) => {
        const newSnapshot: Snapshot = {
            items: nextItems,
            selectedId: nextSelectedId,
            settings: { unit, gridSize, mmPerPx, snapEnabled, ...settingsOverride }
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
        setSelectedId(snap.selectedId);
        setUnit(snap.settings.unit);
        setGridSize(snap.settings.gridSize);
        setMmPerPx(snap.settings.mmPerPx);
        setSnapEnabled(snap.settings.snapEnabled);
    };

    const redo = () => {
        if (!canRedo) return;
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        const snap = history[nextIndex];
        setItems(snap.items);
        setSelectedId(snap.selectedId);
        setUnit(snap.settings.unit);
        setGridSize(snap.settings.gridSize);
        setMmPerPx(snap.settings.mmPerPx);
        setSnapEnabled(snap.settings.snapEnabled);
    };

    // Initial History
    useEffect(() => {
        if (history.length === 0) {
            setHistory([{
                items: [],
                selectedId: null,
                settings: { unit: "mm", gridSize: 10, mmPerPx: 1, snapEnabled: true }
            }]);
            setHistoryIndex(0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

                const valStr = Math.round(val * 10) / 10;
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
    }, [items, draft, selectedId, unit, mmPerPx]);

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

        const rawP = getCanvasPoint(e, c);
        // Freehand以外は生成時にグリッドスナップ
        const p = (tool === "freehand" || tool === "select" || tool === "eraser" || tool === "fill" || tool === "move")
            ? rawP
            : snapToGrid(rawP);

        if (tool === "select") {
            setSelectedId(pickTop(rawP)); // 選択は見た目通りの位置で
            return;
        }

        if (tool === "fill") {
            const id = pickTop(rawP);
            if (!id) return;
            setItems((prev) => {
                const next = prev.map((it) => {
                    if (it.id !== id) return it;
                    if (it.type === "rect" || it.type === "circle") return { ...it, fill: fillColor };
                    return it;
                });
                pushHistory(next, id);
                return next;
            });
            setSelectedId(id);
            return;
        }

        if (tool === "eraser") {
            const id = pickTop(rawP);
            if (!id) return;
            setItems((prev) => {
                const next = prev.filter((it) => it.id !== id);
                pushHistory(next, selectedId === id ? null : selectedId);
                return next;
            });
            if (selectedId === id) setSelectedId(null);
            return;
        }

        if (tool === "move") {
            const id = selectedId ?? pickTop(rawP);
            setSelectedId(id);
            if (!id) return;
            movingRef.current = { last: rawP }; // Move開始点は生の座標で取る（相対移動のため）
            return;
        }

        if (tool === "freehand") {
            setDraft({
                id: uid(),
                type: "freehand",
                points: [rawP], // Freehandは生の座標
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
        const rawP = getCanvasPoint(e, c);

        if (tool === "move") {
            const mv = movingRef.current;
            if (!mv || !selectedId) return;
            const dx = rawP.x - mv.last.x;
            const dy = rawP.y - mv.last.y;
            mv.last = rawP;

            setItems((prev) => prev.map((it) => (it.id === selectedId ? translateDrawable(it, dx, dy) : it)));
            return;
        }

        if (!draft) return;

        if (draft.type === "freehand") {
            setDraft({ ...draft, points: [...draft.points, rawP] });
            return;
        }

        // 図形ツールはグリッドスナップ
        let p = snapToGrid(rawP);

        if (draft.type === "line" || draft.type === "arrow") {
            // アングルスナップ適用
            p = snapAngle(draft.start, p);

            // 数値指定があれば長さを固定
            if (fixedLength && Number(fixedLength) > 0) {
                const lenMm = Number(fixedLength);
                const lenPx = lenMm / mmPerPx;
                const angle = Math.atan2(p.y - draft.start.y, p.x - draft.start.x);
                p = {
                    x: draft.start.x + Math.cos(angle) * lenPx,
                    y: draft.start.y + Math.sin(angle) * lenPx,
                };
            }

            setDraft({ ...draft, end: p });
            return;
        }

        if (draft.type === "rect") {
            let w = p.x - draft.x;
            let h = p.y - draft.y;

            // 数値指定があればサイズ固定（ドラッグ方向は考慮）
            if (fixedWidth && Number(fixedWidth) > 0) {
                const wPx = Number(fixedWidth) / mmPerPx;
                w = (w >= 0 ? 1 : -1) * wPx;
            }
            if (fixedHeight && Number(fixedHeight) > 0) {
                const hPx = Number(fixedHeight) / mmPerPx;
                h = (h >= 0 ? 1 : -1) * hPx;
            }

            // 軸スナップ（高さ/幅が極端に小さい場合、0にして直線化するなど）は
            // グリッドスナップがあればある程度自然にできるため、今回はGrid任せにする
            const r = clampRect(draft.x, draft.y, w, h);
            setDraft({ ...draft, ...r });
            return;
        }

        if (draft.type === "circle") {
            let r = dist({ x: draft.cx, y: draft.cy }, p);

            // 数値指定（直径）があれば半径固定
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

        // Move確定時に履歴追加
        if (movingRef.current) {
            // Move変更はonPointerMoveですでに行われているため、現在のitemsを履歴に積む
            // setItemsのコールバックを使って最新のitemsを確実に取得する
            setItems(prev => {
                pushHistory(prev, selectedId);
                return prev;
            });
        }

        movingRef.current = null;

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
                pushHistory(next, draft.id);
                return next;
            });
            setSelectedId(draft.id);
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
            let newSettings: AppSettings = { unit, gridSize, mmPerPx, snapEnabled };
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
            setSelectedId(null);
            setDraft(null);

            // JSON読み込み履歴追加 (初期化に近いが履歴として積む)
            // state更新後に積むため（ここでは同期的に呼んで問題ないが、念のためsetTimeout等は使わず直接呼ぶ）
            // ただしsetItemsは非同期なので、useEffect等で検知するか、あるいはここで明示的に積む必要がある
            // ここでは推移として「読み込み」扱いにする
            pushHistory(parsed.items, null, newSettings);
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
        setSelectedId(null);
        setDraft(null);
        setHistory([{
            items: [],
            selectedId: null,
            settings: { unit: "mm", gridSize: 10, mmPerPx: 1, snapEnabled: true }
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
                        <input
                            type="checkbox"
                            checked={snapEnabled}
                            onChange={(e) => {
                                const val = e.target.checked;
                                setSnapEnabled(val);
                                pushHistory(items, selectedId, { snapEnabled: val });
                            }}
                        />
                        Snap
                    </label>
                    {snapEnabled && (
                        <select
                            value={gridSize}
                            onChange={(e) => {
                                const val = Number(e.target.value);
                                setGridSize(val);
                                pushHistory(items, selectedId, { gridSize: val });
                            }}
                            style={{ padding: "4px", borderRadius: 4 }}
                        >
                            <option value={5}>5px</option>
                            <option value={10}>10px</option>
                            <option value={20}>20px</option>
                            <option value={40}>40px</option>
                            <option value={50}>50px</option>
                        </select>
                    )}
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        1px=
                        <input
                            type="number"
                            value={mmPerPx}
                            onChange={(e) => setMmPerPx(Number(e.target.value))}
                            onBlur={(e) => pushHistory(items, selectedId, { mmPerPx: Number(e.target.value) })}
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
                            pushHistory(items, selectedId, { unit: val });
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
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        長さ(mm):
                        <input
                            type="number"
                            value={fixedLength}
                            onChange={(e) => setFixedLength(e.target.value)}
                            placeholder="自由"
                            style={{ width: 70, padding: 4, borderRadius: 4 }}
                        />
                    </label>
                )}
                {(tool === "rect") && (
                    <>
                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            幅(mm):
                            <input
                                type="number"
                                value={fixedWidth}
                                onChange={(e) => setFixedWidth(e.target.value)}
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
                            placeholder="自由"
                            style={{ width: 70, padding: 4, borderRadius: 4 }}
                        />
                    </label>
                )}
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
