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
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
// @ts-ignore
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildTfFramePoses, normalizeFrameId, orientationFromYaw, yawFromPose, } from "../../utils/navigationTf";
const CAMERA_NEAR = 0.05;
const CAMERA_FAR = 2000;
const MAP_DISPLAY_ROTATION = Math.PI;
const CLICK_DRAG_THRESHOLD_PX = 8;
const TF_AXIS_LENGTH = 0.2;
const WAYPOINT_RING_INNER_RADIUS = 2.25;
const WAYPOINT_RING_OUTER_RADIUS = 3;
const WAYPOINT_SELECTED_HALO_INNER_RADIUS = 3.28;
const WAYPOINT_SELECTED_HALO_OUTER_RADIUS = 3.72;
const WAYPOINT_CENTER_RADIUS = 1.25;
const WAYPOINT_HEADING_LENGTH = 4.4;
const WAYPOINT_HEADING_SHAFT_WIDTH = 1.12;
const WAYPOINT_HEADING_HEAD_LENGTH = 1.05;
const WAYPOINT_HEADING_HEAD_WIDTH = 2.84;
const WAYPOINT_LABEL_OFFSET_Y = 7.2;
const WAYPOINT_LABEL_SCALE_Y = 6;
const BT_FOCUS_VISIBLE_HEIGHT_MIN = 5;
const BT_FOCUS_VISIBLE_HEIGHT_MAX = 11;
const BT_FOCUS_WAYPOINT_NDC_X = -0.75;
function gridMeta(grid) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const info = grid === null || grid === void 0 ? void 0 : grid.info;
    const width = Number((_a = info === null || info === void 0 ? void 0 : info.width) !== null && _a !== void 0 ? _a : 0);
    const height = Number((_b = info === null || info === void 0 ? void 0 : info.height) !== null && _b !== void 0 ? _b : 0);
    const resolution = Number((_c = info === null || info === void 0 ? void 0 : info.resolution) !== null && _c !== void 0 ? _c : 0);
    const originX = Number((_f = (_e = (_d = info === null || info === void 0 ? void 0 : info.origin) === null || _d === void 0 ? void 0 : _d.position) === null || _e === void 0 ? void 0 : _e.x) !== null && _f !== void 0 ? _f : 0);
    const originY = Number((_j = (_h = (_g = info === null || info === void 0 ? void 0 : info.origin) === null || _g === void 0 ? void 0 : _g.position) === null || _h === void 0 ? void 0 : _h.y) !== null && _j !== void 0 ? _j : 0);
    const originYaw = yawFromPose((_k = info === null || info === void 0 ? void 0 : info.origin) !== null && _k !== void 0 ? _k : null);
    if (!width || !height || !resolution)
        return null;
    return { width, height, resolution, originX, originY, originYaw };
}
function scanCellsForGrid(grid, scan, scanPose, framePose) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const meta = gridMeta(grid);
    if (!meta || !((_a = scan === null || scan === void 0 ? void 0 : scan.ranges) === null || _a === void 0 ? void 0 : _a.length) || !scanPose)
        return null;
    const frameYaw = framePose ? yawFromPose(framePose) : 0;
    const frameCos = Math.cos(frameYaw);
    const frameSin = Math.sin(frameYaw);
    const frameX = Number((_c = (_b = framePose === null || framePose === void 0 ? void 0 : framePose.position) === null || _b === void 0 ? void 0 : _b.x) !== null && _c !== void 0 ? _c : 0);
    const frameY = Number((_e = (_d = framePose === null || framePose === void 0 ? void 0 : framePose.position) === null || _d === void 0 ? void 0 : _d.y) !== null && _e !== void 0 ? _e : 0);
    const originYaw = meta.originYaw;
    const originCos = Math.cos(originYaw);
    const originSin = Math.sin(originYaw);
    const scanX = Number((_g = (_f = scanPose.position) === null || _f === void 0 ? void 0 : _f.x) !== null && _g !== void 0 ? _g : 0);
    const scanY = Number((_j = (_h = scanPose.position) === null || _h === void 0 ? void 0 : _h.y) !== null && _j !== void 0 ? _j : 0);
    const scanYaw = yawFromPose(scanPose);
    const min = Number((_k = scan.range_min) !== null && _k !== void 0 ? _k : 0.02);
    const max = Number((_l = scan.range_max) !== null && _l !== void 0 ? _l : 20);
    const angleMin = Number((_m = scan.angle_min) !== null && _m !== void 0 ? _m : 0);
    const inc = Number((_o = scan.angle_increment) !== null && _o !== void 0 ? _o : 0);
    const cells = new Set();
    scan.ranges.forEach((range, index) => {
        const r = Number(range);
        if (!Number.isFinite(r) || r < min || r > max)
            return;
        const angle = scanYaw + angleMin + inc * index;
        const mapX = scanX + Math.cos(angle) * r;
        const mapY = scanY + Math.sin(angle) * r;
        const frameDx = mapX - frameX;
        const frameDy = mapY - frameY;
        const gridFrameX = frameCos * frameDx + frameSin * frameDy;
        const gridFrameY = -frameSin * frameDx + frameCos * frameDy;
        const originDx = gridFrameX - meta.originX;
        const originDy = gridFrameY - meta.originY;
        const localX = originCos * originDx + originSin * originDy;
        const localY = -originSin * originDx + originCos * originDy;
        const cellX = Math.floor(localX / meta.resolution);
        const cellY = Math.floor(localY / meta.resolution);
        if (cellX < 0 || cellX >= meta.width || cellY < 0 || cellY >= meta.height)
            return;
        for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
                const x = cellX + dx;
                const y = cellY + dy;
                if (x < 0 || x >= meta.width || y < 0 || y >= meta.height)
                    continue;
                cells.add(x + y * meta.width);
            }
        }
    });
    return cells;
}
// Warm, theme-aware occupancy palette (see design handoff, turn 6).
const OCC_COLORS = {
    light: {
        unknown: [227, 221, 207, 220], // #E3DDCF, blends into paper scene bg
        free: [250, 248, 243, 255],    // #FAF8F3
        wall: [42, 38, 32, 255],       // #2A2620 warm ink
        lethal: [193, 78, 52, 215],    // #C14E34
        inflate: [217, 130, 43, 235],  // #D9822B
    },
    dark: {
        unknown: [30, 28, 24, 220],    // #1E1C18
        free: [43, 40, 35, 255],       // #2B2823
        wall: [216, 210, 196, 255],    // #D8D2C4 cream walls (blueprint invert)
        lethal: [209, 90, 62, 215],    // #D15A3E
        inflate: [224, 154, 69, 235],  // #E09A45
    },
};
// Rounded occupancy rendering keeps the exact cells, then only shaves exposed
// outer corners. This avoids the old blur/threshold path where 1-cell edits
// could disappear visually.
const OCC_ROUNDED = {
    scale: 4,
    maxDim: 2048,
    radiusCells: 0.38,
};
function occRgba([r, g, b, a]) {
    return `rgba(${r},${g},${b},${a / 255})`;
}
const OCC_CELL_UNKNOWN = 0;
const OCC_CELL_FREE = 1;
const OCC_CELL_WALL = 2;
function occupancyCellType(value) {
    if (value === 0)
        return OCC_CELL_FREE;
    if (value > 0)
        return OCC_CELL_WALL;
    return OCC_CELL_UNKNOWN;
}
function sameOccupancyCell(cells, w, h, type, x, y) {
    return x >= 0 && x < w && y >= 0 && y < h && cells[x + y * w] === type;
}
function addCornerCut(ctx, x0, y0, x1, y1, r, corner) {
    if (corner === "tl") {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + r, y0);
        ctx.quadraticCurveTo(x0, y0, x0, y0 + r);
    }
    else if (corner === "tr") {
        ctx.moveTo(x1, y0);
        ctx.lineTo(x1, y0 + r);
        ctx.quadraticCurveTo(x1, y0, x1 - r, y0);
    }
    else if (corner === "br") {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - r, y1);
        ctx.quadraticCurveTo(x1, y1, x1, y1 - r);
    }
    else {
        ctx.moveTo(x0, y1);
        ctx.lineTo(x0, y1 - r);
        ctx.quadraticCurveTo(x0, y1, x0 + r, y1);
    }
    ctx.closePath();
}
function drawRoundedOccupancyLayer(targetCtx, cells, w, h, scale, type, color) {
    const layer = document.createElement("canvas");
    layer.width = w * scale;
    layer.height = h * scale;
    const ctx = layer.getContext("2d");
    if (!ctx)
        return;
    ctx.fillStyle = occRgba(color);
    for (let y = 0; y < h; y += 1) {
        let runStart = -1;
        for (let x = 0; x <= w; x += 1) {
            const matches = x < w && cells[x + y * w] === type;
            if (matches && runStart < 0) {
                runStart = x;
            }
            else if (!matches && runStart >= 0) {
                ctx.fillRect(runStart * scale, y * scale, (x - runStart) * scale, scale);
                runStart = -1;
            }
        }
    }
    const r = Math.min(scale * OCC_ROUNDED.radiusCells, scale / 2);
    if (r > 0.1) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "#000";
        ctx.beginPath();
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                if (cells[x + y * w] !== type)
                    continue;
                const left = sameOccupancyCell(cells, w, h, type, x - 1, y);
                const right = sameOccupancyCell(cells, w, h, type, x + 1, y);
                const top = sameOccupancyCell(cells, w, h, type, x, y - 1);
                const bottom = sameOccupancyCell(cells, w, h, type, x, y + 1);
                const x0 = x * scale;
                const y0 = y * scale;
                const x1 = x0 + scale;
                const y1 = y0 + scale;
                if (!left && !top)
                    addCornerCut(ctx, x0, y0, x1, y1, r, "tl");
                if (!right && !top)
                    addCornerCut(ctx, x0, y0, x1, y1, r, "tr");
                if (!right && !bottom)
                    addCornerCut(ctx, x0, y0, x1, y1, r, "br");
                if (!left && !bottom)
                    addCornerCut(ctx, x0, y0, x1, y1, r, "bl");
            }
        }
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
    }
    targetCtx.drawImage(layer, 0, 0);
}
function makeOccupancyTexture(grid, alpha, mode, highlightedCells = null, isDark = false) {
    var _a;
    const meta = gridMeta(grid);
    if (!meta || !grid.data || grid.data.length < meta.width * meta.height)
        return null;
    const palette = isDark ? OCC_COLORS.dark : OCC_COLORS.light;
    const w = meta.width;
    const h = meta.height;

    // ---- Rounded exact-cell rendering for the base map ----
    if (mode === "map") {
        const scale = Math.max(1, Math.min(OCC_ROUNDED.scale, Math.floor(OCC_ROUNDED.maxDim / Math.max(w, h)) || 1));
        const cells = new Uint8Array(w * h);
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                const srcIndex = (w - 1 - x) + (h - 1 - y) * w; // same flip as before
                const value = (_a = grid.data[srcIndex]) !== null && _a !== void 0 ? _a : -1;
                cells[x + y * w] = occupancyCellType(value);
            }
        }

        const out = document.createElement("canvas");
        out.width = w * scale; out.height = h * scale;
        const ctx = out.getContext("2d");
        if (!ctx)
            return null;
        ctx.fillStyle = occRgba(palette.unknown);
        ctx.fillRect(0, 0, out.width, out.height);
        drawRoundedOccupancyLayer(ctx, cells, w, h, scale, OCC_CELL_FREE, palette.free);
        drawRoundedOccupancyLayer(ctx, cells, w, h, scale, OCC_CELL_WALL, palette.wall);

        const texture = new THREE.CanvasTexture(out);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.flipY = false;
        texture.needsUpdate = true;
        return texture;
    }

    // ---- costmaps: crisp per-cell (safety-accurate), warm colors ----
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const srcIndex = (w - 1 - x) + (h - 1 - y) * w;
            const dstIndex = (x + y * w) * 4;
            const value = (_a = grid.data[srcIndex]) !== null && _a !== void 0 ? _a : -1;
            let r = 118, g = 118, b = 118, a = alpha;
            if (mode === "globalCostmap") {
                if (value <= 0) { r = 0; g = 0; b = 0; a = 0; }
                else {
                    const normalized = Math.min(Math.max(value, 0), 100) / 100;
                    const gray = Math.round(220 - normalized * 205);
                    r = gray; g = Math.round(gray * 0.97); b = Math.round(gray * 0.90);
                    a = Math.round(95 + normalized * 150);
                }
            }
            else if (mode === "localCostmap") {
                if (highlightedCells === null || highlightedCells === void 0 ? void 0 : highlightedCells.has(srcIndex)) {
                    [r, g, b, a] = palette.lethal;
                }
                else if (value <= 20) { a = 0; }
                else if (value < 70) { [r, g, b, a] = palette.lethal; }
                else { [r, g, b, a] = palette.inflate; }
            }
            image.data[dstIndex] = r;
            image.data[dstIndex + 1] = g;
            image.data[dstIndex + 2] = b;
            image.data[dstIndex + 3] = a;
        }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.flipY = false;
    texture.needsUpdate = true;
    return texture;
}
function disposeObject(object) {
    object.traverse((child) => {
        var _a;
        if (child instanceof THREE.Mesh ||
            child instanceof THREE.Points ||
            child instanceof THREE.Line ||
            child instanceof THREE.Sprite) {
            (_a = child.geometry) === null || _a === void 0 ? void 0 : _a.dispose();
            const material = child.material;
            if (Array.isArray(material)) {
                material.forEach((item) => {
                    const texture = item.map;
                    // Textures flagged `retain` are cached across layer rebuilds
                    // (annotation regions) and disposed by their cache instead.
                    if (texture && !texture.userData.retain)
                        texture.dispose();
                    item.dispose();
                });
            }
            else {
                const texture = material === null || material === void 0 ? void 0 : material.map;
                if (texture && !texture.userData.retain)
                    texture.dispose();
                material === null || material === void 0 ? void 0 : material.dispose();
            }
        }
    });
}
function makeGridPlane(grid, mode, z, framePose = null, highlightedCells = null, isDark = false) {
    var _a, _b, _c, _d;
    const meta = gridMeta(grid);
    const texture = makeOccupancyTexture(grid, mode === "map" ? 255 : 170, mode, highlightedCells, isDark);
    if (!meta || !texture)
        return null;
    const width = meta.width * meta.resolution;
    const height = meta.height * meta.resolution;
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: mode !== "map",
        opacity: mode === "map" ? 1 : 0.82,
        depthWrite: mode === "map",
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const originYaw = meta.originYaw;
    const originCos = Math.cos(originYaw);
    const originSin = Math.sin(originYaw);
    const gridCenterX = meta.originX + originCos * (width / 2) - originSin * (height / 2);
    const gridCenterY = meta.originY + originSin * (width / 2) + originCos * (height / 2);
    const frameYaw = framePose ? yawFromPose(framePose) : 0;
    const frameCos = Math.cos(frameYaw);
    const frameSin = Math.sin(frameYaw);
    const frameX = Number((_b = (_a = framePose === null || framePose === void 0 ? void 0 : framePose.position) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 0);
    const frameY = Number((_d = (_c = framePose === null || framePose === void 0 ? void 0 : framePose.position) === null || _c === void 0 ? void 0 : _c.y) !== null && _d !== void 0 ? _d : 0);
    mesh.position.set(frameX + frameCos * gridCenterX - frameSin * gridCenterY, frameY + frameSin * gridCenterX + frameCos * gridCenterY, z);
    mesh.rotation.z = frameYaw + originYaw + MAP_DISPLAY_ROTATION;
    mesh.userData.mapTexture = texture;
    return mesh;
}
function makeGridTexturePlane(grid, texture, z) {
    const meta = gridMeta(grid);
    if (!meta || !texture)
        return null;
    const width = meta.width * meta.resolution;
    const height = meta.height * meta.resolution;
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const originYaw = meta.originYaw;
    const originCos = Math.cos(originYaw);
    const originSin = Math.sin(originYaw);
    const gridCenterX = meta.originX + originCos * (width / 2) - originSin * (height / 2);
    const gridCenterY = meta.originY + originSin * (width / 2) + originCos * (height / 2);
    mesh.position.set(gridCenterX, gridCenterY, z);
    mesh.rotation.z = originYaw + MAP_DISPLAY_ROTATION;
    mesh.userData.mapTexture = texture;
    mesh.userData.annotation = true;
    return mesh;
}
function mapPointToGridCell(meta, x, y) {
    if (!meta || !Number.isFinite(x) || !Number.isFinite(y))
        return null;
    const dx = x - meta.originX;
    const dy = y - meta.originY;
    const localX = Math.cos(meta.originYaw) * dx + Math.sin(meta.originYaw) * dy;
    const localY = -Math.sin(meta.originYaw) * dx + Math.cos(meta.originYaw) * dy;
    const cellX = Math.floor(localX / meta.resolution);
    const cellY = Math.floor(localY / meta.resolution);
    if (cellX < 0 || cellX >= meta.width || cellY < 0 || cellY >= meta.height)
        return null;
    return { x: cellX, y: cellY };
}
function gridCellToMapPoint(meta, cellX, cellY) {
    const localX = (cellX + 0.5) * meta.resolution;
    const localY = (cellY + 0.5) * meta.resolution;
    return {
        x: meta.originX + Math.cos(meta.originYaw) * localX - Math.sin(meta.originYaw) * localY,
        y: meta.originY + Math.sin(meta.originYaw) * localX + Math.cos(meta.originYaw) * localY,
    };
}
function boundedFreeRegion(grid, regionSpec, excludedCells = null) {
    const meta = gridMeta(grid);
    if (!meta || !grid.data || !regionSpec)
        return null;
    if (Array.isArray(regionSpec.cells) && regionSpec.cells.length) {
        const cells = [];
        const seen = new Set();
        let sumX = 0;
        let sumY = 0;
        regionSpec.cells.forEach((cell) => {
            const x = Math.floor(Number(cell === null || cell === void 0 ? void 0 : cell.x));
            const y = Math.floor(Number(cell === null || cell === void 0 ? void 0 : cell.y));
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= meta.width || y >= meta.height)
                return;
            const index = x + y * meta.width;
            if (seen.has(index) || grid.data[index] !== 0)
                return;
            if (excludedCells === null || excludedCells === void 0 ? void 0 : excludedCells.has(index))
                return;
            seen.add(index);
            cells.push(index);
            sumX += x;
            sumY += y;
        });
        if (!cells.length)
            return null;
        return {
            cells,
            centroid: {
                x: sumX / cells.length,
                y: sumY / cells.length,
            },
        };
    }
    const seed = regionSpec.seed_cell;
    const bounds = regionSpec.bounds || (seed ? {
        x_min: seed.x,
        y_min: seed.y,
        x_max: seed.x,
        y_max: seed.y,
    } : null);
    if (!bounds)
        return null;
    const rawXMin = Math.floor(Number(bounds.x_min));
    const rawXMax = Math.floor(Number(bounds.x_max));
    const rawYMin = Math.floor(Number(bounds.y_min));
    const rawYMax = Math.floor(Number(bounds.y_max));
    if (![rawXMin, rawXMax, rawYMin, rawYMax].every(Number.isFinite))
        return null;
    const xMin = Math.max(0, Math.min(rawXMin, rawXMax));
    const xMax = Math.min(meta.width - 1, Math.max(rawXMin, rawXMax));
    const yMin = Math.max(0, Math.min(rawYMin, rawYMax));
    const yMax = Math.min(meta.height - 1, Math.max(rawYMin, rawYMax));
    const cells = [];
    let sumX = 0;
    let sumY = 0;
    for (let y = yMin; y <= yMax; y += 1) {
        for (let x = xMin; x <= xMax; x += 1) {
            const index = x + y * meta.width;
            if (grid.data[index] !== 0)
                continue;
            if (excludedCells === null || excludedCells === void 0 ? void 0 : excludedCells.has(index))
                continue;
            cells.push(index);
            sumX += x;
            sumY += y;
        }
    }
    if (!cells.length)
        return null;
    return {
        cells,
        centroid: {
            x: sumX / cells.length,
            y: sumY / cells.length,
        },
    };
}
function rgbaArrayFromHex(color, alpha = 150) {
    const value = hexColorString(color, "#6D1F2A");
    return [
        Number.parseInt(value.slice(1, 3), 16),
        Number.parseInt(value.slice(3, 5), 16),
        Number.parseInt(value.slice(5, 7), 16),
        alpha,
    ];
}
function makeAnnotationRegionTexture(grid, region, colorString, alpha = 164) {
    const meta = gridMeta(grid);
    if (!meta || !region)
        return null;
    const scale = Math.max(1, Math.min(OCC_ROUNDED.scale, Math.floor(OCC_ROUNDED.maxDim / Math.max(meta.width, meta.height)) || 1));
    const mask = new Uint8Array(meta.width * meta.height);
    region.cells.forEach((index) => {
        const gridX = index % meta.width;
        const gridY = Math.floor(index / meta.width);
        const canvasX = meta.width - 1 - gridX;
        const canvasY = meta.height - 1 - gridY;
        mask[canvasX + canvasY * meta.width] = 1;
    });
    const canvas = document.createElement("canvas");
    canvas.width = meta.width * scale;
    canvas.height = meta.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return null;
    drawRoundedOccupancyLayer(ctx, mask, meta.width, meta.height, scale, 1, rgbaArrayFromHex(colorString, alpha));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    return texture;
}
function makeEditorAreaPreview(selection, isDark = false) {
    if (!selection)
        return null;
    const minX = Math.min(selection.startX, selection.endX);
    const maxX = Math.max(selection.startX, selection.endX);
    const minY = Math.min(selection.startY, selection.endY);
    const maxY = Math.max(selection.startY, selection.endY);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 0 || height <= 0)
        return null;
    const group = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({
        color: isDark ? 0xd5794f : 0x6d1f2a,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
    }));
    fill.position.set((minX + maxX) / 2, (minY + maxY) / 2, 0.82);
    group.add(fill);
    const outline = makeLine([
        new THREE.Vector3(minX, minY, 0.84),
        new THREE.Vector3(maxX, minY, 0.84),
        new THREE.Vector3(maxX, maxY, 0.84),
        new THREE.Vector3(minX, maxY, 0.84),
        new THREE.Vector3(minX, minY, 0.84),
    ], isDark ? 0xf3f1ea : 0x1c1a17, 2);
    if (outline)
        group.add(outline);
    return group;
}
function makeLine(points, color, lineWidth = 2) {
    if (points.length < 2)
        return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, linewidth: lineWidth });
    return new THREE.Line(geometry, material);
}
// Warm, theme-aware marker palette (turn 9 shapes + 11b colors + 12 labels).
const MARKER_COLORS = {
    light: {
        idle: 0x5b8266,          // sage — waypoints/behavior actions (walls stay ink)
        selected: 0xc96442,      // clay
        control: 0x1c1a17,       // ink — behavior control chips
        action: 0x5b8266,        // sage
        decorator: 0xb4762f,     // amber
        badgeTextIdle: "#ffffff",
        badgeTextSelected: "#ffffff",
        badgeStroke: "rgba(250,248,243,0.95)",
        labelBg: "rgba(243,241,234,0.92)",
        labelBorder: "rgba(226,221,209,1)",
        labelText: "#1c1a17",
        labelSelBg: "rgba(244,229,220,0.96)",
        labelSelBorder: "#c96442",
        labelSelText: "#b5563a",
        poseArrow: "#f3f1ea",
    },
    dark: {
        idle: 0x6f9a74,
        selected: 0xd5794f,
        control: 0xece7dd,       // cream — behavior control chips
        action: 0x6f9a74,
        decorator: 0xd9a05a,
        badgeTextIdle: "#1b1916",
        badgeTextSelected: "#1b1916",
        badgeStroke: "rgba(27,25,22,0.9)",
        labelBg: "rgba(43,40,35,0.92)",
        labelBorder: "rgba(61,57,49,1)",
        labelText: "#ece7dd",
        labelSelBg: "rgba(61,42,32,0.96)",
        labelSelBorder: "#d5794f",
        labelSelText: "#e0a488",
        poseArrow: "#1b1916",
    },
};
const markerPalette = (isDark) => (isDark ? MARKER_COLORS.dark : MARKER_COLORS.light);

