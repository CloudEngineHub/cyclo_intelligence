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
const WAYPOINT_LABEL_SCALE_X = 24;
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
function makeOccupancyTexture(grid, alpha, mode, highlightedCells = null) {
    var _a;
    const meta = gridMeta(grid);
    if (!meta || !grid.data || grid.data.length < meta.width * meta.height)
        return null;
    const canvas = document.createElement("canvas");
    canvas.width = meta.width;
    canvas.height = meta.height;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return null;
    const image = ctx.createImageData(meta.width, meta.height);
    for (let y = 0; y < meta.height; y += 1) {
        for (let x = 0; x < meta.width; x += 1) {
            const srcIndex = (meta.width - 1 - x) + (meta.height - 1 - y) * meta.width;
            const dstIndex = (x + y * meta.width) * 4;
            const value = (_a = grid.data[srcIndex]) !== null && _a !== void 0 ? _a : -1;
            let r = 118;
            let g = 118;
            let b = 118;
            let a = alpha;
            if (mode === "map") {
                if (value < 0) {
                    r = 150;
                    g = 150;
                    b = 150;
                    a = 210;
                }
                else if (value === 0) {
                    r = 245;
                    g = 245;
                    b = 245;
                    a = 255;
                }
                else {
                    r = 28;
                    g = 28;
                    b = 28;
                    a = 255;
                }
            }
            else if (mode === "globalCostmap") {
                if (value < 0) {
                    r = 12;
                    g = 15;
                    b = 15;
                    a = 210;
                }
                else if (value === 0) {
                    r = 10;
                    g = 13;
                    b = 13;
                    a = 205;
                }
                else {
                    const normalized = Math.min(Math.max(value, 0), 100) / 100;
                    const gray = Math.round(220 - normalized * 205);
                    r = gray;
                    g = gray;
                    b = gray;
                    a = Math.round(95 + normalized * 150);
                }
            }
            else if (mode === "localCostmap") {
                if (highlightedCells === null || highlightedCells === void 0 ? void 0 : highlightedCells.has(srcIndex)) {
                    r = 220;
                    g = 28;
                    b = 28;
                    a = 215;
                }
                else if (value <= 20) {
                    a = 0;
                }
                else if (value < 70) {
                    r = 220;
                    g = 28;
                    b = 28;
                    a = 215;
                }
                else {
                    r = 245;
                    g = 124;
                    b = 0;
                    a = 235;
                }
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
                    texture === null || texture === void 0 ? void 0 : texture.dispose();
                    item.dispose();
                });
            }
            else {
                const texture = material === null || material === void 0 ? void 0 : material.map;
                texture === null || texture === void 0 ? void 0 : texture.dispose();
                material === null || material === void 0 ? void 0 : material.dispose();
            }
        }
    });
}
function makeGridPlane(grid, mode, z, framePose = null, highlightedCells = null) {
    var _a, _b, _c, _d;
    const meta = gridMeta(grid);
    const texture = makeOccupancyTexture(grid, mode === "map" ? 255 : 170, mode, highlightedCells);
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
function makeLine(points, color, lineWidth = 2) {
    if (points.length < 2)
        return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, linewidth: lineWidth });
    return new THREE.Line(geometry, material);
}
function makeTextSprite(text, { width = 256, height = 64, fontSize = 22, backgroundAlpha = 0.58 } = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.fillStyle = `rgba(0, 0, 0, ${backgroundAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0, 0, 0, 0.82)";
        ctx.shadowBlur = Math.max(4, Math.round(fontSize * 0.15));
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        ctx.font = `700 ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
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
function makePoseMarker(pose, color, z) {
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
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    arrow.position.z = 0.01;
    group.add(arrow);
    return group;
}
function makeSpotMarker(spot, selected = false, scale = 1) {
    var _a, _b, _c, _d;
    const pose = spot === null || spot === void 0 ? void 0 : spot.pose;
    if (!pose)
        return null;
    const x = Number((_a = pose.x) !== null && _a !== void 0 ? _a : 0);
    const y = Number((_b = pose.y) !== null && _b !== void 0 ? _b : 0);
    const yaw = Number((_c = pose.yaw) !== null && _c !== void 0 ? _c : 0);
    const color = selected ? 0xf59e0b : 0x22c55e;
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
        const sprite = makeTextSprite(label, {
            width: 512,
            height: 128,
            fontSize: 64,
            backgroundAlpha: 0.68,
        });
        sprite.position.set(0, WAYPOINT_LABEL_OFFSET_Y, 0.04);
        sprite.scale.set(WAYPOINT_LABEL_SCALE_X, WAYPOINT_LABEL_SCALE_Y, 1);
        sprite.userData = { spotId: spot.id, dragAction: "move" };
        group.add(sprite);
    }
    return group;
}
function behaviorNodeColor(category, selected = false) {
    if (selected)
        return 0xf59e0b;
    switch (category) {
        case "control":
            return 0x38bdf8;
        case "decorator":
            return 0xa78bfa;
        case "action":
        default:
            return 0x22c55e;
    }
}
function makeBehaviorNodeMarker(node, selected = false) {
    var _a, _b, _c, _d, _e;
    const pose = node === null || node === void 0 ? void 0 : node.pose;
    if (!pose)
        return null;
    const x = Number((_a = pose.x) !== null && _a !== void 0 ? _a : 0);
    const y = Number((_b = pose.y) !== null && _b !== void 0 ? _b : 0);
    const yaw = Number((_c = pose.yaw) !== null && _c !== void 0 ? _c : 0);
    const color = behaviorNodeColor(node.category, selected);
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
    ], selected ? 0xffffff : 0xe5e7eb, 2);
    if (outline) {
        outline.userData.behaviorNodeId = node.id;
        group.add(outline);
    }
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
    }));
    port.position.set(-0.16, 0, 0.03);
    port.userData.behaviorNodeId = node.id;
    group.add(port);
    const label = String((_e = (_d = node.label) !== null && _d !== void 0 ? _d : node.tag) !== null && _e !== void 0 ? _e : node.id);
    if (label) {
        const sprite = makeTfLabelSprite(label);
        sprite.position.set(0, 0.38, 0.06);
        sprite.scale.set(0.56, 0.14, 1);
        sprite.userData.behaviorNodeId = node.id;
        group.add(sprite);
    }
    return group;
}
function makeTfAxes(pose, label) {
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
    const sprite = makeTfLabelSprite(label);
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
function makeTfLabelSprite(text) {
    const sprite = makeTextSprite(text);
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
        default: {
            color: "#111827",
            backgroundColor: "rgba(255,255,255,0.9)",
            borderColor: "#94a3b8",
        },
        active: {
            color: "#052e16",
            backgroundColor: "rgba(220,252,231,0.94)",
            borderColor: "#15803d",
        },
        muted: {
            color: "#334155",
            backgroundColor: "rgba(248,250,252,0.82)",
            borderColor: "#cbd5e1",
        },
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
            background: "linear-gradient(90deg, rgba(15,23,42,0.1), rgba(15,23,42,0))",
        }}/>
      <div className="absolute inset-y-0 right-0 w-[75%] pointer-events-auto overflow-hidden" style={{
            color: "#111827",
            backgroundColor: "#ffffff",
            borderLeft: "1px solid rgba(148,163,184,0.82)",
        }}>
        <div className="h-full min-h-0 p-5 grid grid-rows-[auto_minmax(0,1fr)] gap-4">
          <header className="min-w-0 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-semibold tracking-wide" style={{ color: "#64748b" }}>
                Waypoint BT
              </div>
              <div className="text-base font-semibold truncate">
                {spot.label || spot.id}
              </div>
            </div>
            {typeof onClose === "function" && (<button type="button" onClick={onClose} className="h-8 px-3 border rounded-md text-xs font-semibold active:translate-y-px" style={{
                    color: "#111827",
                    backgroundColor: "rgba(255,255,255,0.88)",
                    borderColor: "#cbd5e1",
                }}>
                Close
              </button>)}
          </header>
          <div className="relative min-h-0 overflow-hidden rounded-md border" style={{
            borderColor: "#e2e8f0",
        }}>
            {layer.editor ? layer.editor : (<>
            <div className="absolute inset-0 opacity-80" style={{
            backgroundImage: "linear-gradient(rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.18) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
        }}/>
            <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
              <line x1="20%" y1="49%" x2="42%" y2="49%" stroke="#111827" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="56%" y1="38%" x2="76%" y2="28%" stroke="#111827" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="56%" y1="60%" x2="76%" y2="72%" stroke="#111827" strokeWidth="2.5" strokeLinecap="round"/>
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
export function MapViewer({ map, globalCostmap, localCostmap, scan, pose, plan, goalPose, footprint, tf, showMap, showGlobalCostmap, showLocalCostmap, showScan, showGlobalPlan, showGoalPose, showTf, showRobotModel, interactionDisabled, interactionMode, editorActive, viewKey, waitingLabel = "Waiting for /map", fitContainer = false, spots = [], selectedSpotId = "", behaviorNodes = [], selectedBehaviorNodeId = "", behaviorPreviewNode = null, btLayer = null, onBtLayerClose, onSpotClick, onBehaviorNodeClick, onSpotPoseChange, onBehaviorNodePoseChange, onEditorMapPoint, onMapPose, }) {
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
    const [viewerError, setViewerError] = useState(null);
    // Freeze each LaserScan in display coordinates until the next scan or map geometry change.
    const scanProjectionRef = useRef(null);
    const raycasterRef = useRef(new THREE.Raycaster());
    const pointerRef = useRef(new THREE.Vector2());
    const pointerDownRef = useRef(null);
    const editorPaintPointerRef = useRef(null);
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
            scene.background = new THREE.Color(0x1b1b1b);
            sceneRef.current = scene;
            camera = new THREE.PerspectiveCamera(48, 1, CAMERA_NEAR, CAMERA_FAR);
            camera.up.set(0, 1, 0);
            camera.position.set(0, 0, 10);
            cameraRef.current = camera;
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setPixelRatio(window.devicePixelRatio || 1);
            renderer.setClearColor(0x1b1b1b, 1);
            renderer.domElement.className = "block w-full h-full cursor-grab";
            containerEl.appendChild(renderer.domElement);
            rendererRef.current = renderer;
            mapLayer = new THREE.Group();
            scene.add(mapLayer);
            mapLayerRef.current = mapLayer;
            layers = new THREE.Group();
            scene.add(layers);
            layersRef.current = layers;
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
        };
    }, []);
    useEffect(() => {
        const renderer = rendererRef.current;
        const controls = controlsRef.current;
        if (!renderer)
            return;
        const cursor = interactionDisabled
            ? "cursor-wait"
            : editorActive
                ? "cursor-cell"
                : interactionMode === "view"
                    ? "cursor-grab"
                    : "cursor-crosshair";
        renderer.domElement.className = `block w-full h-full ${cursor}`;
        if (controls) {
            controls.enabled = !interactionDisabled && !editorActive && interactionMode === "view";
        }
    }, [editorActive, interactionDisabled, interactionMode]);
    useEffect(() => {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const meta = gridMeta(map);
        if (!camera || !controls || !meta)
            return;
        const spot = btLayer === null || btLayer === void 0 ? void 0 : btLayer.spot;
        const fitKey = viewKey !== null && viewKey !== void 0 ? viewKey : "default";
        if (spot === null || spot === void 0 ? void 0 : spot.pose) {
            focusCameraToWaypoint(camera, controls, meta, spot, viewRollRef.current);
            btFocusActiveRef.current = true;
            return;
        }
        if (btFocusActiveRef.current) {
            fitCameraToMap(camera, controls, meta, viewRollRef.current);
            fitMapKeyRef.current = fitKey;
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
        const mapPlane = makeGridPlane(map, "map", 0);
        if (mapPlane)
            mapLayer.add(mapPlane);
    }, [map, showMap]);
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
                const plane = makeGridPlane(globalCostmap, "globalCostmap", 0.03);
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
                const plane = makeGridPlane(localCostmap, "localCostmap", 0.1, localFramePose, scanCells);
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
            layers.add(makePoseMarker(goalPose.pose, 0xf59e0b, 0.14));
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
                }, true, waypointScale));
            }
            else if (interactionMode === "behavior" && behaviorPreviewNode) {
                layers.add(makeBehaviorNodeMarker({
                    id: "__behavior_preview__",
                    tag: behaviorPreviewNode.tag,
                    label: behaviorPreviewNode.label || behaviorPreviewNode.tag,
                    category: behaviorPreviewNode.category || "action",
                    pose: { x: previewX, y: previewY, yaw: previewYaw },
                }, true));
            }
            else {
                layers.add(makePoseMarker(dragPreviewPose, interactionMode === "initial" ? 0x22c55e : 0xf59e0b, 0.2));
            }
        }
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
                : spot, spot.id === selectedSpotId, waypointScale);
            if (marker)
                layers.add(marker);
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
                : node, node.id === selectedBehaviorNodeId);
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
                    layers.add(makeTfAxes(framePose, frame));
                });
            }
            else {
                layers.add(makeTfAxes({
                    position: { x: robotX, y: robotY, z: 0 },
                    orientation: pose === null || pose === void 0 ? void 0 : pose.orientation,
                }, "base_link"));
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
            layers.add(makePoseMarker(pose, showRobotModel && ((_4 = (_3 = tfSyncedFootprint === null || tfSyncedFootprint === void 0 ? void 0 : tfSyncedFootprint.polygon) === null || _3 === void 0 ? void 0 : _3.points) === null || _4 === void 0 ? void 0 : _4.length) ? 0x60a5fa : 0x007acc, 0.16));
        }
        const fitKey = viewKey !== null && viewKey !== void 0 ? viewKey : "default";
        if (meta && fitMapKeyRef.current !== fitKey && !(btLayer?.spot?.pose)) {
            fitCameraToMap(camera, controls, meta, viewRollRef.current);
            fitMapKeyRef.current = fitKey;
        }
    }, [
        globalCostmap,
        dragPreviewPose,
        nodeDragPreview,
        goalPose,
        interactionMode,
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
        const paintEditorPoint = (event) => {
            if (typeof onEditorMapPoint !== "function")
                return false;
            const point = mapPointFromEvent(event);
            if (!point)
                return false;
            event.preventDefault();
            event.stopImmediatePropagation();
            onEditorMapPoint(point.x, point.y);
            return true;
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
                if (paintEditorPoint(event)) {
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
                    if (target.type === "behaviorNode") {
                        onBehaviorNodeClick(target.id);
                    }
                    else {
                        onSpotClick(target.id);
                    }
                    const point = mapPointFromEvent(event);
                    const targetPose = point ? draggableTargetPose(target) : null;
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
            if (editorPaintPointerRef.current === event.pointerId) {
                paintEditorPoint(event);
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
            if (editorPaintPointerRef.current === event.pointerId) {
                event.preventDefault();
                event.stopImmediatePropagation();
                editorPaintPointerRef.current = null;
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
            editorPaintPointerRef.current = null;
            viewRotateDragRef.current = null;
            nodeDragRef.current = null;
            pointerDownRef.current = null;
            setNodeDragPreview(null);
            setDragPreviewPose(null);
            if (renderer.domElement.hasPointerCapture(event.pointerId)) {
                renderer.domElement.releasePointerCapture(event.pointerId);
            }
        };
        const handleContextMenu = (event) => {
            event.preventDefault();
        };
        renderer.domElement.addEventListener("pointerdown", handlePointerDown, { capture: true });
        renderer.domElement.addEventListener("pointermove", handlePointerMove);
        renderer.domElement.addEventListener("pointerup", handlePointerUp);
        renderer.domElement.addEventListener("pointercancel", handlePointerCancel);
        renderer.domElement.addEventListener("contextmenu", handleContextMenu);
        return () => {
            renderer.domElement.removeEventListener("pointerdown", handlePointerDown, { capture: true });
            renderer.domElement.removeEventListener("pointermove", handlePointerMove);
            renderer.domElement.removeEventListener("pointerup", handlePointerUp);
            renderer.domElement.removeEventListener("pointercancel", handlePointerCancel);
            renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [
        behaviorNodes,
        editorActive,
        interactionDisabled,
        interactionMode,
        map,
        onBehaviorNodeClick,
        onBehaviorNodePoseChange,
        onEditorMapPoint,
        onMapPose,
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
