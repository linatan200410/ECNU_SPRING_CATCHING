/**
 * 华东师大校园巡礼 · 前端主逻辑
 * - 读取 config_v1.json 渲染地图节点与剧情/谜题
 * - 可选 Geolocation：实地模式下按距离解锁；否则为手动点击模式
 * - 进度：localStorage 键 ecnu_fragments
 * 依赖：需通过 HTTP(S) 托管页面，以便 fetch 加载 JSON
 */
// --- 1. 全局变量与状态 ---
let projectData = null;
let isLocationEnabled = false; 
let userCurrentCoords = null;  
let watchId = null;            
let hasShownManualModeTip = false;
let sakuraEnabled = true;
let totalFragmentsNeeded = 0;
// [DEV] 坐标拾取器：默认关闭；与 HTML/app 底部 [DEV] 注释块一同解开方可使用
let coordinatePickerEnabled = false;
let currentPickedCoords = null;
let slideshowInterval = null;
let slideshowIndex = 0;
let fadeTimeout = null;

// DOM 元素获取
const privacyModal = document.getElementById('privacy-modal');
const mapContainer = document.getElementById('map-container');
const toastContainer = document.getElementById('toast-container');
const toggleSakuraBtn = document.getElementById('toggle-sakura-btn');
// [DEV] 拾取器 DOM：生产环境 HTML 中对应节点已注释，故此处常量一并注释，避免误引用
// const togglePickerBtn = document.getElementById('toggle-picker-btn');
// const coordPickerPanel = document.getElementById('coord-picker-panel');
// const pickerNodeSelect = document.getElementById('picker-node-select');
// const pickerReadout = document.getElementById('picker-readout');
// const pickerSnippet = document.getElementById('picker-snippet');
// const copyPickerBtn = document.getElementById('copy-picker-btn');
// const applyPickerBtn = document.getElementById('apply-picker-btn');

// --- 2. 初始化：读取 JSON 数据 ---
// 使用 fetch API 获取同目录下的 config_v1.json
fetch('config_v1.json')
    .then(response => response.json())
    .then(data => {
        projectData = data;
        initializeFragmentTargets();
        cleanStoredProgress();
        // [DEV] initializeCoordinatePicker(); // 解注释以启用坐标拾取器
        updateProgressUI();
        renderMapNodes(); // 数据加载完后，渲染地图上的点
    })
    .catch(error => console.error("读取配置文件失败:", error));

// --- 3. 地图校准：经纬度 → 地图容器内百分比（与 config 中 map_calibration 一致）---
function getPositionPercentage(lat, lng) {
    const calib = projectData.project_config.map_calibration;
    
    // 计算 X 轴百分比 (经度 Lng，从西向东递增)
    const lngRange = calib.bottom_right.lng - calib.top_left.lng;
    const xPercent = ((lng - calib.top_left.lng) / lngRange) * 100;

    // 计算 Y 轴百分比 (纬度 Lat，从北向南递减)
    const latRange = calib.top_left.lat - calib.bottom_right.lat;
    const yPercent = ((calib.top_left.lat - lat) / latRange) * 100;

    return { x: xPercent, y: yPercent };
}

function getNodeDisplayPosition(node) {
    if (node.view_coords) {
        return node.view_coords;
    }

    const triggerCoords = node.trigger_coords || node.real_coords;
    if (triggerCoords && projectData.project_config.map_calibration) {
        return getPositionPercentage(triggerCoords.lat, triggerCoords.lng);
    }

    return { x: 50, y: 50 };
}

function getNodeTriggerCoords(node) {
    return node.trigger_coords || node.real_coords || null;
}

function getSelectedPickerNode() {
    if (!projectData) return null;
    return projectData.nodes.find(node => node.id === pickerNodeSelect.value) || null;
}

function formatViewCoords(coords) {
    return `"view_coords": { "x": ${coords.x.toFixed(1)}, "y": ${coords.y.toFixed(1)} }`;
}