function makeTextSprite(text, { width = 256, height = 64, fontSize = 22, backgroundAlpha = 0.92 } = {}, isDark = false) {
    const pal = markerPalette(isDark);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        const r = height / 2; // pill radius
        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
        ctx.roundRect(2, 2, width - 4, height - 4, r);
        ctx.fillStyle = pal.labelBg.replace("0.92", String(backgroundAlpha));
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = pal.labelBorder;
        ctx.stroke();
        ctx.fillStyle = pal.labelText;
        ctx.font = `600 ${fontSize}px "Hanken Grotesk", "Pretendard Variable", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, width / 2, height / 2 + 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
}

function hexColorString(color, fallback = "#C96442") {
    const match = String(color || "").trim().match(/^#?([0-9A-Fa-f]{6})$/);
    return match ? `#${match[1].toUpperCase()}` : fallback;
}
function makeAnnotationLabelSprite(text, color, isDark = false) {
    const label = String(text || "Area");
    const fontSize = 21;
    const font = `700 ${fontSize}px "Hanken Grotesk", "Pretendard Variable", sans-serif`;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = font;
    const textW = Math.ceil(measure.measureText(label).width);
    const height = 44;
    const padX = 10;
    const width = Math.max(72, textW + padX * 2);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#000000";
        ctx.font = font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, width / 2, height / 2 + 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    return { sprite, aspect: width / height };
}

