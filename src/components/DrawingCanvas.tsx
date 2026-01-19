import React, { useRef, useEffect, useState } from 'react';

type Point = { x: number; y: number };
type ToolType = 'freehand' | 'line' | 'rect' | 'circle';

type DrawingElement =
    | { type: 'freehand'; points: Point[] }
    | { type: 'line'; start: Point; end: Point }
    | { type: 'rect'; start: Point; end: Point }
    | { type: 'circle'; start: Point; end: Point };

export const DrawingCanvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [items, setItems] = useState<DrawingElement[]>([]);
    const [currentTool, setCurrentTool] = useState<ToolType>('freehand');

    // For freehand
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPoints, setCurrentPoints] = useState<Point[]>([]);

    // For shapes
    const [dragStart, setDragStart] = useState<Point | null>(null);
    const [dragCurrent, setDragCurrent] = useState<Point | null>(null);

    // User Feedback
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            redrawAll();
        };

        window.addEventListener('resize', resize);
        resize();

        return () => window.removeEventListener('resize', resize);
    }, [items, currentPoints, dragStart, dragCurrent]);

    const showToast = (message: string, duration = 3000) => {
        setStatusMessage(message);
        setTimeout(() => setStatusMessage(null), duration);
    };

    const redrawAll = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000000';

        // Draw saved items
        items.forEach(el => drawElement(ctx, el));

        // Draw current interaction
        if (isDrawing && currentTool === 'freehand' && currentPoints.length > 0) {
            drawElement(ctx, { type: 'freehand', points: currentPoints });
        } else if (dragStart && dragCurrent && currentTool !== 'freehand') {
            drawElement(ctx, { type: currentTool, start: dragStart, end: dragCurrent } as DrawingElement);
        }
    };

    const drawElement = (ctx: CanvasRenderingContext2D, el: DrawingElement) => {
        ctx.beginPath();
        if (el.type === 'freehand') {
            if (el.points.length < 1) return;
            ctx.moveTo(el.points[0].x, el.points[0].y);
            for (let i = 1; i < el.points.length; i++) {
                ctx.lineTo(el.points[i].x, el.points[i].y);
            }
        } else if (el.type === 'line') {
            ctx.moveTo(el.start.x, el.start.y);
            ctx.lineTo(el.end.x, el.end.y);
        } else if (el.type === 'rect') {
            const w = el.end.x - el.start.x;
            const h = el.end.y - el.start.y;
            ctx.rect(el.start.x, el.start.y, w, h);
        } else if (el.type === 'circle') {
            // Circle from center to current point
            const r = Math.sqrt(
                Math.pow(el.end.x - el.start.x, 2) + Math.pow(el.end.y - el.start.y, 2)
            );
            ctx.arc(el.start.x, el.start.y, r, 0, 2 * Math.PI);
        }
        ctx.stroke();
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.setPointerCapture(e.pointerId);
        const p = { x: e.clientX, y: e.clientY };

        if (currentTool === 'freehand') {
            setIsDrawing(true);
            setCurrentPoints([p]);
        } else {
            setDragStart(p);
            setDragCurrent(p);
        }
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const p = { x: e.clientX, y: e.clientY };

        if (currentTool === 'freehand' && isDrawing) {
            setCurrentPoints(prev => [...prev, p]);
        } else if (dragStart) {
            setDragCurrent(p);
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (canvas) canvas.releasePointerCapture(e.pointerId);

        if (currentTool === 'freehand' && isDrawing) {
            setIsDrawing(false);
            if (currentPoints.length > 0) {
                setItems(prev => [...prev, { type: 'freehand', points: currentPoints }]);
            }
            setCurrentPoints([]);
        } else if (dragStart && dragCurrent) {
            setItems(prev => [...prev, {
                type: currentTool,
                start: dragStart,
                end: dragCurrent
            } as DrawingElement]);
            setDragStart(null);
            setDragCurrent(null);
        }
    };

    const saveJsonToFiles = async () => {
        showToast("Preparing JSON...");
        try {
            const timestamp = new Date().toISOString().slice(0, 19).replace(/T|:/g, '-');
            const filename = `drawing-${timestamp}.json`;

            const jsonData = {
                version: 1,
                items: items
            };
            const jsonString = JSON.stringify(jsonData, null, 2);
            const blob = new Blob([jsonString], { type: "application/json" });
            const file = new File([blob], filename, { type: "application/json" });

            // Priority: Web Share API
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: 'Drawing Data',
                        text: 'Save your drawing JSON data'
                    });
                    showToast("JSON Saved/Shared");
                    return;
                } catch (e) {
                    if ((e as Error).name !== 'AbortError') {
                        console.warn("Share failed", e);
                    } else {
                        return; // User cancelled
                    }
                }
            }

            // Fallback: Download
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
            showToast("JSON Downloaded (Fallback)");

        } catch (e) {
            console.error("JSON Save Error:", e);
            alert("Failed to save JSON.");
        }
    };

    const savePng = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        showToast("Generating PNG...");

        try {
            const timestamp = new Date().toISOString().slice(0, 19).replace(/T|:/g, '-');
            const filename = `drawing-${timestamp}.png`;

            // Generate PNG Blob
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            if (!tempCtx) throw new Error("Canvas context init failed");

            tempCtx.fillStyle = '#ffffff';
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            tempCtx.drawImage(canvas, 0, 0);

            const blob = await new Promise<Blob | null>(resolve => tempCanvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error("PNG generation failed");
            const file = new File([blob], filename, { type: "image/png" });

            // Priority: Web Share API
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: 'Drawing Image',
                        text: 'Here is my drawing!'
                    });
                    showToast("PNG Shared");
                    return;
                } catch (e) {
                    if ((e as Error).name !== 'AbortError') {
                        console.warn("Share failed", e);
                    } else {
                        return; // User cancelled
                    }
                }
            }

            // Fallback: Download
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
            showToast("PNG Downloaded (Fallback)");

        } catch (e) {
            console.error("PNG Save Error:", e);
            alert("Failed to save PNG.");
        }
    };

    const handleOpenClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = event.target?.result as string;
                const parseData = JSON.parse(json);

                let loadedItems: DrawingElement[] | null = null;

                if (parseData.version && Array.isArray(parseData.items)) {
                    loadedItems = parseData.items;
                } else if (Array.isArray(parseData)) {
                    loadedItems = parseData;
                }

                if (!loadedItems) {
                    throw new Error("Invalid file format");
                }

                // Compatibility migration
                let newItems: DrawingElement[] = [];
                if (loadedItems.length > 0) {
                    const isOldFormat = Array.isArray(loadedItems[0]);
                    if (isOldFormat) {
                        newItems = (loadedItems as unknown as Point[][]).map(points => ({
                            type: 'freehand',
                            points
                        }));
                    } else {
                        newItems = loadedItems as DrawingElement[];
                    }
                }

                setItems(newItems);
                showToast("File loaded successfully!");
            } catch (error) {
                console.error("Failed to load drawing", error);
                alert("Failed to load file.");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const tools: { id: ToolType; label: string }[] = [
        { id: 'freehand', label: '✎' },
        { id: 'line', label: '／' },
        { id: 'rect', label: '□' },
        { id: 'circle', label: '○' },
    ];

    return (
        <>
            <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerOut={handlePointerUp}
                style={{
                    touchAction: 'none',
                    display: 'block',
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: '#ffffff'
                }}
            />

            {/* Toast Notification */}
            {statusMessage && (
                <div style={{
                    position: 'fixed',
                    top: '80px', // Below toolbar
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(0,0,0,0.8)',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    fontSize: '14px',
                    pointerEvents: 'none',
                    zIndex: 2000,
                    transition: 'opacity 0.3s'
                }}>
                    {statusMessage}
                </div>
            )}

            {/* Toolbar */}
            <div style={{
                position: 'fixed',
                top: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '10px',
                background: 'rgba(255,255,255,0.9)',
                padding: '10px',
                borderRadius: '16px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                zIndex: 1000
            }}>
                {tools.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setCurrentTool(t.id)}
                        style={{
                            width: '40px',
                            height: '40px',
                            fontSize: '20px',
                            borderRadius: '50%',
                            border: 'none',
                            background: currentTool === t.id ? '#333' : '#eee',
                            color: currentTool === t.id ? '#fff' : '#333',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Bottom Controls */}
            <div style={{
                position: 'fixed',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '12px',
                zIndex: 1000,
                alignItems: 'center'
            }}>
                <button
                    onClick={saveJsonToFiles}
                    style={{
                        padding: '12px 20px',
                        fontSize: '14px',
                        borderRadius: '30px',
                        border: '1px solid #333',
                        background: '#fff',
                        color: '#333',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                        cursor: 'pointer'
                    }}
                >
                    JSON Save
                </button>
                <button
                    onClick={savePng}
                    style={{
                        padding: '12px 24px',
                        fontSize: '16px',
                        borderRadius: '30px',
                        border: 'none',
                        background: '#333',
                        color: 'white',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                        cursor: 'pointer'
                    }}
                >
                    PNG Save
                </button>
                <button
                    onClick={handleOpenClick}
                    style={{
                        padding: '12px 24px',
                        fontSize: '16px',
                        borderRadius: '30px',
                        border: 'none',
                        background: '#333',
                        color: 'white',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                        cursor: 'pointer'
                    }}
                >
                    Open
                </button>
            </div>
            <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />
        </>
    );
};