function updatePickerDisplay(coords = currentPickedCoords) {
    const selectedNode = getSelectedPickerNode();
    const fallbackCoords = selectedNode ? selectedNode.view_coords : null;
    const activeCoords = coords || fallbackCoords;

    if (!selectedNode) {
        pickerReadout.textContent = '暂无可拾取节点。';
        pickerSnippet.value = '';
        return;
    }

    if (!activeCoords) {
        pickerReadout.textContent = `当前节点：${selectedNode.name}。点击地图任意位置，拾取新的 view_coords。`;
        pickerSnippet.value = '';
        return;
    }

    const sourceText = coords ? '新拾取' : '当前配置';
    pickerReadout.textContent = `${sourceText}坐标：${selectedNode.name} -> x ${activeCoords.x.toFixed(1)} / y ${activeCoords.y.toFixed(1)}`;
    pickerSnippet.value = formatViewCoords(activeCoords);
}

function setCoordinatePickerEnabled(enabled) {
    coordinatePickerEnabled = enabled;
    coordPickerPanel.classList.toggle('hidden', !enabled);
    togglePickerBtn.textContent = enabled ? '坐标拾取已开启' : '开启坐标拾取';
}

function renderPickerMarker(coords) {
    let marker = mapContainer.querySelector('.coord-pick-marker');
    if (!marker) {
        marker = document.createElement('div');
        marker.className = 'coord-pick-marker';
        mapContainer.appendChild(marker);
    }

    marker.style.left = `${coords.x}%`;
    marker.style.top = `${coords.y}%`;
}

function initializeCoordinatePicker() {
    pickerNodeSelect.innerHTML = projectData.nodes
        .map(node => `<option value="${node.id}">${node.name}</option>`)
        .join('');

    currentPickedCoords = null;
    updatePickerDisplay();
    setCoordinatePickerEnabled(true);
}

function handleCoordinatePick(event) {
    if (!coordinatePickerEnabled) return;

    const rect = mapContainer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const clampedCoords = {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y))
    };

    currentPickedCoords = clampedCoords;
    renderPickerMarker(clampedCoords);
    updatePickerDisplay(clampedCoords);
    event.preventDefault();
    event.stopPropagation();
}

// Haversine：两点球面距离（米），用于实地模式与 trigger_coords 比对
function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = value => value * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// --- 4. 渲染地图节点 ---
function renderMapNodes() {
    mapContainer.querySelectorAll('.map-node').forEach(marker => marker.remove());

    projectData.nodes.forEach((node, index) => {
        // 创建一个 div 作为地图上的图标
        const marker = document.createElement('div');
        marker.className = 'map-node';
        marker.innerText = index + 1; // 图标显示顺序编号
        
        // 视图层坐标只负责地图展示，不参与距离计算
        const pos = getNodeDisplayPosition(node);
        marker.style.left = `${pos.x}%`;
        marker.style.top = `${pos.y}%`;

        // 绑定点击事件
        marker.addEventListener('click', () => handleNodeClick(node));
        
        mapContainer.appendChild(marker);
    });
}

// --- 5. 点击交互逻辑 ---
function handleNodeClick(node) {
    if (isLocationEnabled && userCurrentCoords) {
        const triggerCoords = getNodeTriggerCoords(node);
        if (!triggerCoords) {
            showToast(`【${node.name}】暂未配置触发坐标`, 2200);
            return;
        }

        // 【实地模式】：计算真实物理距离
        const distance = getDistance(
            userCurrentCoords.lat, userCurrentCoords.lng,
            triggerCoords.lat, triggerCoords.lng
        );
        
        const triggerRadius = projectData.project_config.trigger_radius_meters;

        if (distance <= triggerRadius) {
            triggerNodeContent(node); // 走到了，触发剧情和答题
        } else {
            alert(
                `📍 目标锁定：【${node.name}】\n\n` +
                `📡 雷达扫描：你距离目标大约还有 ${Math.floor(distance)} 米。\n\n` +
                `💡 探险提示：放下手机，看看周围的风景，朝着目标方向再走近一点点，到达后再点击图标解锁吧！`
            );
        }
    } else {
        // 【手动模式】：无视距离，直接触发
        triggerNodeContent(node);
    }
}

