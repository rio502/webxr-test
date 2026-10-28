AFRAME.registerComponent('hybrid-locomotion', {
    schema: { 
        moveSpeed: { default: 0.05 }, 
        turnSpeed: { default: 0.05 },
        snapAngle: { default: 45 } 
    },
    init: function () {
        this.keys = {};
        this.canSnapTurn = true; 
        
        // 準備一個用來儲存相機「真實世界方向」的四元數
        this.cameraWorldQuat = new THREE.Quaternion();

        // 綁定鍵盤事件 (電腦版備用)
        window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    },
    tick: function () {
        const rig = this.el.object3D;
        const cameraEl = document.querySelector('a-camera');
        if (!cameraEl) return;
        const camera = cameraEl.object3D;

        let moveZ = 0;
        let moveX = 0; 
        let currentRightX = 0;

        // 1. 讀取鍵盤輸入
        if (this.keys['KeyW']) moveZ -= 1;
        if (this.keys['KeyS']) moveZ += 1;
        if (this.keys['KeyA']) moveX -= 1;
        if (this.keys['KeyD']) moveX += 1;

        // 🌟 2. 終極殺手鐧：直接強制讀取 WebXR 原生硬體數據 (完美支援 VIVE Focus Vision)
        if (this.el.sceneEl.renderer.xr.isPresenting) {
            const session = this.el.sceneEl.renderer.xr.getSession();
            if (session && session.inputSources) {
                for (let i = 0; i < session.inputSources.length; i++) {
                    const source = session.inputSources[i];
                    // 確保設備有提供 gamepad 數據，且軸向數量足夠
                    if (source && source.gamepad && source.gamepad.axes.length >= 4) {
                        
                        // WebXR 標準映射：axes[2] 是蘑菇頭左右 (X)，axes[3] 是蘑菇頭上下 (Y)
                        const axesX = source.gamepad.axes[2];
                        const axesY = source.gamepad.axes[3];
                        
                        // 設置微小的死區(Deadzone)，防止硬體搖桿老化飄移
                        const deadzone = 0.1;

                        if (source.handedness === 'left') {
                            // 左手負責位移
                            if (Math.abs(axesX) > deadzone) moveX += axesX;
                            if (Math.abs(axesY) > deadzone) moveZ += axesY;
                        } else if (source.handedness === 'right') {
                            // 右手負責轉向
                            if (Math.abs(axesX) > deadzone) {
                                currentRightX = axesX;
                            }
                        }
                    }
                }
            }
        }

        // --- 處理右手轉向 (Snap Turn) ---
        if (Math.abs(currentRightX) < 0.2) {
            this.canSnapTurn = true; 
        } else if (this.canSnapTurn) {
            if (currentRightX > 0.6) {
                rig.rotation.y -= THREE.MathUtils.degToRad(this.data.snapAngle);
                this.canSnapTurn = false;
            } else if (currentRightX < -0.6) {
                rig.rotation.y += THREE.MathUtils.degToRad(this.data.snapAngle);
                this.canSnapTurn = false;
            }
        }

        // --- 處理位移 ---
        moveZ = Math.max(-1, Math.min(1, moveZ));
        moveX = Math.max(-1, Math.min(1, moveX));

        if (Math.abs(moveZ) <= 0.05 && Math.abs(moveX) <= 0.05) return;

        // 取得相機真實世界旋轉，確保往前推就是「視覺上的正前方」
        camera.getWorldQuaternion(this.cameraWorldQuat);

        if (Math.abs(moveZ) > 0.05) {
            const direction = new THREE.Vector3(0, 0, 1);
            direction.applyQuaternion(this.cameraWorldQuat);
            direction.y = 0; 
            direction.normalize();
            rig.position.addScaledVector(direction, moveZ * this.data.moveSpeed);
        }

        if (Math.abs(moveX) > 0.05) {
            const direction = new THREE.Vector3(1, 0, 0);
            direction.applyQuaternion(this.cameraWorldQuat);
            direction.y = 0; 
            direction.normalize();
            rig.position.addScaledVector(direction, moveX * this.data.moveSpeed);
        }
    }
});