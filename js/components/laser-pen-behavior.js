AFRAME.registerComponent('laser-pen-behavior', {
    init: function () {
        this.isGrabbedVR = false;
        this.isGrabbedDesktop = false;
        this.isHovered = false;
        this.isFiring = false;
        this.wasFiring = false; 
        this.grabbedBy = null; 
        
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
        this.lastHitObject = null;

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
            const previewGeo = new THREE.BoxGeometry(0.006, 0.006, 1); 
            const previewMat = new THREE.MeshBasicMaterial({ color: 0x008cba, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false });
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
            };

            this.clearPreviewPoints();
            this.el.sceneEl.object3D.add(this.previewInstancedMesh);

            this.maxHits = 40000; 
            const paintGeo = new THREE.BoxGeometry(1, 1, 0.002); 
            const paintMat = new THREE.MeshBasicMaterial({ color: 0x008cba, transparent: true, opacity: 0.05, depthTest: true, depthWrite: false });
            this.hitInstancedMesh = new THREE.InstancedMesh(paintGeo, paintMat, this.maxHits);
            this.hitInstancedMesh.frustumCulled = false; 
            this.hitInstancedMesh.count = 0; 
            this.hitInstancedMesh.renderOrder = 998;
            this.el.sceneEl.object3D.add(this.hitInstancedMesh);
            
            this.cameraEl = document.querySelector('a-camera');
            this.hasLoaded = true;
        });
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

    onHoverEnter: function () {
        if (this.isGrabbedDesktop || this.isGrabbedVR) return;
        this.isHovered = true;
    },
    onHoverLeave: function () { this.isHovered = false; },
    onKeyDown: function (e) {
        if (e.key.toLowerCase() === 'e') {
            if (!this.isGrabbedDesktop && this.isHovered && !this.isGrabbedVR) {
                this.pickupDesktop();
            } else if (this.isGrabbedDesktop) {
                this.dropDesktop();
            }
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

    // 🌟 降頻救星：加了 interval: 50 讓射線不要隨時在 50 萬面的模型上瘋狂計算
    activateLaser: function () {
        this.raycasterEntity.setAttribute('raycaster', 'showLine: true; near: 0; far: 20; interval: 50; objects: .target; lineColor: red; lineOpacity: 0.8');
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
                this.fireLaser();
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
        this.lastHitObject = null;
        this.smoothedRayOrigin = null;
        this.smoothedRayDirection = null;
        if (this.clearPreviewPoints) this.clearPreviewPoints();
        if (this.hitInstancedMesh) {
            this.hitInstancedMesh.count = 0; 
            this.hitInstancedMesh.instanceMatrix.needsUpdate = true;
        }
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

        if (!this.smoothedRayOrigin || !this.smoothedRayDirection) {
            this.smoothedRayOrigin = rawOrigin.clone();
            this.smoothedRayDirection = rawDirection.clone();
        } else {
            const smoothFactor = 0.15; 
            this.smoothedRayOrigin.lerp(rawOrigin, smoothFactor);
            this.smoothedRayDirection.lerp(rawDirection, smoothFactor).normalize();
        }

        let targetMeshes = [];
        if (this.points3D.length > 0 && this.lastHitObject) {
            targetMeshes = [this.lastHitObject]; 
        } else {
            const targetEls = document.querySelectorAll('.target');
            targetMeshes = Array.from(targetEls).map(el => el.getObject3D('mesh')).filter(m => m);
        }

        this.manualRaycaster.set(this.smoothedRayOrigin, this.smoothedRayDirection);
        const currentIntersects = this.manualRaycaster.intersectObjects(targetMeshes, true);

        if (currentIntersects.length === 0) {
            this.lastHitPoint = null; 
            this.lastRayOrigin = null;
            this.lastRayDirection = null;
            this.lastHitNormal = null;
            return;
        }

        const hit = currentIntersects[0];
        this.lastHitObject = hit.object;

        const hitNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        const offsetPoint = hit.point.clone().addScaledVector(hitNormal, 0.003);

        if (this.lastHitPoint && this.lastRayOrigin && this.lastRayDirection && this.lastHitNormal) {
            const dist = this.lastHitPoint.distanceTo(offsetPoint);
            if (dist > 0.004 && dist < 0.15) {
                const steps = Math.min(Math.floor(dist / 0.004), 3); 
                for (let i = 1; i < steps; i++) {
                    const t = i / steps;
                    const interpOrigin = new THREE.Vector3().lerpVectors(this.lastRayOrigin, this.smoothedRayOrigin, t);
                    const interpDir = new THREE.Vector3().lerpVectors(this.lastRayDirection, this.smoothedRayDirection, t).normalize();
                    
                    this.manualRaycaster.set(interpOrigin, interpDir);
                    const intersects = this.manualRaycaster.intersectObjects(targetMeshes, true);
                    
                    if (intersects.length > 0) {
                        const iHit = intersects[0];
                        const iNormal = iHit.face.normal.clone().transformDirection(iHit.object.matrixWorld).normalize();
                        const iOffset = iHit.point.clone().addScaledVector(iNormal, 0.003);
                        this.points3D.push(iOffset);
                        
                        if (this.previewCursor < this.maxPreviewHits) {
                            const lastP = this.points3D[this.points3D.length - 2];
                            const midP = lastP.clone().lerp(iOffset, 0.5);
                            this.dummy.position.copy(midP);
                            this.dummy.scale.set(1, 1, lastP.distanceTo(iOffset));
                            const upVec = iNormal.clone();
                            const m = new THREE.Matrix4();
                            m.lookAt(midP, iOffset, upVec);
                            this.dummy.quaternion.setFromRotationMatrix(m);
                            this.dummy.updateMatrix();
                            this.previewInstancedMesh.setMatrixAt(this.previewCursor, this.dummy.matrix);
                            this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
                            this.previewCursor++;
                        }
                    }
                }
            }
        }

        this.points3D.push(offsetPoint);
        
        if (this.lastHitPoint && this.previewCursor < this.maxPreviewHits && this.lastHitPoint.distanceTo(offsetPoint) < 0.15) {
            const midP = this.lastHitPoint.clone().lerp(offsetPoint, 0.5);
            this.dummy.position.copy(midP);
            this.dummy.scale.set(1, 1, this.lastHitPoint.distanceTo(offsetPoint));
            const m = new THREE.Matrix4();
            m.lookAt(midP, offsetPoint, hitNormal);
            this.dummy.quaternion.setFromRotationMatrix(m);
            this.dummy.updateMatrix();
            this.previewInstancedMesh.setMatrixAt(this.previewCursor, this.dummy.matrix);
            this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
            this.previewCursor++;
        }

        this.lastHitPoint = offsetPoint.clone();
        this.lastRayOrigin = this.smoothedRayOrigin.clone();
        this.lastRayDirection = this.smoothedRayDirection.clone();
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
            if (billboardText) billboardText.setAttribute('value', 'Ready');
            if (hudText) hudText.setAttribute('value', '');
            if (this.clearPreviewPoints) this.clearPreviewPoints();
            return;
        }

        if (gapDistance > 0.001 && this.previewInstancedMesh && this.previewCursor < this.maxPreviewHits) {
            const firstPoint = this.points3D[0];
            const lastPoint = this.points3D[this.points3D.length - 1];
            const midPoint = lastPoint.clone().lerp(firstPoint, 0.5);
            
            this.dummy.position.copy(midPoint);
            this.dummy.scale.set(1, 1, gapDistance);
            
            const upVector = this.lastHitNormal ? this.lastHitNormal.clone() : new THREE.Vector3(0,1,0);
            const m = new THREE.Matrix4();
            m.lookAt(midPoint, firstPoint, upVector);
            this.dummy.quaternion.setFromRotationMatrix(m);
            
            this.dummy.updateMatrix();
            this.previewInstancedMesh.setMatrixAt(this.previewCursor, this.dummy.matrix);
            this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
            this.previewCursor++;
        }

        if (billboardText) billboardText.setAttribute('value', 'loading...');

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

        const resolution = 20; 
        let indexX = 0;
        let indexY = 0;

        let totalAreaSqMeters = 0;
        let hitCount = 0;
        this.hitInstancedMesh.count = 0;

        const raycaster = new THREE.Raycaster();
        raycaster.firstHitOnly = true; 

        let targetMeshes = [];
        if (this.lastHitObject) {
            targetMeshes = [this.lastHitObject]; 
        } else {
            const targetEls = document.querySelectorAll('.target');
            targetMeshes = Array.from(targetEls).map(el => el.getObject3D('mesh')).filter(m => m);
        }

        const fov = staticCamera.fov * (Math.PI / 180);
        const aspect = staticCamera.aspect;
        
        this.isProcessing = true; 
        
        const processChunk = () => {
            if (!this.isProcessing) return; 
            
            const chunkStartTime = performance.now();
            let processedSteps = 0;
            
            while (indexX <= resolution) {
                let currentX = minX + (indexX / resolution) * (maxX - minX);
                
                while (indexY <= resolution) {
                    let currentY = minY + (indexY / resolution) * (maxY - minY);
                    processedSteps++;

                    if (this.isPointInPolygon(currentX, currentY, ndcPoints)) {
                        raycaster.setFromCamera(new THREE.Vector2(currentX, currentY), staticCamera);
                        const intersects = raycaster.intersectObjects(targetMeshes, true);

                        if (intersects.length > 0) {
                            const hit = intersects[0];
                            const dist = hit.distance;
                            
                            const planeHeightAtDist = 2 * Math.tan(fov / 2) * dist;
                            const planeWidthAtDist = planeHeightAtDist * aspect;
                            const patchWidth = (1 / resolution) * planeWidthAtDist * (maxX - minX) / 2; 
                            const patchHeight = (1 / resolution) * planeHeightAtDist * (maxY - minY) / 2;
                            const basePatchArea = Math.abs(patchWidth * patchHeight);

                            const rayDir = raycaster.ray.direction;
                            const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                            const cosTheta = Math.abs(rayDir.dot(normal));

                            const effectiveCosTheta = Math.max(cosTheta, 0.1); 
                            const trueSurfacePatchArea = basePatchArea / effectiveCosTheta;
                            totalAreaSqMeters += trueSurfacePatchArea;

                            if (hitCount < this.maxHits) {
                                this.dummy.scale.set(patchWidth * 3.5, patchHeight * 3.5, 1);
                                this.dummy.position.copy(hit.point);
                                this.dummy.position.addScaledVector(normal, 0.002); 
                                this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
                                
                                this.dummy.updateMatrix();
                                this.hitInstancedMesh.setMatrixAt(hitCount, this.dummy.matrix);
                                hitCount++;
                            }
                        }
                    }
                    indexY++;
                    
                    if (performance.now() - chunkStartTime > 12) {
                        this.hitInstancedMesh.count = hitCount;
                        this.hitInstancedMesh.instanceMatrix.needsUpdate = true;
                        
                        const totalSteps = (resolution + 1) * (resolution + 1);
                        const currentStepCount = (indexX * (resolution + 1)) + indexY;
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

            this.hitInstancedMesh.count = hitCount;
            this.hitInstancedMesh.instanceMatrix.needsUpdate = true;

            const areaCm2 = (totalAreaSqMeters * 10000).toFixed(1);
            
            const areaUI = document.getElementById('area-display');
            if (areaUI) {
                areaUI.innerHTML = `塗層表面積:<br><span class="highlight">${areaCm2} cm²</span>`;
                areaUI.style.display = 'block';
            }

            const resultMsg = `True 3D Area:\n${areaCm2} cm2`;
            if (billboardText) billboardText.setAttribute('value', resultMsg);
            if (hudText) hudText.setAttribute('value', '');
        };
        
        processChunk(); 
    }
});