// --- 底部抽屉：展示图文、导游文案或寻宝谜题（替代 alert 弹层）---
const bottomDrawer = document.getElementById('bottom-drawer');
const closeDrawerBtn = document.getElementById('close-drawer-btn');

closeDrawerBtn.addEventListener('click', closeDrawer);

function getNodeImages(node) {
    const imgs = node.assets && node.assets.illustrated_images;
    if (Array.isArray(imgs) && imgs.length > 0) return imgs;
    const single = node.assets && node.assets.illustrated_image;
    if (single) return [single];
    return ['assets/images/placeholder_scene.svg'];
}

function getNodeCuteImage(node) {
    const cuteImageMap = {
        '大夏路': 'assets/images/大夏路_cute.png',
        '第二教学楼': 'assets/images/第二教学楼_cute.png',
        '图书馆': 'assets/images/图书馆_cute.png',
        '大学生活动中心': 'assets/images/大学生活动中心_cute.png',
        '冬月食堂': 'assets/images/冬月厅_cute.png',
        '东操场': 'assets/images/东操场_cute.png'
    };

    return cuteImageMap[node.name] || '';
}

function setNpcImageSource(imgEl, src) {
    imgEl.onerror = () => {
        imgEl.onerror = null;
        imgEl.src = 'assets/images/placeholder_scene.svg';
    };
    imgEl.src = src;
}

function fadeToImage(imgEl, src, callback) {
    imgEl.style.opacity = '0';
    if (fadeTimeout) {
        clearTimeout(fadeTimeout);
    }
    fadeTimeout = setTimeout(() => {
        setNpcImageSource(imgEl, src);
        imgEl.style.opacity = '1';
        if (callback) callback();
        fadeTimeout = null;
    }, 420);
}

function renderImageDots(count, activeIndex) {
    const dotsEl = document.getElementById('image-dots');
    dotsEl.innerHTML = '';
    if (count <= 1) return;
    for (let i = 0; i < count; i++) {
        const dot = document.createElement('span');
        dot.className = 'image-dot' + (i === activeIndex ? ' active' : '');
        dotsEl.appendChild(dot);
    }
}

function updateActiveDot(index) {
    document.querySelectorAll('.image-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
    });
}

function startImageSlideshow(images) {
    stopImageSlideshow();
    const npcImage = document.getElementById('npc-image');
    slideshowIndex = 0;
    npcImage.style.opacity = '1';
    setNpcImageSource(npcImage, images[0]);
    npcImage.style.opacity = '1';
    renderImageDots(images.length, 0);
    if (images.length <= 1) return;
    slideshowInterval = setInterval(() => {
        slideshowIndex = (slideshowIndex + 1) % images.length;
        fadeToImage(npcImage, images[slideshowIndex], () => {
            updateActiveDot(slideshowIndex);
        });
    }, 3200);
}

function stopImageSlideshow() {
    if (slideshowInterval) {
        clearInterval(slideshowInterval);
        slideshowInterval = null;
    }
    if (fadeTimeout) {
        clearTimeout(fadeTimeout);
        fadeTimeout = null;
    }
    const dotsEl = document.getElementById('image-dots');
    if (dotsEl) dotsEl.innerHTML = '';
    const npcImage = document.getElementById('npc-image');
    if (npcImage) {
        npcImage.onerror = null;
        npcImage.src = '';
        npcImage.style.opacity = '0';
    }
}

