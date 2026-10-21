document.addEventListener('DOMContentLoaded', () => {
    const btnVR = document.getElementById('btn-enter-vr');
    const btnRestart = document.getElementById('btn-restart');
    const scene = document.querySelector('a-scene');
    const desktopCursor = document.getElementById('desktop-cursor');
    const bgmPlayer = document.querySelector('#bgm-player'); // 抓取 HTML 中的喇叭實體

    // --- 音樂播放機制開始 ---
    let isMusicPlaying = false; // 紀錄音樂是否已經在播放

    const playMusic = () => {
        if (!isMusicPlaying && bgmPlayer && bgmPlayer.components.sound) {
            bgmPlayer.components.sound.playSound(); // 播放音樂
            isMusicPlaying = true;
            // 成功播放後，移除滑鼠點擊監聽，避免不必要的效能浪費
            document.body.removeEventListener('click', playMusic);
        }
    };

    // 綁定：只要使用者在網頁上隨便點擊一下，就會觸發播放音樂
    document.body.addEventListener('click', playMusic);
    // --- 音樂播放機制結束 ---

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
            playMusic(); // 確保使用者點擊「進入 VR」時，音樂一定會播放
        });
    }
    
    if (btnRestart) {
        btnRestart.addEventListener('click', () => { 
            window.location.reload(); 
        });
    }
});