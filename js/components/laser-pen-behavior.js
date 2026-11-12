AFRAME.registerComponent('laser-pen-behavior', {
    init: function () {
        this.isGrabbedVR = false;
        this.isGrabbedDesktop = false;
        this.isHovered = false;
        this.isFiring = false;
        this.wasFiring = false;
        this.grabbedBy = null; 
        this.lastFireTime = 0;
        this.fireInterval = 20; 
    
        this.smoothedRayDir = null;
    
        this.onHoverEnter = this.onHoverEnter.bind(this);
        this.onHoverLeave = this.onHoverLeave.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        
        this.onVRGripDown = this.onVRGripDown.bind(this);
        this.onVRGripUp = this.onVRGripUp.bind(this);
        this.onVRTriggerDown = this.onVRTriggerDown.bind(this);
        this.onVRTriggerUp = this.onVRTriggerUp.bind(this);
    
        this.el.addEventListener('mouseenter', this.onHoverEnter);
        this.el.addEventListener('mouseleave', this.onHoverLeave);
    
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
    
        this.raycasterEntity = document.createElement('a-entity');
        this.raycasterEntity.setAttribute('position', '0 0 0'); 
        this.raycasterEntity.setAttribute('rotation', '90 0 0');
        this.el.appendChild(this.raycasterEntity);
    
        const pos = this.el.getAttribute('position');
        const rot = this.el.getAttribute('rotation');
        this.originalPosition = { x: pos.x, y: pos.y, z: pos.z };
        this.originalRotation = { x: rot.x, y: rot.y, z: rot.z };
        
        this.lastHitPoint = null;
        this.lastHitNormal = null;
    
        // 顏色模式狀態 (0:紅, 1:黃, 2:藍)
        this.currentMode = 0;
        this.colorAreas = [0, 0, 0];
        this.hitCounts = [0, 0, 0];
        this.hitMeshes = [];

        const bindHandEvents = () => {
            const leftHand = document.querySelector('#left-hand');
            const rightHand = document.querySelector('#right-hand');
            
            if(leftHand) {
                leftHand.addEventListener('gripdown', (e) => this.onVRGripDown(e, leftHand));
                leftHand.addEventListener('gripup', (e) => this.onVRGripUp(e, leftHand));
                leftHand.addEventListener('triggerdown', (e) => this.onVRTriggerDown(e, leftHand));
                leftHand.addEventListener('triggerup', (e) => this.onVRTriggerUp(e, leftHand));
            }
            if(rightHand) {
                rightHand.addEventListener('gripdown', (e) => this.onVRGripDown(e, rightHand));
                rightHand.addEventListener('gripup', (e) => this.onVRGripUp(e, rightHand));
                rightHand.addEventListener('triggerdown', (e) => this.onVRTriggerDown(e, rightHand));
                rightHand.addEventListener('triggerup', (e) => this.onVRTriggerUp(e, rightHand));
                
                // 右把手 A 或 B 鍵快速切換
                rightHand.addEventListener('abuttondown', () => this.toggleMode());
                rightHand.addEventListener('bbuttondown', () => this.toggleMode());
            }
        };
    
        if (document.readyState === 'complete') {
            bindHandEvents();
        } else {
            window.addEventListener('load', bindHandEvents);
        }
    
        this.el.sceneEl.addEventListener('loaded', () => {
            this.points3D = []; 
            this.dummy = new THREE.Object3D(); 
            this.manualRaycaster = new THREE.Raycaster();
            this.manualRaycaster.near = 0;
            this.manualRaycaster.firstHitOnly = true;
    
            this.maxPreviewHits = 15000; 
            
            const previewGeo = new THREE.CylinderGeometry(0.0009, 0.0009, 1, 8); 
            
            const previewMat = new THREE.MeshBasicMaterial({ 
                color: 0xff0000, 
                transparent: true, 
                opacity: 0.95, 
                depthTest: true, 
                depthWrite: false 
            });
            this.previewInstancedMesh = new THREE.InstancedMesh(previewGeo, previewMat, this.maxPreviewHits);
            this.previewInstancedMesh.frustumCulled = false; 
            this.previewInstancedMesh.renderOrder = 999;
            this.previewInstancedMesh.count = this.maxPreviewHits;
            this.previewCursor = 0; 
    
            this.clearPreviewPoints = () => {
                this.dummy.position.set(0, -9999, 0); 
                this.dummy.scale.set(0, 0, 0);
                this.dummy.updateMatrix();
                for (let i = 0; i < this.maxPreviewHits; i++) {
                    this.previewInstancedMesh.setMatrixAt(i, this.dummy.matrix);
                }
                this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
                this.previewCursor = 0; 
                this.lastHitPoint = null;
                this.lastRayOrigin = null;
                this.lastRayDirection = null;
                this.lastHitNormal = null;
                this.smoothedRayDir = null;
            };
    
            this.clearPreviewPoints();
            this.el.sceneEl.object3D.add(this.previewInstancedMesh);
    
            this.maxHits = 40000; 
            const paintGeo = new THREE.CircleGeometry(0.5, 16); 
            
            const hexColors = [0xff0000, 0xffff00, 0x00aaff];
            for (let i = 0; i < 3; i++) {
                const paintMat = new THREE.MeshBasicMaterial({ 
                    color: hexColors[i], 
                    transparent: true, 
                    opacity: 0.8, 
                    depthTest: true, 
                    depthWrite: false,
                    side: THREE.DoubleSide 
                });
                const mesh = new THREE.InstancedMesh(paintGeo, paintMat, this.maxHits);
                mesh.frustumCulled = false; 
                mesh.count = 0; 
                mesh.renderOrder = 998;
                this.el.sceneEl.object3D.add(mesh);
                this.hitMeshes.push(mesh);
            }
            
            this.cameraEl = document.querySelector('a-camera');
            this.hasLoaded = true;
        });
    },
    
    toggleMode: function() {
        if (!this.isGrabbedVR && !this.isGrabbedDesktop) return;
        
        this.currentMode = (this.currentMode + 1) % 3;
        
        if (this.raycasterEntity.hasAttribute('raycaster')) {
            this.activateLaser();
        }
        
        const modeNames = ['3rd Deg (Red)', '2nd Deg (Yellow)', '1st Deg (Blue)'];
        const modeColors = ['#ff0000', '#ffff00', '#00aaff'];
        const hexColors = [0xff0000, 0xffff00, 0x00aaff];
        
        if (this.previewInstancedMesh) {
            this.previewInstancedMesh.material.color.setHex(hexColors[this.currentMode]);
        }
        
        const hudText = document.getElementById('hud-loading-text');
        if (hudText) {
            hudText.setAttribute('value', `Mode:\n${modeNames[this.currentMode]}`);
            hudText.setAttribute('color', modeColors[this.currentMode]);
            if (this.hudTimeout) clearTimeout(this.hudTimeout);
            this.hudTimeout = setTimeout(() => {
                if (!this.isFiring) hudText.setAttribute('value', '');
            }, 1500);
        }
        
        if (this.grabbedBy) {
            const gamepad = this.grabbedBy.components['tracked-controls']?.controller;
            if (gamepad && gamepad.hapticActuators && gamepad.hapticActuators.length > 0) {
                gamepad.hapticActuators[0].pulse(0.6, 100);
            }
        }
    },

    orientSegment: function(p1, p2) {
        const segDist = p1.distanceTo(p2);
        if (segDist < 0.0001) return false;
        
        const midP = p1.clone().lerp(p2, 0.5);
        this.dummy.position.copy(midP);
        this.dummy.scale.set(1, segDist, 1);
        
        const dir = p2.clone().sub(p1).normalize();
        this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.dummy.updateMatrix();
        return true;
    },
    
    onVRGripDown: function(evt, hand) { if (!this.isGrabbedVR && !this.isGrabbedDesktop && this.isHovered) this.pickupVR(hand); },
    onVRGripUp: function(evt, hand) { if (this.isGrabbedVR && this.grabbedBy === hand) this.dropVR(); },
    onVRTriggerDown: function(evt, hand) { if(this.isGrabbedVR && this.grabbedBy === hand) this.isFiring = true; },
    onVRTriggerUp: function(evt, hand) { if(this.isGrabbedVR && this.grabbedBy === hand) this.isFiring = false; },
    
    pickupVR: function(hand) {
        this.isGrabbedVR = true; this.grabbedBy = hand; this.isHovered = false;
        this.el.removeAttribute('dynamic-body');
        this.el.setAttribute('position', '0 0.02 -0.06'); 
        this.el.setAttribute('rotation', '-135 0 0'); 
        hand.object3D.add(this.el.object3D);
        
        const handMesh = hand.getObject3D('mesh');
        if (handMesh) handMesh.visible = false;
        
        const handRay = hand.querySelector('.hand-ray');
        if (handRay) {
            handRay.setAttribute('raycaster', 'showLine', false);
            handRay.setAttribute('raycaster', 'enabled', false);
        }
        this.activateLaser();
    },
    
    dropVR: function() {
        if (this.grabbedBy) {
            const handMesh = this.grabbedBy.getObject3D('mesh');
            if (handMesh) handMesh.visible = true;
            const handRay = this.grabbedBy.querySelector('.hand-ray');
            if (handRay) {
                handRay.setAttribute('raycaster', 'showLine', true);
                handRay.setAttribute('raycaster', 'enabled', true);
            }
        }
        this.isGrabbedVR = false; this.isFiring = false; this.grabbedBy = null;
        this.el.sceneEl.object3D.add(this.el.object3D);
        this.el.setAttribute('position', this.originalPosition);
        this.el.setAttribute('rotation', this.originalRotation); 
        this.el.setAttribute('dynamic-body', 'shape: box; mass: 0.5; linearDamping: 0.8; angularDamping: 0.8');
        this.deactivateLaser();
    },
    
    onHoverEnter: function () { if (this.isGrabbedDesktop || this.isGrabbedVR) return; this.isHovered = true; },
    onHoverLeave: function () { this.isHovered = false; },
    onKeyDown: function (e) {
        if (e.key.toLowerCase() === 'e') {
            if (!this.isGrabbedDesktop && this.isHovered && !this.isGrabbedVR) {
                this.pickupDesktop();
            } else if (this.isGrabbedDesktop) {
                this.dropDesktop();
            }
        }
        if (e.key.toLowerCase() === 'c') {
            this.toggleMode();
        }
    },
    onMouseDown: function (e) { if (e.button === 0 && this.isGrabbedDesktop) this.isFiring = true; },
    onMouseUp: function (e) { if (e.button === 0 && this.isGrabbedDesktop) this.isFiring = false; },
    
    pickupDesktop: function () {
        this.isGrabbedDesktop = true; this.isHovered = false;
        this.el.removeAttribute('dynamic-body');
        this.activateLaser();
    },
    
    dropDesktop: function () {
        this.isGrabbedDesktop = false; this.isFiring = false;
        this.el.setAttribute('position', this.originalPosition);
        this.el.setAttribute('rotation', this.originalRotation); 
        this.el.setAttribute('dynamic-body', 'shape: box; mass: 0.5; linearDamping: 0.8; angularDamping: 0.8');
        this.deactivateLaser();
    },
    
    activateLaser: function () {
        const rayColors = ['red', 'yellow', '#00aaff'];
        this.raycasterEntity.setAttribute('raycaster', `showLine: true; near: 0; far: 20; interval: 50; objects: .target; lineColor: ${rayColors[this.currentMode]}; lineOpacity: 0.8`);
        this.raycasterEntity.setAttribute('cursor', 'rayOrigin: entity; defaultCursor: true');
    },
    deactivateLaser: function () {
        this.raycasterEntity.removeAttribute('raycaster');
        this.raycasterEntity.removeAttribute('cursor');
    },
    
    tick: function (time, timeDelta) {
        if (this.isGrabbedDesktop) {
            const camera = document.querySelector('a-camera');
            const cam3D = camera.object3D;
            const offset = new THREE.Vector3(0.3, -0.3, -0.5);
            offset.applyMatrix4(cam3D.matrixWorld);
            this.el.object3D.position.copy(offset);
            this.el.object3D.quaternion.copy(cam3D.quaternion);
            this.el.object3D.rotateX(-Math.PI / 2); 
        }
    
        if (this.hasLoaded) {
            if (this.isFiring) {
                if (!this.wasFiring) this.startDrawing();
                
                if (time - this.lastFireTime > this.fireInterval) {
                    this.fireLaser();
                    this.lastFireTime = time;
                }
            } else {
                if (this.wasFiring) this.stopDrawing();
            }
            this.wasFiring = this.isFiring;
        }
    },
    
    startDrawing: function() {
        this.isProcessing = false;
        if (this.processTimeout) clearTimeout(this.processTimeout);
        this.points3D = [];
        this.lastHitPoint = null;
        this.lastHitNormal = null;
        this.lastRayOrigin = null;
        this.lastRayDirection = null;
        this.smoothedRayDir = null;
        
        if (this.clearPreviewPoints) this.clearPreviewPoints();
        const areaUI = document.getElementById('area-display');
        if (areaUI) areaUI.style.display = 'none';
        
        const billboardText = document.getElementById('billboard-text');
        if (billboardText) billboardText.setAttribute('value', 'Scanning...');
        
        const hudText = document.getElementById('hud-loading-text');
        if (hudText) hudText.setAttribute('value', '');
    },
    
    fireLaser: function () {
        const rawOrigin = new THREE.Vector3();
        const rawDirection = new THREE.Vector3(0, 0, -1);
        this.raycasterEntity.object3D.getWorldPosition(rawOrigin);
        rawDirection.transformDirection(this.raycasterEntity.object3D.matrixWorld).normalize();
    
        if (!this.smoothedRayDir) {
            this.smoothedRayDir = rawDirection.clone();
        } else {
            const angleDelta = this.smoothedRayDir.angleTo(rawDirection);
            if (angleDelta < 0.0035) {
                this.smoothedRayDir.copy(rawDirection);
            } else {
                const dynamicAlpha = THREE.MathUtils.clamp(angleDelta * 32, 0.35, 1.0);
                this.smoothedRayDir.lerp(rawDirection, dynamicAlpha).normalize();
            }
        }
        const rayDirection = this.smoothedRayDir;
    
        const targetEls = document.querySelectorAll('.target');
        const targetMeshes = Array.from(targetEls).map(el => el.getObject3D('mesh')).filter(m => m);
    
        this.manualRaycaster.set(rawOrigin, rayDirection);
        const currentIntersects = this.manualRaycaster.intersectObjects(targetMeshes, true);
    
        if (currentIntersects.length === 0) {
            this.lastHitPoint = null; 
            this.lastRayOrigin = null;
            this.lastRayDirection = null;
            this.lastHitNormal = null;
            return;
        }
    
        const hit = currentIntersects[0];
        const rawNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    
        let effectiveDeadzone = 0.0025; 
        if (this.lastHitNormal) {
            const normalDiff = this.lastHitNormal.angleTo(rawNormal);
            if (normalDiff < 0.2) {
                effectiveDeadzone = 0.0055;
            }
        }
    
        let hitNormal = rawNormal;
        if (this.lastHitNormal) {
            hitNormal = this.lastHitNormal.clone().lerp(rawNormal, 0.35).normalize();
        }
    
        const offsetPoint = hit.point.clone().addScaledVector(hitNormal, 0.004);
    
        if (this.lastHitPoint && this.lastRayOrigin && this.lastRayDirection) {
            const dist = this.lastHitPoint.distanceTo(offsetPoint);
    
            if (dist < effectiveDeadzone) {
                return; 
            }
    
            if (dist > 0.008 && dist < 0.2) {
                const steps = Math.min(Math.floor(dist / 0.005), 4); 
                for (let i = 1; i < steps; i++) {
                    const t = i / steps;
                    const interpOrigin = new THREE.Vector3().lerpVectors(this.lastRayOrigin, rawOrigin, t);
                    const interpDir = new THREE.Vector3().lerpVectors(this.lastRayDirection, rayDirection, t).normalize();
                    
                    this.manualRaycaster.set(interpOrigin, interpDir);
                    const intersects = this.manualRaycaster.intersectObjects(targetMeshes, true);
                    
                    if (intersects.length > 0) {
                        const iHit = intersects[0];
                        const iRawNormal = iHit.face.normal.clone().transformDirection(iHit.object.matrixWorld).normalize();
                        const iNormal = hitNormal.clone().lerp(iRawNormal, 0.35).normalize();
                        const iOffset = iHit.point.clone().addScaledVector(iNormal, 0.004);
                        this.points3D.push(iOffset);
                        
                        if (this.previewCursor < this.maxPreviewHits) {
                            const lastP = this.points3D[this.points3D.length - 2];
                            if (this.orientSegment(lastP, iOffset)) {
                                this.previewInstancedMesh.setMatrixAt(this.previewCursor, this.dummy.matrix);
                                this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
                                this.previewCursor++;
                            }
                        }
                    }
                }
            }
        }
    
        this.points3D.push(offsetPoint);
        
        if (this.lastHitPoint && this.previewCursor < this.maxPreviewHits && this.lastHitPoint.distanceTo(offsetPoint) < 0.2) {
            if (this.orientSegment(this.lastHitPoint, offsetPoint)) {
                this.previewInstancedMesh.setMatrixAt(this.previewCursor, this.dummy.matrix);
                this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
                this.previewCursor++;
            }
        }
    
        this.lastHitPoint = offsetPoint.clone();
        this.lastRayOrigin = rawOrigin.clone();
        this.lastRayDirection = rayDirection.clone();
        this.lastHitNormal = hitNormal.clone();
    },
    
    isPointInPolygon: function(px, py, polygon) {
        let isInside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            let xi = polygon[i].x, yi = polygon[i].y;
            let xj = polygon[j].x, yj = polygon[j].y;
            let intersect = ((yi > py) != (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect) isInside = !isInside;
        }
        return isInside;
    },
    
    stopDrawing: function() {
        const billboardText = document.getElementById('billboard-text');
        const hudText = document.getElementById('hud-loading-text');
    
        const spacingEl = document.getElementById('spacing-val');
        const uiSpacing = spacingEl ? (parseFloat(spacingEl.getAttribute('value')) || 1.5) : 1.5;
        const pointDensity = 45 * (1.5 / Math.max(0.1, uiSpacing)); 
    
        const dotSizeEl = document.getElementById('dot-size-val');
        const uiDotSize = dotSizeEl ? (parseFloat(dotSizeEl.getAttribute('value')) || 1.0) : 1.0;
        const finalDotSize = uiDotSize / 100; 
    
        let maxSpan = 0;
        let gapDistance = 0;
        let pathLength = 0; 
    
        if (this.points3D.length > 0) {
            let box = new THREE.Box3().setFromPoints(this.points3D);
            let size = new THREE.Vector3();
            box.getSize(size);
            maxSpan = size.length(); 
            
            const firstPoint = this.points3D[0];
            const lastPoint = this.points3D[this.points3D.length - 1];
            gapDistance = firstPoint.distanceTo(lastPoint);
    
            for (let i = 1; i < this.points3D.length; i++) {
                pathLength += this.points3D[i-1].distanceTo(this.points3D[i]);
            }
        }
    
        if (
            this.points3D.length < 5 || 
            maxSpan < 0.01 || 
            pathLength < gapDistance * 1.5 || 
            (gapDistance > maxSpan * 0.5 && gapDistance > 0.02)
        ) {
            if (billboardText) billboardText.setAttribute('value', 'Ready to scan');
            if (hudText) hudText.setAttribute('value', '');
            if (this.clearPreviewPoints) this.clearPreviewPoints();
            return;
        }
    
        if (gapDistance > 0.001 && this.previewInstancedMesh && this.previewCursor < this.maxPreviewHits) {
            const firstPoint = this.points3D[0];
            const lastPoint = this.points3D[this.points3D.length - 1];
            if (this.orientSegment(lastPoint, firstPoint)) {
                this.previewInstancedMesh.setMatrixAt(this.previewCursor, this.dummy.matrix);
                this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
                this.previewCursor++;
            }
        }
    
        if (billboardText) billboardText.setAttribute('value', 'Processing...');
    
        const activeCamera = this.cameraEl.components.camera.camera;
        const staticCamera = activeCamera.clone(); 
        
        const ndcPoints = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
        this.points3D.forEach(p3d => {
            const pNdc = p3d.clone().project(staticCamera);
            ndcPoints.push({ x: pNdc.x, y: pNdc.y });
            if (pNdc.x < minX) minX = pNdc.x;
            if (pNdc.x > maxX) maxX = pNdc.x;
            if (pNdc.y < minY) minY = pNdc.y;
            if (pNdc.y > maxY) maxY = pNdc.y;
        });
    
        const marginX = (maxX - minX) * 0.05;
        const marginY = (maxY - minY) * 0.05;
        minX -= marginX; maxX += marginX;
        minY -= marginY; maxY += marginY;
        
        const resX = Math.max(3, Math.ceil((maxX - minX) * pointDensity));
        const resY = Math.max(3, Math.ceil((maxY - minY) * pointDensity));
        
        let indexX = 0;
        let indexY = 0;
    
        let totalAreaSqMeters = 0;
        const raycaster = new THREE.Raycaster();
        raycaster.firstHitOnly = true; 
    
        const targetEls = document.querySelectorAll('.target');
        const targetMeshes = Array.from(targetEls).map(el => el.getObject3D('mesh')).filter(m => m);
    
        const fov = staticCamera.fov * (Math.PI / 180);
        const aspect = staticCamera.aspect;
        
        this.isProcessing = true; 
        
        const processChunk = () => {
            if (!this.isProcessing) return; 
            
            const chunkStartTime = performance.now();
            let processedSteps = 0;
            
            while (indexX <= resX) {
                let currentX = minX + (indexX / resX) * (maxX - minX);
                
                while (indexY <= resY) {
                    let currentY = minY + (indexY / resY) * (maxY - minY);
                    processedSteps++;
    
                    if (this.isPointInPolygon(currentX, currentY, ndcPoints)) {
                        raycaster.setFromCamera(new THREE.Vector2(currentX, currentY), staticCamera);
                        const intersects = raycaster.intersectObjects(targetMeshes, true);
    
                        if (intersects.length > 0) {
                            const hit = intersects[0];
                            const dist = hit.distance;
                            
                            const planeHeightAtDist = 2 * Math.tan(fov / 2) * dist;
                            const planeWidthAtDist = planeHeightAtDist * aspect;
                            
                            const patchWidth = (1 / resX) * planeWidthAtDist * (maxX - minX) / 2; 
                            const patchHeight = (1 / resY) * planeHeightAtDist * (maxY - minY) / 2;
                            const basePatchArea = Math.abs(patchWidth * patchHeight);
    
                            const rayDir = raycaster.ray.direction;
                            const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                            const cosTheta = Math.abs(rayDir.dot(normal));
    
                            const effectiveCosTheta = Math.max(cosTheta, 0.1); 
                            const trueSurfacePatchArea = basePatchArea / effectiveCosTheta;
                            totalAreaSqMeters += trueSurfacePatchArea;
    
                            if (this.hitCounts[this.currentMode] < this.maxHits) {
                                this.dummy.scale.set(finalDotSize, finalDotSize, 1);
                                this.dummy.position.copy(hit.point);
                                this.dummy.position.addScaledVector(normal, 0.003); 
                                this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
                                
                                this.dummy.updateMatrix();
                                this.hitMeshes[this.currentMode].setMatrixAt(this.hitCounts[this.currentMode], this.dummy.matrix);
                                this.hitCounts[this.currentMode]++;
                            }
                        }
                    }
                    indexY++;
                    
                    if (performance.now() - chunkStartTime > 12) {
                        this.hitMeshes[this.currentMode].count = this.hitCounts[this.currentMode];
                        this.hitMeshes[this.currentMode].instanceMatrix.needsUpdate = true;
                        
                        const totalSteps = (resX + 1) * (resY + 1);
                        const currentStepCount = (indexX * (resY + 1)) + indexY;
                        const progress = Math.min(99, Math.round((currentStepCount / totalSteps) * 100));
                        
                        if (billboardText) billboardText.setAttribute('value', `Loading: ${progress}%`);
                        if (hudText) hudText.setAttribute('value', `Loading: ${progress}%`);
                        
                        this.processTimeout = setTimeout(processChunk, 0); 
                        return;
                    }
                }
                indexY = 0; 
                indexX++;
            }
    
            this.isProcessing = false;
            
            if (this.clearPreviewPoints) this.clearPreviewPoints();
    
            this.hitMeshes[this.currentMode].count = this.hitCounts[this.currentMode];
            this.hitMeshes[this.currentMode].instanceMatrix.needsUpdate = true;
    
            // 🌟 1. 取得當下這筆繪製的面積
            const currentArea = (totalAreaSqMeters * 10000).toFixed(1);

            // 🌟 2. 將本次面積累加至對應的分級
            this.colorAreas[this.currentMode] += (totalAreaSqMeters * 10000);

            // 🌟 3. 取出各自面積與加總
            const redArea = this.colorAreas[0].toFixed(1);
            const yellowArea = this.colorAreas[1].toFixed(1);
            const blueArea = this.colorAreas[2].toFixed(1);
            const sumArea = (this.colorAreas[0] + this.colorAreas[1] + this.colorAreas[2]).toFixed(1);

            // 🌟 4. 更新 2D 網頁 UI
            const areaUI = document.getElementById('area-display');
            if (areaUI) {
                areaUI.innerHTML = `
                    <div style="font-size: 0.95em; color: #ddd; margin-bottom: 5px;">
                        本次掃描: <span style="color:#fff;">${currentArea} cm²</span>
                    </div>
                    <div style="font-size: 1.1em; font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid #555; padding-bottom: 5px;">
                        總表面積: <span style="color:#00ff66;">${sumArea} cm²</span>
                    </div>
                    <div style="color: #ff4d4d; font-size: 0.9em; margin-bottom: 3px;">■ 3度燒傷 (紅): ${redArea} cm²</div>
                    <div style="color: #ffdd44; font-size: 0.9em; margin-bottom: 3px;">■ 2度燒傷 (黃): ${yellowArea} cm²</div>
                    <div style="color: #44aaff; font-size: 0.9em;">■ 1度燒傷 (藍): ${blueArea} cm²</div>
                `;
                areaUI.style.display = 'block';
                areaUI.style.textAlign = 'left';
            }

            // 🌟 5. 分開更新 VR 內的專屬統計面板 (含當前次數面積)
            const statCurrent = document.getElementById('stat-current');
            const statTotal = document.getElementById('stat-total');
            const statRed = document.getElementById('stat-red');
            const statYellow = document.getElementById('stat-yellow');
            const statBlue = document.getElementById('stat-blue');
            
            if (statCurrent) statCurrent.setAttribute('value', `Current Scan: ${currentArea} cm2`);
            if (statTotal) statTotal.setAttribute('value', `Total Area: ${sumArea} cm2`);
            if (statRed) statRed.setAttribute('value', `3rd Deg (Red): ${redArea} cm2`);
            if (statYellow) statYellow.setAttribute('value', `2nd Deg (Yel): ${yellowArea} cm2`);
            if (statBlue) statBlue.setAttribute('value', `1st Deg (Blu): ${blueArea} cm2`);

            // 🌟 6. 將頂部狀態恢復為完成狀態
            if (billboardText) billboardText.setAttribute('value', 'Scan Complete');
            if (hudText) hudText.setAttribute('value', '');
        };
        
        processChunk(); 
    }
});