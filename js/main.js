document.addEventListener('DOMContentLoaded', () => {
    const btnVR = document.getElementById('btn-enter-vr');
    const btnRestart = document.getElementById('btn-restart');
    const scene = document.querySelector('a-scene');
    const desktopCursor = document.getElementById('desktop-cursor');

    if (scene) {
        scene.addEventListener('enter-vr', () => { 
            if (desktopCursor) desktopCursor.setAttribute('visible', 'false'); 
        });
        scene.addEventListener('exit-vr', () => { 
            if (desktopCursor) desktopCursor.setAttribute('visible', 'true'); 
        });
    }
    
    if (btnVR) {
        btnVR.addEventListener('click', () => { 
            if (scene) scene.enterVR(); 
        });
    }
    
    if (btnRestart) {
        btnRestart.addEventListener('click', () => { 
            window.location.reload(); 
        });
    }
});