AFRAME.registerComponent('hybrid-locomotion', {
    schema: { moveSpeed: { default: 0.05 }, turnSpeed: { default: 0.05 } },
    init: function () {
        this.leftY = 0; this.leftX = 0; this.rightY = 0; this.rightX = 0;
        this.keys = {};

        window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
        
        this.el.sceneEl.addEventListener('loaded', () => {
            const leftHand = document.querySelector('#left-hand');
            const rightHand = document.querySelector('#right-hand');
            
            if (leftHand) {
                leftHand.addEventListener('thumbstickmoved', (evt) => { 
                    this.leftX = evt.detail.x; this.leftY = evt.detail.y; 
                });
            }
            if (rightHand) {
                rightHand.addEventListener('thumbstickmoved', (evt) => { 
                    this.rightX = evt.detail.x; this.rightY = evt.detail.y;
                });
            }
        });
    },
    tick: function () {
        const rig = this.el.object3D;
        const camera = document.querySelector('a-camera').object3D;

        let moveZ = this.leftY + this.rightY;
        let moveX = this.leftX + this.rightX;

        if (this.keys['KeyW']) moveZ -= 1;
        if (this.keys['KeyS']) moveZ += 1;
        if (this.keys['KeyA']) moveX -= 1;
        if (this.keys['KeyD']) moveX += 1;

        moveZ = Math.max(-1, Math.min(1, moveZ));
        moveX = Math.max(-1, Math.min(1, moveX));

        if (Math.abs(moveZ) > 0.05) {
            const direction = new THREE.Vector3(0, 0, 1);
            direction.applyQuaternion(camera.quaternion);
            direction.y = 0; direction.normalize();
            rig.position.addScaledVector(direction, moveZ * this.data.moveSpeed);
        }

        if (Math.abs(moveX) > 0.05) {
            const direction = new THREE.Vector3(1, 0, 0);
            direction.applyQuaternion(camera.quaternion);
            direction.y = 0; direction.normalize();
            rig.position.addScaledVector(direction, moveX * this.data.moveSpeed);
        }
    }
});