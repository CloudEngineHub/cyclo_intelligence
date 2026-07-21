// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Howon Kim

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdRedo, MdUndo } from "react-icons/md";
import { getMapAnnotations, getPgmFiles, getPgmImage, saveMapAnnotations, savePgmImage } from "../../utils/navigationApi";
import { yawFromPose } from "../../utils/navigationTf";
const FREE_VALUE = 254;
const OCCUPIED_VALUE = 0;
const FREE_THRESHOLD = 250;
const OCCUPIED_THRESHOLD = 50;
const DEFAULT_BRUSH_SIZE_CELLS = 1;
const MAX_BRUSH_SIZE_CELLS = 10;
const BRUSH_SIZE_OPTIONS = [
    { label: "Small", value: 1 },
    { label: "Medium", value: 3 },
    { label: "Large", value: 6 },
    { label: "XL", value: 10 },
];
const EDIT_TOOLS = [
    { id: "erase_black", label: "Clear Space" },
    { id: "draw_black", label: "Add Obstacle" },
];
const ANNOTATION_TOOL = { id: "label_marker", label: "Label" };
const ANNOTATION_COLORS = [
    { id: "clay", label: "Clay", value: "#C96442" },
    { id: "sage", label: "Sage", value: "#5B8266" },
    { id: "amber", label: "Amber", value: "#B4762F" },
    { id: "ink", label: "Ink", value: "#1C1A17" },
];
function decodePgmPixels(image) {
    const binary = window.atob(image.pixels_base64);
    const pixels = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        pixels[index] = binary.charCodeAt(index);
    }
    return pixels;
}
function encodePgmPixels(pixels) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < pixels.length; index += chunkSize) {
        const chunk = pixels.subarray(index, index + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return window.btoa(binary);
}
function paintPgmPixels(pixels, width, height, pixelX, pixelY, operation, brushSizeCells) {
    const next = new Uint8Array(pixels);
    const value = operation === "erase_black" ? FREE_VALUE : OCCUPIED_VALUE;
    const offset = Math.floor(brushSizeCells / 2);
    const startX = pixelX - offset;
    const startY = pixelY - offset;
    for (let y = startY; y < startY + brushSizeCells; y += 1) {
        if (y < 0 || y >= height)
            continue;
        for (let x = startX; x < startX + brushSizeCells; x += 1) {
            if (x < 0 || x >= width)
                continue;
            next[x + y * width] = value;
        }
    }
    return next;
}
function pgmPixelsToGrid(image, pixels) {
    const resolution = Number(image.resolution ?? 1) || 1;
    const origin = image.origin ?? {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const data = new Array(image.width * image.height);
    for (let pgmY = 0; pgmY < image.height; pgmY += 1) {
        for (let x = 0; x < image.width; x += 1) {
            const value = pixels[x + pgmY * image.width];
            const occupancy = value <= OCCUPIED_THRESHOLD
                ? 100
                : value >= FREE_THRESHOLD
                    ? 0
                    : -1;
            const gridY = image.height - 1 - pgmY;
            data[x + gridY * image.width] = occupancy;
        }
    }
    return {
        header: { frame_id: "map" },
        info: {
            resolution,
            width: image.width,
            height: image.height,
            origin,
        },
        data,
    };
}
function mapPointToPgmPixel(image, x, y) {
    const resolution = Number(image.resolution ?? 1) || 1;
    const origin = image.origin ?? {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const originX = Number(origin.position?.x ?? 0);
    const originY = Number(origin.position?.y ?? 0);
    const originYaw = yawFromPose(origin);
    const dx = x - originX;
    const dy = y - originY;
    const localX = Math.cos(originYaw) * dx + Math.sin(originYaw) * dy;
    const localY = -Math.sin(originYaw) * dx + Math.cos(originYaw) * dy;
    const pixelX = Math.floor(localX / resolution);
    const pixelY = image.height - 1 - Math.floor(localY / resolution);
    if (pixelX < 0 || pixelX >= image.width || pixelY < 0 || pixelY >= image.height) {
        return null;
    }
    return { pixelX, pixelY };
}
function normalizeBrushSize(value) {
    if (!Number.isFinite(value))
        return DEFAULT_BRUSH_SIZE_CELLS;
    return Math.min(Math.max(Math.floor(value), 1), MAX_BRUSH_SIZE_CELLS);
}
function mapNameFromPgmPath(path) {
    return path.split("/").pop().replace(/\.pgm$/i, "");
}
function makeAnnotationId() {
    return `mark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeAnnotationColor(value) {
    const color = String(value || "").trim();
    return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : ANNOTATION_COLORS[0].value;
}
function normalizeAnnotation(annotation) {
    var _a, _b, _c, _d, _e, _f;
    const pose = (_a = annotation === null || annotation === void 0 ? void 0 : annotation.pose) !== null && _a !== void 0 ? _a : {};
    const label = String((_b = annotation === null || annotation === void 0 ? void 0 : annotation.label) !== null && _b !== void 0 ? _b : "Label").trim() || "Label";
    return {
        id: String((_c = annotation === null || annotation === void 0 ? void 0 : annotation.id) !== null && _c !== void 0 ? _c : makeAnnotationId()),
        label: label.slice(0, 80),
        color: normalizeAnnotationColor(annotation === null || annotation === void 0 ? void 0 : annotation.color),
        pose: {
            frame_id: String((_d = pose.frame_id) !== null && _d !== void 0 ? _d : "map"),
            x: Number((_e = pose.x) !== null && _e !== void 0 ? _e : 0),
            y: Number((_f = pose.y) !== null && _f !== void 0 ? _f : 0),
            yaw: Number(pose.yaw !== null && pose.yaw !== void 0 ? pose.yaw : 0),
        },
    };
}
function preferredPgmFile(files, mapName) {
    const exact = files.find((file) => mapNameFromPgmPath(file.path) === mapName);
    return exact || files.find((file) => file.path.includes(mapName));
}
export function useMapEditor({ open, mapName, onMessage, reloadToken = 0 }) {
    const pixelsRef = useRef(null);
    const annotationsRef = useRef([]);
    const [files, setFiles] = useState([]);
    const [selectedPath, setSelectedPath] = useState("");
    const [image, setImage] = useState(null);
    const [pixels, setPixels] = useState(null);
    const [annotations, setAnnotations] = useState([]);
    const [annotationLabel, setAnnotationLabel] = useState("Label");
    const [annotationColor, setAnnotationColor] = useState(ANNOTATION_COLORS[0].value);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [tool, setTool] = useState("view");
    const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE_CELLS);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!open)
            return;
        let cancelled = false;
        setBusy(true);
        getPgmFiles()
            .then((response) => {
            if (cancelled)
                return;
            setFiles(response.files);
            const preferred = preferredPgmFile(response.files, mapName);
            setSelectedPath((current) => {
                var _a;
                if (preferred && (reloadToken || mapNameFromPgmPath(current) !== mapName)) {
                    return preferred.path;
                }
                return current || (preferred === null || preferred === void 0 ? void 0 : preferred.path) || ((_a = response.files[0]) === null || _a === void 0 ? void 0 : _a.path) || "";
            });
            if (!response.files.length)
                onMessage("No PGM files found");
        })
            .catch((error) => {
            if (!cancelled)
                onMessage(error instanceof Error ? error.message : "Failed to list PGM files");
        })
            .finally(() => {
            if (!cancelled)
                setBusy(false);
        });
        return () => {
            cancelled = true;
        };
    }, [mapName, onMessage, open, reloadToken]);
    useEffect(() => {
        if (!open || !selectedPath) {
            setImage(null);
            setPixels(null);
            pixelsRef.current = null;
            setUndoStack([]);
            setRedoStack([]);
            setDirty(false);
            return;
        }
        let cancelled = false;
        setBusy(true);
        getPgmImage(selectedPath)
            .then((response) => {
            if (cancelled)
                return;
            setImage(response);
            const decodedPixels = decodePgmPixels(response);
            pixelsRef.current = decodedPixels;
            setPixels(decodedPixels);
            setUndoStack([]);
            setRedoStack([]);
            setDirty(false);
            onMessage(`Loaded ${response.path}`);
        })
            .catch((error) => {
            if (!cancelled)
                onMessage(error instanceof Error ? error.message : "Failed to load PGM file");
        })
            .finally(() => {
            if (!cancelled)
                setBusy(false);
        });
        return () => {
            cancelled = true;
        };
    }, [onMessage, open, selectedPath]);
    useEffect(() => {
        annotationsRef.current = annotations;
    }, [annotations]);
    useEffect(() => {
        if (!open || !selectedPath) {
            annotationsRef.current = [];
            setAnnotations([]);
            return;
        }
        let cancelled = false;
        getMapAnnotations(selectedPath)
            .then((response) => {
            if (cancelled)
                return;
            const next = Array.isArray(response === null || response === void 0 ? void 0 : response.annotations)
                ? response.annotations.map(normalizeAnnotation)
                : [];
            annotationsRef.current = next;
            setAnnotations(next);
        })
            .catch((error) => {
            if (cancelled)
                return;
            annotationsRef.current = [];
            setAnnotations([]);
            onMessage(error instanceof Error ? error.message : "Failed to load map labels");
        });
        return () => {
            cancelled = true;
        };
    }, [onMessage, open, selectedPath]);
    const map = useMemo(() => {
        if (!image || !pixels)
            return null;
        return pgmPixelsToGrid(image, pixels);
    }, [image, pixels]);
    const editAtMapPoint = useCallback((x, y) => {
        if (!open || !image || busy || (tool !== "erase_black" && tool !== "draw_black"))
            return;
        const pixel = mapPointToPgmPixel(image, x, y);
        if (!pixel)
            return;
        const { pixelX, pixelY } = pixel;
        const currentPixels = pixelsRef.current;
        if (!currentPixels)
            return;
        const nextPixels = paintPgmPixels(currentPixels, image.width, image.height, pixelX, pixelY, tool, brushSize);
        let editedPixels = 0;
        for (let index = 0; index < currentPixels.length; index += 1) {
            if (currentPixels[index] !== nextPixels[index])
                editedPixels += 1;
        }
        if (editedPixels === 0) {
            onMessage("No pixels changed");
            return;
        }
        pixelsRef.current = nextPixels;
        setUndoStack((stack) => [...stack, currentPixels]);
        setRedoStack([]);
        setPixels(nextPixels);
        setDirty(true);
        const action = tool === "erase_black" ? "Removed" : "Added";
        onMessage(`${action} ${editedPixels} pixels locally`);
    }, [brushSize, busy, image, onMessage, open, tool]);
    const persistAnnotations = useCallback((nextAnnotations, successMessage) => {
        if (!selectedPath || busy)
            return;
        const normalized = nextAnnotations.map(normalizeAnnotation);
        annotationsRef.current = normalized;
        setAnnotations(normalized);
        setBusy(true);
        saveMapAnnotations(selectedPath, normalized)
            .then((response) => {
            const saved = Array.isArray(response === null || response === void 0 ? void 0 : response.annotations)
                ? response.annotations.map(normalizeAnnotation)
                : normalized;
            annotationsRef.current = saved;
            setAnnotations(saved);
            onMessage(successMessage);
        })
            .catch((error) => {
            onMessage(error instanceof Error ? error.message : "Failed to save map labels");
        })
            .finally(() => setBusy(false));
    }, [busy, onMessage, selectedPath]);
    const placeAnnotationAtMapPoint = useCallback((x, y) => {
        if (!open || !image || busy || tool !== ANNOTATION_TOOL.id)
            return;
        const label = annotationLabel.trim() || "Label";
        const nextAnnotation = normalizeAnnotation({
            id: makeAnnotationId(),
            label,
            color: annotationColor,
            pose: { frame_id: "map", x, y, yaw: 0 },
        });
        persistAnnotations([...annotationsRef.current, nextAnnotation], `Placed label ${nextAnnotation.label}`);
    }, [annotationColor, annotationLabel, busy, image, open, persistAnnotations, tool]);
    const clearAnnotations = useCallback(() => {
        if (!annotationsRef.current.length)
            return;
        persistAnnotations([], "Cleared map labels");
    }, [persistAnnotations]);
    const undo = useCallback(() => {
        const currentPixels = pixelsRef.current;
        setUndoStack((stack) => {
            const previous = stack[stack.length - 1];
            if (!previous || !currentPixels)
                return stack;
            setRedoStack((redo) => [...redo, currentPixels]);
            pixelsRef.current = previous;
            setPixels(previous);
            setDirty(stack.length > 1);
            onMessage("Undid last edit");
            return stack.slice(0, -1);
        });
    }, [onMessage]);
    const redo = useCallback(() => {
        const currentPixels = pixelsRef.current;
        setRedoStack((stack) => {
            const next = stack[stack.length - 1];
            if (!next || !currentPixels)
                return stack;
            setUndoStack((undoHistory) => [...undoHistory, currentPixels]);
            pixelsRef.current = next;
            setPixels(next);
            setDirty(true);
            onMessage("Redid last edit");
            return stack.slice(0, -1);
        });
    }, [onMessage]);
    const save = useCallback(() => {
        if (!image || !pixels || !dirty || busy)
            return;
        setBusy(true);
        savePgmImage(image.path, image.width, image.height, image.maxval, encodePgmPixels(pixels))
            .then((response) => {
            setUndoStack([]);
            setRedoStack([]);
            setDirty(false);
            onMessage(`Saved ${response.path}`);
        })
            .catch((error) => {
            onMessage(error instanceof Error ? error.message : "Failed to save PGM file");
        })
            .finally(() => setBusy(false));
    }, [busy, dirty, image, onMessage, pixels]);
    return {
        files,
        selectedPath,
        setSelectedPath,
        image,
        map,
        annotations,
        annotationLabel,
        setAnnotationLabel,
        annotationColor,
        setAnnotationColor: (value) => setAnnotationColor(normalizeAnnotationColor(value)),
        annotationColors: ANNOTATION_COLORS,
        tool,
        setTool,
        brushSize,
        setBrushSize: (value) => setBrushSize(normalizeBrushSize(value)),
        busy,
        dirty,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undo,
        redo,
        save,
        editAtMapPoint,
        placeAnnotationAtMapPoint,
        clearAnnotations,
    };
}
// Warm segmented map-editor controls (see design handoff, turn 8).
const TOOL_ICONS = {
    view: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.6" />
        </svg>
    ),
    erase_black: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 21-4-4 11-11 4 4-11 11H7z" /><path d="m14 6 4 4" />
        </svg>
    ),
    draw_black: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19c-4 1.5-8-1-8-5 0-6 8-11 8-11s8 5 8 11c0 4-4 6.5-8 5z" />
        </svg>
    ),
    label_marker: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.6 13.2 13.2 20.6a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 2.8 12V4.4A1.6 1.6 0 0 1 4.4 2.8H12a2 2 0 0 1 1.4.6l7.2 7a2 2 0 0 1 0 2.8z" />
            <circle cx="7.5" cy="7.5" r="1.2" />
        </svg>
    ),
};

function SegGroup({ children, ariaLabel }) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="flex items-center gap-0.5 p-[3px]"
            style={{ borderRadius: 12, border: "1px solid var(--mc-border)", backgroundColor: "var(--mc-surface-hover)" }}
        >
            {children}
        </div>
    );
}

function SegButton({ selected, disabled, onClick, title, ariaLabel, children, narrow = false }) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={onClick}
            title={title}
            aria-label={ariaLabel}
            className={`h-[30px] ${narrow ? "w-[34px] justify-center" : "px-3"} inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50`}
            style={{
                borderRadius: 9,
                border: "none",
                color: selected ? "var(--mc-bg)" : "var(--mc-text-muted)",
                backgroundColor: selected ? "var(--mc-text)" : "transparent",
            }}
        >
            {children}
        </button>
    );
}

export function MapEditorControls({ files, selectedPath, setSelectedPath, tool, setTool, brushSize, setBrushSize, busy, image, dirty, canUndo = false, canRedo = false, undo, redo, save, enableAnnotations = false, annotations = [], annotationLabel = "Label", setAnnotationLabel = () => { }, annotationColor = ANNOTATION_COLORS[0].value, setAnnotationColor = () => { }, annotationColors = ANNOTATION_COLORS, clearAnnotations = () => { }, }) {
    const iconButtonStyle = (enabled) => ({
        borderRadius: 9,
        border: "1px solid var(--mc-border-strong)",
        backgroundColor: "var(--mc-surface)",
        color: enabled ? "var(--mc-text)" : "var(--mc-text-subtle)",
    });
    const tools = enableAnnotations ? [...EDIT_TOOLS, ANNOTATION_TOOL] : EDIT_TOOLS;
    const labelActive = enableAnnotations && tool === ANNOTATION_TOOL.id;
    const brushActive = !labelActive;

    return (
        <div className="flex flex-wrap items-center gap-3">
            {/* map file */}
            <select
                value={selectedPath}
                disabled={busy || files.length === 0}
                onChange={(event) => setSelectedPath(event.currentTarget.value)}
                className="h-9 min-w-64 px-3 text-[12px] font-mono"
                style={{ borderRadius: 10, color: "var(--mc-text)", backgroundColor: "var(--mc-surface)", border: "1px solid var(--mc-border-strong)" }}
            >
                {files.map((file) => (
                    <option key={file.path} value={file.path}>{file.path}</option>
                ))}
            </select>

            <div className="h-6 w-px" aria-hidden="true" style={{ backgroundColor: "var(--mc-border)" }} />

            {/* tools — segmented, ink active pill */}
            <SegGroup ariaLabel="Edit tool">
                <SegButton selected={tool === "view"} disabled={busy} onClick={() => setTool("view")} title="View" ariaLabel="View">
                    {TOOL_ICONS.view}View
                </SegButton>
                {tools.map((editTool) => (
                    <SegButton
                        key={editTool.id}
                        selected={tool === editTool.id}
                        disabled={busy}
                        onClick={() => setTool(editTool.id)}
                        title={editTool.label}
                        ariaLabel={editTool.label}
                    >
                        {TOOL_ICONS[editTool.id]}{editTool.label}
                    </SegButton>
                ))}
            </SegGroup>

            {/* brush size — segmented S/M/L/XL (replaces the <select>) */}
            {brushActive && <div className="flex items-center gap-2">
                <span className="text-[9.5px] font-mono tracking-[0.1em]" style={{ color: "var(--mc-text-subtle)" }}>BRUSH</span>
                <SegGroup ariaLabel="Brush size">
                    {BRUSH_SIZE_OPTIONS.map((option) => (
                        <SegButton
                            key={option.value}
                            narrow
                            selected={brushSize === option.value}
                            disabled={busy}
                            onClick={() => setBrushSize(option.value)}
                            title={`Brush ${option.label}`}
                            ariaLabel={`Brush size ${option.label}`}
                        >
                            {option.label === "Small" ? "S" : option.label === "Medium" ? "M" : option.label === "Large" ? "L" : "XL"}
                        </SegButton>
                    ))}
                </SegGroup>
            </div>}

            {labelActive && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[9.5px] font-mono tracking-[0.1em]" style={{ color: "var(--mc-text-subtle)" }}>LABEL</span>
                    <input
                        aria-label="Label name"
                        value={annotationLabel}
                        disabled={busy}
                        onChange={(event) => setAnnotationLabel(event.currentTarget.value)}
                        className="h-9 w-32 px-3 text-[12px] font-semibold"
                        style={{ borderRadius: 10, color: "var(--mc-text)", backgroundColor: "var(--mc-surface)", border: "1px solid var(--mc-border-strong)" }}
                    />
                    <div role="group" aria-label="Label color" className="flex items-center gap-1.5">
                        {annotationColors.map((color) => {
                            const selected = normalizeAnnotationColor(annotationColor) === normalizeAnnotationColor(color.value);
                            return (
                                <button
                                    key={color.id}
                                    type="button"
                                    disabled={busy}
                                    title={`${color.label} label`}
                                    aria-label={`${color.label} label`}
                                    aria-pressed={selected}
                                    onClick={() => setAnnotationColor(color.value)}
                                    className="h-8 w-8 transition-all disabled:opacity-50"
                                    style={{
                                        borderRadius: 999,
                                        border: selected ? "2px solid var(--mc-text)" : "1px solid var(--mc-border-strong)",
                                        backgroundColor: color.value,
                                        boxShadow: selected ? "0 0 0 3px color-mix(in srgb, var(--mc-text) 12%, transparent)" : "none",
                                    }}
                                />
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        disabled={busy || annotations.length === 0}
                        onClick={clearAnnotations}
                        className="h-9 px-3 text-[12px] font-semibold transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0"
                        style={{ borderRadius: 9, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }}
                    >
                        Clear Labels
                    </button>
                </div>
            )}

            <div className="h-6 w-px" aria-hidden="true" style={{ backgroundColor: "var(--mc-border)" }} />

            {/* undo / redo / save */}
            <button type="button" disabled={busy || !canUndo} onClick={undo} title="Undo" aria-label="Undo"
                className="h-9 w-9 inline-flex items-center justify-center transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0"
                style={iconButtonStyle(canUndo)}>
                <MdUndo size={17} />
            </button>
            <button type="button" disabled={busy || !canRedo} onClick={redo} title="Redo" aria-label="Redo"
                className="h-9 w-9 inline-flex items-center justify-center transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0"
                style={iconButtonStyle(canRedo)}>
                <MdRedo size={17} />
            </button>
            <button type="button" disabled={busy || !dirty} onClick={save}
                className="h-9 px-4 text-[12.5px] font-semibold transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0"
                style={{ borderRadius: 9, border: "none", backgroundColor: "var(--mc-accent)", color: "var(--mc-accent-fg)", boxShadow: dirty ? "var(--mc-shadow)" : "none" }}>
                Save
            </button>

            {/* dimensions + dirty state */}
            <span className="text-[11px] font-mono" style={{ color: "var(--mc-text-subtle)" }}>
                {image ? (
                    <>
                        {image.width} × {image.height}
                        {dirty && <span style={{ color: "var(--mc-accent)" }}> · unsaved</span>}
                    </>
                ) : "Select a PGM"}
            </span>
        </div>
    );
}
