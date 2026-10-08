// 【新增】模型攔截器：強制將預設的 hand-controls 替換成自訂手套模型
AFRAME.registerComponent('override-hand-model', {
    schema: { type: 'asset' },
    dependencies: ['hand-controls'],
    init: function () {
        // 等 hand-controls 設定好後，強制把模型網址換成我們自己的
        this.el.setAttribute('gltf-model', this.data);
    }
});

// 原本的雷射筆與抓取邏輯
AFRAME.registerComponent('laser-pen-behavior', {
    init: function () {
        this.isGrabbedVR = false;
        this.isGrabbedDesktop = false;
        this.isHovered = false;
        this.isFiring = false;
        this.wasFiring = false; 
        this.grabbedBy = null; 
        this.lastPreviewTime = 0; 
        
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
        this.raycasterEntity.setAttribute('position', '0 0.25 0'); 
        this.raycasterEntity.setAttribute('rotation', '90 0 0');
        this.el.appendChild(this.raycasterEntity);

        const pos = this.el.getAttribute('position');
        const rot = this.el.getAttribute('rotation');
        this.originalPosition = { x: pos.x, y: pos.y, z: pos.z };
        this.originalRotation = { x: rot.x, y: rot.y, z: rot.z };
        
        this.el.sceneEl.addEventListener('loaded', () => {
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

            this.points3D = []; 
            
            // 邊界紅線材質
            this.lineMaterial = new THREE.LineBasicMaterial({ 
                color: 0xff0000, 
                depthTest: false, 
                depthWrite: false,
                visible: false  // 直接將紅線隱藏
            });
            this.lineGeometry = new THREE.BufferGeometry();
            this.lineMesh = new THREE.Line(this.lineGeometry, this.lineMaterial);
            this.lineMesh.renderOrder = 999;
            
            this.dummy = new THREE.Object3D(); 
            
            // 預覽塗料 (黃色)
            this.maxPreviewHits = 10000; 
            const previewGeo = new THREE.BoxGeometry(1, 1, 0.002); 
            const previewMat = new THREE.MeshBasicMaterial({ 
                color: 0xFFEA00, transparent: true, opacity: 0.5, depthTest: true, depthWrite: false 
            });
            this.previewInstancedMesh = new THREE.InstancedMesh(previewGeo, previewMat, this.maxPreviewHits);
            this.previewInstancedMesh.count = 0; 
            this.previewInstancedMesh.renderOrder = 997;

            // 最終塗料 (綠色)
            this.maxHits = 40000; 
            const paintGeo = new THREE.BoxGeometry(1, 1, 0.002); 
            const paintMat = new THREE.MeshBasicMaterial({ 
                color: 0x00ff66, transparent: true, opacity: 0.85, depthTest: true, depthWrite: false 
            });
            this.hitInstancedMesh = new THREE.InstancedMesh(paintGeo, paintMat, this.maxHits);
            this.hitInstancedMesh.count = 0; 
            this.hitInstancedMesh.renderOrder = 998;
            
            this.el.sceneEl.object3D.add(this.lineMesh);
            this.el.sceneEl.object3D.add(this.previewInstancedMesh);
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
        
        // 位置：移到控制器上方偏前
        this.el.setAttribute('position', '0 0.02 -0.06'); 
        // 角度：-135 剛好順著食指的方向
        this.el.setAttribute('rotation', '-135 0 0'); 
        
        hand.object3D.add(this.el.object3D);
        
        // 【隱藏替換法】抓取時隱藏原本的手掌模型
        const handMesh = hand.getObject3D('mesh');
        if (handMesh) handMesh.visible = false;
        
        // 抓取雷射筆時，關閉手把預設的青色抓取射線
        const handRay = hand.querySelector('.hand-ray');
        if (handRay) {
            handRay.setAttribute('raycaster', 'showLine', false);
            handRay.setAttribute('raycaster', 'enabled', false);
        }
        
        this.activateLaser();
    },
    
    dropVR: function() {
        // 【隱藏替換法】放下時恢復顯示手掌模型
        if (this.grabbedBy) {
            const handMesh = this.grabbedBy.getObject3D('mesh');
            if (handMesh) handMesh.visible = true;
            
            // 放下雷射筆時，恢復手把預設的青色抓取射線
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
    onHoverLeave: function () {
        this.isHovered = false;
    },
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

    activateLaser: function () {
        this.raycasterEntity.setAttribute('raycaster', 'showLine: true; far: 20; objects: .target; lineColor: red; lineOpacity: 0.8');
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
                
                if (time - this.lastPreviewTime > 80) {
                    this.updatePreviewFill();
                    this.lastPreviewTime = time;
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
        this.lineGeometry.setFromPoints(this.points3D);
        
        this.hitInstancedMesh.count = 0; 
        this.hitInstancedMesh.instanceMatrix.needsUpdate = true;
        
        this.previewInstancedMesh.count = 0;
        this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
        
        const areaUI = document.getElementById('area-display');
        if (areaUI) areaUI.style.display = 'none';

        const billboardText = document.getElementById('billboard-text');
        if (billboardText) billboardText.setAttribute('text', 'value', 'Drawing...');
    },

    fireLaser: function () {
        const raycasterComponent = this.raycasterEntity.components.raycaster;
        if (!raycasterComponent || !raycasterComponent.intersections) return;

        const intersections = raycasterComponent.intersections;
        if (intersections && intersections.length > 0) {
            const hitNormal = intersections[0].face.normal.clone().transformDirection(intersections[0].object.matrixWorld).normalize();
            const offsetPoint = intersections[0].point.clone().addScaledVector(hitNormal, 0.002);
            
            this.points3D.push(offsetPoint);
            this.lineGeometry.setFromPoints(this.points3D);
            this.lineGeometry.computeBoundingSphere();
        }
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

    updatePreviewFill: function() {
        if (this.points3D.length < 3) return;

        const camera = this.cameraEl.components.camera.camera;
        const ndcPoints = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        this.points3D.forEach(p3d => {
            const pNdc = p3d.clone().project(camera);
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

        const resolution = 15; 
        const stepX = (maxX - minX) / resolution;
        const stepY = (maxY - minY) / resolution;
        if (stepX <= 0 || stepY <= 0) return;

        const raycaster = new THREE.Raycaster();
        const targetEls = document.querySelectorAll('.target');
        const targetMeshes = Array.from(targetEls).map(el => el.getObject3D('mesh')).filter(m => m);

        let hitCount = 0;
        const fov = camera.fov * (Math.PI / 180);
        const aspect = camera.aspect;

        for (let x = minX; x <= maxX; x += stepX) {
            for (let y = minY; y <= maxY; y += stepY) {
                if (this.isPointInPolygon(x, y, ndcPoints)) {
                    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
                    const intersects = raycaster.intersectObjects(targetMeshes, true);

                    if (intersects.length > 0) {
                        const hit = intersects[0];
                        
                        if (hitCount < this.maxPreviewHits) {
                            const dist = hit.distance;
                            const planeHeightAtDist = 2 * Math.tan(fov / 2) * dist;
                            const planeWidthAtDist = planeHeightAtDist * aspect;
                            const patchWidth = (stepX / 2) * planeWidthAtDist; 
                            const patchHeight = (stepY / 2) * planeHeightAtDist;

                            const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                            
                            this.dummy.scale.set(patchWidth * 2.5, patchHeight * 2.5, 1);
                            this.dummy.position.copy(hit.point);
                            this.dummy.position.addScaledVector(normal, 0.002);
                            this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
                            
                            this.dummy.updateMatrix();
                            this.previewInstancedMesh.setMatrixAt(hitCount, this.dummy.matrix);
                            hitCount++;
                        }
                    }
                }
            }
        }
        this.previewInstancedMesh.count = hitCount;
        this.previewInstancedMesh.instanceMatrix.needsUpdate = true;
    },

    stopDrawing: function() {
        if (this.points3D.length < 3) {
            const billboardText = document.getElementById('billboard-text');
            if (billboardText) billboardText.setAttribute('text', 'value', 'Ready');
            return;
        }

        this.previewInstancedMesh.count = 0;
        this.previewInstancedMesh.instanceMatrix.needsUpdate = true;

        const billboardText = document.getElementById('billboard-text');
        if (billboardText) billboardText.setAttribute('text', 'value', 'Painting...');

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

        const resolution = 40; 
        const stepX = (maxX - minX) / resolution;
        const stepY = (maxY - minY) / resolution;
        if (stepX <= 0 || stepY <= 0) return;
        
        let totalAreaSqMeters = 0;
        let hitCount = 0;
        this.hitInstancedMesh.count = 0;

        const raycaster = new THREE.Raycaster();
        const targetEls = document.querySelectorAll('.target');
        const targetMeshes = Array.from(targetEls).map(el => el.getObject3D('mesh')).filter(m => m);

        const fov = staticCamera.fov * (Math.PI / 180);
        const aspect = staticCamera.aspect;

        let currentX = minX;
        let currentY = minY;
        
        this.isProcessing = true; 
        let lastTextUpdateTime = 0; 
        
        const processChunk = () => {
            if (!this.isProcessing) return; 
            
            const chunkStartTime = performance.now();
            
            while (currentX <= maxX) {
                while (currentY <= maxY) {
                    if (this.isPointInPolygon(currentX, currentY, ndcPoints)) {
                        raycaster.setFromCamera(new THREE.Vector2(currentX, currentY), staticCamera);
                        const intersects = raycaster.intersectObjects(targetMeshes, true);

                        if (intersects.length > 0) {
                            const hit = intersects[0];
                            const dist = hit.distance;
                            const planeHeightAtDist = 2 * Math.tan(fov / 2) * dist;
                            const planeWidthAtDist = planeHeightAtDist * aspect;
                            
                            const patchWidth = (stepX / 2) * planeWidthAtDist; 
                            const patchHeight = (stepY / 2) * planeWidthAtDist;
                            const basePatchArea = patchWidth * patchHeight;

                            const rayDir = raycaster.ray.direction;
                            const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                            const cosTheta = Math.abs(rayDir.dot(normal));

                            const effectiveCosTheta = Math.max(cosTheta, 0.1); 
                            const trueSurfacePatchArea = basePatchArea / effectiveCosTheta;
                            totalAreaSqMeters += trueSurfacePatchArea;

                            if (hitCount < this.maxHits) {
                                this.dummy.scale.set(patchWidth * 2.5, patchHeight * 2.5, 1);
                                this.dummy.position.copy(hit.point);
                                this.dummy.position.addScaledVector(normal, 0.002); 
                                this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), normal);
                                
                                this.dummy.updateMatrix();
                                this.hitInstancedMesh.setMatrixAt(hitCount, this.dummy.matrix);
                                hitCount++;
                            }
                        }
                    }
                    currentY += stepY;
                    
                    if (performance.now() - chunkStartTime > 15) {
                        this.hitInstancedMesh.count = hitCount;
                        this.hitInstancedMesh.instanceMatrix.needsUpdate = true;
                        
                        if (performance.now() - lastTextUpdateTime > 250) {
                            const progress = Math.min(100, Math.round(((currentX - minX) / (maxX - minX)) * 100));
                            if (billboardText) billboardText.setAttribute('text', 'value', `Painting: ${progress}%`);
                            lastTextUpdateTime = performance.now();
                        }
                        
                        this.processTimeout = setTimeout(processChunk, 0); 
                        return;
                    }
                }
                currentY = minY;
                currentX += stepX;
            }

            this.isProcessing = false;
            this.hitInstancedMesh.count = hitCount;
            this.hitInstancedMesh.instanceMatrix.needsUpdate = true;

            const closedPoints = [...this.points3D, this.points3D[0]];
            this.lineGeometry.setFromPoints(closedPoints);

            const areaCm2 = (totalAreaSqMeters * 10000).toFixed(1);
            
            const areaUI = document.getElementById('area-display');
            if (areaUI) {
                areaUI.innerHTML = `塗層表面積:<br><span class="highlight">${areaCm2} cm²</span>`;
                areaUI.style.display = 'block';
            }

            if (billboardText) {
                billboardText.setAttribute('text', 'value', `True 3D Area:\n${areaCm2} cm2`);
            }
        };
        
        processChunk(); 
    }
});