// Auto-width glass pill + downward tail; clay tint when selected. Returns
// { sprite, aspect } so the caller scales without squishing long names.
function makeWaypointLabelSprite(text, { fontSize = 56, selected = false } = {}, isDark = false) {
    const pal = markerPalette(isDark);
    const font = `${selected ? 700 : 600} ${fontSize}px "Hanken Grotesk", "Pretendard Variable", sans-serif`;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = font;
    const textW = Math.ceil(measure.measureText(String(text)).width);
    const pad = Math.round(fontSize * 0.7);
    const pillH = Math.round(fontSize * 1.9);
    const tailH = Math.round(fontSize * 0.38);
    const width = Math.max(textW + pad * 2, pillH);
    const height = pillH + tailH;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        const bg = selected ? pal.labelSelBg : pal.labelBg;
        const border = selected ? pal.labelSelBorder : pal.labelBorder;
        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
        ctx.roundRect(3, 3, width - 6, pillH - 6, pillH / 2);
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = border;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(width / 2 - tailH, pillH - 4);
        ctx.lineTo(width / 2, pillH + tailH - 4);
        ctx.lineTo(width / 2 + tailH, pillH - 4);
        ctx.closePath();
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = border;
        ctx.stroke();
        ctx.fillStyle = bg;
        ctx.fillRect(width / 2 - tailH + 2, pillH - 7, tailH * 2 - 4, 6);
        ctx.fillStyle = selected ? pal.labelSelText : pal.labelText;
        ctx.font = font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(text), width / 2, pillH / 2 + 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    return { sprite, aspect: width / height };
}
function waypointHeadingShape(shaftWidth, headWidth, headLength) {
    const start = WAYPOINT_CENTER_RADIUS * 0.32;
    const tip = WAYPOINT_HEADING_LENGTH;
    const headBase = Math.max(start, tip - headLength);
    const shaftHalf = shaftWidth / 2;
    const headHalf = headWidth / 2;
    const shape = new THREE.Shape();
    shape.moveTo(start, -shaftHalf);
    shape.lineTo(headBase, -shaftHalf);
    shape.lineTo(headBase, -headHalf);
    shape.lineTo(tip, 0);
    shape.lineTo(headBase, headHalf);
    shape.lineTo(headBase, shaftHalf);
    shape.lineTo(start, shaftHalf);
    shape.closePath();
    return shape;
}
function makeWaypointHeadingArrow() {
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(waypointHeadingShape(WAYPOINT_HEADING_SHAFT_WIDTH, WAYPOINT_HEADING_HEAD_WIDTH, WAYPOINT_HEADING_HEAD_LENGTH)), new THREE.MeshBasicMaterial({
        color: 0x111827,
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide,
    }));
    arrow.position.z = 0.04;
    return arrow;
}
function makePoseMarker(pose, color, z, isDark = false) {
    var _a, _b, _c, _d;
    const group = new THREE.Group();
    const x = Number((_b = (_a = pose.position) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 0);
    const y = Number((_d = (_c = pose.position) === null || _c === void 0 ? void 0 : _c.y) !== null && _d !== void 0 ? _d : 0);
    const yaw = yawFromPose(pose);
    group.position.set(x, y, z);
    group.rotation.z = yaw;
    const body = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.86 }));
    group.add(body);
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0.26, 0);
    arrowShape.lineTo(-0.1, 0.13);
    arrowShape.lineTo(-0.04, 0);
    arrowShape.lineTo(-0.1, -0.13);
    arrowShape.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: markerPalette(isDark).poseArrow }));
    arrow.position.z = 0.01;
    group.add(arrow);
    return group;
}
function makeSpotMarker(spot, selected = false, scale = 1, isDark = false) {
    var _a, _b, _c, _d;
    const pose = spot === null || spot === void 0 ? void 0 : spot.pose;
    if (!pose)
        return null;
    const x = Number((_a = pose.x) !== null && _a !== void 0 ? _a : 0);
    const y = Number((_b = pose.y) !== null && _b !== void 0 ? _b : 0);
    const yaw = Number((_c = pose.yaw) !== null && _c !== void 0 ? _c : 0);
    const pal = markerPalette(isDark);
    const color = selected ? pal.selected : pal.idle;
    const group = new THREE.Group();
    group.position.set(x, y, 0.24);
    group.scale.setScalar(scale);
    group.userData = { spotId: spot.id, dragAction: "move" };
    const marker = new THREE.Group();
    marker.rotation.z = yaw;
    marker.userData = { spotId: spot.id, dragAction: "move" };
    if (selected) {
        const halo = new THREE.Mesh(new THREE.RingGeometry(WAYPOINT_SELECTED_HALO_INNER_RADIUS, WAYPOINT_SELECTED_HALO_OUTER_RADIUS, 40), new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.34,
            side: THREE.DoubleSide,
        }));
        halo.userData = { spotId: spot.id, dragAction: "move" };
        marker.add(halo);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(WAYPOINT_RING_INNER_RADIUS, WAYPOINT_RING_OUTER_RADIUS, 40), new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
    }));
    ring.userData = { spotId: spot.id, dragAction: "move" };
    marker.add(ring);
    const center = new THREE.Mesh(new THREE.CircleGeometry(WAYPOINT_CENTER_RADIUS, 32), new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: selected ? 0.95 : 0.78,
    }));
    center.position.z = 0.01;
    center.userData = { spotId: spot.id, dragAction: "move" };
    marker.add(center);
    const heading = makeWaypointHeadingArrow();
    heading.traverse((child) => {
        child.userData = { spotId: spot.id, dragAction: "rotate" };
    });
    marker.add(heading);
    group.add(marker);
    const label = String((_d = spot.label) !== null && _d !== void 0 ? _d : spot.id);
    if (label) {
        const { sprite, aspect } = makeWaypointLabelSprite(label, { selected }, isDark);
        sprite.position.set(0, WAYPOINT_LABEL_OFFSET_Y, 0.04);
        sprite.scale.set(WAYPOINT_LABEL_SCALE_Y * aspect, WAYPOINT_LABEL_SCALE_Y, 1); // auto width, no squish
        sprite.userData = { spotId: spot.id, dragAction: "move" };
        group.add(sprite);
    }
    return group;
}
function makeRouteBadgeSprite(text, selected = false, isDark = false) {
    const pal = markerPalette(isDark);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.arc(64, 64, 52, 0, Math.PI * 2);
        ctx.fillStyle = selected
            ? `#${pal.selected.toString(16).padStart(6, "0")}`
            : `#${pal.idle.toString(16).padStart(6, "0")}`;
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = pal.badgeStroke;
        ctx.stroke();
        ctx.fillStyle = selected ? pal.badgeTextSelected : pal.badgeTextIdle;
        ctx.font = '700 56px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(text), 64, 68);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
}
function makeMissionRouteBadge(spot, order, selected = false, scale = 1, isDark = false) {
    var _a, _b;
    const pose = spot === null || spot === void 0 ? void 0 : spot.pose;
    if (!pose)
        return null;
    const x = Number((_a = pose.x) !== null && _a !== void 0 ? _a : 0);
    const y = Number((_b = pose.y) !== null && _b !== void 0 ? _b : 0);
    const sprite = makeRouteBadgeSprite(order, selected, isDark);
    const size = Math.max(0.34, WAYPOINT_RING_OUTER_RADIUS * scale * 2.2);
    const offset = WAYPOINT_RING_OUTER_RADIUS * scale * 2.25;
    sprite.position.set(x - offset, y, 0.62);
    sprite.scale.set(size, size, 1);
    sprite.userData = { spotId: spot.id, dragAction: "move" };
    return sprite;
}
// Rasterizing an annotation region is the most expensive part of a layers
// rebuild (supersampled full-map canvas + blur), so cache textures per
// annotation object. The editor keeps unchanged annotations reference-identical
// across edits, so only the annotation actually being brushed re-rasterizes.
const annotationTextureCache = new WeakMap();
function cachedAnnotationRegionTexture(annotation, grid, region, colorString, isDark, selected) {
    const hit = annotationTextureCache.get(annotation);
    if (hit && hit.grid === grid && hit.isDark === isDark && hit.selected === selected) {
        return hit.texture;
    }
    const texture = makeAnnotationRegionTexture(grid, region, colorString, selected ? 210 : 164);
    if (texture) {
        texture.userData.retain = true;
        if ((hit === null || hit === void 0 ? void 0 : hit.texture) && hit.texture !== texture)
            hit.texture.dispose();
        annotationTextureCache.set(annotation, { grid, isDark, selected, texture });
    }
    return texture;
}
function makeMapAnnotationRegion(annotation, grid, isDark = false, coveredCells = null, selected = false) {
    var _a, _b, _c, _d, _e, _f;
    const meta = gridMeta(grid);
    if (!meta)
        return null;
    const pose = (_a = annotation === null || annotation === void 0 ? void 0 : annotation.pose) !== null && _a !== void 0 ? _a : {};
    const fallbackCell = mapPointToGridCell(meta, Number((_b = pose.x) !== null && _b !== void 0 ? _b : NaN), Number((_c = pose.y) !== null && _c !== void 0 ? _c : NaN));
    const regionSpec = (_d = annotation === null || annotation === void 0 ? void 0 : annotation.region) !== null && _d !== void 0 ? _d : (fallbackCell ? { seed_cell: fallbackCell } : null);
    const region = boundedFreeRegion(grid, regionSpec, coveredCells);
    if (!region)
        return null;
    const colorString = hexColorString(annotation === null || annotation === void 0 ? void 0 : annotation.color, isDark ? "#6D1F2A" : "#6D1F2A");
    const texture = cachedAnnotationRegionTexture(annotation, grid, region, colorString, isDark, selected);
    const plane = makeGridTexturePlane(grid, texture, 0.065);
    if (!plane)
        return null;
    const group = new THREE.Group();
    group.add(plane);
    if (coveredCells) {
        region.cells.forEach((index) => coveredCells.add(index));
    }
    const label = String((annotation === null || annotation === void 0 ? void 0 : annotation.label) || "Area").trim();
    if (label) {
        const { sprite, aspect } = makeAnnotationLabelSprite(label, colorString, isDark);
        const center = gridCellToMapPoint(meta, region.centroid.x, region.centroid.y);
        const labelHeight = Math.max(0.24, Math.min(0.72, meta.resolution * 11));
        sprite.position.set(center.x, center.y, 0.78);
        sprite.scale.set(labelHeight * aspect, labelHeight, 1);
        group.add(sprite);
    }
    return group;
}
function behaviorNodeColor(category, selected = false, isDark = false) {
    const pal = markerPalette(isDark);
    if (selected)
        return pal.selected;
    switch (category) {
        case "control":
            return pal.control;
        case "decorator":
            return pal.decorator;
        case "action":
        default:
            return pal.action;
    }
}
function makeBehaviorNodeMarker(node, selected = false, isDark = false) {
    var _a, _b, _c, _d, _e;
    const pose = node === null || node === void 0 ? void 0 : node.pose;
    if (!pose)
        return null;
    const x = Number((_a = pose.x) !== null && _a !== void 0 ? _a : 0);
    const y = Number((_b = pose.y) !== null && _b !== void 0 ? _b : 0);
    const yaw = Number((_c = pose.yaw) !== null && _c !== void 0 ? _c : 0);
    const color = behaviorNodeColor(node.category, selected, isDark);
    const group = new THREE.Group();
    group.position.set(x, y, 0.28);
    group.rotation.z = yaw;
    group.userData.behaviorNodeId = node.id;
    const body = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.28), new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: selected ? 0.95 : 0.82,
        side: THREE.DoubleSide,
    }));
    body.userData.behaviorNodeId = node.id;
    group.add(body);
    const outline = makeLine([
        new THREE.Vector3(-0.26, -0.16, 0.02),
        new THREE.Vector3(0.26, -0.16, 0.02),
        new THREE.Vector3(0.26, 0.16, 0.02),
        new THREE.Vector3(-0.26, 0.16, 0.02),
        new THREE.Vector3(-0.26, -0.16, 0.02),
    ], isDark ? 0x1b1916 : 0xf3f1ea, 2);
    if (outline) {
        outline.userData.behaviorNodeId = node.id;
        group.add(outline);
    }
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), new THREE.MeshBasicMaterial({
        color: isDark ? 0x1b1916 : 0xffffff,
        transparent: true,
        opacity: 0.92,
    }));
    port.position.set(-0.16, 0, 0.03);
    port.userData.behaviorNodeId = node.id;
    group.add(port);
    const label = String((_e = (_d = node.label) !== null && _d !== void 0 ? _d : node.tag) !== null && _e !== void 0 ? _e : node.id);
    if (label) {
        const sprite = makeTfLabelSprite(label, isDark);
        sprite.position.set(0, 0.38, 0.06);
        sprite.scale.set(0.56, 0.14, 1);
        sprite.userData.behaviorNodeId = node.id;
        group.add(sprite);
    }
    return group;
}
function makeTfAxes(pose, label, isDark = false) {
    var _a, _b, _c, _d, _e, _f;
    const group = new THREE.Group();
    group.position.set(Number((_b = (_a = pose.position) === null || _a === void 0 ? void 0 : _a.x) !== null && _b !== void 0 ? _b : 0), Number((_d = (_c = pose.position) === null || _c === void 0 ? void 0 : _c.y) !== null && _d !== void 0 ? _d : 0), Number((_f = (_e = pose.position) === null || _e === void 0 ? void 0 : _e.z) !== null && _f !== void 0 ? _f : 0) + 0.08);
    group.rotation.z = yawFromPose(pose);
    const xAxis = makeLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(TF_AXIS_LENGTH, 0, 0)], 0xef4444);
    const yAxis = makeLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, TF_AXIS_LENGTH, 0)], 0x22c55e);
    const zAxis = makeLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, TF_AXIS_LENGTH)], 0x3b82f6);
    if (xAxis)
        group.add(xAxis);
    if (yAxis)
        group.add(yAxis);
    if (zAxis)
        group.add(zAxis);
    const sprite = makeTfLabelSprite(label, isDark);
    sprite.position.set(0, -TF_AXIS_LENGTH * 0.85, 0.012);
    group.add(sprite);
    return group;
}
function makeFootprintMarker(footprint, framePose) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const sourcePoints = (_b = (_a = footprint.polygon) === null || _a === void 0 ? void 0 : _a.points) !== null && _b !== void 0 ? _b : [];
    const polygonPoints = sourcePoints
        .map((point) => {
        var _a, _b, _c;
        return ({
            x: Number((_a = point.x) !== null && _a !== void 0 ? _a : 0),
            y: Number((_b = point.y) !== null && _b !== void 0 ? _b : 0),
            z: Number((_c = point.z) !== null && _c !== void 0 ? _c : 0),
        });
    })
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    if (polygonPoints.length < 3)
        return null;
    const group = new THREE.Group();
    const yaw = framePose ? yawFromPose(framePose) : 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const frameX = Number((_d = (_c = framePose === null || framePose === void 0 ? void 0 : framePose.position) === null || _c === void 0 ? void 0 : _c.x) !== null && _d !== void 0 ? _d : 0);
    const frameY = Number((_f = (_e = framePose === null || framePose === void 0 ? void 0 : framePose.position) === null || _e === void 0 ? void 0 : _e.y) !== null && _f !== void 0 ? _f : 0);
    const frameZ = Number((_h = (_g = framePose === null || framePose === void 0 ? void 0 : framePose.position) === null || _g === void 0 ? void 0 : _g.z) !== null && _h !== void 0 ? _h : 0);
    const transformPoint = (point) => (new THREE.Vector3(frameX + cos * point.x - sin * point.y, frameY + sin * point.x + cos * point.y, frameZ + point.z + 0.18));
    const points = polygonPoints.map(transformPoint);
    points.push(points[0].clone());
    const line = makeLine(points, 0x38bdf8, 3);
    if (line)
        group.add(line);
    const shape = new THREE.Shape();
    polygonPoints.forEach((point, index) => {
        if (index === 0)
            shape.moveTo(point.x, point.y);
        else
            shape.lineTo(point.x, point.y);
    });
    shape.closePath();
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
    }));
    fill.position.set(frameX, frameY, frameZ + 0.17);
    fill.rotation.z = yaw;
    group.add(fill);
    return group;
}
function makeTfLabelSprite(text, isDark = false) {
    const sprite = makeTextSprite(text, undefined, isDark);
    sprite.scale.set(TF_AXIS_LENGTH * 1.8, TF_AXIS_LENGTH * 0.45, 1);
    return sprite;
}
function fitCameraToMap(camera, controls, meta, roll = 0) {
    if (!meta)
        return;
    const width = meta.width * meta.resolution;
    const height = meta.height * meta.resolution;
    const center = new THREE.Vector3(meta.originX + width / 2, meta.originY + height / 2, 0);
    const maxDim = Math.max(width, height, 1);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distanceForHeight = height / (2 * Math.tan(halfFov));
    const distanceForWidth = width / (2 * Math.tan(halfFov) * Math.max(camera.aspect, 0.1));
    const distance = Math.max(distanceForHeight, distanceForWidth, maxDim) * 1.12;
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.position.set(center.x, center.y, distance);
    camera.lookAt(center);
    camera.near = CAMERA_NEAR;
    camera.far = Math.max(CAMERA_FAR, maxDim * 10);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
}
function applyTopViewRoll(camera, controls, roll) {
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.lookAt(controls.target);
    controls.update();
}
function focusCameraToWaypoint(camera, controls, meta, spot, roll = 0) {
    var _a, _b;
    if (!meta || !(spot === null || spot === void 0 ? void 0 : spot.pose))
        return;
    const width = meta.width * meta.resolution;
    const height = meta.height * meta.resolution;
    const maxDim = Math.max(width, height, 1);
    const visibleHeight = Math.max(BT_FOCUS_VISIBLE_HEIGHT_MIN, Math.min(maxDim * 0.68, BT_FOCUS_VISIBLE_HEIGHT_MAX));
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distance = visibleHeight / (2 * Math.tan(halfFov));
    const halfWidth = distance * Math.tan(halfFov) * Math.max(camera.aspect, 0.1);
    const x = Number((_a = spot.pose.x) !== null && _a !== void 0 ? _a : 0);
    const y = Number((_b = spot.pose.y) !== null && _b !== void 0 ? _b : 0);
    const screenRight = new THREE.Vector3(Math.cos(roll), -Math.sin(roll), 0);
    const target = new THREE.Vector3(x, y, 0).addScaledVector(screenRight, -BT_FOCUS_WAYPOINT_NDC_X * halfWidth);
    camera.up.set(Math.sin(roll), Math.cos(roll), 0);
    camera.position.set(target.x, target.y, Math.max(distance, CAMERA_NEAR * 10));
    camera.lookAt(target);
    camera.near = CAMERA_NEAR;
    camera.far = Math.max(CAMERA_FAR, maxDim * 10);
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    controls.update();
}
function BtCanvasNode({ className = "", children, tone = "default" }) {
    const styles = {
        default: { color: "var(--mc-text)", backgroundColor: "var(--mc-surface)", borderColor: "var(--mc-text)" },
        active: { color: "var(--mc-accent-fg)", backgroundColor: "var(--mc-accent)", borderColor: "var(--mc-accent)" },
        muted: { color: "var(--mc-text-muted)", backgroundColor: "var(--mc-surface-2)", borderColor: "var(--mc-success)" },
    };
    return (<div className={`absolute min-w-[112px] h-10 px-3 border rounded-md flex items-center justify-center text-xs font-semibold shadow-sm ${className}`} style={styles[tone] || styles.default}>
      {children}
    </div>);
}
function WaypointBtFocusLayer({ layer, onClose }) {
    const spot = layer === null || layer === void 0 ? void 0 : layer.spot;
    if (!spot)
        return null;
    return (<section className="absolute inset-0 z-20 pointer-events-none" role="region" aria-label="Waypoint BT focus canvas">
      <div className="absolute inset-y-0 left-0 w-[25%] pointer-events-none" style={{
            background: "linear-gradient(90deg, rgba(28,26,23,0.08), rgba(28,26,23,0))",
        }}/>
      <div className="absolute inset-y-0 right-0 w-[75%] pointer-events-auto overflow-hidden" style={{
            color: "var(--mc-text)",
            backgroundColor: "var(--mc-surface)",
            borderLeft: "1px solid var(--mc-border-strong)",
        }}>
        <div className="h-full min-h-0 p-4">
          <div className="relative min-h-0 overflow-hidden rounded-md border" style={{
            borderColor: "var(--mc-border)",
            height: "100%",
        }}>
            {layer.editor ? layer.editor : (<>
            <div className="absolute inset-0 opacity-80" style={{
            backgroundImage: "linear-gradient(rgba(28,26,23,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(28,26,23,0.13) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
        }}/>
            <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
              <line x1="20%" y1="49%" x2="42%" y2="49%" stroke="var(--mc-accent)" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="56%" y1="38%" x2="76%" y2="28%" stroke="var(--mc-accent)" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="56%" y1="60%" x2="76%" y2="72%" stroke="var(--mc-accent)" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            <BtCanvasNode className="left-[8%] top-[43%]" tone={spot.linked_bt_tree ? "active" : "muted"}>
              {spot.linked_bt_tree ? "Tree" : "New BT"}
            </BtCanvasNode>
            <BtCanvasNode className="left-[38%] top-[43%]">
              Sequence
            </BtCanvasNode>
            <BtCanvasNode className="left-[68%] top-[22%]" tone="active">
              Navigate
            </BtCanvasNode>
            <BtCanvasNode className="left-[68%] top-[66%]" tone="default">
              Task
            </BtCanvasNode>
            </>)}
          </div>
        </div>
      </div>
    </section>);
}
// Scene background per theme (warm-minimal). Light uses warm paper; dark uses a
// warm near-black so the occupancy palette (free ~245, occupied ~28) still reads
// as a clean floor-plan without retuning makeOccupancyTexture.
const SCENE_BG = { light: 0xefece3, dark: 0x1b1916 };

