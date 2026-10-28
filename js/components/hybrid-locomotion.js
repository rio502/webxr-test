AFRAME.registerComponent('hybrid-locomotion', {
    schema: { 
        moveSpeed: { default: 0.05 }, 
        turnSpeed: { default: 0.05 },
        snapAngle: { default: 45 } 
    },
    init: function () {
        // 移除了 rightY，因為右手不再負責任何位移
        this.leftY = 0; this.leftX = 0; this.rightX = 0;
        this.keys = {};
        this.canSnapTurn = true; 
        
        // 準備一個用來儲存相機「真實世界方向」的四元數
        this.cameraWorldQuat = new THREE.Quaternion();

        window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
        
        const bindControllers = () => {
            const leftHand = document.querySelector('#left-hand');
            const rightHand = document.querySelector('#right-hand');
            
            // 🌟 獨立抽取出「左手事件處理邏輯」（專職負責前後左右的平移）
            const handleLeftAxis = (evt) => { 
                this.leftX = evt.detail.x; 
                this.leftY = evt.detail.y; 
            };

            // 🌟 獨立抽取出「右手事件處理邏輯」（專職負責轉向，忽略 Y 軸數值）
            const handleRightAxis = (evt) => { 
                this.rightX = evt.detail.x;

                if (Math.abs(this.rightX) < 0.2) {
                    this.canSnapTurn = true; 
                } else if (this.canSnapTurn) {
                    if (this.rightX > 0.6) {
                        this.el.object3D.rotation.y -= THREE.MathUtils.degToRad(this.data.snapAngle);
                        this.canSnapTurn = false;
                    } else if (this.rightX < -0.6) {
                        this.el.object3D.rotation.y += THREE.MathUtils.degToRad(this.data.snapAngle);
                        this.canSnapTurn = false;
                    }
                }
            };

            if (leftHand) {
                // 🌟 讓左手同時聽懂 Quest 搖桿 (thumbstick) 與 VIVE 觸控板 (trackpad)
                leftHand.addEventListener('thumbstickmoved', handleLeftAxis);
                leftHand.addEventListener('trackpadmoved', handleLeftAxis);
            }
            if (rightHand) {
                // 🌟 讓右手同時聽懂 Quest 搖桿 (thumbstick) 與 VIVE 觸控板 (trackpad)
                rightHand.addEventListener('thumbstickmoved', handleRightAxis);
                rightHand.addEventListener('trackpadmoved', handleRightAxis);
            }
        };

        if (document.readyState === 'complete') {
            bindControllers();
        } else {
            window.addEventListener('load', bindControllers);
        }
    },
    tick: function () {
        const rig = this.el.object3D;
        const camera = document.querySelector('a-camera').object3D;

        // 🌟 關鍵修改：前後移動 (moveZ) 現在「只」受左手 (leftY) 影響
        let moveZ = this.leftY;
        let moveX = this.leftX; 

        if (this.keys['KeyW']) moveZ -= 1;
        if (this.keys['KeyS']) moveZ += 1;
        if (this.keys['KeyA']) moveX -= 1;
        if (this.keys['KeyD']) moveX += 1;

        moveZ = Math.max(-1, Math.min(1, moveZ));
        moveX = Math.max(-1, Math.min(1, moveX));

        // 如果完全沒有要移動，就提早結束，節省效能
        if (Math.abs(moveZ) <= 0.05 && Math.abs(moveX) <= 0.05) return;

        // 取得相機在「真實世界」中的旋轉，把 rig (身體) 的旋轉也算進來
        camera.getWorldQuaternion(this.cameraWorldQuat);

        if (Math.abs(moveZ) > 0.05) {
            const direction = new THREE.Vector3(0, 0, 1);
            // 改用 cameraWorldQuat，保證不論身體怎麼轉，前後方向都正確
            direction.applyQuaternion(this.cameraWorldQuat);
            direction.y = 0; 
            direction.normalize();
            rig.position.addScaledVector(direction, moveZ * this.data.moveSpeed);
        }

        if (Math.abs(moveX) > 0.05) {
            const direction = new THREE.Vector3(1, 0, 0);
            // 同樣套用真實世界的旋轉
            direction.applyQuaternion(this.cameraWorldQuat);
            direction.y = 0; 
            direction.normalize();
            rig.position.addScaledVector(direction, moveX * this.data.moveSpeed);
        }
    }
});