// 处理正确答案的逻辑
function handleCorrectAnswer(nodeId) {
    // 查出节点真实名称，用于揭示
    const node = projectData.nodes.find(n => n.id === nodeId);
    const realName = node ? node.name : '';

    if (!collectedFragments.includes(nodeId)) {
        collectedFragments.push(nodeId);
        localStorage.setItem('ecnu_fragments', JSON.stringify(collectedFragments));

        // 揭示真实地点名称
        const npcName = document.getElementById('npc-name');
        if (npcName) npcName.textContent = `📍 ${realName}`;

        const riddleQuestion = document.getElementById('riddle-question');
        const riddleOptions  = document.getElementById('riddle-options');
        if (riddleQuestion) riddleQuestion.textContent = `✅ 获得碎片！当前进度 ${collectedFragments.length}/${totalFragmentsNeeded}`;
        if (riddleOptions)  riddleOptions.innerHTML = '';
        showToast(`已收集碎片 ${collectedFragments.length}/${totalFragmentsNeeded}`);
        updateProgressUI();
    } else {
        // 已收集过也揭示名称
        const npcName = document.getElementById('npc-name');
        if (npcName) npcName.textContent = `📍 ${realName}`;
        showToast("你之前已经拿过这里的碎片啦~");
    }
    setTimeout(() => { closeDrawer(); }, 1000);
}

function closeDrawer() {
    stopImageSlideshow();
    const npcCuteImage = document.getElementById('npc-cute-image');
    if (npcCuteImage) {
        npcCuteImage.src = '';
        npcCuteImage.style.display = 'none';
    }
    bottomDrawer.classList.remove('active');
    setTimeout(() => { bottomDrawer.style.display = 'none'; }, 400);
}

// 这是绑定在地图节点上的点击触发函数
function triggerNodeContent(node) {
    const npcName = document.getElementById('npc-name');
    const npcStory = document.getElementById('npc-story');
    const npcCuteImage = document.getElementById('npc-cute-image');
    const riddleSection = document.getElementById('riddle-section');
    const riddleQuestion = document.getElementById('riddle-question');
    const riddleOptions = document.getElementById('riddle-options');

    // 先 display:block 再设图片 src，避免在 display:none 时部分浏览器不发起图片请求
    bottomDrawer.style.display = 'block';
    setTimeout(() => { bottomDrawer.classList.add('active'); }, 10);

    // 每次打开节点时重建谜题区 DOM，避免上次答题后 innerHTML 被清空导致引用失效
    riddleSection.innerHTML = `
        <p id="riddle-question" class="question-text"></p>
        <div id="riddle-options" class="options-container"></div>`;
    riddleSection.style.display = 'none';

    // 填充公共信息（treasure 答对前保持神秘，guide 直接显示名称）
    npcName.innerText = node.type === 'treasure' ? '🗺️ 神秘坐标' : node.name;
    startImageSlideshow(getNodeImages(node));
    const cuteImageSrc = getNodeCuteImage(node);
    if (npcCuteImage) {
        if (cuteImageSrc) {
            npcCuteImage.src = cuteImageSrc;
            npcCuteImage.style.display = 'block';
        } else {
            npcCuteImage.src = '';
            npcCuteImage.style.display = 'none';
        }
    }

    // 根据节点类型分流渲染
    if (node.type === 'guide') {
        npcStory.innerText = node.guide_messages.intro;
        // guide 节点：在抽屉内容区追加「继续探索」按钮（treasure 由答题或延迟关闭）
        const drawerContent = document.querySelector('.drawer-content');
        let existingBtn = drawerContent.querySelector('.guide-close-btn');
        if (!existingBtn) {
            const btn = document.createElement('button');
            btn.className = 'guide-close-btn';
            btn.textContent = '继续探索 →';
            btn.addEventListener('click', closeDrawer);
            drawerContent.appendChild(btn);
        }

    } else if (node.type === 'treasure') {
        npcStory.innerText = node.story_snippet;
        // 重新获取刚恢复的 DOM 元素
        const freshQuestion = document.getElementById('riddle-question');
        const freshOptions  = document.getElementById('riddle-options');
        riddleSection.style.display = 'block';
        freshQuestion.innerText = node.riddle_data.question;

        node.riddle_data.options.forEach((optionText, index) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerText = optionText;
            btn.onclick = () => {
                if (index === node.riddle_data.correct_answer_index) {
                    handleCorrectAnswer(node.id);
                } else {
                    showToast('❌ 不对哦，再仔细想想！');
                }
            };
            freshOptions.appendChild(btn);
        });
    }
}