export function MapViewer({ map, globalCostmap, localCostmap, scan, pose, plan, goalPose, footprint, tf, showMap, showGlobalCostmap, showLocalCostmap, showScan, showGlobalPlan, showGoalPose, showTf, showRobotModel, interactionDisabled, interactionMode, editorActive, editorPaintOnDrag = true, editorAreaSelection = false, editorBrush = null, viewKey, isDark = false, waitingLabel = "Waiting for /map", fitContainer = false, spots = [], selectedSpotId = "", behaviorNodes = [], selectedBehaviorNodeId = "", behaviorPreviewNode = null, missionRouteOrder = [], missionRouteMode = false, selectedMissionRouteSourceId = "", mapAnnotations = [], selectedMapAnnotationId = "", btLayer = null, onBtLayerClose, onSpotClick, onBehaviorNodeClick, onMissionRouteSpotClick, onMissionRouteMapClick, onSpotPoseChange, onBehaviorNodePoseChange, onEditorMapPoint, onEditorMapArea, onMapClick, onMapPose, }) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const rendererRef = useRef(null);
    const cameraRef = useRef(null);
    const controlsRef = useRef(null);
    const layersRef = useRef(null);
    const mapLayerRef = useRef(null);
    const animationFrameRef = useRef(null);
    const fitMapKeyRef = useRef(null);
    const viewRollRef = useRef(0);
    const viewRotateDragRef = useRef(null);
    const btFocusActiveRef = useRef(false);
    const latestFootprintRef = useRef(null);
    const tfSyncedFootprintRef = useRef(null);
    const [dragPreviewPose, setDragPreviewPose] = useState(null);
    const [nodeDragPreview, setNodeDragPreview] = useState(null);
    const [editorAreaPreview, setEditorAreaPreview] = useState(null);
    const [mapDragActive, setMapDragActive] = useState(false);
    const [viewerError, setViewerError] = useState(null);
    // Freeze each LaserScan in display coordinates until the next scan or map geometry change.
    const scanProjectionRef = useRef(null);
    const raycasterRef = useRef(new THREE.Raycaster());
    const pointerRef = useRef(new THREE.Vector2());
    const pointerDownRef = useRef(null);
    const editorPaintPointerRef = useRef(null);
    const editorMovePendingRef = useRef(null);
    const editorMoveRafRef = useRef(null);
    const editorAreaDragRef = useRef(null);
    const editorBrushLayerRef = useRef(null);
    const nodeDragRef = useRef(null);
    useEffect(() => {
        const containerEl = containerRef.current;
        if (!containerEl || rendererRef.current)
            return;
        let scene = null;
        let camera = null;
        let renderer = null;
        let mapLayer = null;
        let layers = null;
        let controls = null;
        let resizeObserver = null;
        let resize = null;
        try {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(isDark ? SCENE_BG.dark : SCENE_BG.light);
            sceneRef.current = scene;
            camera = new THREE.PerspectiveCamera(48, 1, CAMERA_NEAR, CAMERA_FAR);
            camera.up.set(0, 1, 0);
            camera.position.set(0, 0, 10);
            cameraRef.current = camera;
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setPixelRatio(window.devicePixelRatio || 1);
            renderer.setClearColor(isDark ? SCENE_BG.dark : SCENE_BG.light, 1);
            renderer.domElement.className = "block w-full h-full cursor-grab";
            containerEl.appendChild(renderer.domElement);
            rendererRef.current = renderer;
            mapLayer = new THREE.Group();
            scene.add(mapLayer);
            mapLayerRef.current = mapLayer;
            layers = new THREE.Group();
            scene.add(layers);
            layersRef.current = layers;
            // Dedicated group for the pointer-following editor brush ring — kept
            // outside `layers` so hover tracking never rebuilds the heavy layers.
            const brushLayer = new THREE.Group();
            scene.add(brushLayer);
            editorBrushLayerRef.current = brushLayer;
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            controls.enableRotate = false;
            controls.mouseButtons = {
                LEFT: THREE.MOUSE.PAN,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN,
            };
            controls.screenSpacePanning = true;
            controlsRef.current = controls;
            resize = () => {
                const width = containerEl.clientWidth || 1;
                const height = containerEl.clientHeight || 1;
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
            };
            resize();
            if (typeof ResizeObserver !== "undefined") {
                resizeObserver = new ResizeObserver(resize);
                resizeObserver.observe(containerEl);
            }
            else {
                window.addEventListener("resize", resize);
            }
            const animate = () => {
                animationFrameRef.current = requestAnimationFrame(animate);
                controls.update();
                renderer.render(scene, camera);
            };
            animate();
            setViewerError(null);
        }
        catch (error) {
            console.error("Navigation map viewer failed to initialize:", error);
            setViewerError(error instanceof Error ? error.message : "Map viewer failed to initialize");
            controls === null || controls === void 0 ? void 0 : controls.dispose();
            if (mapLayer)
                disposeObject(mapLayer);
            if (layers)
                disposeObject(layers);
            renderer === null || renderer === void 0 ? void 0 : renderer.dispose();
            if ((renderer === null || renderer === void 0 ? void 0 : renderer.domElement.parentNode) === containerEl) {
                containerEl.removeChild(renderer.domElement);
            }
            sceneRef.current = null;
            rendererRef.current = null;
            cameraRef.current = null;
            controlsRef.current = null;
            mapLayerRef.current = null;
            layersRef.current = null;
            editorBrushLayerRef.current = null;
            return undefined;
        }
        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            else if (resize) {
                window.removeEventListener("resize", resize);
            }
            if (animationFrameRef.current != null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            controls === null || controls === void 0 ? void 0 : controls.dispose();
            if (mapLayer)
                disposeObject(mapLayer);
            if (layers)
                disposeObject(layers);
            if (editorBrushLayerRef.current)
                disposeObject(editorBrushLayerRef.current);
            renderer === null || renderer === void 0 ? void 0 : renderer.dispose();
            if ((renderer === null || renderer === void 0 ? void 0 : renderer.domElement.parentNode) === containerEl) {
                containerEl.removeChild(renderer.domElement);
            }
            sceneRef.current = null;
            rendererRef.current = null;
            cameraRef.current = null;
            controlsRef.current = null;
            mapLayerRef.current = null;
            layersRef.current = null;
            editorBrushLayerRef.current = null;
        };
    }, []);
    useEffect(() => {
        const scene = sceneRef.current;
        const renderer = rendererRef.current;
        if (!scene || !renderer)
            return;
        const bg = isDark ? SCENE_BG.dark : SCENE_BG.light;
        if (scene.background instanceof THREE.Color) {
            scene.background.set(bg);
        }
        else {
            scene.background = new THREE.Color(bg);
        }
        renderer.setClearColor(bg, 1);
    }, [isDark]);
    // Editor brush ring — geometry rebuilt only when the brush spec changes.
    useEffect(() => {
        const brushLayer = editorBrushLayerRef.current;
        if (!brushLayer)
            return;
        disposeObject(brushLayer);
        brushLayer.clear();
        const meta = gridMeta(map);
        if (!editorBrush || !meta)
            return;
        const radius = (Math.max(1, Number(editorBrush.sizeCells) || 1) * meta.resolution) / 2;
        const color = new THREE.Color(editorBrush.color || "#5B8266");
        const group = new THREE.Group();
        // Ink/cream contrast underlay so a paper-colored ring stays visible on the map.
        const underlay = new THREE.Mesh(new THREE.RingGeometry(radius * 0.78, radius * 1.08, 40), new THREE.MeshBasicMaterial({
            color: isDark ? 0xf3f1ea : 0x1c1a17,
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
            side: THREE.DoubleSide,
        }));
        group.add(underlay);
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.84, radius, 40), new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            side: THREE.DoubleSide,
        }));
        group.add(ring);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.84, 40), new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.12,
            depthWrite: false,
        }));
        group.add(fill);
        group.position.set(0, 0, 0.9);
        group.visible = false;
        brushLayer.add(group);
    }, [editorBrush, map, isDark]);
    // Follow the pointer via ref mutation — zero React renders per move.
    useEffect(() => {
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        if (!renderer || !camera || !editorBrush)
            return undefined;
        const meta = gridMeta(map);
        if (!meta)
            return undefined;
        const brushGroup = () => {
            var _a;
            return ((_a = editorBrushLayerRef.current) === null || _a === void 0 ? void 0 : _a.children[0]) || null;
        };
        const handleMove = (event) => {
            const group = brushGroup();
            if (!group)
                return;
            const rect = renderer.domElement.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
                return;
            pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointerRef.current.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
            raycasterRef.current.setFromCamera(pointerRef.current, camera);
            const point = new THREE.Vector3();
            const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            if (!raycasterRef.current.ray.intersectPlane(plane, point)) {
                group.visible = false;
                return;
            }
            const width = meta.width * meta.resolution;
            const height = meta.height * meta.resolution;
            const inside = point.x >= meta.originX &&
                point.x <= meta.originX + width &&
                point.y >= meta.originY &&
                point.y <= meta.originY + height;
            group.visible = inside;
            if (inside)
                group.position.set(point.x, point.y, 0.9);
        };
        const handleLeave = () => {
            const group = brushGroup();
            if (group)
                group.visible = false;
        };
        renderer.domElement.addEventListener("pointermove", handleMove);
        renderer.domElement.addEventListener("pointerleave", handleLeave);
        return () => {
            renderer.domElement.removeEventListener("pointermove", handleMove);
            renderer.domElement.removeEventListener("pointerleave", handleLeave);
            handleLeave();
        };
    }, [editorBrush, map]);
    useEffect(() => {
        const renderer = rendererRef.current;
        const controls = controlsRef.current;
        if (!renderer)
            return;
        const cursor = interactionDisabled
            ? "cursor-wait"
            : editorActive
                ? (editorAreaSelection ? "cursor-crosshair" : "cursor-cell")
                : interactionMode === "view"
                    ? mapDragActive ? "cursor-grabbing" : "cursor-grab"
                    : "cursor-crosshair";
        renderer.domElement.className = `block w-full h-full ${cursor}`;
        if (controls) {
            controls.enabled = !interactionDisabled && !editorActive && interactionMode === "view";
        }
    }, [editorActive, editorAreaSelection, interactionDisabled, interactionMode, mapDragActive]);
    useEffect(() => {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const meta = gridMeta(map);
        if (!camera || !controls || !meta)
            return;
        const spot = btLayer === null || btLayer === void 0 ? void 0 : btLayer.spot;
        if (spot === null || spot === void 0 ? void 0 : spot.pose) {
            focusCameraToWaypoint(camera, controls, meta, spot, viewRollRef.current);
            btFocusActiveRef.current = true;
            return;
        }
        if (btFocusActiveRef.current) {
            btFocusActiveRef.current = false;
        }
    }, [
        btLayer?.spot?.id,
        btLayer?.spot?.pose,
        btLayer?.spot?.linked_bt_tree,
        map,
        viewKey,
    ]);
    useEffect(() => {
        latestFootprintRef.current = footprint;
    }, [footprint]);
    useEffect(() => {
        tfSyncedFootprintRef.current = latestFootprintRef.current;
    }, [tf]);
    // The map is a static layer. Keep its texture alive while TF, pose, scan,
    // plans, and robot markers update in the dynamic layer below.
    useEffect(() => {
        const mapLayer = mapLayerRef.current;
        if (!mapLayer)
            return;
        disposeObject(mapLayer);
        mapLayer.clear();
        if (!showMap || !map)
            return;
        const mapPlane = makeGridPlane(map, "map", 0, null, null, isDark);
        if (mapPlane)
            mapLayer.add(mapPlane);
    }, [map, showMap, isDark]);
    useEffect(() => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4;
        const scene = sceneRef.current;
        const layers = layersRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!scene || !layers || !camera || !controls)
            return;
        disposeObject(layers);
        layers.clear();
        const meta = gridMeta(map);
        const mapKey = meta ? `${meta.width}:${meta.height}:${meta.resolution}:${meta.originX}:${meta.originY}` : null;
        const waypointScale = meta?.resolution && meta.resolution > 0 ? meta.resolution : 1;
        const tfSyncedFootprint = tfSyncedFootprintRef.current;
        const tfFramePoses = buildTfFramePoses(tf, "map");
        const tfFramePoseByName = new Map(tfFramePoses.map(({ frame, pose: framePose }) => [frame, framePose]));
        if (showGlobalCostmap) {
            if (globalCostmap) {
                const plane = makeGridPlane(globalCostmap, "globalCostmap", 0.03, null, null, isDark);
                if (plane)
                    layers.add(plane);
            }
        }
        if (showLocalCostmap) {
            if (localCostmap) {
                const localFrame = normalizeFrameId((_a = localCostmap.header) === null || _a === void 0 ? void 0 : _a.frame_id);
                const localFramePose = localFrame && localFrame !== "map"
                    ? (_b = tfFramePoseByName.get(localFrame)) !== null && _b !== void 0 ? _b : null
                    : null;
                const scanFrame = normalizeFrameId((_c = scan === null || scan === void 0 ? void 0 : scan.header) === null || _c === void 0 ? void 0 : _c.frame_id) || "base_link";
                const scanPose = (_d = tfFramePoseByName.get(scanFrame)) !== null && _d !== void 0 ? _d : pose;
                const scanCells = scanCellsForGrid(localCostmap, scan, scanPose, localFramePose);
                const plane = makeGridPlane(localCostmap, "localCostmap", 0.1, localFramePose, scanCells, isDark);
                if (plane)
                    layers.add(plane);
            }
        }
        if (showGlobalPlan && ((_e = plan === null || plan === void 0 ? void 0 : plan.poses) === null || _e === void 0 ? void 0 : _e.length)) {
            const points = plan.poses
                .map((p) => { var _a; return (_a = p.pose) === null || _a === void 0 ? void 0 : _a.position; })
                .filter((p) => !!p)
                .map((p) => { var _a, _b; return new THREE.Vector3(Number((_a = p.x) !== null && _a !== void 0 ? _a : 0), Number((_b = p.y) !== null && _b !== void 0 ? _b : 0), 0.09); });
            const planLine = makeLine(points, 0x0e7fd1, 3);
            if (planLine)
                layers.add(planLine);
        }
        if (showGoalPose && ((_f = goalPose === null || goalPose === void 0 ? void 0 : goalPose.pose) === null || _f === void 0 ? void 0 : _f.position)) {
            layers.add(makePoseMarker(goalPose.pose, isDark ? 0xd5794f : 0xc96442, 0.14, isDark));
        }
        if (dragPreviewPose === null || dragPreviewPose === void 0 ? void 0 : dragPreviewPose.position) {
            const previewX = Number((_g = dragPreviewPose.position.x) !== null && _g !== void 0 ? _g : 0);
            const previewY = Number((_h = dragPreviewPose.position.y) !== null && _h !== void 0 ? _h : 0);
            const previewYaw = yawFromPose(dragPreviewPose);
            if (interactionMode === "spot") {
                layers.add(makeSpotMarker({
                    id: "__waypoint_preview__",
                    label: "Waypoint",
                    pose: { x: previewX, y: previewY, yaw: previewYaw },
                }, true, waypointScale, isDark));
            }
            else if (interactionMode === "behavior" && behaviorPreviewNode) {
                layers.add(makeBehaviorNodeMarker({
                    id: "__behavior_preview__",
                    tag: behaviorPreviewNode.tag,
                    label: behaviorPreviewNode.label || behaviorPreviewNode.tag,
                    category: behaviorPreviewNode.category || "action",
                    pose: { x: previewX, y: previewY, yaw: previewYaw },
                }, true, isDark));
            }
            else {
                layers.add(makePoseMarker(dragPreviewPose, interactionMode === "initial" ? (isDark ? 0x6f9a74 : 0x5b8266) : (isDark ? 0xd5794f : 0xc96442), 0.2, isDark));
            }
        }
        if (editorAreaPreview) {
            const preview = makeEditorAreaPreview(editorAreaPreview, isDark);
            if (preview)
                layers.add(preview);
        }
        const spotById = new Map(spots.map((spot) => [spot.id, spot]));
        const coveredAnnotationCells = new Set();
        mapAnnotations.forEach((annotation) => {
            const marker = makeMapAnnotationRegion(annotation, map, isDark, coveredAnnotationCells, annotation.id === selectedMapAnnotationId);
            if (marker)
                layers.add(marker);
        });
        spots.forEach((spot) => {
            const preview = (nodeDragPreview === null || nodeDragPreview === void 0 ? void 0 : nodeDragPreview.type) === "spot" && nodeDragPreview.id === spot.id
                ? nodeDragPreview
                : null;
            const marker = makeSpotMarker(preview
                ? {
                    ...spot,
                    pose: {
                        ...spot.pose,
                        x: preview.x,
                        y: preview.y,
                        yaw: preview.yaw,
                    },
                }
                : spot, spot.id === selectedSpotId, waypointScale, isDark);
            if (marker)
                layers.add(marker);
        });
        missionRouteOrder.forEach(({ id, order }) => {
            const spot = spotById.get(id);
            const badge = makeMissionRouteBadge(spot, order, id === selectedMissionRouteSourceId, waypointScale, isDark);
            if (badge)
                layers.add(badge);
        });
        behaviorNodes.forEach((node) => {
            const preview = (nodeDragPreview === null || nodeDragPreview === void 0 ? void 0 : nodeDragPreview.type) === "behaviorNode" && nodeDragPreview.id === node.id
                ? nodeDragPreview
                : null;
            const marker = makeBehaviorNodeMarker(preview
                ? {
                    ...node,
                    pose: {
                        ...node.pose,
                        x: preview.x,
                        y: preview.y,
                        yaw: preview.yaw,
                    },
                }
                : node, node.id === selectedBehaviorNodeId, isDark);
            if (marker)
                layers.add(marker);
        });
        const robotX = Number((_k = (_j = pose === null || pose === void 0 ? void 0 : pose.position) === null || _j === void 0 ? void 0 : _j.x) !== null && _k !== void 0 ? _k : 0);
        const robotY = Number((_m = (_l = pose === null || pose === void 0 ? void 0 : pose.position) === null || _l === void 0 ? void 0 : _l.y) !== null && _m !== void 0 ? _m : 0);
        if (showScan && ((_l = scan === null || scan === void 0 ? void 0 : scan.ranges) === null || _l === void 0 ? void 0 : _l.length)) {
            let points = ((_m = scanProjectionRef.current) === null || _m === void 0 ? void 0 : _m.scan) === scan && scanProjectionRef.current.mapKey === mapKey
                ? scanProjectionRef.current.points
                : null;
            if (!points) {
                const scanFrame = normalizeFrameId((_o = scan.header) === null || _o === void 0 ? void 0 : _o.frame_id) || "base_link";
                const scanPose = (_p = tfFramePoseByName.get(scanFrame)) !== null && _p !== void 0 ? _p : pose;
                const scanX = Number((_r = (_q = scanPose === null || scanPose === void 0 ? void 0 : scanPose.position) === null || _q === void 0 ? void 0 : _q.x) !== null && _r !== void 0 ? _r : robotX);
                const scanY = Number((_t = (_s = scanPose === null || scanPose === void 0 ? void 0 : scanPose.position) === null || _s === void 0 ? void 0 : _s.y) !== null && _t !== void 0 ? _t : robotY);
                const scanYaw = yawFromPose(scanPose);
                const min = Number((_u = scan.range_min) !== null && _u !== void 0 ? _u : 0.02);
                const max = Number((_v = scan.range_max) !== null && _v !== void 0 ? _v : 20);
                const angleMin = Number((_w = scan.angle_min) !== null && _w !== void 0 ? _w : 0);
                const inc = Number((_x = scan.angle_increment) !== null && _x !== void 0 ? _x : 0);
                points = [];
                scan.ranges.forEach((range, index) => {
                    const r = Number(range);
                    if (!Number.isFinite(r) || r < min || r > max)
                        return;
                    const angle = scanYaw + angleMin + inc * index;
                    points.push(scanX + Math.cos(angle) * r, scanY + Math.sin(angle) * r, 0.11);
                });
                scanProjectionRef.current = { scan, mapKey, points };
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
            const material = new THREE.PointsMaterial({ color: 0x22c55e, size: 0.1, sizeAttenuation: true });
            layers.add(new THREE.Points(geometry, material));
        }
        if (showTf && ((_y = tf === null || tf === void 0 ? void 0 : tf.transforms) === null || _y === void 0 ? void 0 : _y.length)) {
            const framePoses = tfFramePoses.slice(0, 80);
            if (framePoses.length > 0) {
                framePoses.forEach(({ frame, pose: framePose }) => {
                    layers.add(makeTfAxes(framePose, frame, isDark));
                });
            }
            else {
                layers.add(makeTfAxes({
                    position: { x: robotX, y: robotY, z: 0 },
                    orientation: pose === null || pose === void 0 ? void 0 : pose.orientation,
                }, "base_link", isDark));
            }
        }
        if (showRobotModel && ((_0 = (_z = tfSyncedFootprint === null || tfSyncedFootprint === void 0 ? void 0 : tfSyncedFootprint.polygon) === null || _z === void 0 ? void 0 : _z.points) === null || _0 === void 0 ? void 0 : _0.length)) {
            const footprintFrame = normalizeFrameId((_1 = tfSyncedFootprint.header) === null || _1 === void 0 ? void 0 : _1.frame_id);
            const footprintFramePose = footprintFrame && footprintFrame !== "map"
                ? (_2 = tfFramePoseByName.get(footprintFrame)) !== null && _2 !== void 0 ? _2 : null
                : null;
            const footprintMarker = makeFootprintMarker(tfSyncedFootprint, footprintFramePose);
            if (footprintMarker)
                layers.add(footprintMarker);
        }
        if (pose === null || pose === void 0 ? void 0 : pose.position) {
            layers.add(makePoseMarker(pose, showRobotModel && ((_4 = (_3 = tfSyncedFootprint === null || tfSyncedFootprint === void 0 ? void 0 : tfSyncedFootprint.polygon) === null || _3 === void 0 ? void 0 : _3.points) === null || _4 === void 0 ? void 0 : _4.length) ? 0x60a5fa : 0x007acc, 0.16, isDark));
        }
        const fitKey = viewKey !== null && viewKey !== void 0 ? viewKey : "default";
        if (meta && fitMapKeyRef.current !== fitKey && !(btLayer?.spot?.pose)) {
            fitCameraToMap(camera, controls, meta, viewRollRef.current);
            fitMapKeyRef.current = fitKey;
        }
    }, [
        globalCostmap,
        dragPreviewPose,
        editorAreaPreview,
        nodeDragPreview,
        goalPose,
        interactionMode,
        missionRouteOrder,
        mapAnnotations,
        selectedMapAnnotationId,
        selectedMissionRouteSourceId,
        behaviorPreviewNode,
        localCostmap,
        map,
        plan,
        pose,
        scan,
        behaviorNodes,
        btLayer?.spot?.id,
        selectedBehaviorNodeId,
        selectedSpotId,
        showGlobalCostmap,
        showLocalCostmap,
        showGlobalPlan,
        showGoalPose,
        showMap,
        showRobotModel,
        showScan,
        showTf,
        spots,
        tf,
        viewKey,
        isDark,
    ]);
    useEffect(() => {
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!renderer || !camera || !controls)
            return;
        const mapPointFromEvent = (event) => {
            const meta = gridMeta(map);
            if (!meta)
                return null;
            const rect = renderer.domElement.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
                return null;
            pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointerRef.current.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
            raycasterRef.current.setFromCamera(pointerRef.current, camera);
            const point = new THREE.Vector3();
            const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            if (!raycasterRef.current.ray.intersectPlane(plane, point))
                return null;
            const width = meta.width * meta.resolution;
            const height = meta.height * meta.resolution;
            if (point.x < meta.originX ||
                point.x > meta.originX + width ||
                point.y < meta.originY ||
                point.y > meta.originY + height) {
                return null;
            }
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
                return null;
            return point;
        };
        const targetFromEvent = (event) => {
            const layers = layersRef.current;
            if (!layers || (typeof onSpotClick !== "function" && typeof onBehaviorNodeClick !== "function"))
                return null;
            const rect = renderer.domElement.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
                return null;
            pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointerRef.current.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
            raycasterRef.current.setFromCamera(pointerRef.current, camera);
            const hits = raycasterRef.current.intersectObjects(layers.children, true);
            for (const hit of hits) {
                let object = hit.object;
                while (object) {
                    if (object.userData && object.userData.behaviorNodeId && typeof onBehaviorNodeClick === "function")
                        return { type: "behaviorNode", id: object.userData.behaviorNodeId, dragAction: "move" };
                    if (object.userData && object.userData.spotId && typeof onSpotClick === "function")
                        return {
                            type: "spot",
                            id: object.userData.spotId,
                            dragAction: object.userData.dragAction || "move",
                        };
                    object = object.parent;
                }
            }
            return null;
        };
        const draggableTargetPose = (target) => {
            var _a;
            if ((target === null || target === void 0 ? void 0 : target.type) === "spot") {
                const spot = spots.find((item) => item.id === target.id);
                if (!spot || typeof onSpotPoseChange !== "function")
                    return null;
                const spotPose = spot.pose;
                if (!spotPose)
                    return null;
                return {
                    x: Number((_a = spotPose.x) !== null && _a !== void 0 ? _a : 0),
                    y: Number(spotPose.y !== null && spotPose.y !== void 0 ? spotPose.y : 0),
                    yaw: Number(spotPose.yaw !== null && spotPose.yaw !== void 0 ? spotPose.yaw : 0),
                };
            }
            if ((target === null || target === void 0 ? void 0 : target.type) === "behaviorNode") {
                const node = behaviorNodes.find((item) => item.id === target.id);
                if (!node || node.id !== selectedBehaviorNodeId || typeof onBehaviorNodePoseChange !== "function")
                    return null;
                const nodePose = node.pose;
                if (!nodePose)
                    return null;
                return {
                    x: Number(nodePose.x !== null && nodePose.x !== void 0 ? nodePose.x : 0),
                    y: Number(nodePose.y !== null && nodePose.y !== void 0 ? nodePose.y : 0),
                    yaw: Number(nodePose.yaw !== null && nodePose.yaw !== void 0 ? nodePose.yaw : 0),
                };
            }
            return null;
        };
        const previewPoseFromDrag = (start, point, clientX, clientY) => {
            const moved = Math.hypot(clientX - start.clientX, clientY - start.clientY);
            const yaw = moved > CLICK_DRAG_THRESHOLD_PX
                ? Math.atan2(point.y - start.mapY, point.x - start.mapX)
                : yawFromPose(pose);
            return {
                position: { x: start.mapX, y: start.mapY, z: 0 },
                orientation: orientationFromYaw(yaw),
            };
        };
        const paintEditorPoint = (event, phase = "paint") => {
            if (typeof onEditorMapPoint !== "function")
                return false;
            const point = mapPointFromEvent(event);
            if (!point)
                return false;
            event.preventDefault();
            event.stopImmediatePropagation();
            onEditorMapPoint(point.x, point.y, phase);
            return true;
        };
        // Coalesce paint moves to one commit per animation frame — pointermove can
        // fire far faster than strokes need, and each commit re-rasterizes the
        // stroked annotation.
        const flushEditorMove = () => {
            if (editorMoveRafRef.current != null) {
                cancelAnimationFrame(editorMoveRafRef.current);
                editorMoveRafRef.current = null;
            }
            const pending = editorMovePendingRef.current;
            editorMovePendingRef.current = null;
            if (pending)
                paintEditorPoint(pending, "move");
        };
        const queueEditorMove = (event) => {
            editorMovePendingRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                preventDefault: () => { },
                stopImmediatePropagation: () => { },
            };
            if (editorMoveRafRef.current == null) {
                editorMoveRafRef.current = requestAnimationFrame(() => {
                    editorMoveRafRef.current = null;
                    const pending = editorMovePendingRef.current;
                    editorMovePendingRef.current = null;
                    if (pending)
                        paintEditorPoint(pending, "move");
                });
            }
        };
        const handlePointerDown = (event) => {
            if (event.button === 2) {
                if (interactionDisabled || editorActive || interactionMode !== "view")
                    return;
                event.preventDefault();
                event.stopImmediatePropagation();
                viewRotateDragRef.current = {
                    clientX: event.clientX,
                    roll: viewRollRef.current,
                };
                renderer.domElement.setPointerCapture(event.pointerId);
                return;
            }
            if (event.button !== 0)
                return;
            if (editorActive) {
                if (interactionDisabled) {
                    pointerDownRef.current = null;
                    setDragPreviewPose(null);
                    return;
                }
                if (editorAreaSelection && typeof onEditorMapArea === "function") {
                    const point = mapPointFromEvent(event);
                    if (!point)
                        return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    editorAreaDragRef.current = {
                        pointerId: event.pointerId,
                        clientX: event.clientX,
                        clientY: event.clientY,
                        startX: point.x,
                        startY: point.y,
                        endX: point.x,
                        endY: point.y,
                    };
                    setEditorAreaPreview(null);
                    renderer.domElement.setPointerCapture(event.pointerId);
                    return;
                }
                if (paintEditorPoint(event, "start") && editorPaintOnDrag) {
                    editorPaintPointerRef.current = event.pointerId;
                    renderer.domElement.setPointerCapture(event.pointerId);
                }
                return;
            }
            if (!interactionDisabled && interactionMode === "view") {
                const target = targetFromEvent(event);
                if (target) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    if (missionRouteMode && target.type === "spot" && typeof onMissionRouteSpotClick === "function") {
                        onMissionRouteSpotClick(target.id);
                    }
                    else if (target.type === "behaviorNode") {
                        onBehaviorNodeClick(target.id);
                    }
                    else {
                        onSpotClick(target.id);
                    }
                    const point = mapPointFromEvent(event);
                    const targetPose = point && !missionRouteMode ? draggableTargetPose(target) : null;
                    if (point && targetPose) {
                        nodeDragRef.current = {
                            type: target.type,
                            id: target.id,
                            dragAction: target.dragAction || "move",
                            clientX: event.clientX,
                            clientY: event.clientY,
                            offsetX: point.x - targetPose.x,
                            offsetY: point.y - targetPose.y,
                            x: targetPose.x,
                            y: targetPose.y,
                            yaw: targetPose.yaw,
                            dragging: false,
                        };
                        renderer.domElement.setPointerCapture(event.pointerId);
                    }
                    else {
                        nodeDragRef.current = null;
                    }
                    pointerDownRef.current = null;
                    setDragPreviewPose(null);
                    return;
                }
            }
            if (interactionDisabled || interactionMode === "view") {
                if (!interactionDisabled && interactionMode === "view" && missionRouteMode && typeof onMissionRouteMapClick === "function") {
                    onMissionRouteMapClick();
                }
                else if (!interactionDisabled && interactionMode === "view" && typeof onMapClick === "function") {
                    const point = mapPointFromEvent(event);
                    if (point) {
                        onMapClick(point.x, point.y);
                    }
                }
                if (!interactionDisabled && interactionMode === "view") {
                    setMapDragActive(true);
                }
                pointerDownRef.current = null;
                setDragPreviewPose(null);
                return;
            }
            const point = mapPointFromEvent(event);
            if (!point) {
                pointerDownRef.current = null;
                setDragPreviewPose(null);
                return;
            }
            const pointerDown = {
                clientX: event.clientX,
                clientY: event.clientY,
                mapX: point.x,
                mapY: point.y,
            };
            pointerDownRef.current = pointerDown;
            setDragPreviewPose(previewPoseFromDrag(pointerDown, point, event.clientX, event.clientY));
            renderer.domElement.setPointerCapture(event.pointerId);
        };
        const handlePointerMove = (event) => {
            const editorAreaDrag = editorAreaDragRef.current;
            if (editorAreaDrag && editorAreaDrag.pointerId === event.pointerId) {
                const point = mapPointFromEvent(event);
                if (!point)
                    return;
                event.preventDefault();
                event.stopImmediatePropagation();
                editorAreaDrag.endX = point.x;
                editorAreaDrag.endY = point.y;
                setEditorAreaPreview({
                    startX: editorAreaDrag.startX,
                    startY: editorAreaDrag.startY,
                    endX: point.x,
                    endY: point.y,
                });
                return;
            }
            if (editorPaintPointerRef.current === event.pointerId) {
                event.preventDefault();
                queueEditorMove(event);
                return;
            }
            const nodeDrag = nodeDragRef.current;
            if (nodeDrag) {
                const point = mapPointFromEvent(event);
                if (!point)
                    return;
                event.preventDefault();
                event.stopImmediatePropagation();
                const moved = Math.hypot(event.clientX - nodeDrag.clientX, event.clientY - nodeDrag.clientY);
                const nextX = nodeDrag.dragAction === "rotate"
                    ? nodeDrag.x
                    : point.x - nodeDrag.offsetX;
                const nextY = nodeDrag.dragAction === "rotate"
                    ? nodeDrag.y
                    : point.y - nodeDrag.offsetY;
                const nextYaw = nodeDrag.dragAction === "rotate"
                    ? Math.atan2(point.y - nodeDrag.y, point.x - nodeDrag.x)
                    : nodeDrag.yaw;
                nodeDrag.x = nextX;
                nodeDrag.y = nextY;
                nodeDrag.yaw = nextYaw;
                nodeDrag.dragging = nodeDrag.dragging || moved > CLICK_DRAG_THRESHOLD_PX;
                if (nodeDrag.dragging) {
                    setNodeDragPreview({
                        type: nodeDrag.type,
                        id: nodeDrag.id,
                        x: nextX,
                        y: nextY,
                        yaw: nextYaw,
                    });
                }
                return;
            }
            const viewRotateDrag = viewRotateDragRef.current;
            if (viewRotateDrag) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const nextRoll = viewRotateDrag.roll - (event.clientX - viewRotateDrag.clientX) * 0.01;
                viewRollRef.current = nextRoll;
                applyTopViewRoll(camera, controls, nextRoll);
                return;
            }
            if (interactionDisabled || interactionMode === "view")
                return;
            const pointerDown = pointerDownRef.current;
            if (!pointerDown)
                return;
            const point = mapPointFromEvent(event);
            if (!point)
                return;
            setDragPreviewPose(previewPoseFromDrag(pointerDown, point, event.clientX, event.clientY));
        };
        const handlePointerUp = (event) => {
            setMapDragActive(false);
            const editorAreaDrag = editorAreaDragRef.current;
            if (editorAreaDrag && editorAreaDrag.pointerId === event.pointerId) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const point = mapPointFromEvent(event);
                const endX = point ? point.x : editorAreaDrag.endX;
                const endY = point ? point.y : editorAreaDrag.endY;
                editorAreaDragRef.current = null;
                setEditorAreaPreview(null);
                if (renderer.domElement.hasPointerCapture(event.pointerId)) {
                    renderer.domElement.releasePointerCapture(event.pointerId);
                }
                onEditorMapArea(editorAreaDrag.startX, editorAreaDrag.startY, endX, endY);
                return;
            }
            if (editorPaintPointerRef.current === event.pointerId) {
                event.preventDefault();
                event.stopImmediatePropagation();
                editorPaintPointerRef.current = null;
                flushEditorMove();
                if (typeof onEditorMapPoint === "function")
                    onEditorMapPoint(0, 0, "end");
                if (renderer.domElement.hasPointerCapture(event.pointerId)) {
                    renderer.domElement.releasePointerCapture(event.pointerId);
                }
                return;
            }
            if (nodeDragRef.current) {
                event.preventDefault();
                event.stopImmediatePropagation();
                const nodeDrag = nodeDragRef.current;
                nodeDragRef.current = null;
                setNodeDragPreview(null);
                if (renderer.domElement.hasPointerCapture(event.pointerId)) {
                    renderer.domElement.releasePointerCapture(event.pointerId);
                }
                if (nodeDrag.dragging) {
                    if (nodeDrag.type === "spot" && typeof onSpotPoseChange === "function") {
                        onSpotPoseChange(nodeDrag.id, nodeDrag.x, nodeDrag.y, nodeDrag.yaw);
                    }
                    else if (nodeDrag.type === "behaviorNode" && typeof onBehaviorNodePoseChange === "function") {
                        onBehaviorNodePoseChange(nodeDrag.id, nodeDrag.x, nodeDrag.y, nodeDrag.yaw);
                    }
                }
                return;
            }
            if (viewRotateDragRef.current) {
                event.preventDefault();
                event.stopImmediatePropagation();
                viewRotateDragRef.current = null;
                if (renderer.domElement.hasPointerCapture(event.pointerId)) {
                    renderer.domElement.releasePointerCapture(event.pointerId);
                }
                return;
            }
            if (interactionDisabled || interactionMode === "view" || event.button !== 0)
                return;
            const pointerDown = pointerDownRef.current;
            pointerDownRef.current = null;
            setDragPreviewPose(null);
            if (renderer.domElement.hasPointerCapture(event.pointerId)) {
                renderer.domElement.releasePointerCapture(event.pointerId);
            }
            if (!pointerDown)
                return;
            const point = mapPointFromEvent(event);
            if (!point)
                return;
            const moved = Math.hypot(event.clientX - pointerDown.clientX, event.clientY - pointerDown.clientY);
            const yaw = moved > CLICK_DRAG_THRESHOLD_PX
                ? Math.atan2(point.y - pointerDown.mapY, point.x - pointerDown.mapX)
                : yawFromPose(pose);
            onMapPose(pointerDown.mapX, pointerDown.mapY, yaw);
        };
        const handlePointerCancel = (event) => {
            const hadPaintPointer = editorPaintPointerRef.current === event.pointerId;
            editorPaintPointerRef.current = null;
            editorAreaDragRef.current = null;
            viewRotateDragRef.current = null;
            nodeDragRef.current = null;
            pointerDownRef.current = null;
            setMapDragActive(false);
            setEditorAreaPreview(null);
            setNodeDragPreview(null);
            setDragPreviewPose(null);
            if (hadPaintPointer) {
                flushEditorMove();
                if (typeof onEditorMapPoint === "function")
                    onEditorMapPoint(0, 0, "end");
            }
            if (renderer.domElement.hasPointerCapture(event.pointerId)) {
                renderer.domElement.releasePointerCapture(event.pointerId);
            }
        };
        const handlePointerLeave = () => {
            setMapDragActive(false);
        };
        const handleContextMenu = (event) => {
            event.preventDefault();
        };
        renderer.domElement.addEventListener("pointerdown", handlePointerDown, { capture: true });
        renderer.domElement.addEventListener("pointermove", handlePointerMove);
        renderer.domElement.addEventListener("pointerup", handlePointerUp);
        renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
        renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
        renderer.domElement.addEventListener("contextmenu", handleContextMenu);
        return () => {
            renderer.domElement.removeEventListener("pointerdown", handlePointerDown, { capture: true });
            renderer.domElement.removeEventListener("pointermove", handlePointerMove);
            renderer.domElement.removeEventListener("pointerup", handlePointerUp);
            renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
            renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
            renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
            if (editorMoveRafRef.current != null) {
                cancelAnimationFrame(editorMoveRafRef.current);
                editorMoveRafRef.current = null;
            }
            editorMovePendingRef.current = null;
        };
    }, [
        behaviorNodes,
        editorActive,
        editorAreaSelection,
        editorPaintOnDrag,
        interactionDisabled,
        interactionMode,
        map,
        missionRouteMode,
        onBehaviorNodeClick,
        onBehaviorNodePoseChange,
        onEditorMapArea,
        onEditorMapPoint,
        onMapPose,
        onMapClick,
        onMissionRouteMapClick,
        onMissionRouteSpotClick,
        onSpotClick,
        onSpotPoseChange,
        pose,
        selectedBehaviorNodeId,
        selectedSpotId,
        spots,
    ]);
    return (<div className={`relative border rounded-md min-h-0 overflow-hidden ${fitContainer ? "h-full w-full" : ""}`} style={{
            ...(fitContainer
                ? { height: "100%", width: "100%" }
                : { aspectRatio: "1 / 1" }),
            backgroundColor: "var(--vscode-editor-background)",
            borderColor: "var(--vscode-panel-border)",
        }}>
      <div ref={containerRef} className="h-full w-full"/>
      {viewerError && (<div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm pointer-events-none" style={{ color: "var(--vscode-descriptionForeground)" }}>
          Map viewer unavailable: {viewerError}
        </div>)}
      {!viewerError && showMap && !map && (<div className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none" style={{ color: "var(--vscode-descriptionForeground)" }}>
          {waitingLabel}
        </div>)}
      <WaypointBtFocusLayer layer={btLayer} onClose={onBtLayerClose}/>
    </div>);
}
