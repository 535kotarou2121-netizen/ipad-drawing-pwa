import React, { useRef, useEffect, useState } from 'react';

type Point = { x: number; y: number };
type Stroke = Point[];

export const DrawingCanvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [currentStroke, setCurrentStroke] = useState<Stroke>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initial setup and resize handler
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            redrawAll(strokes); // Redraw existing strokes on resize
        };

        window.addEventListener('resize', resize);
        resize();

        return () => window.removeEventListener('resize', resize);
    }, [strokes]); // Re-bind resize if strokes change (to capture latest strokes in closure if needed, though passing arg is safer)

    // Redraw function
    const redrawAll = (data: Stroke[]) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Reset context styles
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000000';

        data.forEach(stroke => {
            if (stroke.length < 1) return;
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            for (let i = 1; i < stroke.length; i++) {
                ctx.lineTo(stroke[i].x, stroke[i].y);
            }
            ctx.stroke();
        });
    };

    const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        setIsDrawing(true);
        const startPoint = { x: e.clientX, y: e.clientY };
        setCurrentStroke([startPoint]);

        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        // Ensure styles are set (in case of fresh logic)
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000000';

        canvas.setPointerCapture(e.pointerId);
    };

    const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const newPoint = { x: e.clientX, y: e.clientY };
        setCurrentStroke(prev => [...prev, newPoint]);

        ctx.lineTo(newPoint.x, newPoint.y);
        ctx.stroke();
    };

    const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        setIsDrawing(false);
        setStrokes(prev => [...prev, currentStroke]);
        setCurrentStroke([]);

        const canvas = canvasRef.current;
        if (canvas) {
            canvas.releasePointerCapture(e.pointerId);
        }
    };

    const handleSave = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Generate Timestamp
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 19).replace(/T|:/g, '-');
        const filenameBase = `drawing_${timestamp}`;

        // 1. Generate JSON Blob
        const jsonString = JSON.stringify(strokes);
        const jsonBlob = new Blob([jsonString], { type: "application/json" });
        const jsonFile = new File([jsonBlob], `${filenameBase}.json`, { type: "application/json" });

        // 2. Generate PNG Blob (with white background)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        // Fill white background
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        // Draw original canvas over it
        tempCtx.drawImage(canvas, 0, 0);

        const pngBlob = await new Promise<Blob | null>(resolve => tempCanvas.toBlob(resolve, 'image/png'));
        if (!pngBlob) {
            alert("Failed to generate image.");
            return;
        }
        const pngFile = new File([pngBlob], `${filenameBase}.png`, { type: "image/png" });

        // 3. Share or Download
        const filesToShare = [jsonFile, pngFile];

        if (navigator.canShare && navigator.canShare({ files: filesToShare })) {
            try {
                await navigator.share({
                    files: filesToShare,
                    title: 'Simple Drawing',
                    text: 'Here is my drawing!'
                });
                return; // Shared successfully
            } catch (error) {
                if ((error as Error).name !== 'AbortError') {
                    console.error('Share failed', error);
                }
                // Continue to fallback if share failed (but not if user cancelled)
                if ((error as Error).name === 'AbortError') return;
            }
        }

        // Fallback: Download both files
        const downloadFile = (blob: Blob, filename: string) => {
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(href);
        };

        downloadFile(jsonBlob, `${filenameBase}.json`);
        // Add small delay to ensure simple browsers handle multiple downloads better
        setTimeout(() => {
            downloadFile(pngBlob, `${filenameBase}.png`);
        }, 100);
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
                const data = JSON.parse(json) as Stroke[];
                setStrokes(data);
                setTimeout(() => redrawAll(data), 0); // Ensure state update processes or draw immediately
            } catch (error) {
                console.error("Failed to load drawing", error);
                alert("Failed to load file.");
            }
        };
        reader.readAsText(file);
        // Reset input so same file can be selected again
        e.target.value = '';
    };

    return (
        <>
            <canvas
                ref={canvasRef}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
                onPointerOut={stopDrawing}
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
            {/* Controls UI */}
            <div style={{
                position: 'fixed',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '20px',
                zIndex: 1000
            }}>
                <button
                    onClick={handleSave}
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
                    Save
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