// --- 6. 权限弹窗事件绑定 ---
document.getElementById('btn-agree').addEventListener('click', () => {
    if (!navigator.geolocation) {
        alert("浏览器不支持定位，开启手动模式。");
        startManualMode();
        return;
    }
    document.getElementById('btn-agree').innerText = "获取卫星信号中...";
    navigator.geolocation.getCurrentPosition(
        position => {
            isLocationEnabled = true;
            userCurrentCoords = { lat: position.coords.latitude, lng: position.coords.longitude };
            privacyModal.style.display = 'none';
            alert("定位成功！请走向目标点。");
            
            // 开启持续追踪
            watchId = navigator.geolocation.watchPosition(pos => {
                userCurrentCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            }, err => console.error(err), { enableHighAccuracy: true });
        },
        error => {
            alert("定位失败，已为您切换为纯手动点击模式！");
            startManualMode();
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
});

document.getElementById('btn-manual').addEventListener('click', () => {
    startManualMode();
});

function startManualMode() {
    isLocationEnabled = false;
    privacyModal.style.display = 'none';
    showToast('已进入手动浏览模式，可自由点击查看点位内容。');
}

// --- 7. 进度管理模块 ---
let collectedFragments = JSON.parse(localStorage.getItem('ecnu_fragments')) || [];

function initializeFragmentTargets() {
    const treasureNodes = projectData.nodes.filter(node => node.type === 'treasure');
    const configTotal = projectData.project_config.total_fragments_needed;
    totalFragmentsNeeded = configTotal || treasureNodes.length;
    if (!configTotal) {
        totalFragmentsNeeded = treasureNodes.length;
    }

    const totalSpan = document.getElementById('fragment-total');
    const winTotalSpan = document.getElementById('win-total');
    totalSpan.innerText = String(totalFragmentsNeeded);
    winTotalSpan.innerText = String(totalFragmentsNeeded);
}

function cleanStoredProgress() {
    const validTreasureIds = new Set(
        projectData.nodes.filter(node => node.type === 'treasure').map(node => node.id)
    );
    collectedFragments = collectedFragments.filter(id => validTreasureIds.has(id));
    localStorage.setItem('ecnu_fragments', JSON.stringify(collectedFragments));
}

function updateProgressUI() {
    const countSpan = document.getElementById('fragment-count');
    countSpan.innerText = collectedFragments.length;
    
    // 简单的数字增加动效
    const badge = document.getElementById('progress-badge');
    badge.classList.add('bump');
    setTimeout(() => badge.classList.remove('bump'), 300);

    // 检查是否集齐
    if (totalFragmentsNeeded > 0 && collectedFragments.length >= totalFragmentsNeeded) {
        showWinModal();
    }
}

function showWinModal() {
    const winModal = document.getElementById('win-modal');
    winModal.style.display = 'flex';
}

document.getElementById('btn-restart-clear').addEventListener('click', () => {
    localStorage.removeItem('ecnu_fragments');
    location.reload();
});



/**
 * [调试专用] 在控制台执行 teleportTo('节点名称') 可模拟已到达该点（与 config 中 name 一致）。
 * 便于无 GPS 环境下调试实地解锁；正式对用户发布前建议移除或加环境开关。
 */
window.teleportTo = function(buildingName) {
    const target = projectData.nodes.find(n => n.name === buildingName);
    if (!target) return console.error("找不到这个建筑");
    const triggerCoords = getNodeTriggerCoords(target);
    if (!triggerCoords) return console.error("这个点位没有触发坐标");

    isLocationEnabled = true;
    userCurrentCoords = { lat: triggerCoords.lat, lng: triggerCoords.lng };

    alert(`[调试] 已模拟定位到【${buildingName}】，可点击地图对应节点测试解锁。`);
};
// --- 樱花飘落（可开关，定时创建 DOM 节点并在动画结束后移除以控制数量）---
function createSakura() {
    if (!sakuraEnabled) return;
    const petal = document.createElement('div');
    petal.classList.add('sakura-petal');
    
    // 随机决定花瓣在屏幕顶部的水平起始位置 (0vw 到 100vw 之间)
    petal.style.left = Math.random() * 100 + 'vw';
    
    // 随机花瓣的大小 (5px 到 25px 之间，营造景深感)
    const size = Math.random() * 20+5
    petal.style.width = size + 'px';
    petal.style.height = size + 'px';
    // 花瓣颜色（浅粉系）
    const sakuraColors = [
        '#FFF0F5', /* 极淡的紫粉色 (几近于白) */
        '#FFE4E1', /* 迷雾玫瑰色 */
        '#FFD1DC', /* 浅柔粉色 */
        '#FFC0CB', /* 经典樱花粉 */
        '#FFB7C5'  /* 稍微深一点的粉色 */
    ];
    // 随机从中抽取一个颜色赋给当前这片花瓣
    const randomColor = sakuraColors[Math.floor(Math.random() * sakuraColors.length)];
    petal.style.backgroundColor = randomColor;
    // 随机下落的时间速度 (3秒 到 10秒 之间，有的飘得快有的飘得慢)
    const fallDuration = Math.random() * 7 + 3;
    petal.style.animationDuration = fallDuration + 's';
    
    // 把花瓣挂载到整个网页的最外层
    document.body.appendChild(petal);
    
    // 性能优化：当花瓣落出屏幕后（也就是动画时间结束后），把它从代码里删掉，防止手机卡顿！
    setTimeout(() => {
        petal.remove();
    }, fallDuration * 1000); 
}

function showToast(message, duration = 1800) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// [DEV] 坐标拾取器：解开 HTML 拾取器区块后，同步解开下列 addEventListener
// mapContainer.addEventListener('click', handleCoordinatePick, true);
// pickerNodeSelect.addEventListener('change', () => { currentPickedCoords = null; updatePickerDisplay(); });
// togglePickerBtn.addEventListener('click', () => { setCoordinatePickerEnabled(!coordinatePickerEnabled); });
// copyPickerBtn.addEventListener('click', async () => {
//     if (!pickerSnippet.value) { showToast('请先点击地图拾取坐标'); return; }
//     try { await navigator.clipboard.writeText(pickerSnippet.value); showToast('已复制 view_coords 片段'); }
//     catch (e) { pickerSnippet.select(); document.execCommand('copy'); showToast('已复制 view_coords 片段'); }
// });
// applyPickerBtn.addEventListener('click', () => {
//     const selectedNode = getSelectedPickerNode();
//     if (!selectedNode || !currentPickedCoords) { showToast('请先选择节点并点击地图拾取坐标'); return; }
//     selectedNode.view_coords = { x: Number(currentPickedCoords.x.toFixed(1)), y: Number(currentPickedCoords.y.toFixed(1)) };
//     updatePickerDisplay(selectedNode.view_coords);
//     renderMapNodes();
//     renderPickerMarker(selectedNode.view_coords);
//     showToast(`已预览应用到【${selectedNode.name}】`);
// });

toggleSakuraBtn.addEventListener('click', () => {
    sakuraEnabled = !sakuraEnabled;
    toggleSakuraBtn.textContent = sakuraEnabled ? '关闭特效' : '开启特效';
    showToast(sakuraEnabled ? '已开启樱花特效' : '已关闭樱花特效');
});

// 每隔 500ms 生产一片新樱花，减少低端机压力
setInterval(createSakura, 500);