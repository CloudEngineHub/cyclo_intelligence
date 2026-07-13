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
import { getPgmFiles, getPgmImage, savePgmImage } from "../../utils/navigationApi";
const FREE_VALUE = 254;
const OCCUPIED_VALUE = 0;
const FREE_THRESHOLD = 250;
const OCCUPIED_THRESHOLD = 50;
const DEFAULT_BRUSH_SIZE_CELLS = 1;
const MAX_BRUSH_SIZE_CELLS = 10;
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
            resolution: 1,
            width: image.width,
            height: image.height,
            origin: {
                position: { x: 0, y: 0, z: 0 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
            },
        },
        data,
    };
}
function mapPointToPgmPixel(image, x, y) {
    const pixelX = Math.floor(x);
    const pixelY = image.height - 1 - Math.floor(y);
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
export function useMapEditor({ open, mapName, onMessage }) {
    const pixelsRef = useRef(null);
    const [files, setFiles] = useState([]);
    const [selectedPath, setSelectedPath] = useState("");
    const [image, setImage] = useState(null);
    const [pixels, setPixels] = useState(null);
    const [undoStack, setUndoStack] = useState([]);
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
            const preferred = response.files.find((file) => file.path.includes(mapName));
            setSelectedPath((current) => { var _a; return current || (preferred === null || preferred === void 0 ? void 0 : preferred.path) || ((_a = response.files[0]) === null || _a === void 0 ? void 0 : _a.path) || ""; });
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
    }, [mapName, onMessage, open]);
    useEffect(() => {
        if (!open || !selectedPath) {
            setImage(null);
            setPixels(null);
            pixelsRef.current = null;
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
    const map = useMemo(() => {
        if (!image || !pixels)
            return null;
        return pgmPixelsToGrid(image, pixels);
    }, [image, pixels]);
    const editAtMapPoint = useCallback((x, y) => {
        if (!open || !image || busy || tool === "view")
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
        setPixels(nextPixels);
        setDirty(true);
        const action = tool === "erase_black" ? "Removed" : "Added";
        onMessage(`${action} ${editedPixels} pixels locally`);
    }, [brushSize, busy, image, onMessage, open, tool]);
    const undo = useCallback(() => {
        setUndoStack((stack) => {
            const previous = stack[stack.length - 1];
            if (!previous)
                return stack;
            pixelsRef.current = previous;
            setPixels(previous);
            setDirty(stack.length > 1);
            onMessage("Undid last edit");
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
        tool,
        setTool,
        brushSize,
        setBrushSize: (value) => setBrushSize(normalizeBrushSize(value)),
        busy,
        dirty,
        canUndo: undoStack.length > 0,
        undo,
        save,
        editAtMapPoint,
    };
}
function ViewToolIcon() {
    return (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v20"/>
      <path d="M2 12h20"/>
      <path d="m5 9-3 3 3 3"/>
      <path d="m19 9 3 3-3 3"/>
      <path d="m9 5 3-3 3 3"/>
      <path d="m9 19 3 3 3-3"/>
    </svg>);
}
export function MapEditorControls({ files, selectedPath, setSelectedPath, tool, setTool, brushSize, setBrushSize, busy, image, dirty, canUndo, undo, save, }) {
    const brushSizeOptions = Array.from({ length: MAX_BRUSH_SIZE_CELLS }, (_, index) => index + 1);
    const toolStyle = (selected) => ({
        color: selected
            ? "var(--vscode-list-activeSelectionForeground, var(--vscode-button-foreground))"
            : "var(--vscode-foreground)",
        backgroundColor: selected
            ? "var(--vscode-list-activeSelectionBackground, var(--vscode-button-background))"
            : "var(--vscode-editor-background)",
        borderColor: selected
            ? "var(--vscode-focusBorder)"
            : "var(--vscode-panel-border)",
        boxShadow: selected
            ? "inset 0 0 0 1px var(--vscode-focusBorder), inset 3px 0 0 var(--vscode-focusBorder)"
            : "none",
    });
    const commandStyle = (primary = false, active = false) => ({
        color: active || primary
            ? "var(--vscode-button-foreground)"
            : "var(--vscode-foreground)",
        backgroundColor: active
            ? "var(--vscode-list-activeSelectionBackground, var(--vscode-button-background))"
            : primary
                ? "var(--vscode-button-background)"
                : "var(--vscode-editor-background)",
        borderColor: active || primary
            ? "var(--vscode-focusBorder)"
            : "var(--vscode-panel-border)",
        boxShadow: active
            ? "inset 0 0 0 1px var(--vscode-focusBorder)"
            : "none",
    });
    return (<div className="flex flex-wrap items-center gap-2">
      <select value={selectedPath} disabled={busy || files.length === 0} onChange={(event) => setSelectedPath(event.currentTarget.value)} className="h-8 min-w-64 px-2 border text-sm" style={{
            color: "var(--vscode-input-foreground)",
            backgroundColor: "var(--vscode-input-background)",
            borderColor: "var(--vscode-input-border, var(--vscode-panel-border))",
        }}>
        {files.map((file) => (<option key={file.path} value={file.path}>
            {file.path}
          </option>))}
      </select>
      <div className="h-6 w-px" aria-hidden="true" style={{ backgroundColor: "var(--vscode-panel-border)" }}/>
      <button type="button" disabled={busy} aria-pressed={tool === "view"} onClick={() => setTool("view")} className="h-8 w-8 border inline-flex items-center justify-center transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0" title="View" aria-label="View" style={toolStyle(tool === "view")}>
        <ViewToolIcon />
      </button>
      {["erase_black", "draw_black"].map((value) => (<button key={value} type="button" disabled={busy} aria-pressed={tool === value} onClick={() => setTool(value)} className="h-8 px-3 border text-sm font-semibold transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0" style={toolStyle(tool === value)}>
          {value === "erase_black" ? "-" : "+"}
        </button>))}
      <select value={brushSize} disabled={busy} onChange={(event) => setBrushSize(Number(event.currentTarget.value))} className="h-8 w-12 border text-center text-sm font-semibold disabled:opacity-50" title="Brush size" aria-label="Brush size" style={{
            color: "var(--vscode-input-foreground)",
            backgroundColor: "var(--vscode-input-background)",
            borderColor: brushSize !== DEFAULT_BRUSH_SIZE_CELLS
                ? "var(--vscode-focusBorder)"
                : "var(--vscode-input-border, var(--vscode-panel-border))",
            boxShadow: brushSize !== DEFAULT_BRUSH_SIZE_CELLS
                ? "inset 0 0 0 1px var(--vscode-focusBorder)"
                : "none",
        }}>
        {brushSizeOptions.map((value) => (<option key={value} value={value}>
            {value}
          </option>))}
      </select>
      <div className="h-6 w-px" aria-hidden="true" style={{ backgroundColor: "var(--vscode-panel-border)" }}/>
      <button type="button" disabled={busy || !canUndo} onClick={undo} className="h-8 px-3 border text-sm font-semibold transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0" style={commandStyle(false, canUndo)}>
        Back
      </button>
      <button type="button" disabled={busy || !dirty} onClick={save} className="h-8 px-3 border text-sm font-semibold transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0" style={commandStyle(true, dirty)}>
        Save
      </button>
      <span className="text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
        {image ? `${image.width} x ${image.height}${dirty ? " *" : ""}` : "Select a PGM"}
      </span>
    </div>);
}
