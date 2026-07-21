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
const ANNOTATION_TOOL = { id: "label_marker", label: "Area" };
const ANNOTATION_ERASE_TOOL = { id: "erase_area", label: "Erase Area" };
const ANNOTATION_COLORS = [
    { id: "dark_brown", label: "Dark brown", value: "#3B241F" },
    { id: "red_wine", label: "Red wine", value: "#6D1F2A" },
    { id: "navy", label: "Navy", value: "#203A63" },
    { id: "dark_yellow", label: "Dark yellow", value: "#A77912" },
    { id: "gray", label: "Gray", value: "#5C6670" },
    { id: "forest", label: "Forest", value: "#2F5D46" },
    { id: "plum", label: "Plum", value: "#57406F" },
    { id: "teal", label: "Teal", value: "#1F6B73" },
    { id: "rust", label: "Rust", value: "#8A3F28" },
    { id: "olive", label: "Olive", value: "#58652D" },
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
function annotationCoversPgmPixel(annotation, image, pixelX, pixelY) {
    const region = normalizeAnnotationRegion(annotation === null || annotation === void 0 ? void 0 : annotation.region);
    if (!region)
        return false;
    if ((region.width && region.width !== image.width) || (region.height && region.height !== image.height))
        return false;
    const bounds = region.bounds || {
        x_min: region.seed_cell.x,
        y_min: region.seed_cell.y,
        x_max: region.seed_cell.x,
        y_max: region.seed_cell.y,
    };
    const gridY = image.height - 1 - pixelY;
    return (pixelX >= bounds.x_min &&
        pixelX <= bounds.x_max &&
        gridY >= bounds.y_min &&
        gridY <= bounds.y_max);
}
function pgmSelectionGridBounds(image, startPixel, endPixel) {
    if (!image || !startPixel || !endPixel)
        return null;
    const xMin = Math.max(0, Math.min(startPixel.pixelX, endPixel.pixelX));
    const xMax = Math.min(image.width - 1, Math.max(startPixel.pixelX, endPixel.pixelX));
    const yMin = Math.max(0, Math.min(startPixel.pixelY, endPixel.pixelY));
    const yMax = Math.min(image.height - 1, Math.max(startPixel.pixelY, endPixel.pixelY));
    return {
        x_min: xMin,
        y_min: image.height - 1 - yMax,
        x_max: xMax,
        y_max: image.height - 1 - yMin,
    };
}
function annotationGridBounds(annotation, image) {
    const region = normalizeAnnotationRegion(annotation === null || annotation === void 0 ? void 0 : annotation.region);
    if (!region)
        return null;
    if ((region.width && region.width !== image.width) || (region.height && region.height !== image.height))
        return null;
    const bounds = region.bounds || {
        x_min: region.seed_cell.x,
        y_min: region.seed_cell.y,
        x_max: region.seed_cell.x,
        y_max: region.seed_cell.y,
    };
    return {
        x_min: Math.max(0, Math.min(bounds.x_min, bounds.x_max)),
        y_min: Math.max(0, Math.min(bounds.y_min, bounds.y_max)),
        x_max: Math.min(image.width - 1, Math.max(bounds.x_min, bounds.x_max)),
        y_max: Math.min(image.height - 1, Math.max(bounds.y_min, bounds.y_max)),
    };
}
function annotationIntersectsGridBounds(annotation, image, selectionBounds) {
    const bounds = annotationGridBounds(annotation, image);
    if (!bounds || !selectionBounds)
        return false;
    return !(bounds.x_max < selectionBounds.x_min ||
        bounds.x_min > selectionBounds.x_max ||
        bounds.y_max < selectionBounds.y_min ||
        bounds.y_min > selectionBounds.y_max);
}
function selectedFreePgmRegion(pixels, image, startPixel, endPixel, existingAnnotations = []) {
    if (!pixels || !image || !startPixel || !endPixel)
        return null;
    const xMin = Math.max(0, Math.min(startPixel.pixelX, endPixel.pixelX));
    const xMax = Math.min(image.width - 1, Math.max(startPixel.pixelX, endPixel.pixelX));
    const yMin = Math.max(0, Math.min(startPixel.pixelY, endPixel.pixelY));
    const yMax = Math.min(image.height - 1, Math.max(startPixel.pixelY, endPixel.pixelY));
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (let y = yMin; y <= yMax; y += 1) {
        for (let x = xMin; x <= xMax; x += 1) {
            if (pixels[x + y * image.width] < FREE_THRESHOLD)
                continue;
            if (existingAnnotations.some((annotation) => annotationCoversPgmPixel(annotation, image, x, y)))
                continue;
            count += 1;
            sumX += x;
            sumY += y;
        }
    }
    const gridYMin = image.height - 1 - yMax;
    const gridYMax = image.height - 1 - yMin;
    return {
        count,
        centroidPixelX: count ? sumX / count : (xMin + xMax) / 2,
        centroidPixelY: count ? sumY / count : (yMin + yMax) / 2,
        bounds: {
            x_min: xMin,
            y_min: gridYMin,
            x_max: xMax,
            y_max: gridYMax,
        },
        seedCell: {
            x: Math.floor((xMin + xMax) / 2),
            y: Math.floor((gridYMin + gridYMax) / 2),
        },
    };
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
function pgmPixelToMapPoint(image, pixelX, pixelY) {
    const resolution = Number(image.resolution ?? 1) || 1;
    const origin = image.origin ?? {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const originX = Number(origin.position?.x ?? 0);
    const originY = Number(origin.position?.y ?? 0);
    const originYaw = yawFromPose(origin);
    const localX = (pixelX + 0.5) * resolution;
    const localY = (image.height - 1 - pixelY + 0.5) * resolution;
    return {
        x: originX + Math.cos(originYaw) * localX - Math.sin(originYaw) * localY,
        y: originY + Math.sin(originYaw) * localX + Math.cos(originYaw) * localY,
    };
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
function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] = hp < 1 ? [c, x, 0]
        : hp < 2 ? [x, c, 0]
            : hp < 3 ? [0, c, x]
                : hp < 4 ? [0, x, c]
                    : hp < 5 ? [x, 0, c]
                        : [c, 0, x];
    const m = l - c / 2;
    const toHex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, "0").toUpperCase();
    return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}
function chooseAnnotationColor(existingAnnotations) {
    const used = new Set((existingAnnotations || []).map((annotation) => normalizeAnnotationColor(annotation.color)));
    const available = ANNOTATION_COLORS.filter((color) => !used.has(color.value));
    if (available.length) {
        return available[Math.floor(Math.random() * available.length)].value;
    }
    for (let attempt = 0; attempt < 48; attempt += 1) {
        const hue = (Math.random() * 360 + used.size * 137.508 + attempt * 29) % 360;
        const generated = hslToHex(hue, 0.52, 0.32);
        if (!used.has(generated))
            return generated;
    }
    return hslToHex((used.size * 137.508) % 360, 0.52, 0.32);
}
function normalizeAnnotationRegion(region) {
    var _a, _b, _c, _d, _e;
    const seed = (_a = region === null || region === void 0 ? void 0 : region.seed_cell) !== null && _a !== void 0 ? _a : {};
    const x = Number((_b = seed.x) !== null && _b !== void 0 ? _b : NaN);
    const y = Number((_c = seed.y) !== null && _c !== void 0 ? _c : NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0)
        return null;
    const normalized = {
        seed_cell: { x: Math.floor(x), y: Math.floor(y) },
        cell_count: Number.isFinite(Number(region === null || region === void 0 ? void 0 : region.cell_count)) ? Math.max(0, Math.floor(Number(region.cell_count))) : null,
        width: Number.isFinite(Number((_d = region === null || region === void 0 ? void 0 : region.width) !== null && _d !== void 0 ? _d : NaN)) ? Math.max(0, Math.floor(Number(region.width))) : null,
        height: Number.isFinite(Number((_e = region === null || region === void 0 ? void 0 : region.height) !== null && _e !== void 0 ? _e : NaN)) ? Math.max(0, Math.floor(Number(region.height))) : null,
    };
    const bounds = region === null || region === void 0 ? void 0 : region.bounds;
    if (bounds) {
        const xMin = Math.floor(Number(bounds.x_min));
        const yMin = Math.floor(Number(bounds.y_min));
        const xMax = Math.floor(Number(bounds.x_max));
        const yMax = Math.floor(Number(bounds.y_max));
        if ([xMin, yMin, xMax, yMax].every(Number.isFinite)) {
            normalized.bounds = {
                x_min: Math.max(0, Math.min(xMin, xMax)),
                y_min: Math.max(0, Math.min(yMin, yMax)),
                x_max: Math.max(0, Math.max(xMin, xMax)),
                y_max: Math.max(0, Math.max(yMin, yMax)),
            };
        }
    }
    return normalized;
}
function normalizeAnnotation(annotation) {
    var _a, _b, _c, _d, _e, _f;
    const pose = (_a = annotation === null || annotation === void 0 ? void 0 : annotation.pose) !== null && _a !== void 0 ? _a : {};
    const label = String((_b = annotation === null || annotation === void 0 ? void 0 : annotation.label) !== null && _b !== void 0 ? _b : "Area").trim() || "Area";
    const normalized = {
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
    const region = normalizeAnnotationRegion(annotation === null || annotation === void 0 ? void 0 : annotation.region);
    if (region)
        normalized.region = region;
    return normalized;
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
    const [annotationLabel, setAnnotationLabel] = useState("Area");
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [annotationsDirty, setAnnotationsDirty] = useState(false);
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
            setAnnotationsDirty(false);
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
            setAnnotationsDirty(false);
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
            setAnnotationsDirty(false);
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
            setAnnotationsDirty(false);
        })
            .catch((error) => {
            if (cancelled)
                return;
            annotationsRef.current = [];
            setAnnotations([]);
            setAnnotationsDirty(false);
            onMessage(error instanceof Error ? error.message : "Failed to load map areas");
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
        setUndoStack((stack) => [...stack, { type: "pixels", pixels: currentPixels }]);
        setRedoStack([]);
        setPixels(nextPixels);
        setDirty(true);
        const action = tool === "erase_black" ? "Removed" : "Added";
        onMessage(`${action} ${editedPixels} pixels locally`);
    }, [brushSize, busy, image, onMessage, open, tool]);
    const applyAnnotationsSnapshot = useCallback((nextAnnotations, successMessage) => {
        const normalized = nextAnnotations.map(normalizeAnnotation);
        annotationsRef.current = normalized;
        setAnnotations(normalized);
        setAnnotationsDirty(true);
        onMessage(successMessage);
    }, [onMessage]);
    const persistAnnotations = useCallback((nextAnnotations, successMessage) => {
        if (!selectedPath || busy)
            return;
        const currentAnnotations = annotationsRef.current;
        setUndoStack((stack) => [...stack, { type: "annotations", annotations: currentAnnotations }]);
        setRedoStack([]);
        applyAnnotationsSnapshot(nextAnnotations, successMessage);
    }, [applyAnnotationsSnapshot, busy, selectedPath]);
    const placeAnnotationAtMapArea = useCallback((startX, startY, endX = startX, endY = startY) => {
        if (!open || !image || busy || tool !== ANNOTATION_TOOL.id)
            return;
        const startPixel = mapPointToPgmPixel(image, startX, startY);
        const endPixel = mapPointToPgmPixel(image, endX, endY);
        if (!startPixel || !endPixel) {
            onMessage("Select an area inside the map");
            return;
        }
        const currentPixels = pixelsRef.current;
        if (!currentPixels)
            return;
        const region = selectedFreePgmRegion(currentPixels, image, startPixel, endPixel, annotationsRef.current);
        if (!region || region.count === 0) {
            onMessage("Drag over an unmarked white free-space area");
            return;
        }
        const label = annotationLabel.trim() || "Area";
        const centroid = pgmPixelToMapPoint(image, region.centroidPixelX, region.centroidPixelY);
        const nextAnnotation = normalizeAnnotation({
            id: makeAnnotationId(),
            label,
            color: chooseAnnotationColor(annotationsRef.current),
            pose: { frame_id: "map", x: centroid.x, y: centroid.y, yaw: 0 },
            region: {
                seed_cell: {
                    x: region.seedCell.x,
                    y: region.seedCell.y,
                },
                bounds: region.bounds,
                cell_count: region.count,
                width: image.width,
                height: image.height,
            },
        });
        persistAnnotations([...annotationsRef.current, nextAnnotation], `Marked area ${nextAnnotation.label}`);
    }, [annotationLabel, busy, image, onMessage, open, persistAnnotations, tool]);
    const placeAnnotationAtMapPoint = useCallback((x, y) => {
        placeAnnotationAtMapArea(x, y, x, y);
    }, [placeAnnotationAtMapArea]);
    const eraseAnnotationsAtMapArea = useCallback((startX, startY, endX = startX, endY = startY) => {
        if (!open || !image || busy || tool !== ANNOTATION_ERASE_TOOL.id)
            return;
        const startPixel = mapPointToPgmPixel(image, startX, startY);
        const endPixel = mapPointToPgmPixel(image, endX, endY);
        const selectionBounds = pgmSelectionGridBounds(image, startPixel, endPixel);
        if (!selectionBounds) {
            onMessage("Select an area inside the map");
            return;
        }
        const currentAnnotations = annotationsRef.current;
        const nextAnnotations = currentAnnotations.filter((annotation) => !annotationIntersectsGridBounds(annotation, image, selectionBounds));
        const removedCount = currentAnnotations.length - nextAnnotations.length;
        if (removedCount === 0) {
            onMessage("No map areas selected");
            return;
        }
        persistAnnotations(nextAnnotations, `Removed ${removedCount} map area${removedCount === 1 ? "" : "s"}`);
    }, [busy, image, onMessage, open, persistAnnotations, tool]);
    const clearAnnotations = useCallback(() => {
        if (!annotationsRef.current.length)
            return;
        persistAnnotations([], "Cleared map areas");
    }, [persistAnnotations]);
    const undo = useCallback(() => {
        const currentPixels = pixelsRef.current;
        setUndoStack((stack) => {
            const previous = stack[stack.length - 1];
            if (!previous)
                return stack;
            if (previous.type === "pixels") {
                if (!currentPixels)
                    return stack;
                setRedoStack((redo) => [...redo, { type: "pixels", pixels: currentPixels }]);
                pixelsRef.current = previous.pixels;
                setPixels(previous.pixels);
                setDirty(stack.slice(0, -1).some((item) => item.type === "pixels"));
                onMessage("Undid last map edit");
            }
            else if (previous.type === "annotations") {
                const currentAnnotations = annotationsRef.current;
                setRedoStack((redo) => [...redo, { type: "annotations", annotations: currentAnnotations }]);
                applyAnnotationsSnapshot(previous.annotations, "Undid last area edit");
            }
            return stack.slice(0, -1);
        });
    }, [applyAnnotationsSnapshot, onMessage]);
    const redo = useCallback(() => {
        const currentPixels = pixelsRef.current;
        setRedoStack((stack) => {
            const next = stack[stack.length - 1];
            if (!next)
                return stack;
            if (next.type === "pixels") {
                if (!currentPixels)
                    return stack;
                setUndoStack((undoHistory) => [...undoHistory, { type: "pixels", pixels: currentPixels }]);
                pixelsRef.current = next.pixels;
                setPixels(next.pixels);
                setDirty(true);
                onMessage("Redid last map edit");
            }
            else if (next.type === "annotations") {
                const currentAnnotations = annotationsRef.current;
                setUndoStack((undoHistory) => [...undoHistory, { type: "annotations", annotations: currentAnnotations }]);
                applyAnnotationsSnapshot(next.annotations, "Redid last area edit");
            }
            return stack.slice(0, -1);
        });
    }, [applyAnnotationsSnapshot, onMessage]);
    const save = useCallback(() => {
        if (!image || !pixels || busy || (!dirty && !annotationsDirty))
            return;
        setBusy(true);
        Promise.resolve()
            .then(async () => {
            const savedParts = [];
            let savedPath = image.path;
            if (dirty) {
                const response = await savePgmImage(image.path, image.width, image.height, image.maxval, encodePgmPixels(pixels));
                savedPath = (response === null || response === void 0 ? void 0 : response.path) || savedPath;
                setDirty(false);
                savedParts.push("map");
            }
            if (annotationsDirty) {
                const response = await saveMapAnnotations(image.path, annotationsRef.current);
                const saved = Array.isArray(response === null || response === void 0 ? void 0 : response.annotations)
                    ? response.annotations.map(normalizeAnnotation)
                    : annotationsRef.current;
                annotationsRef.current = saved;
                setAnnotations(saved);
                setAnnotationsDirty(false);
                savedParts.push("areas");
            }
            setUndoStack([]);
            setRedoStack([]);
            onMessage(savedParts.length > 1 ? `Saved map and areas ${savedPath}` : `Saved ${savedParts[0] === "areas" ? "map areas" : savedPath}`);
        })
            .catch((error) => {
            onMessage(error instanceof Error ? error.message : "Failed to save map");
        })
            .finally(() => setBusy(false));
    }, [annotationsDirty, busy, dirty, image, onMessage, pixels]);
    const hasUnsavedChanges = dirty || annotationsDirty;
    return {
        files,
        selectedPath,
        setSelectedPath,
        image,
        map,
        annotations,
        annotationLabel,
        setAnnotationLabel,
        tool,
        setTool,
        brushSize,
        setBrushSize: (value) => setBrushSize(normalizeBrushSize(value)),
        busy,
        dirty: hasUnsavedChanges,
        pixelsDirty: dirty,
        annotationsDirty,
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undo,
        redo,
        save,
        editAtMapPoint,
        placeAnnotationAtMapPoint,
        placeAnnotationAtMapArea,
        eraseAnnotationsAtMapArea,
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
    erase_area: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16" /><path d="M9 5V3h6v2" /><path d="M7 9l1 11h8l1-11" /><path d="M10 12v5" /><path d="M14 12v5" />
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

export function MapEditorControls({ files, selectedPath, setSelectedPath, tool, setTool, brushSize, setBrushSize, busy, image, dirty, canUndo = false, canRedo = false, undo, redo, save, enableAnnotations = false, annotations = [], annotationLabel = "Area", setAnnotationLabel = () => { }, clearAnnotations = () => { }, }) {
    const iconButtonStyle = (enabled) => ({
        borderRadius: 9,
        border: "1px solid var(--mc-border-strong)",
        backgroundColor: "var(--mc-surface)",
        color: enabled ? "var(--mc-text)" : "var(--mc-text-subtle)",
    });
    const tools = enableAnnotations ? [...EDIT_TOOLS, ANNOTATION_TOOL, ANNOTATION_ERASE_TOOL] : EDIT_TOOLS;
    const labelActive = enableAnnotations && tool === ANNOTATION_TOOL.id;
    const eraseAreaActive = enableAnnotations && tool === ANNOTATION_ERASE_TOOL.id;
    const brushActive = !labelActive && !eraseAreaActive;

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
                    <span className="text-[9.5px] font-mono tracking-[0.1em]" style={{ color: "var(--mc-text-subtle)" }}>AREA</span>
                    <input
                        aria-label="Area name"
                        value={annotationLabel}
                        disabled={busy}
                        onChange={(event) => setAnnotationLabel(event.currentTarget.value)}
                        className="h-9 w-32 px-3 text-[12px] font-semibold"
                        style={{ borderRadius: 10, color: "var(--mc-text)", backgroundColor: "var(--mc-surface)", border: "1px solid var(--mc-border-strong)" }}
                    />
                    <button
                        type="button"
                        disabled={busy || annotations.length === 0}
                        onClick={clearAnnotations}
                        className="h-9 px-3 text-[12px] font-semibold transition-all active:translate-y-px disabled:opacity-50 disabled:active:translate-y-0"
                        style={{ borderRadius: 9, border: "1px solid var(--mc-border-strong)", backgroundColor: "var(--mc-surface)", color: "var(--mc-text)" }}
                    >
                        Clear Areas
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
